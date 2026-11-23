// Lucian UX/UI Prompt #470 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#470
import type { ReactNode } from "react";
import styles from "./document-repository.module.css";

export function DocumentListRow({ type, selected, details, actions, children }: {
  type: string;
  selected: boolean;
  details?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return <li className={styles.row} data-selected={selected}>
    <div className={styles.rowMain}>
      <span className={styles.fileType} data-type={type}>{type.toUpperCase()}</span>
      <div className={styles.rowText}>{children}</div>
      <div className={styles.actions}>{actions}</div>
    </div>
    {details}
  </li>;
}
