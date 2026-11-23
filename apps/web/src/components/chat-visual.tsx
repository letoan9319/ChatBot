import styles from "./chat-visual.module.css";

type Bar = { label: string; value: number };

type Visual =
  | { type: "flow"; title: string; steps: string[] }
  | { type: "bar"; title: string; items: Bar[] };

const shortText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 140;

function bar(value: unknown): value is Bar {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Bar>;
  return shortText(item.label) && typeof item.value === "number" && Number.isFinite(item.value);
}

export function parseChatVisual(source: string): Visual | null {
  if (source.length > 4000) return null;
  try {
    const candidate = JSON.parse(source);
    if (!candidate || !shortText(candidate.title)) return null;
    if (candidate.type === "flow" && Array.isArray(candidate.steps) &&
      candidate.steps.length >= 2 && candidate.steps.length <= 8 && candidate.steps.every(shortText)) {
      return { type: "flow", title: candidate.title, steps: candidate.steps };
    }
    if (candidate.type === "bar" && Array.isArray(candidate.items) &&
      candidate.items.length >= 1 && candidate.items.length <= 8 && candidate.items.every(bar)) {
      return { type: "bar", title: candidate.title, items: candidate.items };
    }
  } catch {
    return null;
  }
  return null;
}

export function ChatVisual({ visual }: { visual: Visual }) {
  const scale = visual.type === "bar" ? (Math.max(...visual.items.map(item => Math.abs(item.value))) || 1) : 1;
  const divided = visual.type === "bar" && visual.items.some(item => item.value < 0);
  return <figure className={styles.visual}>
    <figcaption>{visual.title}</figcaption>
    {visual.type === "flow" ? <ol className={styles.flow}>
      {visual.steps.map((step, index) => <li key={index}>{step}</li>)}
    </ol> : <ul className={styles.chart} data-divided={divided}>
      {visual.items.map((item, index) => <li key={index}>
        <span>{item.label}</span>
        <span className={styles.axis} aria-hidden="true">
          <span className={styles.bar} data-negative={item.value < 0}
            style={{ width: Math.abs(item.value) / scale * (divided ? 50 : 100) + "%" }} />
        </span>
        <span>{new Intl.NumberFormat("vi-VN", { maximumSignificantDigits: 8,
          notation: Math.abs(item.value) >= 1e9 || (item.value !== 0 && Math.abs(item.value) < 1e-6)
            ? "scientific" : "standard" }).format(item.value)}</span>
      </li>)}
    </ul>}
  </figure>;
}
