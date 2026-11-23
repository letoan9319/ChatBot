alter table public.messages
  add column thinking_started_at timestamptz,
  add column thinking_ms integer,
  add constraint messages_thinking_metadata_check check (
    (thinking_started_at is null and thinking_ms is null)
    or (role = 'assistant' and thinking_started_at is not null and (thinking_ms is null or thinking_ms >= 0))
  );
