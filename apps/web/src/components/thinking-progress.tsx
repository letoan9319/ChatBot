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

export function ThinkingProgress({ status, started, duration, content, provider }: {
  status: string;
  started: boolean;
  duration?: number | null;
  content: string;
  provider?: string | null;
}) {
  const id = useId();
  const star = useRef<SVGSVGElement>(null);
  const rotation = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const active = status === "generating" && !content && duration == null;
  const activeLabel = started ? "Đang suy luận…" : "Đang chuẩn bị câu trả lời…";
  const recorded = duration == null ? "" : duration < 1000
    ? "Đã suy luận dưới 1 giây" : "Đã suy luận trong " + Math.round(duration / 1000) + " giây";
  const doneLabel = recorded || (started
    ? status === "stopped" ? "Đã dừng suy luận" : "Suy luận bị gián đoạn"
    : status === "generating" ? "Đang sinh câu trả lời…" : "Không ghi nhận suy luận riêng");
  const approach = status === "completed" ? readApproach(content) : null;
  const steps = [
    started && "Worker đã nhận tín hiệu suy luận từ model.",
    recorded && "Thời gian được đo từ tín hiệu suy luận đầu tiên đến khi model bắt đầu xuất câu trả lời hoặc kết thúc lượt sinh.",
    !started && status === "completed" && (provider === "deploy" || provider === "openrouter"
      ? "Lượt trả lời qua nhà cung cấp dự phòng chưa có dữ liệu tiến độ suy luận trong LearnStep."
      : "LearnStep chỉ báo đã suy luận khi nhận được tín hiệu riêng từ model."),
    !started && status === "generating" && "Worker đang chuẩn bị ngữ cảnh hoặc bắt đầu sinh câu trả lời.",
  ];

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

  return <div className={styles.u453 + (active ? "" : " " + styles.done)}>
    <div className={styles.u453Wrap}>
      <button type="button" className={styles.u453Toggle} aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
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
      <div className={styles.u453Panel} id={id} aria-hidden={!open}>
        <div className={styles.u453Inner}>
          <div className={styles.u453List}>
            {steps.filter(Boolean).map((step, index) => <p key={index} className={styles.u453Line + (step ? " " + styles.visible : "")}>
              <span><span>{step || ""}</span></span>
            </p>)}
            {approach && <div className={styles.approach}>
              <strong>Tóm tắt cách tiếp cận</strong>
              <Markdown content={approach} chatMath />
            </div>}
          </div>
        </div>
      </div>
    </div>
    <span className={styles.u453Live} role="status">{active ? activeLabel : doneLabel}</span>
  </div>;
}
