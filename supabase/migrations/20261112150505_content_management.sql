create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('content_manager')),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
revoke all on public.user_roles from public, anon, authenticated;
grant select on public.user_roles to authenticated;
create policy user_roles_read_own on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));

create table app_private.knowledge_document_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  document_id uuid not null,
  action text not null check (action in ('publish', 'revoke')),
  created_at timestamptz not null default now()
);
alter table app_private.knowledge_document_audit enable row level security;
revoke all on app_private.knowledge_document_audit from public, anon, authenticated;

create function app_private.set_knowledge_publication(p_document_id uuid, p_publish boolean, p_description text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  description text := btrim(coalesce(p_description, ''));
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  -- Keep the role valid through the write, including concurrent role revocation.
  perform 1 from public.user_roles
    where user_id = actor and role = 'content_manager' for share;
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
revoke all on function app_private.set_knowledge_publication(uuid, boolean, text) from public, anon, authenticated;
grant execute on function app_private.set_knowledge_publication(uuid, boolean, text) to authenticated;

create function public.app_set_knowledge_publication(p_document_id uuid, p_publish boolean, p_description text default '')
returns boolean
language sql security invoker set search_path = '' as $$
  select app_private.set_knowledge_publication(p_document_id, p_publish, p_description);
$$;
revoke all on function public.app_set_knowledge_publication(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.app_set_knowledge_publication(uuid, boolean, text) to authenticated;
