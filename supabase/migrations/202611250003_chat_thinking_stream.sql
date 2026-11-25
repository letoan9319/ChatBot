alter table public.messages
  add column if not exists thinking_content text,
  drop constraint if exists messages_thinking_metadata_check,
  add constraint messages_thinking_metadata_check check (
    (thinking_started_at is null and thinking_ms is null and thinking_content is null)
    or (
      role = 'assistant'
      and thinking_started_at is not null
      and (thinking_ms is null or thinking_ms >= 0)
      and (thinking_content is null or length(thinking_content) <= 32000)
    )
  );
