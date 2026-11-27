"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";
import {
  compileMathExpr,
  niceTicks,
  numericDerivative,
  sampleFunctionPlot,
  type MathFn,
} from "@/core/math-eval";
import styles from "./chat-visual.module.css";

type Bar = { label: string; value: number };
type Point = { x: number; y: number };
type Line = { type: "line"; title: string; xLabel: string; yLabel: string; points: Point[] };

type ConceptItem = { label: string; detail: string };
type Concept = { type: "concept"; title: string; center: string; items: ConceptItem[] };

export type VisualTone = "primary" | "secondary" | "info" | "warn" | "neutral";

export type PlotFunctionSpec = {
  expr: string;
  label?: string;
  tone?: VisualTone;
};

export type PlotShadeSpec = {
  from: number;
  to: number;
  fnIndex?: number;
};

export type PlotMarkerSpec = {
  x: number;
  y?: number;
  label?: string;
};

export type PlotVisual = {
  type: "plot";
  title: string;
  xDomain: [number, number];
  yDomain?: [number, number];
  xLabel: string;
  yLabel: string;
  functions: PlotFunctionSpec[];
  shade?: PlotShadeSpec;
  tangentAt?: number;
  points?: PlotMarkerSpec[];
};

export type VectorItem = {
  label: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  tone?: VisualTone;
};

export type VectorVisual = {
  type: "vector";
  title: string;
  grid: boolean;
  planeAngle?: number;
  bodyLabel?: string;
  vectors: VectorItem[];
};

export type Visual =
  | { type: "flow"; title: string; steps: string[] }
  | { type: "bar"; title: string; items: Bar[] }
  | Line
  | Concept
  | PlotVisual
  | VectorVisual;

const DEFAULT_PLOT_TONES: VisualTone[] = ["primary", "secondary", "info"];
const DEFAULT_VECTOR_TONES: VisualTone[] = ["primary", "info", "warn", "secondary", "neutral"];

const shortText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 140;

function cleanVisualText(value: string): string {
  return value
    .replace(/\t(ext)\{([^}]*)\}/g, "$2")
    .replace(/\t(anh?)(?=\s*[({])/g, "t$1")
    .replace(/\\(?:overrightarrow|overarrow|vec)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:text|mathrm|operatorname|mathbf)\{([^}]*)\}/g, "$1")
    .replace(/\^\{\s*\\circ\s*\}|\^\\circ|\\circ\b/g, "\u00b0")
    .replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sqrt|cbrt|abs|exp|ln|log)\b/g, "$1")
    .replace(/\\cdot\b/g, "\u00b7")
    .replace(/\\times\b/g, "\u00d7")
    .replace(/\\alpha\b/g, "\u03b1")
    .replace(/\\beta\b/g, "\u03b2")
    .replace(/\\theta\b/g, "\u03b8")
    .replace(/\\phi\b/g, "\u03c6")
    .replace(/\\mu\b/g, "\u03bc")
    .replace(/\\pi\b/g, "\u03c0")
    .replace(/\\Delta\b/g, "\u0394")
    .replace(/\\omega\b/g, "\u03c9")
    .replace(/\\lambda\b/g, "\u03bb")
    .replace(/\\nabla\b/g, "\u2207")
    .replace(/\\partial\b/g, "\u2202")
    .replace(/\\infty\b/g, "\u221e")
    .replace(/_\{([^}]+)\}/g, "_$1")
    .replace(/\^\{([^}]+)\}/g, "^$1")
    .replace(/\\\(|\\\)/g, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanShortText(value: unknown): string | undefined {
  if (!shortText(value)) return undefined;
  const cleaned = cleanVisualText(value);
  return cleaned.length > 0 && cleaned.length <= 140 ? cleaned : undefined;
}

function cleanExprText(raw: string): string {
  return raw
    .replace(/\t(anh?)(?=\s*[({])/g, "\\t$1")
    .replace(/\f(rac)(?=\s*\{)/g, "\\f$1")
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .trim();
}

function parseJsonLenient(cleaned: string): unknown {
  try {
    return JSON.parse(cleaned);
  } catch {
    const escaped = cleaned.replace(/\\(?!(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))/g, "\\\\");
    if (escaped === cleaned) return null;
    try {
      return JSON.parse(escaped);
    } catch {
      return null;
    }
  }
}

const finiteNum = (value: unknown, limit = 1e6): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

function normalizeTone(value: unknown): VisualTone | undefined {
  if (typeof value !== "string") return undefined;
  const lowered = value.trim().toLowerCase();
  if (lowered === "primary" || lowered === "accent" || lowered === "green" || lowered === "success") {
    return "primary";
  }
  if (lowered === "secondary" || lowered === "purple") return "secondary";
  if (lowered === "info" || lowered === "blue") return "info";
  if (lowered === "warn" || lowered === "warning" || lowered === "yellow" || lowered === "danger" || lowered === "red") {
    return "warn";
  }
  if (lowered === "neutral" || lowered === "muted" || lowered === "gray") return "neutral";
  return undefined;
}

function parseDomain(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  if (!finiteNum(a) || !finiteNum(b) || a >= b) return null;
  return [a, b];
}

function bar(value: unknown): value is Bar {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Bar>;
  return shortText(item.label) && typeof item.value === "number" && Number.isFinite(item.value);
}

function conceptItem(value: unknown): value is ConceptItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ConceptItem>;
  return shortText(item.label) && shortText(item.detail);
}

function point(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const { x, y } = value as Partial<Point>;
  return typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e100 &&
    typeof y === "number" && Number.isFinite(y) && Math.abs(y) <= 1e100;
}

function parsePlotVisual(candidate: Record<string, unknown>, title: string): PlotVisual | null {
  const rawXDomain = candidate.xDomain ?? candidate.xRange ?? candidate.domain;
  let xDomain: [number, number] = [-5, 5];
  if (rawXDomain !== undefined && rawXDomain !== null) {
    const parsed = parseDomain(rawXDomain);
    if (!parsed) return null;
    xDomain = parsed;
  }

  const rawYDomain = candidate.yDomain ?? candidate.yRange;
  let yDomain: [number, number] | undefined;
  if (rawYDomain !== undefined && rawYDomain !== null) {
    const parsed = parseDomain(rawYDomain);
    if (!parsed) return null;
    yDomain = parsed;
  }

  const xLabel = cleanShortText(candidate.xLabel) ?? "x";
  const yLabel = cleanShortText(candidate.yLabel) ?? "y";

  let rawFunctions: unknown[] | null = null;
  if (Array.isArray(candidate.functions)) {
    rawFunctions = candidate.functions;
  } else if (Array.isArray(candidate.curves)) {
    rawFunctions = candidate.curves;
  } else if (shortText(candidate.expr ?? candidate.fn ?? candidate.formula)) {
    rawFunctions = [{ expr: candidate.expr ?? candidate.fn ?? candidate.formula, label: candidate.label }];
  }
  if (!rawFunctions || rawFunctions.length < 1 || rawFunctions.length > 3) return null;

  const functions: PlotFunctionSpec[] = [];
  for (const entry of rawFunctions) {
    if (typeof entry === "string") {
      const expr = cleanExprText(entry);
      if (!expr || !compileMathExpr(expr)) return null;
      functions.push({ expr });
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    const rawExpr = item.expr ?? item.fn ?? item.formula;
    if (typeof rawExpr !== "string") return null;
    const expr = cleanExprText(rawExpr);
    if (!expr || !compileMathExpr(expr)) return null;
    const label = cleanShortText(item.label);
    const tone = normalizeTone(item.tone);
    functions.push({ expr, label, tone });
  }

  let shade: PlotShadeSpec | undefined;
  if (candidate.shade !== undefined && candidate.shade !== null) {
    if (typeof candidate.shade !== "object" || Array.isArray(candidate.shade)) return null;
    const rawShade = candidate.shade as Record<string, unknown>;
    const rawFrom = rawShade.from;
    const rawTo = rawShade.to;
    if (!finiteNum(rawFrom) || !finiteNum(rawTo) || rawFrom === rawTo) return null;
    let fnIndex = 0;
    if (rawShade.fnIndex !== undefined && rawShade.fnIndex !== null) {
      if (
        typeof rawShade.fnIndex !== "number" ||
        !Number.isInteger(rawShade.fnIndex) ||
        rawShade.fnIndex < 0 ||
        rawShade.fnIndex >= functions.length
      ) {
        return null;
      }
      fnIndex = rawShade.fnIndex;
    }
    shade = {
      from: Math.min(rawFrom, rawTo),
      to: Math.max(rawFrom, rawTo),
      fnIndex,
    };
  }

  let tangentAt: number | undefined;
  if (candidate.tangentAt !== undefined && candidate.tangentAt !== null) {
    if (!finiteNum(candidate.tangentAt)) return null;
    tangentAt = candidate.tangentAt;
  }

  let points: PlotMarkerSpec[] | undefined;
  if (candidate.points !== undefined && candidate.points !== null) {
    if (!Array.isArray(candidate.points) || candidate.points.length > 12) return null;
    const parsedPoints: PlotMarkerSpec[] = [];
    for (const entry of candidate.points) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      if (!finiteNum(item.x)) return null;
      if (item.y !== undefined && item.y !== null && !finiteNum(item.y)) return null;
      const label = cleanShortText(item.label);
      parsedPoints.push({
        x: item.x,
        y: typeof item.y === "number" ? item.y : undefined,
        label,
      });
    }
    if (parsedPoints.length > 0) points = parsedPoints;
  }

  return {
    type: "plot",
    title,
    xDomain,
    yDomain,
    xLabel,
    yLabel,
    functions,
    shade,
    tangentAt,
    points,
  };
}

function parseVectorVisual(candidate: Record<string, unknown>, title: string): VectorVisual | null {
  if (!Array.isArray(candidate.vectors)) return null;
  const rawVectors = candidate.vectors;
  if (rawVectors.length < 1 || rawVectors.length > 8) return null;

  let planeAngle: number | undefined;
  if (candidate.planeAngle !== undefined && candidate.planeAngle !== null) {
    if (
      typeof candidate.planeAngle !== "number" ||
      !Number.isFinite(candidate.planeAngle) ||
      candidate.planeAngle < -60 ||
      candidate.planeAngle > 60
    ) {
      return null;
    }
    planeAngle = candidate.planeAngle;
  }

  let bodyLabel: string | undefined;
  if (candidate.bodyLabel !== undefined && candidate.bodyLabel !== null) {
    const cleanedBody = cleanShortText(candidate.bodyLabel);
    if (!cleanedBody) return null;
    bodyLabel = cleanedBody;
  }

  let grid: boolean;
  if (candidate.grid !== undefined && candidate.grid !== null) {
    if (typeof candidate.grid !== "boolean") return null;
    grid = candidate.grid;
  } else {
    grid = bodyLabel === undefined && planeAngle === undefined;
  }

  const vectors: VectorItem[] = [];
  let hasNonZero = false;
  for (const entry of rawVectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    const cleanedLabel = cleanShortText(item.label ?? item.name);
    if (!cleanedLabel) return null;
    if (!finiteNum(item.dx) || !finiteNum(item.dy)) return null;
    const x = item.x === undefined || item.x === null ? 0 : item.x;
    const y = item.y === undefined || item.y === null ? 0 : item.y;
    if (!finiteNum(x) || !finiteNum(y)) return null;
    if (Math.hypot(item.dx, item.dy) > 1e-9) hasNonZero = true;
    vectors.push({
      label: cleanedLabel,
      x,
      y,
      dx: item.dx,
      dy: item.dy,
      tone: normalizeTone(item.tone),
    });
  }

  if (!hasNonZero) return null;

  return {
    type: "vector",
    title,
    grid,
    planeAngle,
    bodyLabel,
    vectors,
  };
}

export function parseChatVisual(source: string): Visual | null {
  if (source.length > 6000) return null;
  const cleaned = source.trim().replace(/,\s*([}\]])/g, "$1");
  if (!cleaned) return null;
  const candidate = parseJsonLenient(cleaned);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const title = cleanShortText(record.title);
  if (!title) return null;

  if (record.type === "plot") {
    return parsePlotVisual(record, title);
  }
  if (record.type === "vector") {
    return parseVectorVisual(record, title);
  }
  if (record.type === "flow" && Array.isArray(record.steps) &&
    record.steps.length >= 2 && record.steps.length <= 8 && record.steps.every(shortText)) {
    return { type: "flow", title, steps: record.steps };
  }
  if (record.type === "bar" && Array.isArray(record.items) &&
    record.items.length >= 1 && record.items.length <= 8 && record.items.every(bar)) {
    return { type: "bar", title, items: record.items };
  }
  if (record.type === "concept" && shortText(record.center) && Array.isArray(record.items) &&
    record.items.length >= 1 && record.items.length <= 6 && record.items.every(conceptItem)) {
    return { type: "concept", title, center: record.center, items: record.items };
  }
  if (record.type === "line" && shortText(record.xLabel) && shortText(record.yLabel) &&
    Array.isArray(record.points)) {
    const rawPoints: unknown[] = record.points;
    if (rawPoints.length < 2 || rawPoints.length > 8 || !rawPoints.every(point) ||
      new Set(rawPoints.map((p) => p.x)).size !== rawPoints.length) return null;
    const points = [...rawPoints].sort((a, b) => a.x - b.x);
    return { type: "line", title, xLabel: record.xLabel, yLabel: record.yLabel, points };
  }
  return null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumSignificantDigits: 8,
    notation: Math.abs(value) >= 1e9 || (value !== 0 && Math.abs(value) < 1e-6)
      ? "scientific" : "standard",
  }).format(value);
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "không xác định";
  const cleaned = Math.abs(value) < 1e-9 ? 0 : value;
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: Math.abs(cleaned) >= 100 ? 1 : 2,
  }).format(cleaned);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function FunctionPlot({ visual }: { visual: PlotVisual }) {
  const clipId = useId();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const computed = useMemo(() => {
    const compiled = visual.functions
      .map((spec, idx) => {
        const fn = compileMathExpr(spec.expr);
        return fn
          ? {
              fn,
              expr: spec.expr,
              label: spec.label ?? `f${visual.functions.length > 1 ? idx + 1 : ""}(x) = ${spec.expr}`,
              tone: spec.tone ?? DEFAULT_PLOT_TONES[idx % DEFAULT_PLOT_TONES.length],
            }
          : null;
      })
      .filter((item): item is { fn: MathFn; expr: string; label: string; tone: VisualTone } => item !== null);

    const fns = compiled.map((c) => c.fn);
    const sample = sampleFunctionPlot(fns, visual.xDomain, visual.yDomain, 240);

    const resolvedPoints = (visual.points ?? [])
      .map((pt) => {
        const y = pt.y !== undefined ? pt.y : fns[0](pt.x);
        return Number.isFinite(y) ? { x: pt.x, y, label: pt.label } : null;
      })
      .filter((pt): pt is { x: number; y: number; label: string | undefined } => pt !== null);

    let tangent: { x0: number; y0: number; slope: number; x1: number; y1: number; x2: number; y2: number } | null = null;
    if (visual.tangentAt !== undefined && fns.length > 0) {
      const x0 = visual.tangentAt;
      const y0 = fns[0](x0);
      const slope = numericDerivative(fns[0], x0);
      if (Number.isFinite(y0) && Number.isFinite(slope)) {
        const [xMin, xMax] = sample.xDomain;
        const [yMin, yMax] = sample.yDomain;
        const ySpan = Math.max(yMax - yMin, 1e-6);
        let tX1 = xMin;
        let tX2 = xMax;
        if (Math.abs(slope) > 1e-9) {
          const boundLow = yMin - ySpan;
          const boundHigh = yMax + ySpan;
          const xa = x0 + (boundLow - y0) / slope;
          const xb = x0 + (boundHigh - y0) / slope;
          tX1 = Math.max(xMin, Math.min(xa, xb));
          tX2 = Math.min(xMax, Math.max(xa, xb));
        }
        if (tX2 > tX1) {
          tangent = {
            x0,
            y0,
            slope,
            x1: tX1,
            y1: y0 + slope * (tX1 - x0),
            x2: tX2,
            y2: y0 + slope * (tX2 - x0),
          };
        }
      }
    }

    const shadePolygons: Array<Array<{ x: number; y: number }>> = [];
    if (visual.shade && fns.length > 0) {
      const fnIdx = visual.shade.fnIndex ?? 0;
      const fn = fns[fnIdx];
      const [xMin, xMax] = sample.xDomain;
      const [yMin, yMax] = sample.yDomain;
      const ySpan = Math.max(yMax - yMin, 1e-6);
      const from = clamp(visual.shade.from, xMin, xMax);
      const to = clamp(visual.shade.to, xMin, xMax);
      if (fn && to > from) {
        const steps = 96;
        const step = (to - from) / steps;
        let chunk: Array<{ x: number; y: number }> = [];
        for (let i = 0; i <= steps; i++) {
          const x = i === steps ? to : from + i * step;
          const y = fn(x);
          const valid = Number.isFinite(y) && y >= yMin - ySpan * 2.5 && y <= yMax + ySpan * 2.5;
          if (!valid) {
            if (chunk.length >= 2) shadePolygons.push(chunk);
            chunk = [];
            continue;
          }
          if (chunk.length > 0) {
            const prev = chunk[chunk.length - 1];
            if (Math.abs(y - prev.y) > ySpan * 1.2) {
              if (chunk.length >= 2) shadePolygons.push(chunk);
              chunk = [];
            }
          }
          chunk.push({ x, y });
        }
        if (chunk.length >= 2) shadePolygons.push(chunk);
      }
    }

    return { compiled, sample, resolvedPoints, tangent, shadePolygons };
  }, [visual]);

  const SVG_W = 560;
  const SVG_H = 320;
  const PAD_L = 54;
  const PAD_R = 22;
  const PAD_T = 20;
  const PAD_B = 40;
  const plotW = SVG_W - PAD_L - PAD_R;
  const plotH = SVG_H - PAD_T - PAD_B;

  const { compiled, sample, resolvedPoints, tangent, shadePolygons } = computed;
  const [xMin, xMax] = sample.xDomain;
  const [yMin, yMax] = sample.yDomain;
  const mapX = (x: number) => PAD_L + ((x - xMin) / (xMax - xMin)) * plotW;
  const mapY = (y: number) => PAD_T + ((yMax - y) / (yMax - yMin)) * plotH;

  const xAxisInView = yMin <= 0 && yMax >= 0;
  const yAxisInView = xMin <= 0 && xMax >= 0;
  const zeroY = mapY(0);
  const zeroX = mapX(0);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((event.clientX - rect.left) / rect.width) * SVG_W;
    const clampedX = clamp(svgX, PAD_L, PAD_L + plotW);
    const mathX = xMin + ((clampedX - PAD_L) / plotW) * (xMax - xMin);
    setHoverX(mathX);
  };

  const handlePointerLeave = () => {
    setHoverX(null);
  };

  const ariaLabel = `${visual.title}: đồ thị ${compiled.map((c) => c.expr).join(", ")} trên [${formatCompact(xMin)}, ${formatCompact(xMax)}]`;
  const baselineY = clamp(zeroY, PAD_T - plotH, PAD_T + plotH * 2);

  return (
    <div className={styles.stemPlot}>
      <div className={styles.readoutBar} aria-live="polite">
        {hoverX !== null ? (
          <>
            <span className={styles.readoutCoord}>x = {formatCompact(hoverX)}</span>
            {compiled.map((curve, idx) => {
              const val = curve.fn(hoverX);
              return (
                <span key={idx} className={styles.readoutItem} data-tone={curve.tone}>
                  <span className={styles.swatchDot} />
                  <span>{curve.label}: {formatCompact(val)}</span>
                </span>
              );
            })}
          </>
        ) : (
          <span className={styles.readoutHint}>Di chuột trên đồ thị để xem tọa độ (x, y)</span>
        )}
      </div>

      <svg
        className={styles.stemSvg}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        <rect
          x={PAD_L}
          y={PAD_T}
          width={plotW}
          height={plotH}
          rx={6}
          className={styles.plotBg}
        />

        {sample.xTicks.map((tick) => {
          const sx = mapX(tick);
          return (
            <g key={`xt-${tick}`}>
              <line
                x1={sx}
                y1={PAD_T}
                x2={sx}
                y2={PAD_T + plotH}
                className={styles.gridLine}
              />
              <line
                x1={sx}
                y1={PAD_T + plotH}
                x2={sx}
                y2={PAD_T + plotH + 4}
                className={styles.tickMark}
              />
              <text
                x={sx}
                y={PAD_T + plotH + 17}
                textAnchor="middle"
                className={styles.tickLabel}
              >
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}

        {sample.yTicks.map((tick) => {
          const sy = mapY(tick);
          return (
            <g key={`yt-${tick}`}>
              <line
                x1={PAD_L}
                y1={sy}
                x2={PAD_L + plotW}
                y2={sy}
                className={styles.gridLine}
              />
              <line
                x1={PAD_L - 4}
                y1={sy}
                x2={PAD_L}
                y2={sy}
                className={styles.tickMark}
              />
              <text
                x={PAD_L - 8}
                y={sy + 4}
                textAnchor="end"
                className={styles.tickLabel}
              >
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}

        {xAxisInView && (
          <line
            x1={PAD_L}
            y1={zeroY}
            x2={PAD_L + plotW}
            y2={zeroY}
            className={styles.axisLine}
          />
        )}
        {yAxisInView && (
          <line
            x1={zeroX}
            y1={PAD_T}
            x2={zeroX}
            y2={PAD_T + plotH}
            className={styles.axisLine}
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {shadePolygons.map((chunk, idx) => {
            const firstX = mapX(chunk[0].x).toFixed(2);
            const lastX = mapX(chunk[chunk.length - 1].x).toFixed(2);
            const pts = [
              `${firstX},${baselineY.toFixed(2)}`,
              ...chunk.map((p) => `${mapX(p.x).toFixed(2)},${mapY(p.y).toFixed(2)}`),
              `${lastX},${baselineY.toFixed(2)}`,
            ].join(" ");
            const shadeTone = compiled[visual.shade?.fnIndex ?? 0]?.tone ?? "primary";
            return (
              <polygon
                key={`shade-${idx}`}
                points={pts}
                className={styles.shadeArea}
                data-tone={shadeTone}
              />
            );
          })}

          {tangent && (
            <line
              x1={mapX(tangent.x1)}
              y1={mapY(tangent.y1)}
              x2={mapX(tangent.x2)}
              y2={mapY(tangent.y2)}
              className={styles.tangentLine}
              data-role="tangent"
            />
          )}

          {sample.curves.map((curveSample, curveIdx) => {
            const tone = compiled[curveIdx]?.tone ?? "primary";
            return curveSample.segments.map((segment, segIdx) => (
              <polyline
                key={`curve-${curveIdx}-${segIdx}`}
                points={segment
                  .map((pt) => `${mapX(pt.x).toFixed(2)},${mapY(pt.y).toFixed(2)}`)
                  .join(" ")}
                className={styles.curveLine}
                data-tone={tone}
              />
            ));
          })}

          {tangent && (
            <circle
              cx={mapX(tangent.x0)}
              cy={mapY(tangent.y0)}
              r={4.5}
              className={styles.tangentDot}
            />
          )}

          {resolvedPoints.map((pt, idx) => {
            const px = mapX(pt.x);
            const py = mapY(pt.y);
            const nearTop = py < PAD_T + 26;
            const nearRight = px > PAD_L + plotW - 90;
            const textY = nearTop ? py + 16 : py - 10;
            const textAnchor = nearRight ? "end" : "start";
            const textX = nearRight ? px - 8 : px + 8;
            const tag = pt.label
              ? `${pt.label} (${formatCompact(pt.x)}, ${formatCompact(pt.y)})`
              : `(${formatCompact(pt.x)}, ${formatCompact(pt.y)})`;
            return (
              <g key={`pt-${idx}`} data-role="plot-point">
                <circle cx={px} cy={py} r={4.5} className={styles.pointDot} />
                <text
                  x={textX}
                  y={textY}
                  textAnchor={textAnchor}
                  className={styles.pointLabel}
                >
                  {tag}
                </text>
              </g>
            );
          })}

          {hoverX !== null && (
            <g className={styles.crosshairGroup} pointerEvents="none">
              <line
                x1={mapX(hoverX)}
                y1={PAD_T}
                x2={mapX(hoverX)}
                y2={PAD_T + plotH}
                className={styles.crosshairLine}
              />
              {compiled.map((curve, idx) => {
                const y = curve.fn(hoverX);
                if (!Number.isFinite(y) || y < yMin || y > yMax) return null;
                return (
                  <circle
                    key={`hover-${idx}`}
                    cx={mapX(hoverX)}
                    cy={mapY(y)}
                    r={4.5}
                    className={styles.hoverDot}
                    data-tone={curve.tone}
                  />
                );
              })}
            </g>
          )}
        </g>

        <text
          x={PAD_L + plotW}
          y={SVG_H - 6}
          textAnchor="end"
          className={styles.axisName}
        >
          {visual.xLabel}
        </text>
        <text
          x={PAD_L + 4}
          y={PAD_T - 6}
          textAnchor="start"
          className={styles.axisName}
        >
          {visual.yLabel}
        </text>
      </svg>

      <div className={styles.legend}>
        {compiled.map((curve, idx) => (
          <span key={`leg-${idx}`} className={styles.legendItem} data-tone={curve.tone}>
            <span className={styles.legendLine} />
            <span>{curve.label}</span>
          </span>
        ))}
        {visual.shade && (
          <span
            className={styles.legendItem}
            data-tone={compiled[visual.shade.fnIndex ?? 0]?.tone ?? "primary"}
          >
            <span className={styles.legendShade} />
            <span>
              Miền tô [{formatCompact(visual.shade.from)}, {formatCompact(visual.shade.to)}]
            </span>
          </span>
        )}
        {tangent && (
          <span className={styles.legendItem} data-tone="warn">
            <span className={styles.legendDashed} />
            <span>
              Tiếp tuyến tại x = {formatCompact(tangent.x0)} (k = {formatCompact(tangent.slope)})
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function VectorDiagram({ visual }: { visual: VectorVisual }) {
  const SVG_W = 520;
  const SVG_H = 320;
  const PAD = 48;

  const hasBody = visual.bodyLabel !== undefined || visual.planeAngle !== undefined;
  const angle = visual.planeAngle ?? 0;

  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const v of visual.vectors) {
    minX = Math.min(minX, v.x, v.x + v.dx);
    maxX = Math.max(maxX, v.x, v.x + v.dx);
    minY = Math.min(minY, v.y, v.y + v.dy);
    maxY = Math.max(maxY, v.y, v.y + v.dy);
  }

  const rawSpanX = Math.max(maxX - minX, 2);
  const rawSpanY = Math.max(maxY - minY, 2);
  const padX = Math.max(rawSpanX * 0.25, 0.75);
  const padY = Math.max(rawSpanY * 0.25, 0.75);
  const boundMinX = minX - padX;
  const boundMaxX = maxX + padX;
  const boundMinY = minY - padY;
  const boundMaxY = maxY + padY;

  const midX = (boundMinX + boundMaxX) * 0.5;
  const midY = (boundMinY + boundMaxY) * 0.5;
  const scale = Math.min(
    (SVG_W - PAD * 2) / Math.max(boundMaxX - boundMinX, 1e-3),
    (SVG_H - PAD * 2) / Math.max(boundMaxY - boundMinY, 1e-3),
  );

  const cx = SVG_W * 0.5;
  const cy = SVG_H * 0.5;
  const mapX = (x: number) => cx + (x - midX) * scale;
  const mapY = (y: number) => cy - (y - midY) * scale;

  const visXMin = midX - (cx - 16) / scale;
  const visXMax = midX + (SVG_W - cx - 16) / scale;
  const visYMin = midY - (SVG_H - cy - 16) / scale;
  const visYMax = midY + (cy - 16) / scale;

  const xTicks = visual.grid ? niceTicks(visXMin, visXMax, 7) : [];
  const yTicks = visual.grid ? niceTicks(visYMin, visYMax, 6) : [];

  const ox = mapX(0);
  const oy = mapY(0);
  const boxW = 54;
  const boxH = 34;
  const planeHalfLen = 175;
  const planeYOffset = boxH * 0.5;
  const hatchOffsets = [-145, -115, -85, -55, -25, 5, 35, 65, 95, 125, 155];

  const ariaParts = [visual.title];
  if (visual.planeAngle !== undefined) {
    ariaParts.push(`mặt phẳng góc ${formatCompact(visual.planeAngle)} độ`);
  }
  ariaParts.push(
    visual.vectors
      .map((v) => `${v.label}(${formatCompact(v.dx)}, ${formatCompact(v.dy)})`)
      .join(", "),
  );

  return (
    <div className={styles.stemPlot}>
      <svg
        className={styles.stemSvg}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        role="img"
        aria-label={ariaParts.join(": ")}
      >
        <rect
          x={8}
          y={8}
          width={SVG_W - 16}
          height={SVG_H - 16}
          rx={8}
          className={styles.plotBg}
        />

        {visual.grid && (
          <g data-role="vector-grid">
            {xTicks.map((tick) => {
              const sx = mapX(tick);
              return (
                <g key={`vxt-${tick}`}>
                  <line x1={sx} y1={14} x2={sx} y2={SVG_H - 14} className={styles.gridLine} />
                  {tick !== 0 && oy >= 24 && oy <= SVG_H - 24 && (
                    <text x={sx} y={oy + 14} textAnchor="middle" className={styles.tickLabel}>
                      {formatCompact(tick)}
                    </text>
                  )}
                </g>
              );
            })}
            {yTicks.map((tick) => {
              const sy = mapY(tick);
              return (
                <g key={`vyt-${tick}`}>
                  <line x1={14} y1={sy} x2={SVG_W - 14} y2={sy} className={styles.gridLine} />
                  {tick !== 0 && ox >= 28 && ox <= SVG_W - 28 && (
                    <text x={ox - 7} y={sy + 4} textAnchor="end" className={styles.tickLabel}>
                      {formatCompact(tick)}
                    </text>
                  )}
                </g>
              );
            })}
            {oy >= 14 && oy <= SVG_H - 14 && (
              <g>
                <line x1={16} y1={oy} x2={SVG_W - 18} y2={oy} className={styles.axisLine} />
                <polygon
                  points={`${SVG_W - 12},${oy} ${SVG_W - 21},${oy - 4} ${SVG_W - 21},${oy + 4}`}
                  className={styles.axisArrow}
                />
                <text x={SVG_W - 18} y={oy - 8} textAnchor="end" className={styles.axisName}>
                  x
                </text>
              </g>
            )}
            {ox >= 14 && ox <= SVG_W - 14 && (
              <g>
                <line x1={ox} y1={SVG_H - 16} x2={ox} y2={18} className={styles.axisLine} />
                <polygon
                  points={`${ox},12 ${ox - 4},21 ${ox + 4},21`}
                  className={styles.axisArrow}
                />
                <text x={ox + 9} y={24} textAnchor="start" className={styles.axisName}>
                  y
                </text>
              </g>
            )}
          </g>
        )}

        {hasBody && (
          <g data-role="vector-plane">
            {Math.abs(angle) > 0.1 && (() => {
              const rad = (angle * Math.PI) / 180;
              const anchorX = ox - Math.cos(rad) * 110 + Math.sin(rad) * planeYOffset;
              const anchorY = oy + Math.sin(rad) * 110 + Math.cos(rad) * planeYOffset;
              const refLen = 84;
              const arcR = 38;
              const arcEndX = anchorX + Math.cos(rad) * arcR;
              const arcEndY = anchorY - Math.sin(rad) * arcR;
              const sweepFlag = angle > 0 ? 0 : 1;
              return (
                <g data-role="plane-angle">
                  <line
                    x1={anchorX}
                    y1={anchorY}
                    x2={anchorX + refLen}
                    y2={anchorY}
                    className={styles.angleRefLine}
                  />
                  <path
                    d={`M ${anchorX + arcR} ${anchorY} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${arcEndX.toFixed(2)} ${arcEndY.toFixed(2)}`}
                    className={styles.angleArc}
                  />
                  <text
                    x={anchorX + arcR + 14}
                    y={anchorY + (angle > 0 ? -8 : 16)}
                    className={styles.angleLabel}
                  >
                    {formatCompact(Math.abs(angle))}&deg;
                  </text>
                </g>
              );
            })()}

            <g transform={`rotate(${-angle} ${ox} ${oy})`}>
              <line
                x1={ox - planeHalfLen}
                y1={oy + planeYOffset}
                x2={ox + planeHalfLen}
                y2={oy + planeYOffset}
                className={styles.planeLine}
              />
              {hatchOffsets.map((dx) => (
                <line
                  key={`hatch-${dx}`}
                  x1={ox + dx}
                  y1={oy + planeYOffset}
                  x2={ox + dx - 8}
                  y2={oy + planeYOffset + 10}
                  className={styles.planeHatch}
                />
              ))}
              <rect
                x={ox - boxW * 0.5}
                y={oy - boxH * 0.5}
                width={boxW}
                height={boxH}
                rx={6}
                className={styles.bodyBox}
              />
              {visual.bodyLabel && (
                <text
                  x={ox}
                  y={oy + 5}
                  textAnchor="middle"
                  className={styles.bodyLabel}
                >
                  {visual.bodyLabel}
                </text>
              )}
            </g>
          </g>
        )}

        {visual.vectors.map((vec, idx) => {
          const tone = vec.tone ?? DEFAULT_VECTOR_TONES[idx % DEFAULT_VECTOR_TONES.length];
          const x1 = mapX(vec.x);
          const y1 = mapY(vec.y);
          const x2 = mapX(vec.x + vec.dx);
          const y2 = mapY(vec.y + vec.dy);
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < 1) return null;

          const ux = (x2 - x1) / len;
          const uy = (y2 - y1) / len;
          const headLen = Math.min(13, Math.max(7, len * 0.28));
          const headHalfW = headLen * 0.44;
          const shaftEndX = x2 - ux * headLen * 0.82;
          const shaftEndY = y2 - uy * headLen * 0.82;
          const baseX = x2 - ux * headLen;
          const baseY = y2 - uy * headLen;
          const leftX = baseX - uy * headHalfW;
          const leftY = baseY + ux * headHalfW;
          const rightX = baseX + uy * headHalfW;
          const rightY = baseY - ux * headHalfW;

          const labelX = clamp(x2 + ux * 14 - uy * 6, 26, SVG_W - 26);
          const labelY = clamp(y2 + uy * 14 + ux * 6 + 4, 24, SVG_H - 18);

          return (
            <g key={`vec-${idx}`} className={styles.vectorGroup} data-tone={tone} data-role="vector-arrow">
              {!hasBody && (Math.abs(vec.x) > 1e-9 || Math.abs(vec.y) > 1e-9) && (
                <circle cx={x1} cy={y1} r={3.5} className={styles.vectorHead} />
              )}
              <line
                x1={x1}
                y1={y1}
                x2={shaftEndX}
                y2={shaftEndY}
                className={styles.vectorShaft}
              />
              <polygon
                points={`${x2.toFixed(2)},${y2.toFixed(2)} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}`}
                className={styles.vectorHead}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                className={styles.vectorLabel}
              >
                {vec.label}
              </text>
            </g>
          );
        })}

        <circle cx={ox} cy={oy} r={3} className={styles.originDot} />
      </svg>

      <div className={styles.legend}>
        {visual.vectors.map((vec, idx) => {
          const tone = vec.tone ?? DEFAULT_VECTOR_TONES[idx % DEFAULT_VECTOR_TONES.length];
          const mag = Math.hypot(vec.dx, vec.dy);
          const hasTail = !hasBody && (Math.abs(vec.x) > 1e-9 || Math.abs(vec.y) > 1e-9);
          return (
            <span key={`vleg-${idx}`} className={styles.legendItem} data-tone={tone}>
              <span className={styles.legendLine} />
              <span>
                {vec.label} = ({formatCompact(vec.dx)}, {formatCompact(vec.dy)})
                {hasTail ? ` tại (${formatCompact(vec.x)}, ${formatCompact(vec.y)})` : ""}, |{vec.label}| = {formatCompact(mag)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LinePlot({ visual }: { visual: Line }) {
  const { points, xLabel, yLabel } = visual;
  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const yMin = Math.min(...points.map((p) => p.y));
  const yMax = Math.max(...points.map((p) => p.y));
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

function ConceptDiagram({ visual }: { visual: Concept }) {
  return <div className={styles.concept}>
    <strong className={styles.conceptCenter}>{visual.center}</strong>
    <ul className={styles.conceptBranches}>
      {visual.items.map((item, index) => <li key={index}><strong>{item.label}</strong><span>{item.detail}</span></li>)}
    </ul>
  </div>;
}

export function ChatVisualLoading() {
  return (
    <div className={styles.loadingVisual} role="status">
      <span>Đang dựng hình minh họa...</span>
      <div className={styles.loadingBars} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function ChatVisual({ visual }: { visual: Visual }) {
  const scale = visual.type === "bar" ? (Math.max(...visual.items.map((item) => Math.abs(item.value))) || 1) : 1;
  const divided = visual.type === "bar" && visual.items.some((item) => item.value < 0);
  return <figure className={styles.visual}>
    <figcaption>{visual.title}</figcaption>
    {visual.type === "plot" ? <FunctionPlot visual={visual} /> :
      visual.type === "vector" ? <VectorDiagram visual={visual} /> :
      visual.type === "concept" ? <ConceptDiagram visual={visual} /> :
      visual.type === "line" ? <LinePlot visual={visual} /> : visual.type === "flow" ? <ol className={styles.flow}>
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
