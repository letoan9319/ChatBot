alter table public.messages drop constraint messages_generation_provider_check;
alter table public.messages add constraint messages_generation_provider_check
  check (generation_provider in ('ollama', 'openrouter', 'deploy'));
