-- A learning day is earned by a completed chat job with a nonempty, cited answer.
-- Dates come from PostgreSQL, never from a browser-supplied date or clock.
create table public.study_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  first_completed_at timestamptz not null,
  primary key (user_id, study_date)
);
alter table public.study_activity_days enable row level security;
revoke all on public.study_activity_days from public, anon, authenticated;
grant select on public.study_activity_days to authenticated;
create policy study_days_read_own on public.study_activity_days
  for select to authenticated using (user_id = (select auth.uid()));

create function public.app_record_study_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  completed_at timestamptz := clock_timestamp();
begin
  if exists (
    select 1 from public.messages m
    join public.conversations c on c.id=m.conversation_id and c.user_id=new.user_id
    where m.id=new.message_id and m.user_id=new.user_id
      and m.role='assistant' and m.status='completed' and length(btrim(m.content))>0
      and exists (
        select 1 from public.message_sources s
        join public.documents d on d.id=s.document_id and d.user_id=new.user_id
        where s.message_id=m.id and s.user_id=new.user_id
      )
  ) then
    insert into public.study_activity_days(user_id, study_date, first_completed_at)
    values(new.user_id, (completed_at at time zone 'Asia/Ho_Chi_Minh')::date, completed_at)
    on conflict(user_id, study_date) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.app_record_study_day() from public, anon, authenticated;

-- Worker commits sources before finishing the job. The trigger shares that
-- transaction, so failed/rolled-back attempts cannot award a learning day.
create trigger record_completed_study_day
after update of status on public.jobs
for each row when (new.kind='chat' and new.status='completed' and old.status is distinct from new.status)
execute function public.app_record_study_day();

-- Preserve qualifying historical study, using completion time rather than the
-- time a question was queued. Source tombstones still represent past learning.
insert into public.study_activity_days(user_id, study_date, first_completed_at)
select j.user_id, (j.finished_at at time zone 'Asia/Ho_Chi_Minh')::date, min(j.finished_at)
from public.jobs j
join public.messages m on m.id=j.message_id and m.user_id=j.user_id
join public.conversations c on c.id=m.conversation_id and c.user_id=j.user_id
where j.kind='chat' and j.status='completed' and j.finished_at is not null
  and j.finished_at<=statement_timestamp()
  and m.role='assistant' and m.status='completed' and length(btrim(m.content))>0
  and exists (
    select 1 from public.message_sources s
    join public.documents d on d.id=s.document_id and d.user_id=j.user_id
    where s.message_id=m.id and s.user_id=j.user_id
  )
group by j.user_id, (j.finished_at at time zone 'Asia/Ho_Chi_Minh')::date
on conflict(user_id, study_date) do update set
  first_completed_at=least(study_activity_days.first_completed_at, excluded.first_completed_at);

create function public.app_get_streak() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  today date := (statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  result jsonb;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  with days as materialized (
    select study_date from public.study_activity_days where user_id=u and study_date<=today
  ), numbered as (
    select study_date, study_date-(row_number() over(order by study_date))::integer as island from days
  ), runs as (
    select max(study_date) as last_date, count(*)::integer as length from numbered group by island
  )
  select jsonb_build_object(
    'current', coalesce((select length from runs where last_date>=today-1 order by last_date desc limit 1),0),
    'longest', coalesce((select max(length) from runs),0),
    'total_days', (select count(*) from days),
    'today_completed', exists(select 1 from days where study_date=today),
    'last_study_date', (select max(study_date) from days),
    'today', today,
    'timezone', 'Asia/Ho_Chi_Minh',
    'week', (select jsonb_agg(jsonb_build_object(
      'date', today-offset_days,
      'completed', exists(select 1 from days where study_date=today-offset_days)
    ) order by offset_days desc) from generate_series(0,6) as offsets(offset_days))
  ) into result;
  return result;
end;
$$;
revoke all on function public.app_get_streak() from public, anon;
grant execute on function public.app_get_streak() to authenticated;
