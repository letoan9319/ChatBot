"use client";

import { useEffect, useState } from "react";
import { completedLessons, lessons, recordAttempt, type LearningPlan, type PlanInput } from "@/core/learning-plan";
import { subjects, uuid } from "@/core/validation";

type Content = PlanInput["content"];
const empty: Content = { subject: "calculus", topic: "", goal: "", baseline: "", schedule: "", documents: [],
  notes: [], summary: "", cards: [], attempts: [], review: "", assessment: "" };

export function LearningPlans({ documents, onAsk }: {
  documents: { id: string; name: string; status: string }[];
  onAsk: (ids: string[], topic: string) => void;
}) {
  const [plans, setPlans] = useState<LearningPlan[]>([]);
  const [mode, setMode] = useState<PlanInput["mode"]>("guided");
  const [draft, setDraft] = useState<PlanInput | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [lessonIndex, setLessonIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/learning-plans", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Không tải được kế hoạch. Kiểm tra migration và tải lại trang.");
        setPlans(await response.json());
        setReady(true);
      })
      .catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);

  function select(plan: PlanInput | null) {
    setDraft(plan);
    setLessonIndex(plan ? Math.min(completedLessons(plan.content), 2) : 0);
    setNote("");
    setSource("");
    setFront("");
    setBack("");
    setMessage("");
  }

  function edit<K extends keyof Content>(key: K, value: Content[K]) {
    setDraft(previous => previous && ({ ...previous, content: { ...previous.content, [key]: value } }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/learning-plans", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không lưu được kế hoạch.");
      setDraft(result);
      setPlans(previous => [result, ...previous.filter(plan => plan.id !== result.id)]);
      setMessage("Đã lưu kế hoạch.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally { setBusy(false); }
  }

  function addNote() {
    if (!draft || !note.trim()) return;
    const match = source.trim().match(/^(?:https?:\/\/[^/]+)?\/study\/documents\/([^?/#]+)(?:\?([^#]*))?$/);
    const document = match?.[1] ?? null;
    const chunk = new URLSearchParams(match?.[2]).get("chunk");
    if (source.trim() && (!uuid.safeParse(document).success || !documents.some(item => item.id === document)
      || (chunk && !uuid.safeParse(chunk).success))) {
      setMessage("Dán liên kết đến một tài liệu bạn có quyền đọc hoặc để trống.");
      return;
    }
    edit("notes", [...draft.content.notes, { text: note.trim(), source: document, chunk }]);
    setNote("");
    setSource("");
  }

  const content = draft?.content;
  const course = content ? lessons[content.subject] : null;
  const lesson = course?.[lessonIndex];
  const progress = content ? completedLessons(content) : 0;
  const attempt = content?.attempts.find(item => item.lesson === lessonIndex);
  const update = (value: PlanInput["mode"]) => { setMode(value); select(null); };

  return <section className="learning-plans" aria-label="Kế hoạch học tập">
    <nav aria-label="Phương thức học">
      <button disabled={busy} aria-pressed={mode === "guided"} onClick={() => update("guided")}>Học theo tiến trình</button>
      <button disabled={busy} aria-pressed={mode === "self"} onClick={() => update("self")}>Tự học</button>
      <button disabled={!ready || busy} onClick={() => select({ id: crypto.randomUUID(), mode, revision: null, content: empty })}>Tạo kế hoạch</button>
    </nav>
    {message && <p role="status">{message}</p>}
    <ul>{plans.filter(plan => plan.mode === mode).map(plan =>
      <li key={plan.id}><button disabled={busy} onClick={() => select(plan)}>{plan.content.topic}</button>
        {mode === "guided" && <span> · {completedLessons(plan.content)}/3 bài</span>}</li>)}</ul>
    {!draft && ready && <p>Chọn một kế hoạch đã lưu hoặc tạo kế hoạch mới.</p>}
    {draft && content && lesson && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>Mục tiêu và lịch học</legend>
        <label>Môn học <select value={content.subject} disabled={content.attempts.length > 0}
          onChange={event => { edit("subject", event.target.value as Content["subject"]); setLessonIndex(0); }}>
          {Object.entries(subjects).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select></label>
        <label>Chủ đề <input required maxLength={120} value={content.topic} onChange={event => edit("topic", event.target.value)} /></label>
        <label>Mục tiêu <textarea required maxLength={400} value={content.goal} onChange={event => edit("goal", event.target.value)} /></label>
        {mode === "guided" && <label>Kiến thức ban đầu <textarea maxLength={300} value={content.baseline}
          onChange={event => edit("baseline", event.target.value)} /></label>}
        <label>Nhịp học hoặc thời gian dự kiến <input maxLength={300} value={content.schedule}
          onChange={event => edit("schedule", event.target.value)} /></label>
        <label>Ngày ôn lại <input type="date" value={content.review} onChange={event => edit("review", event.target.value)} /></label>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Tài liệu nguồn</legend>
        {documents.filter(item => item.status === "ready").map(item => <label className="learning-check" key={item.id}>
          <input type="checkbox" checked={content.documents.includes(item.id)}
            disabled={!content.documents.includes(item.id) && content.documents.length >= 5}
            onChange={event => edit("documents", event.target.checked ? [...content.documents, item.id] : content.documents.filter(id => id !== item.id))} />
          <a href={"/study/documents/" + item.id} target="_blank" rel="noreferrer">{item.name}</a></label>)}
        <button type="button" disabled={!documents.some(item => item.status === "ready" && content.documents.includes(item.id))}
          onClick={() => onAsk(content.documents, mode === "guided" ? lesson.title : content.topic)}>Hỏi trợ giảng theo nội dung này</button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>{mode === "guided" ? "Bài học theo thứ tự" : "Tự kiểm tra theo chủ đề mẫu"}</legend>
        {mode === "guided" && <p>Đã đạt {progress}/3 bài. Trả lời đúng để mở bài tiếp theo.</p>}
        <nav aria-label="Bài học">{course?.map((item, index) => <button type="button" key={item.title}
          aria-pressed={index === lessonIndex} disabled={mode === "guided" && index > progress}
          onClick={() => setLessonIndex(index)}>{item.title}</button>)}</nav>
        <p>{lesson.explanation}</p><p>{lesson.practice}</p><strong>{lesson.question}</strong>
        <div>{lesson.options.map((answer, index) => <button type="button" key={answer}
          onClick={() => edit("attempts", recordAttempt(content, lessonIndex, index))}>{answer}</button>)}</div>
        {attempt && <p role="status">{attempt.answer === lesson.correct ? "Trả lời đúng." : "Chưa đúng. Đọc lại phần giải thích và thử lại."}</p>}
        <details><summary>Lịch sử tự kiểm tra</summary><ol>{content.attempts.map((item, index) =>
          <li key={index}>{course?.[item.lesson].title} · {item.answer === course?.[item.lesson].correct ? "Đúng" : "Cần ôn"} · {new Date(item.date).toLocaleString("vi-VN")}</li>)}</ol></details>
      </fieldset>
      {mode === "self" && <fieldset disabled={busy}>
        <legend>Ghi chú và ôn tập</legend>
        <label>Ghi chú <textarea maxLength={600} value={note} onChange={event => setNote(event.target.value)} /></label>
        <label>Liên kết đoạn nguồn (tùy chọn) <input value={source} onChange={event => setSource(event.target.value)} /></label>
        <button type="button" disabled={!note.trim() || content.notes.length >= 12} onClick={addNote}>Thêm ghi chú</button>
        <ul>{content.notes.map((item, index) => <li key={index}>{item.text} {item.source &&
          <a href={"/study/documents/" + item.source + (item.chunk ? "?chunk=" + item.chunk : "")} target="_blank" rel="noreferrer">Mở nguồn</a>}
          <button type="button" onClick={() => edit("notes", content.notes.filter((_, i) => i !== index))}>Bỏ ghi chú</button></li>)}</ul>
        <label>Tóm tắt <textarea maxLength={800} value={content.summary} onChange={event => edit("summary", event.target.value)} /></label>
        <label>Mặt trước thẻ <input maxLength={200} value={front} onChange={event => setFront(event.target.value)} /></label>
        <label>Mặt sau thẻ <textarea maxLength={300} value={back} onChange={event => setBack(event.target.value)} /></label>
        <button type="button" disabled={!front.trim() || !back.trim() || content.cards.length >= 12} onClick={() => {
          edit("cards", [...content.cards, { front, back }]); setFront(""); setBack("");
        }}>Thêm thẻ</button>
        {content.cards.map((card, index) => <details key={index}><summary>{card.front}</summary><p>{card.back}</p>
          <button type="button" onClick={() => edit("cards", content.cards.filter((_, i) => i !== index))}>Bỏ thẻ</button></details>)}
      </fieldset>}
      <fieldset disabled={busy}>
        <legend>Đánh giá và điều chỉnh</legend>
        <label>Mức đạt mục tiêu và nội dung cần ôn <textarea maxLength={400} value={content.assessment}
          onChange={event => edit("assessment", event.target.value)} /></label>
      </fieldset>
      <button disabled={busy} type="submit">{busy ? "Đang lưu…" : "Lưu kế hoạch"}</button>
    </form>}
  </section>;
}
