-- Community metadata is discoverable; membership never grants document/chat access.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table public.study_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject in ('calculus','linear-algebra','physics')),
  name text not null check (length(btrim(name)) between 3 and 80),
  description text not null default '' check (length(description)<=500),
  created_at timestamptz not null default clock_timestamp(),
  create_key uuid not null,
  unique(owner_id,create_key)
);
create index study_groups_subject on public.study_groups(subject,created_at desc);

create table public.study_group_members (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  primary key(group_id,user_id)
);
create index study_group_members_user on public.study_group_members(user_id,group_id);

create table public.study_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  key uuid not null,
  unique(user_id,key)
);
create index study_group_messages_group on public.study_group_messages(group_id,created_at desc,id desc);
create index study_group_messages_rate on public.study_group_messages(user_id,created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('document_ready','document_failed','chat_completed','chat_failed','chat_interrupted','group_message')),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body)<=300),
  conversation_id uuid references public.conversations(id) on delete set null,
  group_id uuid references public.study_groups(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  event_key text not null,
  unique(user_id,event_key)
);
create index notifications_owner on public.notifications(user_id,created_at desc,id desc);
create index notifications_unread on public.notifications(user_id) where read_at is null;

-- This helper reads as the migration owner to avoid recursive membership RLS.
-- Its only identity input is auth.uid(), never an arbitrary caller-supplied user.
create function app_private.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.study_group_members where group_id=p_group and user_id=auth.uid()
  );
$$;
revoke all on function app_private.is_group_member(uuid) from public,anon,authenticated;
grant execute on function app_private.is_group_member(uuid) to authenticated;

alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;
alter table public.study_group_messages enable row level security;
alter table public.notifications enable row level security;
revoke all on public.study_groups,public.study_group_members,public.study_group_messages,public.notifications from public,anon,authenticated;
grant select on public.study_groups,public.study_group_members,public.study_group_messages,public.notifications to authenticated;
create policy groups_discover on public.study_groups for select to authenticated using ((select auth.uid()) is not null);
create policy group_members_read on public.study_group_members for select to authenticated using (app_private.is_group_member(group_id));
create policy group_messages_read on public.study_group_messages for select to authenticated using (app_private.is_group_member(group_id));
create policy notifications_read_own on public.notifications for select to authenticated using (user_id=(select auth.uid()));

create function app_private.group_json(p_group uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',g.id,'owner_id',g.owner_id,'subject',g.subject,
    'name',g.name,'description',g.description,'created_at',g.created_at,
    'member_count',(select count(*) from public.study_group_members m where m.group_id=g.id),
    'joined',exists(select 1 from public.study_group_members m where m.group_id=g.id and m.user_id=auth.uid()))
  from public.study_groups g where g.id=p_group;
$$;
revoke all on function app_private.group_json(uuid) from public,anon,authenticated;

create function app_private.group_message_json(p_message uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'group_id',m.group_id,'user_id',m.user_id,
    'username',coalesce(p.username,'Bạn học'),'content',m.content,'created_at',m.created_at)
  from public.study_group_messages m left join public.profiles p on p.id=m.user_id
  where m.id=p_message;
$$;
revoke all on function app_private.group_message_json(uuid) from public,anon,authenticated;

create function public.app_list_groups(p_subject text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_subject is not null and p_subject not in ('calculus','linear-algebra','physics') then raise exception 'INVALID_SUBJECT'; end if;
  -- Preserve the caller's at most twenty memberships before filling discovery
  -- slots. Bound JSON construction even when the public directory grows.
  return coalesce((select jsonb_agg(app_private.group_json(g.id) order by g.joined desc,g.created_at desc,g.id)
    from (select candidate.id,candidate.created_at,
      exists(select 1 from public.study_group_members m where m.group_id=candidate.id and m.user_id=auth.uid()) as joined
      from public.study_groups candidate where p_subject is null or candidate.subject=p_subject
      order by joined desc,candidate.created_at desc,candidate.id limit 100) g),'[]'::jsonb);
end $$;

create function public.app_create_group(p_name text,p_subject text,p_description text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); g public.study_groups; chosen_name text:=btrim(p_name); chosen_description text:=btrim(coalesce(p_description,''));
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_key is null or chosen_name is null or length(chosen_name) not between 3 and 80 or length(chosen_description)>500 then raise exception 'INVALID_GROUP'; end if;
  if p_subject is null or p_subject not in ('calculus','linear-algebra','physics') then raise exception 'INVALID_SUBJECT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  select * into g from public.study_groups where owner_id=u and create_key=p_key;
  if found then
    if g.name is distinct from chosen_name or g.subject is distinct from p_subject or g.description is distinct from chosen_description then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return app_private.group_json(g.id);
  end if;
  if (select count(*) from public.study_groups where owner_id=u)>=5 or (select count(*) from public.study_group_members where user_id=u)>=20 then raise exception 'GROUP_LIMIT'; end if;
  insert into public.study_groups(owner_id,subject,name,description,create_key)
    values(u,p_subject,chosen_name,chosen_description,p_key) returning * into g;
  insert into public.study_group_members(group_id,user_id) values(g.id,u);
  return app_private.group_json(g.id);
end $$;

create function public.app_join_group(p_group uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  perform 1 from public.study_groups where id=p_group for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.study_group_members where group_id=p_group and user_id=u) then return app_private.group_json(p_group); end if;
  if (select count(*) from public.study_group_members where user_id=u)>=20 then raise exception 'GROUP_LIMIT'; end if;
  if (select count(*) from public.study_group_members where group_id=p_group)>=50 then raise exception 'GROUP_FULL'; end if;
  insert into public.study_group_members(group_id,user_id) values(p_group,u);
  return app_private.group_json(p_group);
end $$;

create function public.app_leave_group(p_group uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); owner uuid;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  select owner_id into owner from public.study_groups where id=p_group for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if owner=u then raise exception 'GROUP_OWNER'; end if;
  delete from public.study_group_members where group_id=p_group and user_id=u;
end $$;

create function public.app_group_messages(p_group uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  return coalesce((select jsonb_agg(app_private.group_message_json(m.id) order by m.created_at,m.id)
    from (select id,created_at from public.study_group_messages
      where group_id=p_group and (p_before is null or created_at<p_before)
      order by created_at desc,id desc limit 50) m),'[]'::jsonb);
end $$;

create function public.app_post_group_message(p_group uuid,p_content text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.study_group_messages; chosen_content text:=btrim(p_content);
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  if p_key is null or chosen_content is null or length(chosen_content) not between 1 and 2000 then raise exception 'INVALID_GROUP'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community:'||u::text,0));
  perform 1 from public.study_groups where id=p_group for update;
  if not found or not app_private.is_group_member(p_group) then raise exception 'NOT_FOUND'; end if;
  select * into m from public.study_group_messages where user_id=u and key=p_key;
  if found then
    if m.group_id is distinct from p_group or m.content is distinct from chosen_content then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return app_private.group_message_json(m.id);
  end if;
  if (select count(*) from public.study_group_messages where user_id=u and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'RATE_LIMIT'; end if;
  insert into public.study_group_messages(group_id,user_id,content,key) values(p_group,u,chosen_content,p_key) returning * into m;
  return app_private.group_message_json(m.id);
end $$;

create function public.app_read_notifications(p_id uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); changed integer;
begin
  if u is null then raise exception 'UNAUTHORIZED'; end if;
  update public.notifications set read_at=clock_timestamp()
    where user_id=u and read_at is null and (p_id is null or id=p_id);
  get diagnostics changed=row_count;
  return changed;
end $$;

-- Notification payloads deliberately contain no document text, questions or answers.
create function app_private.notify_document_status() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,kind,title,body,event_key)
  values(new.user_id,'document_'||new.status,
    case when new.status='ready' then 'Tài liệu đã sẵn sàng' else 'Xử lý tài liệu thất bại' end,
    case when new.status='ready' then 'Bạn có thể dùng tài liệu trong phiên học.' else 'Mở thư viện để kiểm tra và thử lại.' end,
    'document:'||new.id::text||':'||new.index_version::text||':'||new.status)
  on conflict(user_id,event_key) do nothing;
  return new;
end $$;
create trigger notify_document_status after update of status on public.documents
for each row when (new.status in ('ready','failed') and old.status is distinct from new.status)
execute function app_private.notify_document_status();

create function app_private.notify_chat_status() returns trigger
language plpgsql security definer set search_path='' as $$
declare conv uuid;
begin
  select c.id into conv from public.messages m join public.conversations c on c.id=m.conversation_id
    where m.id=new.message_id and m.user_id=new.user_id and c.user_id=new.user_id and m.role='assistant';
  if conv is null then return new; end if;
  insert into public.notifications(user_id,kind,title,body,conversation_id,event_key)
  values(new.user_id,'chat_'||new.status,
    case when new.status='completed' then 'Câu trả lời đã hoàn tất' else 'Phiên trả lời chưa hoàn tất' end,
    'Mở phiên học để xem kết quả và trạng thái.',conv,'chat:'||new.id::text||':'||new.status)
  on conflict(user_id,event_key) do nothing;
  return new;
end $$;
create trigger notify_chat_status after update of status on public.jobs
for each row when (new.kind='chat' and new.status in ('completed','failed') and old.status is distinct from new.status)
execute function app_private.notify_chat_status();

-- The worker records recoverable interruptions on messages, while jobs requeue.
create function app_private.notify_chat_interrupted() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,kind,title,body,conversation_id,event_key)
  select new.user_id,'chat_interrupted','Phiên trả lời bị gián đoạn',
    'Mở phiên học để kiểm tra trạng thái và thử lại.',new.conversation_id,'chat:'||j.id::text||':interrupted'
  from public.jobs j join public.conversations c on c.id=new.conversation_id and c.user_id=new.user_id
  where j.message_id=new.id and j.user_id=new.user_id and j.kind='chat'
  on conflict(user_id,event_key) do nothing;
  return new;
end $$;
create trigger notify_chat_interrupted after update of status on public.messages
for each row when (new.role='assistant' and new.status='interrupted' and old.status is distinct from new.status)
execute function app_private.notify_chat_interrupted();

create function app_private.notify_group_message() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,kind,title,body,group_id,event_key)
  select m.user_id,'group_message','Tin nhắn nhóm học tập','Có tin nhắn mới trong nhóm học tập.',new.group_id,'group:'||new.id::text
  from public.study_group_members m where m.group_id=new.group_id and m.user_id<>new.user_id
  on conflict(user_id,event_key) do nothing;
  return new;
end $$;
create trigger notify_group_message after insert on public.study_group_messages
for each row execute function app_private.notify_group_message();

revoke all on function app_private.notify_document_status(),app_private.notify_chat_status(),app_private.notify_chat_interrupted(),app_private.notify_group_message() from public,anon,authenticated;
revoke all on function public.app_list_groups(text),public.app_create_group(text,text,text,uuid),public.app_join_group(uuid),public.app_leave_group(uuid),public.app_group_messages(uuid,timestamptz),public.app_post_group_message(uuid,text,uuid),public.app_read_notifications(uuid) from public,anon,authenticated;
grant execute on function public.app_list_groups(text),public.app_create_group(text,text,text,uuid),public.app_join_group(uuid),public.app_leave_group(uuid),public.app_group_messages(uuid,timestamptz),public.app_post_group_message(uuid,text,uuid),public.app_read_notifications(uuid) to authenticated;
