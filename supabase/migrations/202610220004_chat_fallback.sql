alter table public.worker_heartbeats
  add column chat_fallback_enabled boolean not null default false;

alter table public.messages
  add column generation_provider text
    check (generation_provider in ('ollama', 'openrouter'));

-- Expose configuration, not secrets or other users' message data.
create or replace function public.app_ai_provider() returns text
language sql stable security definer set search_path = public
as $$
  select case when ai_provider='ollama' and chat_fallback_enabled
    then 'ollama_with_openrouter_fallback' else ai_provider end
  from public.worker_heartbeats
  where last_seen > now() - interval '60 seconds'
  order by last_seen desc limit 1;
$$;
revoke all on function public.app_ai_provider() from public, anon;
grant execute on function public.app_ai_provider() to authenticated;
