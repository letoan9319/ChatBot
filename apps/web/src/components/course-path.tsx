"use client";

import { useCallback, useEffect, useState } from "react";
import {
  chapterProgress, course, courseProgress, findLesson, lessonStates, nextLesson, PASS_SCORE, subjectLessons,
  type LessonProgress, type LessonSource, type LessonState,
} from "@/core/course";
import type { Source } from "@/core/types";
import { subjects, type Subject } from "@/core/validation";
import { Markdown } from "./markdown";
import styles from "./course-path.module.css";

type Overview = { published: { lesson_id: string; questions: number }[]; progress: LessonProgress[] };
type PublishedLesson = { lesson_id: string; body: string; sources: LessonSource[]; quiz: { question: string; options: string[] }[] };
type QuizResult = { score: number; passed: boolean; results: { correct: boolean; answer: number; explanation: string }[] };

const stateLabels: Record<LessonState, string> = { passed: "Đã xong", current: "Đang học", open: "Đã mở", locked: "Chưa mở" };
const subjectIds = Object.keys(subjects) as Subject[];

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Không tải được lộ trình học. Hãy thử lại.");
  return data as T;
}

export function CoursePath({ onAsk }: { onAsk: (subject: Subject, lessonId: string) => void }) {
  const [overviews, setOverviews] = useState<Partial<Record<Subject, Overview>>>({});
  const [subject, setSubject] = useState<Subject | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all(subjectIds.map(id => call<Overview>(`course?subject=${id}`).then(data => [id, data] as const)))
      .then(entries => { if (active) { setOverviews(Object.fromEntries(entries)); setError(""); } })
      .catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, [reload]);

  const refreshSubject = useCallback(async (id: Subject) => {
    const data = await call<Overview>(`course?subject=${id}`);
    setOverviews(current => ({ ...current, [id]: data }));
  }, []);

  const loaded = subjectIds.every(id => overviews[id]);
  if (error && !loaded) {
    return <div className={styles.state} role="alert">
      <p>{error}</p>
      <button type="button" onClick={() => { setError(""); setReload(value => value + 1); }}>Thử lại</button>
    </div>;
  }
  if (!loaded) return <div className={styles.state} role="status"><p>Đang tải lộ trình học…</p></div>;

  if (subject && lessonId) {
    return <LessonView key={lessonId} subject={subject} lessonId={lessonId} overview={overviews[subject]!}
      onBack={() => setLessonId(null)} onOpen={setLessonId} onAsk={() => onAsk(subject, lessonId)}
      onProgress={() => refreshSubject(subject)} />;
  }
  if (subject) {
    return <SubjectPath subject={subject} overview={overviews[subject]!} onBack={() => setSubject(null)} onOpen={setLessonId} />;
  }
  return <section className={styles.subjects} aria-labelledby="course-subjects-heading">
    <header className={styles.intro}>
      <h2 id="course-subjects-heading">Chọn môn để bắt đầu</h2>
      <p>Học lần lượt từ chương 1. Mỗi bài có bài giảng, ví dụ và bài kiểm tra ngắn; đạt {PASS_SCORE}% để mở bài tiếp theo.</p>
    </header>
    <div className={styles.subjectGrid}>
      {subjectIds.map(id => {
        const overview = overviews[id]!;
        const { done, total } = courseProgress(id, overview.progress);
        const next = nextLesson(id, overview.progress);
        const position = next ? findLesson(next.id) : null;
        return <button type="button" key={id} className={styles.subjectCard} onClick={() => setSubject(id)}>
          <strong>{subjects[id]}</strong>
          <span>{course[id].length} chương · {total} bài</span>
          <progress value={done} max={total} aria-label={`Đã xong ${done}/${total} bài`} />
          <span className={styles.meta}>{done === total ? "Đã hoàn thành môn học"
            : done ? `Học tiếp: bài ${position?.number} ${next?.title}` : "Bắt đầu từ chương 1"}</span>
        </button>;
      })}
    </div>
  </section>;
}

function SubjectPath({ subject, overview, onBack, onOpen }: {
  subject: Subject; overview: Overview; onBack: () => void; onOpen: (id: string) => void;
}) {
  const states = lessonStates(subject, overview.progress);
  const published = new Set(overview.published.map(item => item.lesson_id));
  const next = nextLesson(subject, overview.progress);
  const { done, total } = courseProgress(subject, overview.progress);
  return <section className={styles.path} aria-labelledby="course-path-heading">
    <button type="button" className={styles.back} onClick={onBack}>Đổi môn học</button>
    <header className={styles.pathHeader}>
      <div>
        <h2 id="course-path-heading">{subjects[subject]}</h2>
        <p className={styles.meta}>Đã xong {done}/{total} bài</p>
        <progress value={done} max={total} aria-label={`Tiến độ môn ${subjects[subject]}`} />
      </div>
      {next && <button type="button" className={styles.primary} onClick={() => onOpen(next.id)}>
        {done ? "Học tiếp" : "Bắt đầu học"}
      </button>}
    </header>
    <ol className={styles.chapters}>
      {course[subject].map(chapter => {
        const counted = chapterProgress(chapter, overview.progress);
        const hasCurrent = chapter.lessons.some(lesson => states.get(lesson.id) === "current");
        const locked = chapter.lessons.every(lesson => states.get(lesson.id) === "locked");
        return <li key={chapter.id} className={styles.chapter} data-locked={locked || undefined}>
          <details open={hasCurrent}>
            <summary>
              <span className={styles.chapterNumber}>Chương {chapter.number}</span>
              <strong>{chapter.title}</strong>
              <span className={styles.meta}>{counted.done === counted.total ? "Hoàn thành" : `${counted.done}/${counted.total} bài`}</span>
            </summary>
            <p className={styles.meta}>{chapter.summary}</p>
            <ul className={styles.lessons}>
              {chapter.lessons.map((lesson, index) => {
                const state = states.get(lesson.id)!;
                return <li key={lesson.id}>
                  <button type="button" disabled={state === "locked"} onClick={() => onOpen(lesson.id)} data-state={state}>
                    <span className={styles.lessonNumber}>{chapter.number}.{index + 1}</span>
                    <span className={styles.lessonTitle}>{lesson.title}</span>
                    {!published.has(lesson.id) && <span className={styles.meta}>Học cùng trợ giảng</span>}
                    <span className={styles.badge} data-state={state}>{stateLabels[state]}</span>
                  </button>
                </li>;
              })}
            </ul>
          </details>
        </li>;
      })}
    </ol>
  </section>;
}

function LessonView({ subject, lessonId, overview, onBack, onOpen, onAsk, onProgress }: {
  subject: Subject; lessonId: string; overview: Overview;
  onBack: () => void; onOpen: (id: string) => void; onAsk: () => void; onProgress: () => Promise<void>;
}) {
  const found = findLesson(lessonId)!;
  const isPublished = overview.published.some(item => item.lesson_id === lessonId);
  const [lesson, setLesson] = useState<PublishedLesson | null>(null);
  const [loading, setLoading] = useState(isPublished);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!isPublished) return;
    let active = true;
    call<PublishedLesson>(`course/lessons/${lessonId}`)
      .then(data => { if (active) { setLesson(data); setAnswers(data.quiz.map(() => null)); } })
      .catch(reason => { if (active) setError((reason as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isPublished, lessonId]);

  const ordered = subjectLessons(subject);
  const position = ordered.findIndex(item => item.id === lessonId);
  const previous = ordered[position - 1];
  const following = ordered[position + 1];
  const states = lessonStates(subject, overview.progress);
  const progress = overview.progress.find(item => item.lesson_id === lessonId);
  const passed = Boolean(progress?.passed_at) || finished;
  const canContinue = following && (passed || (states.get(following.id) ?? "locked") !== "locked");
  const sources: Source[] = (lesson?.sources ?? []).map(source => ({
    id: source.label, label: source.label, document_id: source.document_id, document_name: source.document_name,
    page: source.page, section: null, paragraph: null, chunk_id: source.chunk_id,
  }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!lesson || busy || answers.some(answer => answer === null)) return;
    setBusy(true);
    setError("");
    try {
      const graded = await call<QuizResult>(`course/lessons/${lessonId}/submit`, "POST", { answers });
      setResult(graded);
      if (graded.passed) setFinished(true);
      await onProgress();
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setBusy(false); }
  }

  async function complete() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await call(`course/lessons/${lessonId}/complete`, "POST", {});
      setFinished(true);
      await onProgress();
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setBusy(false); }
  }

  const quiz = lesson?.quiz ?? [];
  return <article className={styles.lesson} aria-labelledby="lesson-heading">
    <button type="button" className={styles.back} onClick={onBack}>Lộ trình {subjects[subject]}</button>
    <header className={styles.lessonHeader}>
      <span className={styles.chapterNumber}>Chương {found.chapter.number} · {found.chapter.title}</span>
      <h2 id="lesson-heading">Bài {found.number}. {found.lesson.title}</h2>
      {passed && <span className={styles.badge} data-state="passed">Đã xong{progress?.best_score ? ` · ${progress.best_score}%` : ""}</span>}
    </header>
    <section className={styles.objectives} aria-label="Mục tiêu bài học">
      <strong>Sau bài này bạn có thể</strong>
      <ul>{found.lesson.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul>
    </section>

    {loading && <p className={styles.meta} role="status">Đang tải bài giảng…</p>}
    {lesson && <section className={styles.body} aria-label="Bài giảng">
      <Markdown content={lesson.body} chatMath sources={sources}
        onOpenSource={source => window.open(`/study/documents/${source.document_id}${source.chunk_id ? `?chunk=${source.chunk_id}` : ""}`, "_blank", "noopener")} />
    </section>}
    {!loading && !lesson && <section className={styles.notice}>
      <strong>Bài giảng chính thức đang được biên soạn</strong>
      <p>Trong lúc chờ, bạn có thể nhờ trợ giảng giảng bài này dựa trên giáo trình trong kho chung, rồi đánh dấu đã học xong.</p>
    </section>}

    <div className={styles.actions}>
      <button type="button" onClick={onAsk}>{lesson ? "Hỏi trợ giảng về bài này" : "Nhờ trợ giảng giảng bài này"}</button>
    </div>

    {lesson && quiz.length > 0 && <form className={styles.quiz} onSubmit={submit} aria-labelledby="quiz-heading">
      <h3 id="quiz-heading">Kiểm tra cuối bài</h3>
      <p className={styles.meta}>{quiz.length} câu · đạt {PASS_SCORE}% để mở bài tiếp theo.</p>
      {quiz.map((item, index) => {
        const graded = result?.results[index];
        return <fieldset key={index} disabled={busy || Boolean(result)} data-result={graded ? (graded.correct ? "correct" : "wrong") : undefined}>
          <legend><span>Câu {index + 1}.</span> <Markdown content={item.question} chatMath /></legend>
          {item.options.map((option, optionIndex) => <label key={optionIndex} className={styles.option}
            data-answer={graded && optionIndex === graded.answer ? "true" : undefined}>
            <input type="radio" name={`q${index}`} checked={answers[index] === optionIndex}
              onChange={() => setAnswers(current => current.map((value, i) => i === index ? optionIndex : value))} />
            <span>{String.fromCharCode(65 + optionIndex)}.</span> <Markdown content={option} chatMath />
          </label>)}
          {graded && <p className={styles.feedback}>{graded.correct ? "Đúng." : `Chưa đúng. Đáp án: ${String.fromCharCode(65 + graded.answer)}.`}
            {graded.explanation && <> {graded.explanation}</>}</p>}
        </fieldset>;
      })}
      {result && <p className={styles.score} data-passed={result.passed} role="status">
        {result.passed ? `Bạn đạt ${result.score}%. Đã mở bài tiếp theo.` : `Bạn đạt ${result.score}%. Cần ${PASS_SCORE}% để qua bài, hãy đọc lại phần giảng và thử lại.`}
      </p>}
      <div className={styles.actions}>
        {!result && <button type="submit" className={styles.primary} disabled={busy || answers.some(answer => answer === null)}>
          {busy ? "Đang chấm…" : "Nộp bài"}
        </button>}
        {result && <button type="button" onClick={() => { setResult(null); setAnswers(quiz.map(() => null)); }}>Làm lại</button>}
      </div>
    </form>}

    {!loading && quiz.length === 0 && !passed && <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={busy} onClick={complete}>{busy ? "Đang lưu…" : "Đánh dấu đã học xong"}</button>
    </div>}

    {error && <p className={styles.error} role="alert">{error}</p>}

    <nav className={styles.pager} aria-label="Chuyển bài">
      {previous ? <button type="button" onClick={() => onOpen(previous.id)}>Bài trước</button> : <span />}
      {following && <button type="button" className={passed ? styles.primary : undefined} disabled={!canContinue}
        onClick={() => onOpen(following.id)}>Bài tiếp theo</button>}
      {!following && passed && <button type="button" className={styles.primary} onClick={onBack}>Hoàn thành môn học</button>}
    </nav>
  </article>;
}
