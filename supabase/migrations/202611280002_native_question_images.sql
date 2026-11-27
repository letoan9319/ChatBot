-- Keep uploaded chat question images in their native format (PNG, JPEG, WebP)
-- while remaining backwards-compatible with existing single-page question PDFs.

alter table public.documents
  drop constraint if exists documents_file_type_check,
  add constraint documents_file_type_check
    check (file_type in ('pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'));

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp'
]
where id = 'documents';

create or replace function public.app_upload_intent(p_name text, p_size bigint, p_subject text, p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d public.documents; ext text; new_id uuid:=gen_random_uuid(); is_image boolean;
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
  is_image:=ext in ('png','jpg','jpeg','webp');
  if p_key is null or p_name is null or length(trim(p_name))=0 or p_size is null or ext is null
     or ext not in ('pdf','docx','png','jpg','jpeg','webp')
     or length(p_name)>180
     or p_size not between 1 and 20971520
     or (is_image and (p_name not like 'Ảnh câu hỏi - %' or p_size > 3145728)) then
    raise exception 'INVALID_FILE';
  end if;
  if p_subject is null or p_subject not in ('calculus','linear-algebra','physics') then raise exception 'INVALID_SUBJECT'; end if;
  if (select count(*) from public.documents where user_id=u and status<>'deleted')>=20 then raise exception 'DOCUMENT_LIMIT'; end if;
  insert into public.documents(id,user_id,name,subject,file_type,size_bytes,storage_path,upload_key)
  values(new_id,u,p_name,p_subject,ext,p_size,u::text||'/'||new_id::text||'.'||ext,p_key) returning * into d;
  return to_jsonb(d);
end $$;

create or replace function public.app_send_message(p_conversation uuid,p_question text,p_documents uuid[],p_key uuid,p_mode text,p_subject text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.jobs; user_msg uuid; assistant_msg uuid; versions jsonb; owners jsonb;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_mode is null or p_mode not in ('documents','search','research','library') then raise exception 'INVALID_QUESTION'; end if;
  if p_subject is not null and p_subject not in ('calculus','linear-algebra','physics') then raise exception 'INVALID_SUBJECT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if not exists(select 1 from public.conversations where id=p_conversation and user_id=u and (temporary_until is null or temporary_until>now())) then raise exception 'NOT_FOUND'; end if;
  select * into j from public.jobs where user_id=u and kind='chat' and request_key=p_key;
  if found then
    if j.payload->>'conversation_id'<>p_conversation::text or j.payload->>'question'<>p_question or j.payload->'document_ids'<>to_jsonb(p_documents) or coalesce(j.payload->>'mode','documents')<>p_mode
      or (j.payload->>'subject') is distinct from p_subject then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return to_jsonb(j);
  end if;
  perform public.app_require_online();
  if p_key is null or p_question is null or p_documents is null or length(trim(p_question)) not between 1 and 2000 or cardinality(p_documents)>5 or (p_mode='documents' and cardinality(p_documents)=0) or (p_mode='library' and cardinality(p_documents)<>0) then raise exception 'INVALID_QUESTION'; end if;
  perform id from public.documents where id=any(p_documents) order by id for share;
  if (select count(*) from public.documents where id=any(p_documents) and app_private.can_read_document(id))<>cardinality(p_documents) then raise exception 'INVALID_DOCUMENTS'; end if;
  if p_subject is not null and exists(
    select 1 from public.documents d where d.id=any(p_documents) and d.subject<>p_subject
      and not (d.user_id=u and d.file_type in ('pdf','png','jpg','jpeg','webp') and d.name like 'Ảnh câu hỏi - %')
  ) then raise exception 'DOCUMENT_SUBJECT_MISMATCH'; end if;
  if exists(select 1 from public.jobs where user_id=u and kind='chat' and status in ('queued','running')) then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from app_private.chat_request_log where user_id=u and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT'; end if;
  select jsonb_object_agg(id::text,index_version),jsonb_object_agg(id::text,user_id::text)
    into versions,owners from public.documents where id=any(p_documents);
  insert into public.messages(conversation_id,user_id,role,content,status,subject) values(p_conversation,u,'user',trim(p_question),'completed',p_subject) returning id into user_msg;
  insert into public.messages(conversation_id,user_id,role,subject) values(p_conversation,u,'assistant',p_subject) returning id into assistant_msg;
  insert into public.jobs(user_id,kind,message_id,request_key,payload)
  values(u,'chat',assistant_msg,p_key,jsonb_build_object('conversation_id',p_conversation,'question',p_question,'user_message_id',user_msg,'document_ids',p_documents,'versions',versions,'owners',owners,'mode',p_mode,'subject',p_subject,'temporary',exists(select 1 from public.conversations where id=p_conversation and temporary_until is not null))) returning * into j;
  update public.conversations set title=left(trim(p_question),80) where id=p_conversation and title='Phiên học mới';
  update public.conversations set temporary_until=now()+interval '1 hour' where id=p_conversation and temporary_until is not null;
  perform pgmq.send('study_jobs',jsonb_build_object('job_id',j.id));
  return to_jsonb(j);
end $$;
