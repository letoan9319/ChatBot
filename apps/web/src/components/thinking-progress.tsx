// Lucian UX/UI Prompt #453 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#453
"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./thinking-progress.module.css";

export function ThinkingProgress({ status, started, duration }: {
  status: string;
  started: boolean;
  duration?: number | null;
}) {
  const id = useId();
  const star = useRef<SVGSVGElement>(null);
  const rotation = useRef<number | null>(null);
  const [openPhase, setOpenPhase] = useState<"active" | "done" | null>(null);
  const active = status === "generating" && duration == null;
  const phase = active ? "active" : "done";
  const open = openPhase === phase;
  const activeLabel = started ? "Đang suy luận…" : "Đang chuẩn bị câu trả lời…";
  const doneLabel = duration != null
    ? duration < 1000 ? "Đã suy luận dưới 1 giây" : "Đã suy luận trong " + Math.round(duration / 1000) + " giây"
    : status === "stopped" ? "Đã dừng suy luận" : "Suy luận bị gián đoạn";
  const steps = [
    "Chuẩn bị ngữ cảnh cho câu hỏi.",
    started && "Model đã bắt đầu suy luận.",
    duration != null && "Đã kết thúc giai đoạn suy luận.",
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
        onClick={() => setOpenPhase(open ? null : phase)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpenPhase(null);
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
            {steps.map((step, index) => <p key={index} className={styles.u453Line + (step ? " " + styles.visible : "")}>
              <span><span>{step || ""}</span></span>
            </p>)}
          </div>
        </div>
      </div>
    </div>
    <span className={styles.u453Live} role="status">{active ? "" : doneLabel}</span>
  </div>;
}
