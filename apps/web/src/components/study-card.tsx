"use client";

import { Fragment, type ReactNode } from "react";
import { z } from "zod";
import styles from "./study-card.module.css";

const TONES = ["neutral", "info", "accent", "warn"] as const;
type Tone = (typeof TONES)[number];

const toneSchema = z.enum(TONES).optional();

const stepsSchema = z.object({
  kind: z.literal("steps"),
  title: z.string().trim().min(1).optional(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        body: z.string().trim().default(""),
        tone: toneSchema,
      }),
    )
    .min(1)
    .max(8),
  loop: z.string().trim().min(1).optional(),
  caption: z.string().trim().min(1).optional(),
});

const pipelineSchema = z.object({
  kind: z.literal("pipeline"),
  title: z.string().trim().min(1).optional(),
  nodes: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        subtitle: z.string().trim().default(""),
        tone: toneSchema,
      }),
    )
    .min(2)
    .max(8),
  caption: z.string().trim().min(1).optional(),
});

const comparisonSchema = z.object({
  kind: z.literal("comparison"),
  title: z.string().trim().min(1).optional(),
  columns: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        tone: toneSchema,
        items: z
          .array(
            z.object({
              label: z.string().trim().min(1),
              value: z.number().finite().min(0),
              display: z.string().trim().min(1),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .min(1)
    .max(3),
  caption: z.string().trim().min(1).optional(),
});

const studyCardSchema = z.discriminatedUnion("kind", [
  stepsSchema,
  pipelineSchema,
  comparisonSchema,
]);

export type StudyCard = z.infer<typeof studyCardSchema>;

function normalizeTone(value: unknown): Tone | undefined {
  if (typeof value !== "string") return undefined;
  const lowered = value.trim().toLowerCase();
  if ((TONES as readonly string[]).includes(lowered)) return lowered as Tone;
  if (lowered === "primary" || lowered === "green" || lowered === "success") return "accent";
  if (lowered === "blue") return "info";
  if (lowered === "warning" || lowered === "yellow") return "warn";
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseNumericValue(value: unknown): { numeric: number; fallbackDisplay: string } | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { numeric: value, fallbackDisplay: String(value) };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^([+-]?\d+(?:[.,]\d+)?)/);
    if (!match) return null;
    const numeric = Number(match[1].replace(",", "."));
    if (Number.isFinite(numeric) && numeric >= 0) {
      return { numeric, fallbackDisplay: trimmed };
    }
  }
  return null;
}

export function parseStudyCard(raw: string): StudyCard | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:study-card|learnstep-visual|vis)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/,\s*([}\]])/g, "$1");
  if (!cleaned) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const escaped = cleaned
      .replace(/\\(?!(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))/g, "\\\\")
      .replace(/\r?\n/g, " ");
    try {
      parsed = JSON.parse(escaped);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const rawKind = asString(obj.kind ?? obj.type)?.toLowerCase();
  const kind =
    rawKind === "step" || rawKind === "step-flow" || rawKind === "steps"
      ? "steps"
      : rawKind === "pipeline" || rawKind === "stages"
        ? "pipeline"
        : rawKind === "bars" || rawKind === "compare" || rawKind === "comparison"
          ? "comparison"
          : undefined;
  if (!kind) return null;

  const title = asString(obj.title);
  const caption = asString(obj.caption);

  if (kind === "steps") {
    const rawSteps = Array.isArray(obj.steps) ? obj.steps : Array.isArray(obj.items) ? obj.items : null;
    if (!rawSteps) return null;
    const steps = rawSteps.map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const item = entry as Record<string, unknown>;
      return {
        title: asString(item.title ?? item.heading) ?? "",
        body: asString(item.body ?? item.text ?? item.description) ?? "",
        tone: normalizeTone(item.tone),
      };
    });
    if (steps.some((item) => item === null)) return null;
    const validated = stepsSchema.safeParse({
      kind,
      title,
      steps,
      loop: asString(obj.loop),
      caption,
    });
    return validated.success ? validated.data : null;
  }

  if (kind === "pipeline") {
    const rawNodes = Array.isArray(obj.nodes)
      ? obj.nodes
      : Array.isArray(obj.steps)
        ? obj.steps
        : Array.isArray(obj.stages)
          ? obj.stages
          : null;
    if (!rawNodes) return null;
    const nodes = rawNodes.map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const item = entry as Record<string, unknown>;
      return {
        title: asString(item.title ?? item.label ?? item.name) ?? "",
        subtitle: asString(item.subtitle ?? item.description ?? item.body) ?? "",
        tone: normalizeTone(item.tone),
      };
    });
    if (nodes.some((item) => item === null)) return null;
    const validated = pipelineSchema.safeParse({
      kind,
      title,
      nodes,
      caption,
    });
    return validated.success ? validated.data : null;
  }

  const rawColumns = Array.isArray(obj.columns) ? obj.columns : Array.isArray(obj.groups) ? obj.groups : null;
  if (!rawColumns) return null;
  const columns = rawColumns.map((entry) => {
    if (typeof entry !== "object" || entry === null) return null;
    const col = entry as Record<string, unknown>;
    const rawItems = Array.isArray(col.items) ? col.items : null;
    if (!rawItems) return null;
    const items = rawItems.map((row) => {
      if (typeof row !== "object" || row === null) return null;
      const item = row as Record<string, unknown>;
      const parsedVal = parseNumericValue(item.value);
      if (!parsedVal) return null;
      return {
        label: asString(item.label ?? item.name) ?? "",
        value: parsedVal.numeric,
        display: asString(item.display) ?? parsedVal.fallbackDisplay,
      };
    });
    if (items.some((item) => item === null)) return null;
    return {
      title: asString(col.title ?? col.name) ?? "",
      tone: normalizeTone(col.tone),
      items,
    };
  });
  if (columns.some((col) => col === null)) return null;
  const validated = comparisonSchema.safeParse({
    kind,
    title,
    columns,
    caption,
  });
  return validated.success ? validated.data : null;
}

function ConnectorArrow() {
  return (
    <div className={styles.connector} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path
          d="M8 2.5v10M4.5 9L8 12.5 11.5 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function LoopGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M12.5 6A5 5 0 0 0 3.7 4.7M3.5 10a5 5 0 0 0 8.8 1.3M3.5 2.5v2.7h2.7M12.5 13.5v-2.7H9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StudyCardBlock({
  raw,
  streaming = false,
  renderInline,
}: {
  raw: string;
  streaming?: boolean;
  renderInline: (text: string) => ReactNode;
}) {
  const card = parseStudyCard(raw);
  if (!card) {
    if (!streaming) return null;
    return (
      <div className={styles.loadingCard} role="status">
        <span>Đang dựng sơ đồ minh họa…</span>
        <div className={styles.loadingBars} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <figure className={styles.card}>
      {card.title && <div className={styles.cardTitle}>{renderInline(card.title)}</div>}
      {card.kind === "steps" && (
        <div className={styles.stack}>
          {card.steps.map((step, index) => {
            const tone: Tone =
              step.tone ?? (index === 0 ? "neutral" : index === card.steps.length - 1 ? "accent" : "info");
            return (
              <Fragment key={`${step.title}-${index}`}>
                {index > 0 && <ConnectorArrow />}
                <div className={styles.stepBox} data-tone={tone}>
                  <div className={styles.stepTitle}>{renderInline(step.title)}</div>
                  {step.body && <div className={styles.stepBody}>{renderInline(step.body)}</div>}
                </div>
              </Fragment>
            );
          })}
          {card.loop && (
            <div className={styles.loopNote}>
              <LoopGlyph />
              <span>{renderInline(card.loop)}</span>
            </div>
          )}
        </div>
      )}
      {card.kind === "pipeline" && (
        <div className={styles.pipelineStack}>
          {card.nodes.map((node, index) => {
            const tone: Tone =
              node.tone ?? (index === card.nodes.length - 1 ? "accent" : index % 2 === 1 ? "info" : "neutral");
            return (
              <Fragment key={`${node.title}-${index}`}>
                {index > 0 && <ConnectorArrow />}
                <div className={styles.nodeBox} data-tone={tone}>
                  <div className={styles.nodeTitle}>{renderInline(node.title)}</div>
                  {node.subtitle && <div className={styles.nodeSubtitle}>{renderInline(node.subtitle)}</div>}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
      {card.kind === "comparison" && (() => {
        const allValues = card.columns.flatMap((col) => col.items.map((item) => item.value));
        const maxVal = Math.max(0, ...allValues);
        const scaleMax = maxVal <= 100 ? 100 : maxVal;
        return (
          <div className={styles.compareGrid}>
            {card.columns.map((column, colIndex) => {
              const colTone: Tone = column.tone ?? (colIndex === 0 ? "accent" : "neutral");
              return (
                <div className={styles.compareColumn} data-tone={colTone} key={`${column.title}-${colIndex}`}>
                  <div className={styles.compareHeader}>{renderInline(column.title)}</div>
                  <div className={styles.compareItems}>
                    {column.items.map((item, itemIndex) => {
                      const pct =
                        scaleMax > 0 ? Math.min(100, Math.max(0, (item.value / scaleMax) * 100)) : 0;
                      return (
                        <div className={styles.compareRow} key={`${item.label}-${itemIndex}`}>
                          <div className={styles.compareRowHead}>
                            <span className={styles.compareLabel}>{renderInline(item.label)}</span>
                            <span className={styles.compareValue}>{item.display}</span>
                          </div>
                          <div className={styles.barTrack}>
                            <div className={styles.barFill} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
      {card.caption && <figcaption className={styles.caption}>{renderInline(card.caption)}</figcaption>}
    </figure>
  );
}
