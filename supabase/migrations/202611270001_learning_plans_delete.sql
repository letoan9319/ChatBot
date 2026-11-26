grant delete on public.learning_plans to authenticated;

create policy learning_plans_delete on public.learning_plans for delete to authenticated
  using (user_id = (select auth.uid()));
