"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { StudyStreak } from "@/core/types";
import { ThemeToggle } from "./theme-provider";
import { StreakFlame, StudyStreakCard } from "./study-streak";
import { NotificationCenter } from "./notification-center";
import styles from "./study-workspace.module.css";

type Panel = "streak" | "status" | "account";

export function StudyToolbar({ username, canManageKnowledge, online, loading, provider, streak, streakError, title, subtitle, showStreak = true, onSignOut, onOpenConversation, onOpenGroup }: {
  username: string;
  canManageKnowledge: boolean;
  online: boolean;
  loading: boolean;
  provider: string | null;
  streak: StudyStreak | null;
  streakError: string;
  title: string;
  subtitle: string;
  showStreak?: boolean;
  onSignOut: () => Promise<void>;
  onOpenConversation: (id: string) => void;
  onOpenGroup: (id: string) => void;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const header = useRef<HTMLElement>(null);
  const status = loading ? "Đang kết nối" : online ? "AI sẵn sàng" : "AI tạm dừng";

  useEffect(() => {
    if (!panel) return;
    const closeOutside = (event: Event) => {
      if (!header.current?.contains(event.target as Node)) setPanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanel(null);
      document.getElementById(`toolbar-${panel}`)?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel]);

  function toggle(next: Panel) {
    setPanel((current) => current === next ? null : next);
  }

  return (
    <header className={styles.topbar} ref={header}>
      <div className={styles.pageHeading}><h1>{title}</h1><p>{subtitle}</p></div>
      <div className={styles.toolbarActions}>
        <button className={styles.statusButton} id="toolbar-status"
          aria-label={`Trạng thái trợ giảng: ${status}`} aria-expanded={panel === "status"}
          aria-controls="toolbar-status-panel" onClick={() => toggle("status")}>
          <span className={styles.statusDot} data-online={online && !loading} aria-hidden="true" />
          <span className={styles.statusLabel}>{status}</span>
          <span className={styles.statusShort} aria-hidden="true">AI</span>
        </button>
        {showStreak && <button className={styles.streakButton} id="toolbar-streak"
          aria-label={streak && !streakError ? `Chuỗi ${streak.current} ngày học, xem chi tiết` : "Xem chuỗi ngày học"}
          aria-expanded={panel === "streak"} aria-controls="toolbar-streak-panel"
          onClick={() => toggle("streak")}>
          <span className={styles.toolbarFlame}>{streak && !streakError && <StreakFlame days={streak.current} compact />}</span>
          <strong>{streak && !streakError ? streak.current : "…"}</strong>
          <span className={styles.streakUnit}>ngày</span>
        </button>}
        <NotificationCenter onOpenConversation={onOpenConversation} onOpenGroup={onOpenGroup} />
        <ThemeToggle />
        <button className={styles.accountButton} id="toolbar-account"
          aria-label={`Tài khoản ${username}`} aria-expanded={panel === "account"}
          aria-controls="toolbar-account-panel" onClick={() => toggle("account")}>
          <span className={styles.avatar} aria-hidden="true">{username.slice(0, 2).toUpperCase()}</span>
          <span className={styles.accountName}>{username}</span>
        </button>
      </div>
      <div id="toolbar-streak-panel" className={`${styles.popover} ${styles.streakPopover}`} hidden={panel !== "streak"}>
        <StudyStreakCard data={streak} error={streakError} />
      </div>
      <section id="toolbar-status-panel" className={styles.popover} hidden={panel !== "status"} aria-label="Trạng thái trợ giảng">
        <strong>{status}</strong>
        <p>{loading ? "Đang kiểm tra kết nối với trợ giảng."
          : online ? "Bạn có thể tải tài liệu và đặt câu hỏi."
            : "Máy xử lý AI chưa kết nối. Bạn vẫn có thể xem lại hội thoại. Tài liệu và câu hỏi đang chờ sẽ tiếp tục khi máy hoạt động."}</p>
        {provider === "openrouter" && <p>AI sử dụng OpenRouter/NVIDIA. Câu hỏi và các đoạn tài liệu cần xử lý được gửi đến dịch vụ này.
          Tài liệu và lịch sử vẫn được lưu trong tài khoản của bạn. Chỉ dùng tài liệu thử nghiệm không chứa thông tin nhạy cảm.</p>}
        {provider === "ollama_with_openrouter_fallback" && <p>AI ưu tiên model cục bộ. Khi model không khả dụng, câu hỏi,
          lịch sử gần đây và các đoạn nguồn sẽ được gửi qua OpenRouter/NVIDIA để trả lời.
          Chỉ dùng tài liệu thử nghiệm không chứa thông tin nhạy cảm.</p>}
      </section>
      <section id="toolbar-account-panel" className={styles.popover} hidden={panel !== "account"} aria-label="Tài khoản">
        <strong>{username}</strong>
        <p>Góc học tập và tài liệu riêng của bạn.</p>
        {canManageKnowledge && <p><Link href="/admin/knowledge" prefetch={false}>Quản lý tài liệu chung</Link></p>}
        <button className={styles.quietButton} disabled={signingOut} onClick={async () => {
          setSigningOut(true);
          try { await onSignOut(); } finally { setSigningOut(false); }
        }}>{signingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button>
      </section>
    </header>
  );
}
