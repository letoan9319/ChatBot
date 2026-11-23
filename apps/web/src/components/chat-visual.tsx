import styles from "./chat-visual.module.css";

type Bar = { label: string; value: number };
type Point = { x: number; y: number };
type Line = { type: "line"; title: string; xLabel: string; yLabel: string; points: Point[] };

type Visual =
  | { type: "flow"; title: string; steps: string[] }
  | { type: "bar"; title: string; items: Bar[] }
  | Line;

const shortText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 140;

function bar(value: unknown): value is Bar {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Bar>;
  return shortText(item.label) && typeof item.value === "number" && Number.isFinite(item.value);
}

function point(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const { x, y } = value as Partial<Point>;
  return typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e100 &&
    typeof y === "number" && Number.isFinite(y) && Math.abs(y) <= 1e100;
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
    if (candidate.type === "line" && shortText(candidate.xLabel) && shortText(candidate.yLabel) &&
      Array.isArray(candidate.points)) {
      const rawPoints: unknown[] = candidate.points;
      if (rawPoints.length < 2 || rawPoints.length > 8 || !rawPoints.every(point) ||
        new Set(rawPoints.map(p => p.x)).size !== rawPoints.length) return null;
      const points = [...rawPoints].sort((a, b) => a.x - b.x);
      return { type: "line", title: candidate.title, xLabel: candidate.xLabel, yLabel: candidate.yLabel, points };
    }
  } catch {
    return null;
  }
  return null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumSignificantDigits: 8,
    notation: Math.abs(value) >= 1e9 || (value !== 0 && Math.abs(value) < 1e-6)
      ? "scientific" : "standard" }).format(value);
}

function LinePlot({ visual }: { visual: Line }) {
  const { points, xLabel, yLabel } = visual;
  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const yMin = Math.min(...points.map(p => p.y));
  const yMax = Math.max(...points.map(p => p.y));
  const plotX = (x: number) => 4 + ((x - xMin) / (xMax - xMin)) * 292;
  const plotY = (y: number) => yMin === yMax ? 60 : 116 - ((y - yMin) / (yMax - yMin)) * 112;
  const positions = points.map(({ x, y }) => plotX(x) + "," + plotY(y));

  return <div className={styles.line}>
    <div>{yLabel}</div>
    <div className={styles.plot}>
      <div className={styles.yScale} aria-hidden="true" data-flat={yMin === yMax}>
        <span>{formatNumber(yMax)}</span>
        {yMin !== yMax && <span>{formatNumber(yMin)}</span>}
      </div>
      <svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
        <line x1="4" y1="4" x2="4" y2="116" />
        <line x1="4" y1="116" x2="296" y2="116" />
        {yMin < 0 && yMax > 0 && <line className={styles.zero} x1="4" y1={plotY(0)} x2="296" y2={plotY(0)} />}
        {xMin < 0 && xMax > 0 && <line className={styles.zero} x1={plotX(0)} y1="4" x2={plotX(0)} y2="116" />}
        <polyline points={positions.join(" ")} />
      </svg>
      <div className={styles.xScale} aria-hidden="true">
        <span>{formatNumber(xMin)}</span>
        <span>{formatNumber(xMax)}</span>
      </div>
    </div>
    <div className={styles.xLabel}>{xLabel}</div>
    <table>
      <caption className={styles.srOnly}>Dữ liệu của đồ thị</caption>
      <thead><tr><th scope="col">{xLabel}</th><th scope="col">{yLabel}</th></tr></thead>
      <tbody>{points.map(({ x, y }) => <tr key={x}>
        <td>{formatNumber(x)}</td><td>{formatNumber(y)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function ChatVisual({ visual }: { visual: Visual }) {
  const scale = visual.type === "bar" ? (Math.max(...visual.items.map(item => Math.abs(item.value))) || 1) : 1;
  const divided = visual.type === "bar" && visual.items.some(item => item.value < 0);
  return <figure className={styles.visual}>
    <figcaption>{visual.title}</figcaption>
    {visual.type === "line" ? <LinePlot visual={visual} /> : visual.type === "flow" ? <ol className={styles.flow}>
      {visual.steps.map((step, index) => <li key={index}>{step}</li>)}
    </ol> : <ul className={styles.chart} data-divided={divided}>
      {visual.items.map((item, index) => <li key={index}>
        <span>{item.label}</span>
        <span className={styles.axis} aria-hidden="true">
          <span className={styles.bar} data-negative={item.value < 0}
            style={{ width: Math.abs(item.value) / scale * (divided ? 50 : 100) + "%" }} />
        </span>
        <span>{formatNumber(item.value)}</span>
      </li>)}
    </ul>}
  </figure>;
}
