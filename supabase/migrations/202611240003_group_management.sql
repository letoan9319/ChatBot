create function public.app_group_members(p_group uuid) returns jsonb
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
          'is_owner', m.user_id = g.owner_id
        ) order by (m.user_id = g.owner_id) desc, m.joined_at, m.user_id)
        from public.study_group_members m
        left join public.profiles p on p.id = m.user_id
        where m.group_id = g.id
      ), '[]'::jsonb)
    )
    from public.study_groups g where g.id = p_group
  );
end $$;

create function public.app_update_group(p_group uuid, p_name text, p_description text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  chosen_name text := btrim(p_name);
  chosen_description text := btrim(coalesce(p_description, ''));
begin
  if viewer is null then raise exception 'UNAUTHORIZED'; end if;
  if chosen_name is null or length(chosen_name) not between 3 and 80 or length(chosen_description) > 500 then
    raise exception 'INVALID_GROUP';
  end if;
  update public.study_groups
  set name = chosen_name, description = chosen_description
  where id = p_group and owner_id = viewer;
  if not found then raise exception 'FORBIDDEN'; end if;
  return app_private.group_json(p_group);
end $$;

revoke all on function public.app_group_members(uuid), public.app_update_group(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.app_group_members(uuid), public.app_update_group(uuid, text, text)
  to authenticated;
