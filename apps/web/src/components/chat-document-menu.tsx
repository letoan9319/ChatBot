"use client";

import { useEffect, useRef, useState } from "react";
import { subjects } from "@/core/validation";
import { SidebarIcon } from "./sidebar-icon";
import styles from "./study-workspace.module.css";

export function ChatDocumentMenu({ selected, canUpload, onChoose, onUpload }: {
  selected: number;
  canUpload: boolean;
  onChoose: () => void;
  onUpload: (file: File, subject: string) => Promise<void>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("calculus");
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
        onClick={() => fileInput.current?.click()}><SidebarIcon name="attach" /> Tải PDF hoặc DOCX lên</button>
      <label className={styles.menuField} htmlFor="chat-upload-subject">
        <span>Môn học</span>
        <select id="chat-upload-subject" value={subject} disabled={!canUpload} onChange={event => setSubject(event.target.value)}>
          {Object.entries(subjects).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
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
        void onUpload(file, subject);
      }} />
    </div>
  </details>;
}
