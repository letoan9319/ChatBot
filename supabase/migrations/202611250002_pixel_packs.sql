alter table public.profiles
  add column avatar_id text check (avatar_id in ('frog','owl','rabbit','cat','capybara','axolotl'));

alter table public.study_group_messages
  add column sticker_id text check (sticker_id in ('thumbs-up','trophy','thinking','reading','hello','celebrate')),
  drop constraint study_group_messages_payload_check,
  add constraint study_group_messages_payload_check check (
    length(btrim(content)) <= 2000 and (
      (sticker_id is not null and content = '' and image_data is null and image_mime is null)
      or (sticker_id is null and image_data is null and image_mime is null and length(btrim(content)) >= 1)
      or (sticker_id is null and image_data is not null and image_mime is not null
          and image_mime in ('image/png','image/jpeg','image/webp')
          and octet_length(image_data) between 12 and 524288)
    )
  );

create function public.app_set_avatar(p_avatar text) returns text
language plpgsql security definer set search_path='' as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'UNAUTHORIZED'; end if;
  if p_avatar is not null and p_avatar not in ('frog','owl','rabbit','cat','capybara','axolotl') then
    raise exception 'INVALID_AVATAR';
  end if;
  update public.profiles set avatar_id = p_avatar where id = viewer;
  if not found then raise exception 'NOT_FOUND'; end if;
  return p_avatar;
end $$;

create or replace function app_private.group_message_json(p_message uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'group_id',m.group_id,'user_id',m.user_id,
    'username',coalesce(p.username,'Bạn học'),'content',m.content,'created_at',m.created_at,'has_image',m.image_data is not null,
    'sticker_id',m.sticker_id,'avatar_id',p.avatar_id)
  from public.study_group_messages m left join public.profiles p on p.id=m.user_id
  where m.id=p_message;
$$;

create function app_private.post_group_message(p_group uuid,p_content text,p_key uuid,p_sticker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.study_group_messages; chosen_content text:=btrim(p_content);
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_key is null or chosen_content is null or
      (p_sticker is null and length(chosen_content) not between 1 and 2000) or
      (p_sticker is not null and (chosen_content <> '' or p_sticker not in ('thumbs-up','trophy','thinking','reading','hello','celebrate'))) then raise exception 'INVALID_GROUP'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  perform 1 from public.study_groups where id=p_group for update;
  if not found or not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  select * into m from public.study_group_messages where user_id=u and key=p_key;
  if found then
    if m.group_id is distinct from p_group or m.content is distinct from chosen_content or m.image_data is not null or m.sticker_id is distinct from p_sticker then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return app_private.group_message_json(m.id);
  end if;
  if (select count(*) from public.study_group_messages where user_id=u and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'RATE_LIMIT'; end if;
  insert into public.study_group_messages(group_id,user_id,content,key,sticker_id) values(p_group,u,chosen_content,p_key,p_sticker) returning * into m;
  return app_private.group_message_json(m.id);
end $$;

create or replace function public.app_post_group_message(p_group uuid,p_content text,p_key uuid) returns jsonb
language sql security definer set search_path='' as $$
  select app_private.post_group_message(p_group,p_content,p_key,null);
$$;

create function public.app_post_group_sticker(p_group uuid,p_sticker text,p_key uuid) returns jsonb
language sql security definer set search_path='' as $$
  select app_private.post_group_message(p_group,'',p_key,p_sticker);
$$;

create or replace function public.app_group_members(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not app_private.is_group_member(p_group) then raise exception 'FORBIDDEN'; end if;

  return (
    select jsonb_build_object(
      'can_edit', g.owner_id = auth.uid(),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.user_id, 'username', coalesce(p.username, 'Bạn học'),
          'is_owner', m.user_id = g.owner_id, 'avatar_id', p.avatar_id
        ) order by (m.user_id = g.owner_id) desc, m.joined_at, m.user_id)
        from public.study_group_members m
        left join public.profiles p on p.id = m.user_id
        where m.group_id = g.id
      ), '[]'::jsonb)
    )
    from public.study_groups g where g.id = p_group
  );
end $$;

revoke all on function app_private.post_group_message(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.app_set_avatar(text), public.app_post_group_sticker(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.app_set_avatar(text), public.app_post_group_sticker(uuid,text,uuid) to authenticated;
