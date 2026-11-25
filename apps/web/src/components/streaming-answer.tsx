// Lucian UX/UI Prompt #086 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#086
"use client";

import { useEffect, useRef, useState } from "react";
import type { Source, WebSource } from "@/core/types";
import { Markdown } from "./markdown";
import styles from "./streaming-answer.module.css";

const graphemes = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("vi", { granularity: "grapheme" })
  : null;

export function revealSegments(text: string): string[] {
  return graphemes
    ? Array.from(graphemes.segment(text), part => part.segment)
    : Array.from(text);
}

export function StreamingAnswer({ content, status, sources, webSources, onOpenSource, onReveal }: {
  content: string;
  status: string;
  sources?: Source[];
  webSources?: WebSource[];
  onOpenSource?: (source: Source) => void;
  onReveal: () => void;
}) {
  const live = status === "queued" || status === "generating";
  const [visible, setVisible] = useState(live ? "" : content);
  const rendered = useRef(visible);

  useEffect(() => {
    function show(next: string) {
      rendered.current = next;
      setVisible(next);
    }

    if (content === rendered.current) return;
    if (!content || (!live && status !== "completed") ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      show(content);
      return;
    }

    const prefix = content.startsWith(rendered.current) ? rendered.current : "";
    if (!prefix && rendered.current) show("");
    const suffix = revealSegments(content.slice(prefix.length));
    const milliseconds = Math.min(live ? 1500 : 650, suffix.length * 24);
    const started = performance.now();
    let frame = 0;
    let lastPaint = -Infinity;
    let count = 0;
    let next = prefix;

    function reveal(now: number) {
      const due = Math.min(suffix.length, Math.floor((now - started) * suffix.length / milliseconds) + 1);
      if (due > count && (now - lastPaint >= 24 || due === suffix.length)) {
        next += suffix.slice(count, due).join("");
        count = due;
        lastPaint = now;
        show(next);
      }
      if (count < suffix.length) frame = requestAnimationFrame(reveal);
    }
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [content, live, status]);

  useEffect(() => {
    onReveal();
  }, [visible, onReveal]);

  if (!visible) return live && status === "generating" ? (
    <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
  ) : null;
  const streaming = live || visible !== content;
  return <div className={streaming ? styles.streaming : undefined} aria-live={streaming ? "off" : undefined}>
    <Markdown
      content={visible}
      chatMath
      visuals={status === "completed" && !streaming}
      streaming={streaming}
      sources={status === "completed" && !streaming ? sources : undefined}
      webSources={status === "completed" && !streaming ? webSources : undefined}
      onOpenSource={onOpenSource}
    />
  </div>;
}
