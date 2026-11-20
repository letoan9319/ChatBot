create function public.app_ocr_available() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.worker_heartbeats
    where id = 'learnstep-mineru' and last_seen > now() - interval '35 seconds'
  );
$$;

revoke all on function public.app_ocr_available() from public, anon, authenticated;
grant execute on function public.app_ocr_available() to authenticated;
