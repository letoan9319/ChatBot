create table app_private.study_group_reactions (
  message_id uuid not null references public.study_group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('like','love','laugh','surprised','sad','celebrate')),
  primary key (message_id,user_id)
);
alter table app_private.study_group_reactions enable row level security;
revoke all on app_private.study_group_reactions from public,anon,authenticated;

create function app_private.group_reaction_summary(p_message uuid,p_viewer uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'reaction',r.reaction,'count',r.total,'reacted',r.reacted
  ) order by r.reaction),'[]'::jsonb)
  from (
    select reaction,count(*) as total,bool_or(user_id=p_viewer) as reacted
    from app_private.study_group_reactions where message_id=p_message
    group by reaction
  ) r;
$$;
revoke all on function app_private.group_reaction_summary(uuid,uuid) from public,anon,authenticated;

create or replace function public.app_group_messages(p_group uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  return coalesce((select jsonb_agg(
      app_private.group_message_json(m.id) ||
        jsonb_build_object('reactions',app_private.group_reaction_summary(m.id,u))
      order by m.created_at,m.id)
    from (select id,created_at from public.study_group_messages
      where group_id=p_group and (p_before is null or created_at<p_before)
      order by created_at desc,id desc limit 50) m),'[]'::jsonb);
end $$;

create function public.app_set_group_reaction(p_group uuid,p_message uuid,p_reaction text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_reaction is not null and p_reaction not in ('like','love','laugh','surprised','sad','celebrate') then
    raise exception 'INVALID_GROUP';
  end if;
  -- Serialize with group leave and join before checking membership.
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  perform 1 from public.study_groups where id=p_group for update;
  if not found or not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.study_group_messages where id=p_message and group_id=p_group) then
    raise exception 'NOT_FOUND';
  end if;
  if p_reaction is null then
    delete from app_private.study_group_reactions where message_id=p_message and user_id=u;
  else
    insert into app_private.study_group_reactions(message_id,user_id,reaction)
    values(p_message,u,p_reaction)
    on conflict (message_id,user_id) do update set reaction=excluded.reaction;
  end if;
  return app_private.group_reaction_summary(p_message,u);
end $$;
revoke all on function public.app_set_group_reaction(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.app_set_group_reaction(uuid,uuid,text) to authenticated;
