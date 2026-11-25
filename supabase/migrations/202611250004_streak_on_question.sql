-- Award a learning day immediately when an authenticated learner submits a question.
drop trigger if exists record_completed_study_day on public.jobs;
drop trigger if exists record_question_study_day on public.messages;

create or replace function public.app_record_study_day() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  asked_at timestamptz := clock_timestamp();
begin
  if new.role = 'user'
    and length(btrim(new.content)) > 0
    and exists (
      select 1 from public.conversations c
      where c.id = new.conversation_id and c.user_id = new.user_id
    )
  then
    insert into public.study_activity_days(user_id, study_date, first_completed_at)
    values (new.user_id, (asked_at at time zone 'Asia/Ho_Chi_Minh')::date, asked_at)
    on conflict (user_id, study_date) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.app_record_study_day() from public, anon, authenticated;

create trigger record_question_study_day
after insert on public.messages
for each row when (new.role = 'user')
execute function public.app_record_study_day();

-- Credit existing user questions (including uncited or in-flight turns) by Vietnam date.
insert into public.study_activity_days(user_id, study_date, first_completed_at)
select m.user_id, (m.created_at at time zone 'Asia/Ho_Chi_Minh')::date, min(m.created_at)
from public.messages m
join public.conversations c on c.id = m.conversation_id and c.user_id = m.user_id
where m.role = 'user'
  and length(btrim(m.content)) > 0
  and m.created_at <= statement_timestamp()
group by m.user_id, (m.created_at at time zone 'Asia/Ho_Chi_Minh')::date
on conflict (user_id, study_date) do update set
  first_completed_at = least(study_activity_days.first_completed_at, excluded.first_completed_at);
