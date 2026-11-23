"use client";

import { useEffect, useRef } from "react";
import { SidebarIcon } from "./sidebar-icon";
import styles from "./study-workspace.module.css";

export function ChatDocumentMenu({ selected, canUpload, onChoose, onUpload }: {
  selected: number;
  canUpload: boolean;
  onChoose: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return <details ref={menu} className={styles.documentMenu} onKeyDown={event => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
    event.stopPropagation();
  }}>
    <summary aria-label={`Tùy chọn tài liệu, đã chọn ${selected}/5`}>
      <SidebarIcon name="new" /><span>{selected > 0 ? selected : ""}</span>
    </summary>
    <div className={`${styles.actionPanel} ${styles.documentMenuPanel}`}>
      <button type="button" className={styles.menuAction} disabled={!canUpload}
        aria-label="Đính kèm PDF hoặc DOCX" title="Đính kèm PDF hoặc DOCX"
        onClick={() => fileInput.current?.click()}><SidebarIcon name="attach" /></button>
      <hr className={styles.menuDivider} />
      <button type="button" className={styles.menuAction} onClick={() => {
        if (menu.current) menu.current.open = false;
        onChoose();
      }}><SidebarIcon name="study" /> Chọn từ kho tài liệu <span className={styles.menuMeta}>{selected}/5</span></button>
      <input ref={fileInput} type="file" hidden accept=".pdf,.docx" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        if (menu.current) menu.current.open = false;
        void onUpload(file);
      }} />
    </div>
  </details>;
}
