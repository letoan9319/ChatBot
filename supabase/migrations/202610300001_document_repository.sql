-- Only an operator may publish an indexed document. Existing uploads stay private.
create schema if not exists app_private;
revoke all on schema app_private from public,anon;
grant usage on schema app_private to authenticated;
create table public.knowledge_documents (
  document_id uuid primary key references public.documents(id) on delete cascade,
  description text not null default '' check(length(description)<=2000),
  published_at timestamptz not null default now()
);
alter table public.knowledge_documents enable row level security;
revoke all on public.knowledge_documents from public,anon,authenticated;
grant all on public.knowledge_documents to service_role;

-- Publishing/revoking serializes with document locks held by enqueue/finalization.
create function app_private.lock_knowledge_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.document_id<>old.document_id then raise exception 'INVALID_STATE'; end if;
  perform id from public.documents where id=case when tg_op='DELETE' then old.document_id else new.document_id end for update;
  if tg_op='DELETE' then return old; end if;
  if not exists(select 1 from public.documents where id=new.document_id and status='ready') then raise exception 'INVALID_STATE'; end if;
  return new;
end $$;
revoke all on function app_private.lock_knowledge_document() from public,anon,authenticated;
create trigger knowledge_document_lock before insert or update or delete on public.knowledge_documents
for each row execute function app_private.lock_knowledge_document();

create function app_private.can_read_document(p_id uuid,p_version integer default null) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.documents d where d.id=p_id and d.status='ready'
      and (p_version is null or d.index_version=p_version)
      and (d.user_id=auth.uid() or exists(select 1 from public.knowledge_documents k where k.document_id=d.id))
  );
$$;
revoke all on function app_private.can_read_document(uuid,integer) from public,anon,authenticated;
grant execute on function app_private.can_read_document(uuid,integer) to authenticated;
drop policy chunks_read on public.document_chunks;
create policy chunks_read on public.document_chunks for select to authenticated
using (app_private.can_read_document(document_id,index_version));
drop policy document_files_read on storage.objects;
create function app_private.can_read_file(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.documents d where d.storage_path=p_path and d.status='ready'
      and (d.user_id=auth.uid() or exists(select 1 from public.knowledge_documents k where k.document_id=d.id))
  );
$$;
revoke all on function app_private.can_read_file(text) from public,anon,authenticated;
grant execute on function app_private.can_read_file(text) to authenticated;
create policy document_files_read on storage.objects for select to authenticated using (
  bucket_id='documents' and app_private.can_read_file(name)
);

create function public.app_list_knowledge_documents() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.published_at desc,t.id) from (
    select d.id,d.name,d.subject,d.file_type,d.size_bytes,d.status,d.created_at,
      null::text as error,k.description,k.published_at,'knowledge'::text as scope
    from public.knowledge_documents k join public.documents d on d.id=k.document_id where d.status='ready'
  ) t),'[]'::jsonb);
end $$;

create function public.app_get_document(p_id uuid,p_chunk uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.documents; result jsonb; snippet jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into d from public.documents where id=p_id and status not in ('deleted','deleting')
    and (user_id=auth.uid() or app_private.can_read_document(id));
  if not found then raise exception 'NOT_FOUND'; end if;
  select jsonb_build_object('id',c.id,'content',c.content,'page',c.page,'section',c.section,'paragraph',c.paragraph)
    into snippet from public.document_chunks c where c.document_id=d.id and c.index_version=d.index_version
    and d.status='ready' and (p_chunk is null or c.id=p_chunk) order by c.ordinal limit 1;
  result:=jsonb_build_object('id',d.id,'name',d.name,'subject',d.subject,'file_type',d.file_type,
    'size_bytes',d.size_bytes,'status',d.status,'created_at',d.created_at,'error',d.error,
    'scope',case when exists(select 1 from public.knowledge_documents where document_id=d.id) then 'knowledge' else 'personal' end,
    'description',coalesce((select description from public.knowledge_documents where document_id=d.id),''),
    'excerpt',snippet,'requested_chunk_available',p_chunk is null or snippet is not null);
  return result;
end $$;

create function public.app_document_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not app_private.can_read_document(p_id) then raise exception 'NOT_FOUND'; end if;
  select * into d from public.documents where id=p_id;
  return jsonb_build_object('name',d.name,'file_type',d.file_type,'storage_path',d.storage_path);
end $$;

-- Keep the original quotas, queue transaction and idempotency checks; allow
-- explicitly published system documents in addition to the caller's own files.
create or replace function public.app_send_message(p_conversation uuid,p_question text,p_documents uuid[],p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.jobs; user_msg uuid; assistant_msg uuid; versions jsonb; owners jsonb;
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
  perform id from public.documents where id=any(p_documents) order by id for share;
  if (select count(*) from public.documents where id=any(p_documents) and app_private.can_read_document(id))<>cardinality(p_documents) then raise exception 'INVALID_DOCUMENTS'; end if;
  if exists(select 1 from public.jobs where user_id=u and kind='chat' and status in ('queued','running')) then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from public.jobs where user_id=u and kind='chat' and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT'; end if;
  select jsonb_object_agg(id::text,index_version),jsonb_object_agg(id::text,user_id::text)
    into versions,owners from public.documents where id=any(p_documents);
  insert into public.messages(conversation_id,user_id,role,content,status) values(p_conversation,u,'user',trim(p_question),'completed') returning id into user_msg;
  insert into public.messages(conversation_id,user_id,role) values(p_conversation,u,'assistant') returning id into assistant_msg;
  insert into public.jobs(user_id,kind,message_id,request_key,payload)
  values(u,'chat',assistant_msg,p_key,jsonb_build_object('conversation_id',p_conversation,'question',p_question,'user_message_id',user_msg,'document_ids',p_documents,'versions',versions,'owners',owners)) returning * into j;
  update public.conversations set title=left(trim(p_question),80) where id=p_conversation and title='Phiên học mới';
  perform pgmq.send('study_jobs',jsonb_build_object('job_id',j.id));
  return to_jsonb(j);
end $$;

revoke all on function public.app_list_knowledge_documents() from public,anon,authenticated;
revoke all on function public.app_get_document(uuid,uuid) from public,anon,authenticated;
revoke all on function public.app_document_file(uuid) from public,anon,authenticated;
grant execute on function public.app_list_knowledge_documents() to authenticated;
grant execute on function public.app_get_document(uuid,uuid) to authenticated;
grant execute on function public.app_document_file(uuid) to authenticated;

-- A cited answer from the shared RAG library also qualifies as a study day.
create or replace function public.app_record_study_day() returns trigger
language plpgsql security definer set search_path='' as $$
declare completed_at timestamptz:=clock_timestamp();
begin
  if exists(
    select 1 from public.messages m
    join public.conversations c on c.id=m.conversation_id and c.user_id=new.user_id
    where m.id=new.message_id and m.user_id=new.user_id and m.role='assistant'
      and m.status='completed' and length(btrim(m.content))>0 and exists(
        select 1 from public.message_sources s join public.documents d on d.id=s.document_id
        where s.message_id=m.id and s.user_id=new.user_id
          and (d.user_id=new.user_id or exists(select 1 from public.knowledge_documents k where k.document_id=d.id))
      )
  ) then
    insert into public.study_activity_days(user_id,study_date,first_completed_at)
    values(new.user_id,(completed_at at time zone 'Asia/Ho_Chi_Minh')::date,completed_at)
    on conflict(user_id,study_date) do nothing;
  end if;
  return new;
end $$;
