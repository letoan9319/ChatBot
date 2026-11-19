alter table public.study_group_messages
  add column image_data bytea,
  add column image_mime text,
  drop constraint study_group_messages_content_check,
  add constraint study_group_messages_payload_check check (
    length(btrim(content)) <= 2000 and
    ((image_data is null and image_mime is null and length(btrim(content)) >= 1) or
     (image_data is not null and image_mime is not null and image_mime in ('image/png','image/jpeg','image/webp')
      and octet_length(image_data) between 12 and 524288))
  );

create or replace function app_private.group_message_json(p_message uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'group_id',m.group_id,'user_id',m.user_id,
    'username',coalesce(p.username,'Bạn học'),'content',m.content,'created_at',m.created_at,'has_image',m.image_data is not null)
  from public.study_group_messages m left join public.profiles p on p.id=m.user_id
  where m.id=p_message;
$$;

create or replace function public.app_post_group_message(p_group uuid,p_content text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.study_group_messages; chosen_content text:=btrim(p_content);
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_key is null or chosen_content is null or length(chosen_content) not between 1 and 2000 then raise exception 'INVALID_GROUP'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  perform 1 from public.study_groups where id=p_group for update;
  if not found or not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  select * into m from public.study_group_messages where user_id=u and key=p_key;
  if found then
    if m.group_id is distinct from p_group or m.content is distinct from chosen_content or m.image_data is not null then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return app_private.group_message_json(m.id);
  end if;
  if (select count(*) from public.study_group_messages where user_id=u and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'RATE_LIMIT'; end if;
  insert into public.study_group_messages(group_id,user_id,content,key) values(p_group,u,chosen_content,p_key) returning * into m;
  return app_private.group_message_json(m.id);
end $$;

create function public.app_post_group_image_message(p_group uuid,p_content text,p_key uuid,p_image text,p_mime text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.study_group_messages; chosen_content text:=btrim(p_content); image_bytes bytea;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_key is null or chosen_content is null or length(chosen_content)>2000 then raise exception 'INVALID_GROUP'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  perform 1 from public.study_groups where id=p_group for update;
  if not found or not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  if p_image is null or p_mime is null or length(p_image)>699052
     or p_image !~ '^[A-Za-z0-9+/]+={0,2}$' or length(p_image)%4<>0 then
    raise exception 'INVALID_GROUP_IMAGE';
  end if;
  begin
    image_bytes:=decode(p_image,'base64');
  exception when invalid_parameter_value or invalid_text_representation then
    raise exception 'INVALID_GROUP_IMAGE';
  end;
  if octet_length(image_bytes) not between 12 and 524288 or not (
      (p_mime='image/png' and substring(image_bytes from 1 for 8)=decode('89504e470d0a1a0a','hex'))
      or (p_mime='image/jpeg' and substring(image_bytes from 1 for 3)=decode('ffd8ff','hex'))
      or (p_mime='image/webp' and substring(image_bytes from 1 for 4)=decode('52494646','hex')
          and substring(image_bytes from 9 for 4)=decode('57454250','hex'))
  ) then raise exception 'INVALID_GROUP_IMAGE'; end if;
  select * into m from public.study_group_messages where user_id=u and key=p_key;
  if found then
    if m.group_id is distinct from p_group or m.content is distinct from chosen_content or m.image_data is distinct from image_bytes or m.image_mime is distinct from p_mime then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return app_private.group_message_json(m.id);
  end if;
  if (select count(*) from public.study_group_messages where user_id=u and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'RATE_LIMIT'; end if;
  insert into public.study_group_messages(group_id,user_id,content,key,image_data,image_mime) values(p_group,u,chosen_content,p_key,image_bytes,p_mime) returning * into m;
  return app_private.group_message_json(m.id);
end $$;


create function public.app_get_group_message_image(p_group uuid,p_message uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  select jsonb_build_object('mime',image_mime,'image',encode(image_data,'base64')) into result
  from public.study_group_messages where id=p_message and group_id=p_group and image_data is not null;
  if result is null then raise exception 'NOT_FOUND'; end if;
  return result;
end $$;

revoke all on function public.app_post_group_image_message(uuid,text,uuid,text,text),
  public.app_get_group_message_image(uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_post_group_image_message(uuid,text,uuid,text,text),
  public.app_get_group_message_image(uuid,uuid) to authenticated;
