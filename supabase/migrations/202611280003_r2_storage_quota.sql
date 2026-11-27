-- Migrate document object storage to Cloudflare R2 with strict 90% free-tier safety caps:
--   Free tier: 10 GB storage, 1,000,000 Class A ops/month, 10,000,000 Class B ops/month (UTC).
--   Hard 90% safety stops: 9,000,000,000 bytes (9.0 GB), 900,000 Class A, 9,000,000 Class B.
-- Delete operations remain free and are never blocked so space can always be reclaimed.

alter table public.documents
  add column if not exists storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase', 'r2'));

create index if not exists documents_storage_provider_idx
  on public.documents(storage_provider) where status <> 'deleted';

create table if not exists app_private.storage_quota_limits (
  id integer primary key check (id = 1),
  storage_free_tier_bytes bigint not null check (storage_free_tier_bytes > 0),
  storage_limit_bytes bigint not null check (storage_limit_bytes > 0 and storage_limit_bytes <= storage_free_tier_bytes),
  class_a_free_tier bigint not null check (class_a_free_tier > 0),
  class_a_limit bigint not null check (class_a_limit > 0 and class_a_limit <= class_a_free_tier),
  class_b_free_tier bigint not null check (class_b_free_tier > 0),
  class_b_limit bigint not null check (class_b_limit > 0 and class_b_limit <= class_b_free_tier),
  updated_at timestamptz not null default now()
);

insert into app_private.storage_quota_limits (
  id,
  storage_free_tier_bytes,
  storage_limit_bytes,
  class_a_free_tier,
  class_a_limit,
  class_b_free_tier,
  class_b_limit
)
values (
  1,
  10000000000,
  9000000000,
  1000000,
  900000,
  10000000,
  9000000
)
on conflict (id) do nothing;

alter table app_private.storage_quota_limits enable row level security;
revoke all on app_private.storage_quota_limits from public, anon, authenticated;

create table if not exists app_private.storage_usage_monthly (
  month_key text primary key check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  class_a_ops bigint not null default 0 check (class_a_ops >= 0),
  class_b_ops bigint not null default 0 check (class_b_ops >= 0),
  updated_at timestamptz not null default now()
);

alter table app_private.storage_usage_monthly enable row level security;
revoke all on app_private.storage_usage_monthly from public, anon, authenticated;

create or replace function app_private.consume_storage_op(p_kind text, p_count integer default 1)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  lim app_private.storage_quota_limits;
  row_usage app_private.storage_usage_monthly;
begin
  if p_kind is null or p_kind not in ('class_a', 'class_b') or p_count is null or p_count not between 1 and 100 then
    raise exception 'INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('r2_storage_quota', 0));
  select * into lim from app_private.storage_quota_limits where id = 1;

  insert into app_private.storage_usage_monthly(month_key, class_a_ops, class_b_ops, updated_at)
  values (m, 0, 0, now())
  on conflict (month_key) do nothing;

  select * into row_usage
  from app_private.storage_usage_monthly
  where month_key = m
  for update;

  if p_kind = 'class_a' then
    if row_usage.class_a_ops + p_count > lim.class_a_limit then
      raise exception 'STORAGE_OPS_LIMIT_REACHED';
    end if;
    update app_private.storage_usage_monthly
    set class_a_ops = class_a_ops + p_count, updated_at = now()
    where month_key = m
    returning * into row_usage;
  else
    if row_usage.class_b_ops + p_count > lim.class_b_limit then
      raise exception 'STORAGE_OPS_LIMIT_REACHED';
    end if;
    update app_private.storage_usage_monthly
    set class_b_ops = class_b_ops + p_count, updated_at = now()
    where month_key = m
    returning * into row_usage;
  end if;

  return jsonb_build_object(
    'month_key', row_usage.month_key,
    'class_a_ops', row_usage.class_a_ops,
    'class_a_limit', lim.class_a_limit,
    'class_b_ops', row_usage.class_b_ops,
    'class_b_limit', lim.class_b_limit
  );
end;
$$;

revoke all on function app_private.consume_storage_op(text, integer) from public, anon, authenticated;

create or replace function app_private.check_r2_storage_capacity(p_additional_bytes bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  lim app_private.storage_quota_limits;
  used_bytes bigint;
begin
  if p_additional_bytes is null or p_additional_bytes < 0 then
    raise exception 'INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('r2_storage_quota', 0));
  select * into lim from app_private.storage_quota_limits where id = 1;
  select coalesce(sum(size_bytes), 0)::bigint
  into used_bytes
  from public.documents
  where storage_provider = 'r2' and status <> 'deleted';

  if used_bytes + p_additional_bytes > lim.storage_limit_bytes then
    raise exception 'STORAGE_QUOTA_REACHED';
  end if;
end;
$$;

revoke all on function app_private.check_r2_storage_capacity(bigint) from public, anon, authenticated;

create or replace function public.app_consume_storage_op(p_kind text, p_count integer default 1)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_count is null or p_count not between 1 and 10 then
    raise exception 'INVALID_INPUT';
  end if;
  return app_private.consume_storage_op(p_kind, p_count);
end;
$$;

revoke all on function public.app_consume_storage_op(text, integer) from public, anon, authenticated;
grant execute on function public.app_consume_storage_op(text, integer) to authenticated;

create or replace function public.app_upload_intent(
  p_name text,
  p_size bigint,
  p_subject text,
  p_key uuid,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  d public.documents;
  ext text;
  new_id uuid := gen_random_uuid();
  is_image boolean;
  provider text := coalesce(p_provider, 'supabase');
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if provider not in ('supabase', 'r2') then raise exception 'INVALID_FILE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  select * into d from public.documents where user_id = u and upload_key = p_key;
  if found then
    if d.name <> p_name or d.size_bytes <> p_size or d.subject <> p_subject then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(d);
  end if;
  perform public.app_require_online();
  ext := lower(substring(p_name from '\.([^.]+)$'));
  is_image := ext in ('png', 'jpg', 'jpeg', 'webp');
  if p_key is null or p_name is null or length(trim(p_name)) = 0 or p_size is null or ext is null
     or ext not in ('pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp')
     or length(p_name) > 180
     or p_size not between 1 and 20971520
     or (is_image and (p_name not like 'Ảnh câu hỏi - %' or p_size > 3145728)) then
    raise exception 'INVALID_FILE';
  end if;
  if p_subject is null or p_subject not in ('calculus', 'linear-algebra', 'physics') then
    raise exception 'INVALID_SUBJECT';
  end if;
  if (select count(*) from public.documents where user_id = u and status <> 'deleted') >= 20 then
    raise exception 'DOCUMENT_LIMIT';
  end if;

  if provider = 'r2' then
    perform app_private.check_r2_storage_capacity(p_size);
    perform app_private.consume_storage_op('class_a', 1);
  end if;

  insert into public.documents(
    id, user_id, name, subject, file_type, size_bytes, storage_path, storage_provider, upload_key
  )
  values (
    new_id, u, p_name, p_subject, ext, p_size, u::text || '/' || new_id::text || '.' || ext, provider, p_key
  )
  returning * into d;
  return to_jsonb(d);
end;
$$;

revoke all on function public.app_upload_intent(text, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.app_upload_intent(text, bigint, text, uuid, text) to authenticated;

create or replace function public.app_upload_intent(
  p_name text,
  p_size bigint,
  p_subject text,
  p_key uuid
) returns jsonb
language sql security invoker set search_path = '' as $$
  select public.app_upload_intent(p_name, p_size, p_subject, p_key, 'supabase');
$$;

revoke all on function public.app_upload_intent(text, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.app_upload_intent(text, bigint, text, uuid) to authenticated;

create or replace function public.app_document_file(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  d public.documents;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_id is null then raise exception 'NOT_FOUND'; end if;
  select * into d from public.documents where id = p_id;
  if not found or not app_private.can_read_document(p_id) then
    raise exception 'NOT_FOUND';
  end if;
  return jsonb_build_object(
    'name', d.name,
    'file_type', d.file_type,
    'storage_path', d.storage_path,
    'storage_provider', d.storage_provider
  );
end;
$$;

create or replace function public.app_admin_overview()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  m text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  lim app_private.storage_quota_limits;
  row_usage app_private.storage_usage_monthly;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  perform 1 from public.user_roles
    where user_id = actor and role = 'admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;

  select * into lim from app_private.storage_quota_limits where id = 1;
  select * into row_usage from app_private.storage_usage_monthly where month_key = m;

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
    'storage_quota', jsonb_build_object(
      'month_key', m,
      'used_bytes', (select coalesce(sum(size_bytes), 0)::bigint from public.documents where storage_provider = 'r2' and status <> 'deleted'),
      'storage_limit_bytes', lim.storage_limit_bytes,
      'storage_free_tier_bytes', lim.storage_free_tier_bytes,
      'class_a_ops', coalesce(row_usage.class_a_ops, 0),
      'class_a_limit', lim.class_a_limit,
      'class_a_free_tier', lim.class_a_free_tier,
      'class_b_ops', coalesce(row_usage.class_b_ops, 0),
      'class_b_limit', lim.class_b_limit,
      'class_b_free_tier', lim.class_b_free_tier,
      'r2_documents', (select count(*)::int from public.documents where storage_provider = 'r2' and status <> 'deleted'),
      'supabase_documents', (select count(*)::int from public.documents where storage_provider = 'supabase' and status <> 'deleted')
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
