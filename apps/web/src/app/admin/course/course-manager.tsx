"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import {
  course, draftPrompt, findLesson, parseDraft, usedSources, type LessonSource, type QuizItem,
} from "@/core/course";
import type { Message, Source } from "@/core/types";
import { subjects, type Subject } from "@/core/validation";
import styles from "./course-manager.module.css";

type ManagedLesson = {
  lesson_id: string; body: string; quiz: QuizItem[]; sources: LessonSource[];
  status: "draft" | "published"; updated_at: string; published_at: string | null;
};
type Draft = { body: string; quiz: QuizItem[]; sources: LessonSource[] };

const emptyDraft: Draft = { body: "", quiz: [], sources: [] };
const emptyQuestion = (): QuizItem => ({ question: "", options: ["", "", "", ""], correct: 0, explanation: "" });
const subjectIds = Object.keys(subjects) as Subject[];
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const time = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Không thể hoàn thành yêu cầu. Hãy thử lại.");
  return data as T;
}

function toDraft(lesson?: ManagedLesson): Draft {
  return lesson ? { body: lesson.body, quiz: lesson.quiz, sources: lesson.sources } : emptyDraft;
}

export function CourseManager() {
  const [subject, setSubject] = useState<Subject>("calculus");
  const [lessons, setLessons] = useState<Record<string, ManagedLesson>>({});
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [generating, setGenerating] = useState<{ startedAt: number; partial: string; jobId: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cancelled = useRef(false);

  const saved = selected ? toDraft(lessons[selected]) : emptyDraft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    call<ManagedLesson[]>(`course/manage?subject=${subject}`)
      .then(rows => { if (active) setLessons(Object.fromEntries(rows.map(row => [row.lesson_id, row]))); })
      .catch(reason => { if (active) setLoadError((reason as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [subject]);

  useEffect(() => () => { cancelled.current = true; }, []);
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [generating]);
  useEffect(() => {
    if (!dirty && !generating) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, generating]);

  function confirmLeave() {
    return !dirty || window.confirm("Bài đang soạn có thay đổi chưa lưu. Bỏ các thay đổi này?");
  }

  function choose(lessonId: string) {
    if (lessonId === selected || generating || !confirmLeave()) return;
    setSelected(lessonId);
    setDraft(toDraft(lessons[lessonId]));
    setPreview(false);
    setMessage(null);
  }

  function changeSubject(value: Subject) {
    if (value === subject || generating || !confirmLeave()) return;
    setSubject(value);
    setSelected(null);
    setDraft(emptyDraft);
    setMessage(null);
  }

  async function generate() {
    if (!selected || generating || busy) return;
    if ((draft.body.trim() || draft.quiz.length) && !window.confirm("Bản nháp AI sẽ thay nội dung đang có trong trình soạn. Tiếp tục?")) return;
    const lessonId = selected;
    cancelled.current = false;
    setMessage(null);
    setGenerating({ startedAt: Date.now(), partial: "", jobId: null });
    let conversation: string | null = null;
    try {
      conversation = (await call<{ id: string }>("conversations", "POST", { key: crypto.randomUUID(), temporary: true })).id;
      const job = await call<{ id: string }>(`conversations/${conversation}/messages`, "POST", {
        question: draftPrompt(lessonId), documentIds: [], key: crypto.randomUUID(), subject,
      });
      setGenerating(current => current && { ...current, jobId: job.id });
      const deadline = Date.now() + 10 * 60_000;
      let answer: Message | undefined;
      for (;;) {
        await wait(2500);
        if (cancelled.current) return;
        const messages = await call<Message[]>(`conversations/${conversation}/messages`);
        answer = [...messages].reverse().find(item => item.role === "assistant");
        if (answer) setGenerating(current => current && { ...current, partial: answer!.content });
        if (answer?.status === "completed") break;
        if (answer && ["failed", "stopped"].includes(answer.status)) {
          const status = await call<{ error: string | null }>(`jobs/${job.id}`).catch(() => ({ error: null }));
          throw new Error(status.error || "AI chưa tạo được bản nháp. Hãy thử lại.");
        }
        if (Date.now() > deadline) throw new Error("AI phản hồi quá lâu. Hãy kiểm tra máy xử lý rồi thử lại.");
      }
      const parsed = parseDraft(answer.content);
      if (!parsed.body) throw new Error("Bản nháp AI không có nội dung bài giảng. Hãy thử lại.");
      const sources = usedSources(parsed.body, answer.message_sources.map(source => ({
        label: source.label, document_id: source.document_id, document_name: source.document_name.slice(0, 300),
        page: source.page, chunk_id: source.chunk_id,
      })));
      if (!cancelled.current) {
        setDraft({ body: parsed.body, quiz: parsed.quiz, sources });
        setPreview(true);
        setMessage({
          error: false,
          text: `Đã tạo bản nháp với ${parsed.quiz.length} câu hỏi và ${sources.length} nguồn trích dẫn. Hãy đọc lại, sửa rồi lưu.`,
        });
      }
    } catch (reason) {
      if (!cancelled.current) setMessage({ error: true, text: (reason as Error).message });
    } finally {
      if (conversation) void call(`conversations/${conversation}`, "DELETE").catch(() => undefined);
      if (!cancelled.current) setGenerating(null);
    }
  }

  async function stop() {
    const jobId = generating?.jobId;
    cancelled.current = true;
    setGenerating(null);
    setMessage({ error: false, text: "Đã dừng tạo bản nháp." });
    if (jobId) await call(`jobs/${jobId}/stop`, "POST").catch(() => undefined);
  }

  async function save(publish: boolean) {
    if (!selected || busy || generating) return;
    const problem = draft.quiz.findIndex(item => !item.question.trim() || item.options.some(option => !option.trim()));
    if (problem !== -1) {
      setMessage({ error: true, text: `Câu ${problem + 1} còn thiếu nội dung câu hỏi hoặc phương án.` });
      return;
    }
    if (publish && !draft.body.trim()) {
      setMessage({ error: true, text: "Bài giảng trống không thể công bố." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const quiz = draft.quiz.map(item => ({
        question: item.question.trim(), options: item.options.map(option => option.trim()), correct: item.correct,
        ...(item.explanation?.trim() ? { explanation: item.explanation.trim() } : {}),
      }));
      const result = await call<ManagedLesson>("course/manage", "POST", {
        lessonId: selected, body: draft.body, quiz, sources: usedSources(draft.body, draft.sources), publish,
      });
      setLessons(current => ({ ...current, [result.lesson_id]: result }));
      setDraft(toDraft(result));
      setMessage({ error: false, text: publish ? "Đã công bố bài giảng cho người học." : "Đã lưu bản nháp. Người học chưa thấy bản này." });
    } catch (reason) {
      setMessage({ error: true, text: (reason as Error).message });
    } finally { setBusy(false); }
  }

  const editQuestion = (index: number, change: Partial<QuizItem>) =>
    setDraft(current => ({ ...current, quiz: current.quiz.map((item, i) => i === index ? { ...item, ...change } : item) }));

  const found = selected ? findLesson(selected) : null;
  const current = selected ? lessons[selected] : undefined;
  const previewSources: Source[] = draft.sources.map(source => ({
    id: source.label, label: source.label, document_id: source.document_id, document_name: source.document_name,
    page: source.page, section: null, paragraph: null, chunk_id: source.chunk_id,
  }));
  const published = course[subject].flatMap(chapter => chapter.lessons).filter(lesson => lessons[lesson.id]?.status === "published").length;
  const total = course[subject].flatMap(chapter => chapter.lessons).length;

  return <div className={styles.manager}>
    <nav className={styles.subjects} aria-label="Môn học">
      {subjectIds.map(id => <button type="button" key={id} aria-pressed={id === subject} disabled={Boolean(generating)}
        onClick={() => changeSubject(id)}>{subjects[id]}</button>)}
    </nav>
    <div className={styles.layout}>
      <aside className={styles.outline} aria-label="Đề cương môn học">
        <p className={styles.meta}>Đã công bố {published}/{total} bài</p>
        {loading && <p className={styles.meta} role="status">Đang tải…</p>}
        {loadError && <p className={styles.error} role="alert">{loadError}</p>}
        {!loading && !loadError && course[subject].map(chapter => <section key={chapter.id}>
          <h2>Chương {chapter.number}. {chapter.title}</h2>
          <ul>{chapter.lessons.map((lesson, index) => {
            const status = lessons[lesson.id]?.status;
            return <li key={lesson.id}>
              <button type="button" aria-current={lesson.id === selected ? "true" : undefined}
                disabled={Boolean(generating)} onClick={() => choose(lesson.id)}>
                <span>{chapter.number}.{index + 1} {lesson.title}</span>
                <span className={styles.status} data-status={status ?? "empty"}>
                  {status === "published" ? "Đã công bố" : status === "draft" ? "Nháp" : "Chưa soạn"}
                </span>
              </button>
            </li>;
          })}</ul>
        </section>)}
      </aside>

      <section className={styles.editor} aria-label="Soạn bài giảng">
        {!found && <div className={styles.empty}>
          <h2>Chọn một bài trong đề cương</h2>
          <p className={styles.meta}>
            Bản nháp AI dùng tài liệu đã công bố trong kho chung của môn {subjects[subject]}. Hãy công bố giáo trình
            trước để bài giảng có trích dẫn đúng nguồn.
          </p>
        </div>}
        {found && <>
          <header className={styles.editorHeader}>
            <div>
              <span className={styles.meta}>Chương {found.chapter.number} · {found.chapter.title}</span>
              <h2>Bài {found.number}. {found.lesson.title}</h2>
              <p className={styles.meta}>
                {current ? `${current.status === "published" ? "Đã công bố" : "Bản nháp"} · cập nhật ${time.format(new Date(current.updated_at))}` : "Chưa có nội dung"}
                {dirty && " · có thay đổi chưa lưu"}
              </p>
            </div>
            <div className={styles.actions}>
              {!generating && <button type="button" disabled={busy} onClick={generate}>Tạo nháp bằng AI</button>}
              {generating && <button type="button" onClick={stop}>Dừng tạo nháp</button>}
            </div>
          </header>
          <details className={styles.objectives}>
            <summary>Mục tiêu bài học</summary>
            <ul>{found.lesson.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul>
          </details>

          {generating && <div className={styles.generating} role="status">
            <strong>AI đang soạn bài giảng… {Math.max(0, Math.round((now - generating.startedAt) / 1000))} giây</strong>
            <p className={styles.meta}>Việc này thường mất 1 đến 3 phút tùy máy xử lý. Giữ trang này mở cho tới khi xong.</p>
            {generating.partial && <pre>{generating.partial.slice(-1200)}</pre>}
          </div>}

          {message && <p className={message.error ? styles.error : styles.notice} role={message.error ? "alert" : "status"}>{message.text}</p>}

          <fieldset className={styles.section} disabled={busy || Boolean(generating)}>
            <legend>Bài giảng (Markdown, công thức dùng $...$)</legend>
            <div className={styles.tabs} role="group" aria-label="Chế độ xem bài giảng">
              <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Soạn</button>
              <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Xem trước</button>
            </div>
            {preview
              ? <div className={styles.preview}>{draft.body.trim()
                ? <Markdown content={draft.body} chatMath sources={previewSources} />
                : <p className={styles.meta}>Chưa có nội dung.</p>}</div>
              : <textarea value={draft.body} maxLength={40000} rows={20} aria-label="Nội dung bài giảng"
                onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} />}
            <p className={styles.meta}>{draft.body.length.toLocaleString("vi-VN")}/40.000 ký tự</p>
            {draft.sources.length > 0 && <div>
              <strong>Nguồn trích dẫn</strong>
              <ul className={styles.sources}>{draft.sources.map(source => <li key={source.label}>
                [{source.label}] {source.document_name}{source.page ? `, trang ${source.page}` : ""}
                {!draft.body.includes(`[${source.label}]`) && <span className={styles.meta}> (không còn dùng, sẽ bị bỏ khi lưu)</span>}
              </li>)}</ul>
            </div>}
          </fieldset>

          <fieldset className={styles.section} disabled={busy || Boolean(generating)}>
            <legend>Câu hỏi kiểm tra ({draft.quiz.length}/10)</legend>
            <p className={styles.meta}>Người học cần đúng 70% để qua bài. Không có câu hỏi thì người học tự đánh dấu đã học xong.</p>
            {draft.quiz.map((item, index) => <div key={index} className={styles.question}>
              <label>Câu {index + 1}
                <textarea value={item.question} maxLength={600} rows={2}
                  onChange={event => editQuestion(index, { question: event.target.value })} />
              </label>
              {item.options.map((option, optionIndex) => <div key={optionIndex} className={styles.option}>
                <input type="radio" name={`correct-${index}`} checked={item.correct === optionIndex}
                  aria-label={`Đáp án đúng là ${String.fromCharCode(65 + optionIndex)}`}
                  onChange={() => editQuestion(index, { correct: optionIndex })} />
                <span>{String.fromCharCode(65 + optionIndex)}.</span>
                <input value={option} maxLength={300} aria-label={`Phương án ${String.fromCharCode(65 + optionIndex)} của câu ${index + 1}`}
                  onChange={event => editQuestion(index, { options: item.options.map((value, i) => i === optionIndex ? event.target.value : value) })} />
                <button type="button" disabled={item.options.length <= 2} aria-label="Bỏ phương án"
                  onClick={() => editQuestion(index, {
                    options: item.options.filter((_, i) => i !== optionIndex),
                    correct: item.correct === optionIndex ? 0 : item.correct > optionIndex ? item.correct - 1 : item.correct,
                  })}>Bỏ</button>
              </div>)}
              <div className={styles.actions}>
                <button type="button" disabled={item.options.length >= 5}
                  onClick={() => editQuestion(index, { options: [...item.options, ""] })}>Thêm phương án</button>
                <button type="button" onClick={() => setDraft(current => ({ ...current, quiz: current.quiz.filter((_, i) => i !== index) }))}>Xóa câu hỏi</button>
              </div>
              <label>Giải thích đáp án
                <textarea value={item.explanation ?? ""} maxLength={1000} rows={2}
                  onChange={event => editQuestion(index, { explanation: event.target.value })} />
              </label>
            </div>)}
            <div className={styles.actions}>
              <button type="button" disabled={draft.quiz.length >= 10}
                onClick={() => setDraft(current => ({ ...current, quiz: [...current.quiz, emptyQuestion()] }))}>Thêm câu hỏi</button>
            </div>
          </fieldset>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy || Boolean(generating) || !draft.body.trim()}
              onClick={() => save(true)}>{busy ? "Đang lưu…" : current?.status === "published" && !dirty ? "Đã công bố" : "Công bố"}</button>
            <button type="button" disabled={busy || Boolean(generating)} onClick={() => save(false)}>
              {current?.status === "published" ? "Gỡ công bố và lưu nháp" : "Lưu nháp"}
            </button>
            {dirty && <button type="button" disabled={busy || Boolean(generating)} onClick={() => setDraft(saved)}>Hoàn tác thay đổi</button>}
          </div>
        </>}
      </section>
    </div>
  </div>;
}
