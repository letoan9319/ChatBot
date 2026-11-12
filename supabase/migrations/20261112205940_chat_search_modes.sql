alter table public.messages
  add column web_sources jsonb not null default '[]'::jsonb check (jsonb_typeof(web_sources)='array');

create or replace function public.app_send_message(p_conversation uuid,p_question text,p_documents uuid[],p_key uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.jobs; user_msg uuid; assistant_msg uuid; versions jsonb; owners jsonb;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_mode is null or p_mode not in ('documents','search','research') then raise exception 'INVALID_QUESTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if not exists(select 1 from public.conversations where id=p_conversation and user_id=u) then raise exception 'NOT_FOUND'; end if;
  select * into j from public.jobs where user_id=u and kind='chat' and request_key=p_key;
  if found then
    if j.payload->>'conversation_id'<>p_conversation::text or j.payload->>'question'<>p_question or j.payload->'document_ids'<>to_jsonb(p_documents) or coalesce(j.payload->>'mode','documents')<>p_mode then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(j);
  end if;
  perform public.app_require_online();
  if p_key is null or p_question is null or p_documents is null or length(trim(p_question)) not between 1 and 2000 or cardinality(p_documents)>5 or (p_mode='documents' and cardinality(p_documents)=0) then raise exception 'INVALID_QUESTION'; end if;
  perform id from public.documents where id=any(p_documents) order by id for share;
  if (select count(*) from public.documents where id=any(p_documents) and app_private.can_read_document(id))<>cardinality(p_documents) then raise exception 'INVALID_DOCUMENTS'; end if;
  if exists(select 1 from public.jobs where user_id=u and kind='chat' and status in ('queued','running')) then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from public.jobs where user_id=u and kind='chat' and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT'; end if;
  select jsonb_object_agg(id::text,index_version),jsonb_object_agg(id::text,user_id::text)
    into versions,owners from public.documents where id=any(p_documents);
  insert into public.messages(conversation_id,user_id,role,content,status) values(p_conversation,u,'user',trim(p_question),'completed') returning id into user_msg;
  insert into public.messages(conversation_id,user_id,role) values(p_conversation,u,'assistant') returning id into assistant_msg;
  insert into public.jobs(user_id,kind,message_id,request_key,payload)
  values(u,'chat',assistant_msg,p_key,jsonb_build_object('conversation_id',p_conversation,'question',p_question,'user_message_id',user_msg,'document_ids',p_documents,'versions',versions,'owners',owners,'mode',p_mode)) returning * into j;
  update public.conversations set title=left(trim(p_question),80) where id=p_conversation and title='Phiên học mới';
  perform pgmq.send('study_jobs',jsonb_build_object('job_id',j.id));
  return to_jsonb(j);
end $$;

revoke all on function public.app_send_message(uuid,text,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function public.app_send_message(uuid,text,uuid[],uuid,text) to authenticated;

create or replace function public.app_send_message(p_conversation uuid,p_question text,p_documents uuid[],p_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.app_send_message(p_conversation,p_question,p_documents,p_key,'documents');
$$;
