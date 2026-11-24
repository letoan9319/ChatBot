// Lucian UX/UI Prompt #452 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#452
import type { ReactNode } from "react";
import { PixelNavigationIcon } from "./sidebar-icon";
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
        <PixelNavigationIcon name="send" className={styles.sendIcon} />
        <span className={styles.stop} aria-hidden="true" />
      </button>
    </div>
  </div>;
}
