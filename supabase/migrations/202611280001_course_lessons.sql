-- Guided course: reviewed lesson content shared by everyone and private per-learner progress.
-- The chapter and lesson outline lives in the web app; lesson ids follow subject.cN.lM.

create table public.course_lessons (
  lesson_id text primary key
    check (lesson_id ~ '^(calculus|linear-algebra|physics)\.c[1-9][0-9]?\.l[1-9][0-9]?$'),
  body text not null default '' check (length(body) <= 40000),
  quiz jsonb not null default '[]'::jsonb check (jsonb_typeof(quiz) = 'array' and jsonb_array_length(quiz) <= 10),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  status text not null default 'draft' check (status in ('draft', 'published')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (status = 'draft' or (published_at is not null and length(btrim(body)) > 0))
);
alter table public.course_lessons enable row level security;
revoke all on public.course_lessons from public, anon, authenticated;

create table public.course_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lesson_id text not null
    check (lesson_id ~ '^(calculus|linear-algebra|physics)\.c[1-9][0-9]?\.l[1-9][0-9]?$'),
  best_score smallint not null default 0 check (best_score between 0 and 100),
  attempts integer not null default 0 check (attempts >= 0),
  passed_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table public.course_progress enable row level security;
revoke all on public.course_progress from public, anon, authenticated;
grant select on public.course_progress to authenticated;
create policy course_progress_read_own on public.course_progress for select to authenticated
  using (user_id = (select auth.uid()));

create function app_private.valid_course_quiz(p_quiz jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_quiz) = 'array'
    and jsonb_array_length(p_quiz) <= 10
    and not exists (
      select 1 from jsonb_array_elements(p_quiz) item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'question') is distinct from 'string'
        or length(btrim(item->>'question')) not between 1 and 600
        or jsonb_typeof(item->'options') is distinct from 'array'
        or jsonb_array_length(item->'options') not between 2 and 5
        or exists (
          select 1 from jsonb_array_elements(item->'options') opt
          where jsonb_typeof(opt) <> 'string' or length(btrim(opt #>> '{}')) not between 1 and 300
        )
        or jsonb_typeof(item->'correct') is distinct from 'number'
        or (item->>'correct') !~ '^[0-9]$'
        or (item->>'correct')::integer >= jsonb_array_length(item->'options')
        or (item ? 'explanation' and (jsonb_typeof(item->'explanation') <> 'string'
          or length(item->>'explanation') > 1000))
    );
$$;
revoke all on function app_private.valid_course_quiz(jsonb) from public, anon, authenticated;

create function app_private.valid_course_sources(p_sources jsonb)
returns boolean
language sql stable security definer set search_path = '' as $$
  select jsonb_typeof(p_sources) = 'array'
    and jsonb_array_length(p_sources) <= 20
    and not exists (
      select 1 from jsonb_array_elements(p_sources) item
      where jsonb_typeof(item) <> 'object'
        or (item->>'label') !~ '^S[0-9]{1,2}$'
        or jsonb_typeof(item->'document_name') is distinct from 'string'
        or length(item->>'document_name') not between 1 and 300
        or (item->>'document_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (item ? 'chunk_id' and jsonb_typeof(item->'chunk_id') <> 'null'
          and (item->>'chunk_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or (item ? 'page' and jsonb_typeof(item->'page') not in ('null', 'number'))
        -- Learners may only be pointed at published shared documents.
        or not exists (
          select 1 from public.knowledge_documents k where k.document_id = (item->>'document_id')::uuid
        )
    );
$$;
revoke all on function app_private.valid_course_sources(jsonb) from public, anon, authenticated;

-- Learner: which lessons of a subject are published, and this learner's progress.
create function public.app_course_overview(p_subject text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if p_subject is null or p_subject not in ('calculus', 'linear-algebra', 'physics') then
    raise exception 'INVALID_INPUT';
  end if;
  return jsonb_build_object(
    'published', coalesce((
      select jsonb_agg(jsonb_build_object('lesson_id', l.lesson_id, 'questions', jsonb_array_length(l.quiz))
        order by l.lesson_id)
      from public.course_lessons l
      where l.status = 'published' and l.lesson_id like p_subject || '.%'
    ), '[]'::jsonb),
    'progress', coalesce((
      select jsonb_agg(jsonb_build_object('lesson_id', p.lesson_id, 'best_score', p.best_score,
        'attempts', p.attempts, 'passed_at', p.passed_at) order by p.lesson_id)
      from public.course_progress p
      where p.user_id = actor and p.lesson_id like p_subject || '.%'
    ), '[]'::jsonb)
  );
end;
$$;

-- Learner: a published lesson without the answer key.
create function public.app_course_lesson(p_lesson text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  lesson public.course_lessons;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select * into lesson from public.course_lessons where lesson_id = p_lesson and status = 'published';
  if not found then return null; end if;
  return jsonb_build_object(
    'lesson_id', lesson.lesson_id,
    'body', lesson.body,
    'sources', lesson.sources,
    'published_at', lesson.published_at,
    'quiz', coalesce((
      select jsonb_agg(jsonb_build_object('question', item->'question', 'options', item->'options') order by ordinal)
      from jsonb_array_elements(lesson.quiz) with ordinality as q(item, ordinal)
    ), '[]'::jsonb)
  );
end;
$$;

-- Learner: grade on the server so progress reflects real answers.
create function public.app_submit_lesson_quiz(p_lesson text, p_answers integer[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  lesson public.course_lessons;
  total integer;
  correct_count integer := 0;
  score integer;
  results jsonb := '[]'::jsonb;
  item jsonb;
  idx integer;
  right_answer integer;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select * into lesson from public.course_lessons where lesson_id = p_lesson and status = 'published';
  if not found then raise exception 'NOT_FOUND'; end if;
  total := jsonb_array_length(lesson.quiz);
  if total = 0 then raise exception 'NO_QUIZ'; end if;
  if p_answers is null or coalesce(array_length(p_answers, 1), 0) <> total then raise exception 'INVALID_INPUT'; end if;
  for idx in 0 .. total - 1 loop
    item := lesson.quiz -> idx;
    right_answer := (item->>'correct')::integer;
    if coalesce(p_answers[idx + 1] = right_answer, false) then correct_count := correct_count + 1; end if;
    results := results || jsonb_build_array(jsonb_build_object(
      'correct', coalesce(p_answers[idx + 1] = right_answer, false),
      'answer', right_answer,
      'explanation', coalesce(item->>'explanation', '')
    ));
  end loop;
  score := round(100.0 * correct_count / total);
  insert into public.course_progress(user_id, lesson_id, best_score, attempts, passed_at, last_attempt_at)
  values (actor, p_lesson, score, 1, case when score >= 70 then now() end, now())
  on conflict (user_id, lesson_id) do update set
    best_score = greatest(public.course_progress.best_score, excluded.best_score),
    attempts = least(public.course_progress.attempts + 1, 1000000),
    passed_at = coalesce(public.course_progress.passed_at, excluded.passed_at),
    last_attempt_at = excluded.last_attempt_at;
  return jsonb_build_object('score', score, 'passed', score >= 70, 'results', results);
end;
$$;

-- Learner: finish a lesson that has no published quiz yet, so the path never dead-ends.
create function public.app_complete_lesson(p_lesson text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if p_lesson is null or p_lesson !~ '^(calculus|linear-algebra|physics)\.c[1-9][0-9]?\.l[1-9][0-9]?$' then
    raise exception 'INVALID_INPUT';
  end if;
  if exists (select 1 from public.course_lessons
    where lesson_id = p_lesson and status = 'published' and jsonb_array_length(quiz) > 0) then
    raise exception 'QUIZ_REQUIRED';
  end if;
  insert into public.course_progress(user_id, lesson_id, best_score, attempts, passed_at, last_attempt_at)
  values (actor, p_lesson, 0, 0, now(), now())
  on conflict (user_id, lesson_id) do update set
    passed_at = coalesce(public.course_progress.passed_at, now()),
    last_attempt_at = now();
  return true;
end;
$$;

-- Content managers: every lesson of a subject, drafts included, with the answer key.
create function public.app_manage_course_lessons(p_subject text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not app_private.can_manage_knowledge(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_subject is null or p_subject not in ('calculus', 'linear-algebra', 'physics') then
    raise exception 'INVALID_INPUT';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('lesson_id', lesson_id, 'body', body, 'quiz', quiz, 'sources', sources,
      'status', status, 'updated_at', updated_at, 'published_at', published_at) order by lesson_id)
    from public.course_lessons where lesson_id like p_subject || '.%'
  ), '[]'::jsonb);
end;
$$;

create function public.app_save_course_lesson(
  p_lesson text, p_body text, p_quiz jsonb, p_sources jsonb, p_publish boolean
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved public.course_lessons;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  -- Keep the role valid through the write, including concurrent role revocation.
  perform 1 from public.user_roles
    where user_id = actor and role in ('admin', 'content_manager') for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_lesson is null or p_lesson !~ '^(calculus|linear-algebra|physics)\.c[1-9][0-9]?\.l[1-9][0-9]?$'
    or p_body is null or length(p_body) > 40000 or p_publish is null
    or not app_private.valid_course_quiz(coalesce(p_quiz, 'null'::jsonb)) then
    raise exception 'INVALID_INPUT';
  end if;
  if not app_private.valid_course_sources(coalesce(p_sources, 'null'::jsonb)) then raise exception 'INVALID_SOURCES'; end if;
  if p_publish and length(btrim(p_body)) = 0 then raise exception 'EMPTY_LESSON'; end if;

  insert into public.course_lessons(lesson_id, body, quiz, sources, status, updated_by, updated_at, published_at)
  values (p_lesson, p_body, p_quiz, p_sources, case when p_publish then 'published' else 'draft' end,
    actor, now(), case when p_publish then now() end)
  on conflict (lesson_id) do update set
    body = excluded.body, quiz = excluded.quiz, sources = excluded.sources, status = excluded.status,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at,
    published_at = case when p_publish then now() end
  returning * into saved;
  return jsonb_build_object('lesson_id', saved.lesson_id, 'body', saved.body, 'quiz', saved.quiz,
    'sources', saved.sources, 'status', saved.status, 'updated_at', saved.updated_at,
    'published_at', saved.published_at);
end;
$$;

revoke all on function
  public.app_course_overview(text),
  public.app_course_lesson(text),
  public.app_submit_lesson_quiz(text, integer[]),
  public.app_complete_lesson(text),
  public.app_manage_course_lessons(text),
  public.app_save_course_lesson(text, text, jsonb, jsonb, boolean)
  from public, anon;
grant execute on function
  public.app_course_overview(text),
  public.app_course_lesson(text),
  public.app_submit_lesson_quiz(text, integer[]),
  public.app_complete_lesson(text),
  public.app_manage_course_lessons(text),
  public.app_save_course_lesson(text, text, jsonb, jsonb, boolean)
  to authenticated;
