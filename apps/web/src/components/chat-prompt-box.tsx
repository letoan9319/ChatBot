// Lucian UX/UI Prompt #452 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#452
import type { ReactNode } from "react";
import styles from "./chat-prompt-box.module.css";

export function ChatPromptBox({ children, tools, inactive, label, onStop }: {
  children: ReactNode;
  tools: ReactNode;
  inactive: boolean;
  label: string;
  onStop?: () => void;
}) {
  const generating = Boolean(onStop);

  return <div className={styles.box} data-generating={generating}>
    <span className={styles.glow} aria-hidden="true" />
    {children}
    <div className={styles.bar}>
      {tools}
      <button type={generating ? "button" : "submit"} className={styles.send}
        disabled={inactive} aria-label={label} title={label} onClick={onStop}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5.5M6 11l6-6 6 6" /></svg>
        <span className={styles.stop} aria-hidden="true" />
      </button>
    </div>
  </div>;
}
