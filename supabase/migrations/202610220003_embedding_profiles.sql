-- Remember the actual vector namespace so changing providers cannot mix spaces
-- and cleanup can remove vectors indexed by a previously configured worker.
alter table public.documents
  add column embedding_profile text not null default 'ollama:bge-m3',
  add column vector_collection text not null default 'study_bge_m3_v1';

-- RLS and RPC write boundaries from 001 remain in force. Clients cannot update
-- these fields directly; only the trusted worker records index metadata.
alter table public.worker_heartbeats
  add column ai_provider text not null default 'ollama'
    check (ai_provider in ('ollama', 'openrouter'));

create function public.app_ai_provider() returns text
language sql stable security definer set search_path = public
as $$
  select ai_provider from public.worker_heartbeats
  where last_seen > now() - interval '60 seconds'
  order by last_seen desc limit 1;
$$;
revoke all on function public.app_ai_provider() from public, anon;
grant execute on function public.app_ai_provider() to authenticated;
