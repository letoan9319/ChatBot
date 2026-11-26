-- Role-based access control: admin vs content_manager vs regular learner.
alter table public.user_roles
  drop constraint if exists user_roles_role_check,
  add constraint user_roles_role_check check (role in ('admin', 'content_manager'));

create index if not exists user_roles_role_idx on public.user_roles(role, user_id);

create table app_private.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null check (action in ('grant_role', 'revoke_role', 'delete_group')),
  target_id uuid not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index admin_audit_log_created_idx on app_private.admin_audit_log(created_at desc, id desc);
alter table app_private.admin_audit_log enable row level security;
revoke all on app_private.admin_audit_log from public, anon, authenticated;

create function app_private.has_role(p_user_id uuid, p_role text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1 from public.user_roles where user_id = p_user_id and role = p_role
  );
$$;

create function app_private.is_admin(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.has_role(p_user_id, 'admin');
$$;

create function app_private.can_manage_knowledge(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role in ('admin', 'content_manager')
  );
$$;

revoke all on function
  app_private.has_role(uuid, text),
  app_private.is_admin(uuid),
  app_private.can_manage_knowledge(uuid)
  from public, anon, authenticated;

create or replace function app_private.set_knowledge_publication(p_document_id uuid, p_publish boolean, p_description text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  description text := btrim(coalesce(p_description, ''));
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  -- Keep the role valid through the write, including concurrent role revocation.
  perform 1 from public.user_roles
    where user_id = actor and role in ('admin', 'content_manager') for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_document_id is null or p_publish is null or length(description) > 2000 then
    raise exception 'INVALID_INPUT';
  end if;

  if p_publish then
    -- Reuse the document lock order used by enqueue and worker finalization.
    perform 1 from public.documents
      where id = p_document_id and user_id = actor and status = 'ready' for update;
    if not found then raise exception 'DOCUMENT_NOT_PUBLISHABLE'; end if;
    insert into public.knowledge_documents(document_id, description)
      values (p_document_id, description) on conflict (document_id) do nothing;
  else
    perform 1 from public.documents d where d.id = p_document_id
      and exists (select 1 from public.knowledge_documents k where k.document_id = d.id)
      for update of d;
    if not found then return false; end if;
    delete from public.knowledge_documents where document_id = p_document_id;
  end if;

  if not found then return false; end if;
  insert into app_private.knowledge_document_audit(actor_id, document_id, action)
    values (actor, p_document_id, case when p_publish then 'publish' else 'revoke' end);
  return true;
end;
$$;

create function public.app_admin_overview()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.user_roles
    where user_id = actor and role = 'admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;

  return jsonb_build_object(
    'counts', jsonb_build_object(
      'users', (select count(*)::int from auth.users),
      'profiles', (select count(*)::int from public.profiles),
      'admins', (select count(*)::int from public.user_roles where role = 'admin'),
      'content_managers', (select count(*)::int from public.user_roles where role = 'content_manager'),
      'ready_documents', (select count(*)::int from public.documents where status = 'ready'),
      'published_documents', (
        select count(*)::int
        from public.knowledge_documents k
        join public.documents d on d.id = k.document_id
        where d.status = 'ready'
      ),
      'study_groups', (select count(*)::int from public.study_groups),
      'active_jobs', (select count(*)::int from public.jobs where status in ('queued', 'running'))
    ),
    'recent_audit', coalesce((
      select jsonb_agg(row_to_json(entry) order by entry.created_at desc, entry.id desc)
      from (
        select
          l.id,
          l.actor_id,
          p.username as actor_username,
          l.action,
          l.target_id,
          l.detail,
          l.created_at
        from app_private.admin_audit_log l
        left join public.profiles p on p.id = l.actor_id
        order by l.created_at desc, l.id desc
        limit 20
      ) entry
    ), '[]'::jsonb)
  );
end;
$$;

create function public.app_admin_list_users(p_search text default '', p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  query text := lower(btrim(coalesce(p_search, '')));
  lim integer := coalesce(p_limit, 50);
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.user_roles
    where user_id = actor and role = 'admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if length(query) > 100 or lim not between 1 and 100 then
    raise exception 'INVALID_INPUT';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', item.user_id,
        'username', item.username,
        'roles', item.roles,
        'created_at', item.created_at
      )
      order by item.has_role desc, item.created_at desc nulls last, item.user_id asc
    )
    from (
      select
        u.id as user_id,
        p.username,
        coalesce((
          select array_agg(r.role order by r.role)
          from public.user_roles r
          where r.user_id = u.id
        ), array[]::text[]) as roles,
        exists(select 1 from public.user_roles r where r.user_id = u.id) as has_role,
        p.created_at
      from auth.users u
      left join public.profiles p on p.id = u.id
      where query = ''
        or strpos(lower(coalesce(p.username, '')), query) > 0
        or strpos(lower(u.id::text), query) > 0
      order by has_role desc, p.created_at desc nulls last, u.id asc
      limit lim
    ) item
  ), '[]'::jsonb);
end;
$$;

create function public.app_admin_set_user_role(p_target_user_id uuid, p_role text, p_grant boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  changed integer := 0;
  remaining_admins integer;
  target_username text;
  updated_roles text[];
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_roles', 0));
  perform 1 from public.user_roles
    where user_id = actor and role = 'admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_target_user_id is null or p_grant is null or p_role is null
     or p_role not in ('admin', 'content_manager') then
    raise exception 'INVALID_INPUT';
  end if;
  perform 1 from auth.users where id = p_target_user_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  select username into target_username from public.profiles where id = p_target_user_id;

  if p_grant then
    insert into public.user_roles(user_id, role)
    values (p_target_user_id, p_role)
    on conflict (user_id, role) do nothing;
    get diagnostics changed = row_count;
  else
    if p_role = 'admin' and exists (
      select 1 from public.user_roles where user_id = p_target_user_id and role = 'admin'
    ) then
      select count(*)::int into remaining_admins
      from public.user_roles
      where role = 'admin' and user_id <> p_target_user_id;
      if remaining_admins < 1 then
        raise exception 'LAST_ADMIN';
      end if;
    end if;
    delete from public.user_roles where user_id = p_target_user_id and role = p_role;
    get diagnostics changed = row_count;
  end if;

  if changed > 0 then
    insert into app_private.admin_audit_log(actor_id, action, target_id, detail)
    values (
      actor,
      case when p_grant then 'grant_role' else 'revoke_role' end,
      p_target_user_id,
      jsonb_build_object('role', p_role, 'target_username', target_username)
    );
  end if;

  select coalesce(array_agg(r.role order by r.role), array[]::text[])
  into updated_roles
  from public.user_roles r
  where r.user_id = p_target_user_id;

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'username', target_username,
    'roles', updated_roles,
    'changed', changed > 0
  );
end;
$$;

create function public.app_admin_list_groups(p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  lim integer := coalesce(p_limit, 50);
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.user_roles
    where user_id = actor and role = 'admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if lim not between 1 and 100 then
    raise exception 'INVALID_INPUT';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'subject', item.subject,
        'description', item.description,
        'owner_id', item.owner_id,
        'owner_username', item.owner_username,
        'member_count', item.member_count,
        'message_count', item.message_count,
        'created_at', item.created_at
      )
      order by item.created_at desc, item.id desc
    )
    from (
      select
        g.id,
        g.name,
        g.subject,
        g.description,
        g.owner_id,
        p.username as owner_username,
        (select count(*)::int from public.study_group_members m where m.group_id = g.id) as member_count,
        (select count(*)::int from public.study_group_messages msg where msg.group_id = g.id) as message_count,
        g.created_at
      from public.study_groups g
      left join public.profiles p on p.id = g.owner_id
      order by g.created_at desc, g.id desc
      limit lim
    ) item
  ), '[]'::jsonb);
end;
$$;

create function public.app_admin_delete_group(p_group_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_group record;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.user_roles
    where user_id = actor and role = 'admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_group_id is null then raise exception 'INVALID_INPUT'; end if;

  select g.id, g.name, g.subject, g.owner_id
  into target_group
  from public.study_groups g
  where g.id = p_group_id
  for update;
  if not found then return false; end if;

  delete from public.notifications where group_id = p_group_id and kind = 'group_message';
  delete from public.study_groups where id = p_group_id;

  insert into app_private.admin_audit_log(actor_id, action, target_id, detail)
  values (
    actor,
    'delete_group',
    p_group_id,
    jsonb_build_object(
      'name', target_group.name,
      'subject', target_group.subject,
      'owner_id', target_group.owner_id
    )
  );
  return true;
end;
$$;

revoke all on function
  public.app_admin_overview(),
  public.app_admin_list_users(text, integer),
  public.app_admin_set_user_role(uuid, text, boolean),
  public.app_admin_list_groups(integer),
  public.app_admin_delete_group(uuid)
  from public, anon, authenticated;

grant execute on function
  public.app_admin_overview(),
  public.app_admin_list_users(text, integer),
  public.app_admin_set_user_role(uuid, text, boolean),
  public.app_admin_list_groups(integer),
  public.app_admin_delete_group(uuid)
  to authenticated;
