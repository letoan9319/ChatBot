create table public.learning_plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  mode text not null check (mode in ('guided', 'self')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 24000),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);

create index learning_plans_owner on public.learning_plans(user_id, created_at desc);
alter table public.learning_plans enable row level security;
revoke all on public.learning_plans from public, anon, authenticated;
grant select, insert on public.learning_plans to authenticated;
grant update(content, revision) on public.learning_plans to authenticated;

create policy learning_plans_read on public.learning_plans for select to authenticated
  using (user_id = (select auth.uid()));
create policy learning_plans_create on public.learning_plans for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy learning_plans_update on public.learning_plans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
