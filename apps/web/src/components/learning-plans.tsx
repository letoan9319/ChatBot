"use client";

import { useEffect, useState } from "react";
import { completedLessons, lessons, recordAttempt, type LearningPlan, type PlanInput } from "@/core/learning-plan";
import { subjects, uuid } from "@/core/validation";
import { MAX_JSON_BYTES } from "@/core/request-security";
import "@fontsource-variable/inter";
import styles from "./learning-plans.module.css";

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
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [sourceQuery, setSourceQuery] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [lessonIndex, setLessonIndex] = useState(0);
  const savedContent = draft && (plans.find(plan => plan.id === draft.id)?.content ?? empty);
  const dirty = Boolean(draft && (JSON.stringify(draft.content) !== JSON.stringify(savedContent) || note || source || front || back));
  const payload = draft ? JSON.stringify(draft) : "";
  const payloadBytes = new TextEncoder().encode(payload).byteLength;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/learning-plans", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("Không tải được danh sách kế hoạch.");
        setPlans(await response.json());
        setReady(true);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError("Không tải được danh sách kế hoạch. Hãy thử lại."); });
    return () => controller.abort();
  }, [reload]);

  function select(plan: PlanInput | null) {
    if (plan && plan.id === draft?.id) return false;
    if (dirty && !window.confirm("Bạn có thay đổi chưa lưu. Bỏ các thay đổi này?")) return false;
    setDraft(plan);
    setLessonIndex(plan ? Math.min(completedLessons(plan.content), 2) : 0);
    setNote("");
    setSource("");
    setSourceQuery("");
    setFront("");
    setBack("");
    setMessage("");
    return true;
  }

  function edit<K extends keyof Content>(key: K, value: Content[K]) {
    setDraft(previous => previous && ({ ...previous, content: { ...previous.content, [key]: value } }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || busy || payloadBytes > MAX_JSON_BYTES) return;
    setBusy(true);
    try {
      const response = await fetch("/api/learning-plans", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
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
  const update = (value: PlanInput["mode"]) => {
    if (value !== mode && select(null)) setMode(value);
  };

  const visiblePlans = plans.filter(plan => plan.mode === mode);
  const readySources = documents.filter(item => item.status === "ready");
  const visibleSources = readySources.filter(item => item.name.toLocaleLowerCase("vi-VN")
    .includes(sourceQuery.trim().toLocaleLowerCase("vi-VN")));
  const createPlan = () => select({ id: crypto.randomUUID(), mode, revision: null, content: empty });

  return <section className={styles.plans} aria-label="Kế hoạch học tập">
    <nav className={styles.modes} aria-label="Phương thức học">
      <button disabled={busy} aria-pressed={mode === "guided"} onClick={() => update("guided")}>
        <strong>Học theo tiến trình</strong><span>Học từng bài theo thứ tự và tự kiểm tra trước khi chuyển bài.</span>
      </button>
      <button disabled={busy} aria-pressed={mode === "self"} onClick={() => update("self")}>
        <strong>Tự học</strong><span>Chọn chủ đề, ghi chú và tạo thẻ để ôn theo nhịp của bạn.</span>
      </button>
    </nav>
    {!ready && <div className={styles.state} role="status">
      <p>{loadError || "Đang tải kế hoạch học tập…"}</p>
      {loadError && <button onClick={() => { setLoadError(""); setReload(value => value + 1); }}>Thử lại</button>}
    </div>}
    {ready && <div className={styles.workspace}>
      <section className={styles.saved} aria-labelledby="saved-plans-heading">
        <h2 id="saved-plans-heading">Kế hoạch của bạn</h2>
        <button className={styles.primary} disabled={busy} onClick={createPlan}>Tạo kế hoạch</button>
        {visiblePlans.length > 0 && <ul>{visiblePlans.map(plan =>
          <li key={plan.id}><button disabled={busy} aria-current={draft?.id === plan.id ? "true" : undefined} onClick={() => select(plan)}>
            <strong>{plan.content.topic}</strong>
            <span>{subjects[plan.content.subject]}{mode === "guided" && ` · ${completedLessons(plan.content)}/3 bài`}</span>
          </button></li>)}</ul>}
      </section>
      <div className={styles.detail}>
    {message && <p className={styles.message} role="status">{message}</p>}
    {!draft && <section className={styles.state}>
      <h2>{visiblePlans.length ? "Chọn kế hoạch để tiếp tục" : "Bắt đầu kế hoạch đầu tiên"}</h2>
      <p>{visiblePlans.length ? "Mở một kế hoạch đã lưu để xem mục tiêu, tài liệu và tiến độ." : "Chọn môn học, đặt mục tiêu và xác định khi nào bạn muốn ôn lại."}</p>
    </section>}
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
        <label>Tìm tài liệu <input type="search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} /></label>
        <p className={styles.meta}>Đã chọn {content.documents.length}/5 tài liệu</p>
        <div className={styles.sources}>
        {visibleSources.map(item => <label className={styles.check} key={item.id}>
          <input type="checkbox" checked={content.documents.includes(item.id)}
            disabled={!content.documents.includes(item.id) && content.documents.length >= 5}
            onChange={event => edit("documents", event.target.checked ? [...content.documents, item.id] : content.documents.filter(id => id !== item.id))} />
          <a href={"/study/documents/" + item.id} target="_blank" rel="noreferrer">{item.name}</a></label>)}
        {visibleSources.length === 0 && <p>{readySources.length ? "Không tìm thấy tài liệu phù hợp." : "Chưa có tài liệu sẵn sàng."}</p>}
        </div>
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
      {payloadBytes > MAX_JSON_BYTES && <p role="alert">Kế hoạch vượt giới hạn lưu. Hãy rút ngắn ghi chú, tóm tắt hoặc thẻ ghi nhớ.</p>}
      <button className={styles.primary} disabled={busy || payloadBytes > MAX_JSON_BYTES} type="submit">{busy ? "Đang lưu…" : "Lưu kế hoạch"}</button>
    </form>}
      </div>
    </div>}
  </section>;
}
