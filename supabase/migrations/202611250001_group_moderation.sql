create function public.app_remove_group_member(p_group uuid, p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'UNAUTHORIZED'; end if;
  if p_member is null then raise exception 'INVALID_GROUP'; end if;
  perform 1 from public.study_groups where id = p_group and owner_id = viewer for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_member = viewer then raise exception 'GROUP_OWNER'; end if;

  delete from public.study_group_members where group_id = p_group and user_id = p_member;
  return app_private.group_json(p_group);
end $$;

create function public.app_delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  group_owner uuid;
begin
  if viewer is null then raise exception 'UNAUTHORIZED'; end if;
  select owner_id into group_owner from public.study_groups where id = p_group for update;
  if not found then return; end if;
  if group_owner <> viewer then raise exception 'FORBIDDEN'; end if;
  delete from public.notifications where group_id = p_group and kind = 'group_message';
  delete from public.study_groups where id = p_group;
end $$;

revoke all on function public.app_remove_group_member(uuid, uuid), public.app_delete_group(uuid)
  from public, anon, authenticated;
grant execute on function public.app_remove_group_member(uuid, uuid), public.app_delete_group(uuid)
  to authenticated;
