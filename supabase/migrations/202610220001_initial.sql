-- Apply to a new Supabase project as the migration owner.
create extension if not exists pgmq;
select pgmq.create('study_jobs');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 180),
  subject text not null check (subject in ('calculus','linear-algebra','physics')),
  file_type text not null check (file_type in ('pdf','docx')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  storage_path text not null unique,
  status text not null default 'uploading' check (status in ('uploading','queued','processing','ready','failed','deleting','deleted')),
  error text,
  index_version integer not null default 1,
  upload_key uuid not null,
  upload_cleanup_after timestamptz not null default now()+interval '3 hours 5 minutes',
  upload_cleanup_done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id,upload_key)
);
create index documents_owner on public.documents(user_id,created_at desc);

create table public.document_chunks (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  index_version integer not null,
  ordinal integer not null,
  content text not null,
  page integer,
  section text,
  paragraph integer,
  unique(document_id,index_version,ordinal)
);
create index chunks_document on public.document_chunks(document_id,index_version);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Phiên học mới' check (length(title) <= 120),
  created_at timestamptz not null default now()
);
create index conversations_owner on public.conversations(user_id,created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  status text not null default 'queued' check (status in ('queued','generating','completed','failed','interrupted')),
  sequence bigint generated always as identity,
  created_at timestamptz not null default now()
);
create index messages_conversation on public.messages(conversation_id,sequence);

create table public.message_sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  chunk_id uuid references public.document_chunks(id) on delete set null,
  document_id uuid not null references public.documents(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  document_name text not null,
  page integer,
  section text,
  paragraph integer,
  unique(message_id,label)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ingest','chat','delete')),
  document_id uuid references public.documents(id),
  message_id uuid references public.messages(id),
  payload jsonb not null default '{}',
  request_key uuid not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  attempts integer not null default 0,
  lease_token uuid,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(user_id,kind,request_key)
);
create unique index one_active_chat on public.jobs(user_id) where kind='chat' and status in ('queued','running');
create index jobs_owner on public.jobs(user_id,created_at desc);
create table public.worker_heartbeats (
  id text primary key,
  last_seen timestamptz not null default now()
);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_sources enable row level security;
alter table public.jobs enable row level security;
alter table public.worker_heartbeats enable row level security;

create policy documents_read on public.documents for select to authenticated using (user_id=(select auth.uid()));
create policy conversations_read on public.conversations for select to authenticated using (user_id=(select auth.uid()));
create policy messages_read on public.messages for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.conversations c where c.id=conversation_id and c.user_id=(select auth.uid()))
);
create policy chunks_read on public.document_chunks for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.documents d where d.id=document_id and d.user_id=(select auth.uid()) and d.status='ready' and d.index_version=document_chunks.index_version)
);
create policy sources_read on public.message_sources for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.messages m where m.id=message_id and m.user_id=(select auth.uid()) and m.status='completed')
);
create policy jobs_read on public.jobs for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.documents,public.document_chunks,public.conversations,public.messages,public.message_sources,public.jobs,public.worker_heartbeats from anon,authenticated;
grant select on public.documents,public.document_chunks,public.conversations,public.messages,public.message_sources,public.jobs to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('documents','documents',false,20971520,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
-- Uploads are signed by the API after a quota-checked intent. No client mutations.
create policy document_files_read on storage.objects for select to authenticated using (
  bucket_id='documents' and exists(select 1 from public.documents d where d.storage_path=name and d.user_id=(select auth.uid()) and d.status='ready')
);

create function public.app_worker_online() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.worker_heartbeats where last_seen > now()-interval '60 seconds');
$$;

create function public.app_require_online() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.app_worker_online() then raise exception 'WORKER_OFFLINE'; end if;
end $$;

create function public.app_upload_intent(p_name text,p_size bigint,p_subject text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.documents; ext text; new_id uuid:=gen_random_uuid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into d from public.documents where user_id=u and upload_key=p_key;
  if found then
    if d.name<>p_name or d.size_bytes<>p_size or d.subject<>p_subject then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(d);
  end if;
  perform public.app_require_online();
  ext:=lower(substring(p_name from '\.([^.]+)$'));
  if p_key is null or p_name is null or length(trim(p_name))=0 or p_size is null or ext is null or ext not in ('pdf','docx') or length(p_name)>180 or p_size not between 1 and 20971520 then raise exception 'INVALID_FILE'; end if;
  if p_subject is null or p_subject not in ('calculus','linear-algebra','physics') then raise exception 'INVALID_SUBJECT'; end if;
  if (select count(*) from public.documents where user_id=u and status<>'deleted')>=20 then raise exception 'DOCUMENT_LIMIT'; end if;
  insert into public.documents(id,user_id,name,subject,file_type,size_bytes,storage_path,upload_key)
  values(new_id,u,p_name,p_subject,ext,p_size,u::text||'/'||new_id::text||'.'||ext,p_key) returning * into d;
  return to_jsonb(d);
end $$;

create function public.app_enqueue_document(p_id uuid,p_action text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.documents; j public.jobs; k text;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into d from public.documents where id=p_id and user_id=u for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_key is null or p_action is null or p_action not in ('complete','retry','delete') then raise exception 'INVALID_ACTION'; end if;
  k:=case when p_action='delete' then 'delete' else 'ingest' end;
  select * into j from public.jobs where user_id=u and kind=k and request_key=p_key;
  if found then
    if j.document_id<>p_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(j);
  end if;
  -- Repeated requests with a fresh key also reuse the active document job.
  select * into j from public.jobs where document_id=p_id and kind=k and status in ('queued','running') limit 1;
  if found then return to_jsonb(j); end if;
  if p_action='delete' then
    if d.status='deleted' then return jsonb_build_object('status','completed'); end if;
    update public.documents set status='deleting',error=null where id=p_id;
  else
    perform public.app_require_online();
    if (p_action='complete' and d.status<>'uploading') or (p_action='retry' and d.status<>'failed') then raise exception 'INVALID_STATE'; end if;
    if p_action='retry' then
      update public.documents set index_version=index_version+1 where id=p_id returning * into d;
    end if;
    update public.documents set status='queued',error=null where id=p_id;
  end if;
  insert into public.jobs(user_id,kind,document_id,request_key,payload)
  values(u,k,p_id,p_key,jsonb_build_object('index_version',d.index_version)) returning * into j;
  perform pgmq.send('study_jobs',jsonb_build_object('job_id',j.id));
  return to_jsonb(j);
end $$;

create function public.app_create_conversation(p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); existing_owner uuid;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_key is null then raise exception 'INVALID_QUESTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select user_id into existing_owner from public.conversations where id=p_key;
  if found then
    if existing_owner<>u then raise exception 'NOT_FOUND'; end if;
    return p_key;
  end if;
  insert into public.conversations(id,user_id) values(p_key,u);
  return p_key;
end $$;

create function public.app_send_message(p_conversation uuid,p_question text,p_documents uuid[],p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.jobs; user_msg uuid; assistant_msg uuid; versions jsonb;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if not exists(select 1 from public.conversations where id=p_conversation and user_id=u) then raise exception 'NOT_FOUND'; end if;
  select * into j from public.jobs where user_id=u and kind='chat' and request_key=p_key;
  if found then
    if j.payload->>'conversation_id'<>p_conversation::text or j.payload->>'question'<>p_question or j.payload->'document_ids'<>to_jsonb(p_documents) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(j);
  end if;
  perform public.app_require_online();
  if p_key is null or p_question is null or p_documents is null or length(trim(p_question)) not between 1 and 2000 or coalesce(cardinality(p_documents),0) not between 1 and 5 then raise exception 'INVALID_QUESTION'; end if;
  -- Lock documents in stable order so deletion and enqueue have a defined order.
  perform id from public.documents where id=any(p_documents) order by id for share;
  if (select count(*) from public.documents where id=any(p_documents) and user_id=u and status='ready')<>cardinality(p_documents) then raise exception 'INVALID_DOCUMENTS'; end if;
  if exists(select 1 from public.jobs where user_id=u and kind='chat' and status in ('queued','running')) then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from public.jobs where user_id=u and kind='chat' and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT'; end if;
  select jsonb_object_agg(id::text,index_version) into versions from public.documents where id=any(p_documents);
  insert into public.messages(conversation_id,user_id,role,content,status) values(p_conversation,u,'user',trim(p_question),'completed') returning id into user_msg;
  insert into public.messages(conversation_id,user_id,role) values(p_conversation,u,'assistant') returning id into assistant_msg;
  insert into public.jobs(user_id,kind,message_id,request_key,payload)
  values(u,'chat',assistant_msg,p_key,jsonb_build_object('conversation_id',p_conversation,'question',p_question,'user_message_id',user_msg,'document_ids',p_documents,'versions',versions)) returning * into j;
  update public.conversations set title=left(trim(p_question),80) where id=p_conversation and title='Phiên học mới';
  perform pgmq.send('study_jobs',jsonb_build_object('job_id',j.id));
  return to_jsonb(j);
end $$;

-- All mutation helpers are closed by default, including to authenticated users.
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'app_%'
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
end $$;
grant execute on function public.app_worker_online() to authenticated;
grant execute on function public.app_upload_intent(text,bigint,text,uuid) to authenticated;
grant execute on function public.app_enqueue_document(uuid,text,uuid) to authenticated;
grant execute on function public.app_create_conversation(uuid) to authenticated;
grant execute on function public.app_send_message(uuid,text,uuid[],uuid) to authenticated;
