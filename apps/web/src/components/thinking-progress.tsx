// Lucian UX/UI Prompt #453 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#453
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Markdown } from "./markdown";
import styles from "./thinking-progress.module.css";

export function readApproach(content: string): string | null {
  const match = /^\s*(?:#{1,6}[ \t]+)?(?:\*\*)?Cách tiếp cận(?:\*\*)?[ \t]*:(?:\*\*)?\s*([^\n]+(?:\n(?!\s*\n|#{1,6} ).+)*)/i.exec(content);
  const approach = match?.[1].trim();
  return approach && approach.length <= 480 ? approach : null;
}

export function ThinkingProgress({ status, duration, thinking, content, sources = [] }: {
  status: string;
  started: boolean;
  duration?: number | null;
  thinking?: string | null;
  content: string;
  provider?: string | null;
  sources?: { label: string; title: string; url: string }[];
}) {
  const id = useId();
  const star = useRef<SVGSVGElement>(null);
  const rotation = useRef<number | null>(null);
  const streamBox = useRef<HTMLDivElement>(null);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const active = status === "generating" && !content && duration == null;
  const liveThinking = thinking?.trim() ?? "";
  const open = userOpen ?? (active && Boolean(liveThinking));
  const activeLabel = "Đang suy nghĩ…";
  const seconds = duration == null ? null : Math.max(1, Math.round(duration / 1000));
  const recorded = duration == null ? "" : duration < 1000
    ? "Đã suy nghĩ dưới 1 giây" : "Đã suy nghĩ trong " + seconds + " giây";
  const doneLabel = recorded || (status === "stopped"
    ? "Đã dừng suy nghĩ"
    : status === "generating"
      ? "Đang sinh câu trả lời…"
      : status === "failed" || status === "interrupted"
        ? "Quá trình suy nghĩ bị gián đoạn"
        : "Đã suy nghĩ dưới 1 giây");
  const approach = status === "completed" ? readApproach(content) : null;
  const approachSources = approach
    ? sources.filter(source => approach.includes("[" + source.label + "]"))
    : [];
  const citedSources = approachSources.length ? approachSources
    : sources.filter(source => status === "completed" && content.includes("[" + source.label + "]"));
  const steps = !liveThinking ? [
    duration != null && (duration < 1000
      ? "Đã phân tích câu hỏi và đối chiếu ngữ cảnh trong chưa đầy 1 giây."
      : "Đã phân tích câu hỏi và đối chiếu ngữ cảnh trong " + seconds + " giây."),
    duration == null && status === "generating" && "Đang phân tích câu hỏi và đối chiếu tài liệu liên quan.",
    duration == null && status === "completed" && "Đã phân tích câu hỏi và đối chiếu ngữ cảnh trong chưa đầy 1 giây.",
  ] : [];

  useEffect(() => {
    if (!active || !open || !liveThinking || !streamBox.current) return;
    streamBox.current.scrollTop = streamBox.current.scrollHeight;
  }, [active, open, liveThinking]);

  useEffect(() => {
    const icon = star.current;
    if (!icon || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !icon.animate) return;
    if (active) {
      const animation = icon.animate([
        { transform: "rotate(0deg) scale(1)" },
        { transform: "rotate(180deg) scale(.78)" },
        { transform: "rotate(360deg) scale(1)" },
      ], { duration: 2400, iterations: Infinity });
      return () => {
        rotation.current = Number(animation.currentTime ?? 0) % 2400 / 2400;
        animation.cancel();
      };
    }
    const position = rotation.current;
    if (position == null) return;
    rotation.current = null;
    const angle = position * 360;
    const scale = position < 0.5 ? 1 - 0.44 * position : 0.78 + 0.44 * (position - 0.5);
    const settle = icon.animate([
      { transform: "rotate(" + angle + "deg) scale(" + scale + ")" },
      { transform: "rotate(" + Math.ceil((angle + 25) / 90) * 90 + "deg) scale(1)" },
    ], { duration: 750, easing: "cubic-bezier(.3,1.45,.5,1)", fill: "forwards" });
    return () => settle.cancel();
  }, [active]);

  return <div className={styles.u453 + (active ? "" : " " + styles.done) + (liveThinking ? " " + styles.withStream : "")}>
    <div className={styles.u453Wrap}>
      <button type="button" className={styles.u453Toggle} aria-expanded={open} aria-controls={id}
        onClick={() => setUserOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setUserOpen(false);
          }
        }}>
        <span className={styles.u453Icon} aria-hidden="true">
          <svg ref={star} viewBox="0 0 24 24"><path d="M12 1.6c.8 5.3 5.1 9.6 10.4 10.4-5.3.8-9.6 5.1-10.4 10.4C11.2 17.1 6.9 12.8 1.6 12 6.9 11.2 11.2 6.9 12 1.6Z" /></svg>
        </span>
        <span className={styles.u453Text}>
          <span className={styles.u453Active} aria-hidden={!active}>{activeLabel}</span>
          <span className={styles.u453Complete} aria-hidden={active}>{doneLabel}</span>
        </span>
        <svg className={styles.u453Chevron} viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
      </button>
      <div className={styles.u453Panel} id={id} aria-hidden={!open} inert={!open}>
        <div className={styles.u453Inner}>
          <div className={styles.u453List}>
            {liveThinking && <div className={styles.thoughtStream}>
              <strong className={styles.thoughtTitle}>{active ? "Luồng suy nghĩ trực tiếp" : "Nội dung suy nghĩ"}</strong>
              <div ref={streamBox} className={styles.thoughtBody}>
                <Markdown content={liveThinking} chatMath streaming={active} />
              </div>
            </div>}
            {steps.filter(Boolean).map((step, index) => <p key={index} className={styles.u453Line + (step ? " " + styles.visible : "")}>
              <span><span>{step || ""}</span></span>
            </p>)}
            {approach && <div className={styles.approach}>
              <strong>Tóm tắt cách tiếp cận</strong>
              <Markdown content={approach} chatMath />
            </div>}
            {citedSources.length > 0 && <ul aria-label={approachSources.length ? "Nguồn trong tóm tắt" : "Nguồn đã trích trong câu trả lời"}>
              {citedSources.map(source => <li key={source.label}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">[{source.label}] {source.title}</a>
              </li>)}
            </ul>}
          </div>
        </div>
      </div>
    </div>
    <span className={styles.u453Live} role="status">{active ? activeLabel : doneLabel}</span>
  </div>;
}
