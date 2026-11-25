-- Backfill thinking duration for historical completed assistant messages from job timestamps.
update public.messages m
set thinking_started_at = coalesce(m.thinking_started_at, j.started_at, m.created_at),
    thinking_ms = greatest(
      0,
      round(
        extract(
          epoch from (
            coalesce(j.finished_at, m.created_at) - coalesce(m.thinking_started_at, j.started_at, m.created_at)
          )
        ) * 1000
      )
    )::integer
from public.jobs j
where j.message_id = m.id
  and j.kind = 'chat'
  and m.role = 'assistant'
  and m.status = 'completed'
  and m.thinking_ms is null;

update public.messages
set thinking_started_at = coalesce(thinking_started_at, created_at),
    thinking_ms = 0
where role = 'assistant'
  and status = 'completed'
  and thinking_ms is null;

create or replace function app_private.ensure_assistant_thinking_ms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'assistant' then
    if new.status = 'completed' and new.thinking_ms is null then
      new.thinking_started_at := coalesce(new.thinking_started_at, old.thinking_started_at, old.created_at, clock_timestamp());
      new.thinking_ms := greatest(
        0,
        round(extract(epoch from (clock_timestamp() - new.thinking_started_at)) * 1000)
      )::integer;
    elsif new.status = 'stopped' and old.status = 'generating' and new.thinking_started_at is not null and new.thinking_ms is null then
      new.thinking_ms := greatest(
        0,
        round(extract(epoch from (clock_timestamp() - new.thinking_started_at)) * 1000)
      )::integer;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.ensure_assistant_thinking_ms() from public, anon, authenticated;

drop trigger if exists ensure_assistant_thinking_ms on public.messages;
create trigger ensure_assistant_thinking_ms
before update on public.messages
for each row
execute function app_private.ensure_assistant_thinking_ms();
