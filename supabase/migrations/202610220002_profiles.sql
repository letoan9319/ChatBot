-- No auth.users trigger: signup remains independent from profile onboarding.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,23}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create function public.app_set_username(p_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  chosen text := lower(btrim(p_username));
  current_name text;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if chosen is null or chosen !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception 'INVALID_USERNAME';
  end if;
  -- One name per account. Retries cannot replace an existing profile.
  select username into current_name from public.profiles where id = u;
  if found then return current_name; end if;
  insert into public.profiles(id, username) values (u, chosen)
    on conflict (id) do nothing;
  select username into current_name from public.profiles where id = u;
  return current_name;
exception when unique_violation then
  raise exception 'USERNAME_TAKEN';
end $$;
revoke all on function public.app_set_username(text) from public, anon, authenticated;
grant execute on function public.app_set_username(text) to authenticated;
