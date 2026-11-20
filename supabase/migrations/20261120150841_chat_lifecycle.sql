alter table public.conversations add column temporary_until timestamptz;
create index conversations_temporary_expiry on public.conversations(temporary_until)
where temporary_until is not null;

alter table public.messages drop constraint messages_status_check,
  add constraint messages_status_check check (status in ('queued','generating','completed','failed','interrupted','stopped'));

-- Keep content-free rate-limit counters when chat jobs are deleted.
create table app_private.chat_request_log (
  job_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null
);
create index chat_request_log_owner on app_private.chat_request_log(user_id,created_at);
insert into app_private.chat_request_log
select id,user_id,created_at from public.jobs where kind='chat' and created_at>now()-interval '1 hour';

create function app_private.log_chat_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into app_private.chat_request_log values(new.id,new.user_id,new.created_at);
  return new;
end $$;
create trigger log_chat_request after insert on public.jobs
for each row when (new.kind='chat') execute function app_private.log_chat_request();

create function public.app_create_temporary_conversation(p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if exists(select 1 from public.conversations where id=p_key and user_id=u and temporary_until>now()) then
    return p_key;
  end if;
  if (select count(*) from public.conversations where user_id=u and temporary_until>now())>=30 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.conversations(id,user_id,temporary_until) values(p_key,u,now()+interval '1 hour')
  on conflict do nothing;
  if not found then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return p_key;
end $$;

create function public.app_stop_chat(p_job uuid) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.jobs;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select * into j from public.jobs where id=p_job and user_id=u and kind='chat' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if j.status in ('queued','running') then
    update public.jobs set status='failed',error='USER_STOPPED',finished_at=now(),lease_token=null where id=j.id;
    update public.messages set status='stopped' where id=j.message_id and user_id=u;
    return 'stopped';
  end if;
  return case when j.error='USER_STOPPED' then 'stopped' else j.status end;
end $$;

create function app_private.delete_chat(p_user uuid,p_conversation uuid,p_expired boolean) returns integer
language plpgsql set search_path='' as $$
declare targets uuid[]; removed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select coalesce(array_agg(id),'{}'::uuid[]) into targets from public.conversations
  where user_id=p_user and (
    (p_expired and temporary_until<=now()) or
    (not p_expired and (id=p_conversation or (p_conversation is null and temporary_until is null)))
  );
  delete from public.jobs where user_id=p_user and kind='chat' and
    message_id in (select id from public.messages where user_id=p_user and conversation_id=any(targets));
  delete from public.notifications where user_id=p_user and conversation_id=any(targets);
  delete from public.conversations where user_id=p_user and id=any(targets);
  get diagnostics removed=row_count;
  return removed;
end $$;

create function public.app_delete_chat(p_conversation uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  return app_private.delete_chat(u,p_conversation,false);
end $$;

create function app_private.purge_expired_chats() returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  for owner_id in select distinct user_id from public.conversations
    where temporary_until<=now() order by user_id limit 500
  loop
    perform app_private.delete_chat(owner_id,null,true);
  end loop;
  delete from app_private.chat_request_log where created_at<now()-interval '1 hour';
end $$;

revoke all on function public.app_create_temporary_conversation(uuid),public.app_stop_chat(uuid),public.app_delete_chat(uuid)
from public,anon,authenticated;
grant execute on function public.app_create_temporary_conversation(uuid),public.app_stop_chat(uuid),public.app_delete_chat(uuid)
to authenticated;
revoke all on function app_private.delete_chat(uuid,uuid,boolean),app_private.purge_expired_chats()
from public,anon,authenticated;

create or replace function public.app_send_message(p_conversation uuid,p_question text,p_documents uuid[],p_key uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.jobs; user_msg uuid; assistant_msg uuid; versions jsonb; owners jsonb;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_mode is null or p_mode not in ('documents','search','research','library') then raise exception 'INVALID_QUESTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if not exists(select 1 from public.conversations where id=p_conversation and user_id=u and (temporary_until is null or temporary_until>now())) then raise exception 'NOT_FOUND'; end if;
  select * into j from public.jobs where user_id=u and kind='chat' and request_key=p_key;
  if found then
    if j.payload->>'conversation_id'<>p_conversation::text or j.payload->>'question'<>p_question or j.payload->'document_ids'<>to_jsonb(p_documents) or coalesce(j.payload->>'mode','documents')<>p_mode then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(j);
  end if;
  perform public.app_require_online();
  if p_key is null or p_question is null or p_documents is null or length(trim(p_question)) not between 1 and 2000 or cardinality(p_documents)>5 or (p_mode='documents' and cardinality(p_documents)=0) or (p_mode='library' and cardinality(p_documents)<>0) then raise exception 'INVALID_QUESTION'; end if;
  perform id from public.documents where id=any(p_documents) order by id for share;
  if (select count(*) from public.documents where id=any(p_documents) and app_private.can_read_document(id))<>cardinality(p_documents) then raise exception 'INVALID_DOCUMENTS'; end if;
  if exists(select 1 from public.jobs where user_id=u and kind='chat' and status in ('queued','running')) then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from app_private.chat_request_log where user_id=u and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT'; end if;
  select jsonb_object_agg(id::text,index_version),jsonb_object_agg(id::text,user_id::text)
    into versions,owners from public.documents where id=any(p_documents);
  insert into public.messages(conversation_id,user_id,role,content,status) values(p_conversation,u,'user',trim(p_question),'completed') returning id into user_msg;
  insert into public.messages(conversation_id,user_id,role) values(p_conversation,u,'assistant') returning id into assistant_msg;
  insert into public.jobs(user_id,kind,message_id,request_key,payload)
  values(u,'chat',assistant_msg,p_key,jsonb_build_object('conversation_id',p_conversation,'question',p_question,'user_message_id',user_msg,'document_ids',p_documents,'versions',versions,'owners',owners,'mode',p_mode,'temporary',exists(select 1 from public.conversations where id=p_conversation and temporary_until is not null))) returning * into j;
  update public.conversations set title=left(trim(p_question),80) where id=p_conversation and title='Phiên học mới';
  update public.conversations set temporary_until=now()+interval '1 hour' where id=p_conversation and temporary_until is not null;
  perform pgmq.send('study_jobs',jsonb_build_object('job_id',j.id));
  return to_jsonb(j);
end $$;

create or replace function app_private.notify_chat_status() returns trigger
language plpgsql security definer set search_path='' as $$
declare conv uuid;
begin
  select c.id into conv from public.messages m join public.conversations c on c.id=m.conversation_id
    where m.id=new.message_id and m.user_id=new.user_id and c.user_id=new.user_id and m.role='assistant' and c.temporary_until is null;
  if conv is null or new.error = 'USER_STOPPED' then return new; end if;
  insert into public.notifications(user_id,kind,title,body,conversation_id,event_key)
  values(new.user_id,'chat_'||new.status,
    case when new.status='completed' then 'Câu trả lời đã hoàn tất' else 'Phiên trả lời chưa hoàn tất' end,
    'Mở phiên học để xem kết quả và trạng thái.',conv,'chat:'||new.id::text||':'||new.status)
  on conflict(user_id,event_key) do nothing;
  return new;
end $$;

-- The worker records recoverable interruptions on messages, while jobs requeue.
create or replace function app_private.notify_chat_interrupted() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,kind,title,body,conversation_id,event_key)
  select new.user_id,'chat_interrupted','Phiên trả lời bị gián đoạn',
    'Mở phiên học để kiểm tra trạng thái và thử lại.',new.conversation_id,'chat:'||j.id::text||':interrupted'
  from public.jobs j join public.conversations c on c.id=new.conversation_id and c.user_id=new.user_id and c.temporary_until is null
  where j.message_id=new.id and j.user_id=new.user_id and j.kind='chat'
  on conflict(user_id,event_key) do nothing;
  return new;
end $$;


create or replace function public.app_record_study_day() returns trigger
language plpgsql security definer set search_path='' as $$
declare completed_at timestamptz:=clock_timestamp();
begin
  if exists(
    select 1 from public.messages m
    join public.conversations c on c.id=m.conversation_id and c.user_id=new.user_id and c.temporary_until is null
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

create extension if not exists pg_cron;
select cron.schedule('learnstep-expired-chat-cleanup','*/5 * * * *',
  'select app_private.purge_expired_chats()');
