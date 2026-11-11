"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./notification-center.module.css";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  conversation_id: string | null;
  group_id: string | null;
  created_at: string;
  read_at: string | null;
};
type NotificationSnapshot = { items: Notification[]; unread: number };

async function readResponse(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "Không thể tải thông báo. Vui lòng thử lại.");
  }
  return result;
}

function notificationTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function NotificationCenter({ onOpenConversation, onOpenGroup }: {
  onOpenConversation: (id: string) => void;
  onOpenGroup: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const readController = useRef<AbortController | null>(null);
  const mutations = useRef(new Set<AbortController>());
  const requestVersion = useRef(0);
  const alive = useRef(false);
  const titleId = useId();
  const panelId = useId();

  const refresh = useCallback(async (replace = false) => {
    if (readController.current && !replace) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++requestVersion.current;
    try {
      const result = await readResponse(await fetch("/api/notifications", { cache: "no-store", signal: controller.signal }));
      if (!Array.isArray(result?.items) || !Number.isInteger(result.unread) || result.unread < 0) {
        throw new Error("Dữ liệu thông báo chưa hợp lệ. Vui lòng thử lại.");
      }
      if (!alive.current || version !== requestVersion.current) return;
      setSnapshot(result);
      setError("");
    } catch (failure) {
      if (!controller.signal.aborted && alive.current && version === requestVersion.current) {
        setError(failure instanceof Error ? failure.message : "Không thể tải thông báo. Vui lòng thử lại.");
      }
    } finally {
      if (readController.current === controller) readController.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    const onFocus = () => { void refresh(true); };
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      requestVersion.current += 1;
      readController.current?.abort();
      readController.current = null;
      for (const controller of mutations.current) controller.abort();
      mutations.current.clear();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    void refresh(true);
    function dismissOutside(event: Event) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function dismissEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open, refresh]);

  async function markRead(item?: Notification) {
    if (busy) return;
    const controller = new AbortController();
    mutations.current.add(controller);
    setBusy(item?.id ?? "all");
    try {
      if (!item?.read_at) {
        await readResponse(await fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item ? { id: item.id } : {}),
          signal: controller.signal,
        }));
      }
      if (!alive.current || controller.signal.aborted) return;
      requestVersion.current += 1;
      readController.current?.abort();
      readController.current = null;
      setSnapshot((current) => {
        if (!current) return current;
        const wasUnread = item ? current.items.some((entry) => entry.id === item.id && !entry.read_at) : false;
        return {
          items: current.items.map((entry) => !item || entry.id === item.id ? { ...entry, read_at: entry.read_at ?? new Date().toISOString() } : entry),
          unread: item ? Math.max(0, current.unread - (wasUnread ? 1 : 0)) : 0,
        };
      });
      setError("");
      if (item?.conversation_id || item?.group_id) {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
        if (item.conversation_id) onOpenConversation(item.conversation_id);
        else if (item.group_id) onOpenGroup(item.group_id);
      }
      void refresh(true);
    } catch (failure) {
      if (!controller.signal.aborted && alive.current) setError(failure instanceof Error ? failure.message : "Chưa thể đánh dấu đã đọc. Vui lòng thử lại.");
    } finally {
      mutations.current.delete(controller);
      if (alive.current && !controller.signal.aborted) setBusy(null);
    }
  }

  const unread = snapshot?.unread;
  return (
    <div className={styles.root} ref={root}>
      <button ref={trigger} type="button" className={styles.trigger}
        aria-label={`Thông báo${unread === undefined ? "" : unread > 0 ? `, ${unread} chưa đọc` : ", đã đọc tất cả"}`}
        title="Thông báo" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4" />
        </svg>
        {unread !== undefined && unread > 0 && <span className={styles.badge} aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && <div id={panelId} ref={panel} tabIndex={-1} role="dialog" aria-labelledby={titleId} className={styles.panel}>
        <header className={styles.heading}>
          <div><h2 id={titleId}>Thông báo</h2><p>{unread === undefined ? "Cập nhật từ việc học của bạn" : unread > 0 ? `${unread} thông báo chưa đọc` : "Bạn đã đọc tất cả thông báo"}</p></div>
          <button type="button" className={styles.close} aria-label="Đóng thông báo" onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>Đóng</button>
        </header>
        <div className={styles.actions}>
          <span>Hoạt động gần đây</span>
          <button type="button" disabled={busy !== null || !snapshot || snapshot.unread === 0} onClick={() => void markRead()}>
            {busy === "all" ? "Đang lưu..." : "Đánh dấu tất cả đã đọc"}
          </button>
        </div>
        {error && <div role="alert" className={styles.error}><p>{error}</p><button type="button" onClick={() => void refresh(true)}>Thử tải lại</button></div>}
        {!snapshot && !error && <p className={styles.empty} role="status">Đang tải thông báo...</p>}
        {snapshot && snapshot.items.length === 0 && <div className={styles.empty}><strong>Chưa có thông báo</strong><p>Các cập nhật về tài liệu, câu trả lời và nhóm học sẽ xuất hiện tại đây.</p></div>}
        {snapshot && snapshot.items.length > 0 && <ul className={styles.list}>
          {snapshot.items.map((item) => <li key={item.id} data-unread={!item.read_at}>
            <button type="button" className={styles.item} disabled={busy !== null} onClick={() => void markRead(item)}
              aria-label={`${item.title}${item.read_at ? "" : ", chưa đọc"}${item.conversation_id || item.group_id ? ", mở nội dung" : ", đánh dấu đã đọc"}`}>
              <span className={styles.marker} aria-hidden="true" />
              <span className={styles.itemBody}><strong>{item.title}</strong>{item.body && <span>{item.body}</span>}
                <small><time dateTime={item.created_at}>{notificationTime(item.created_at)}</time>{busy === item.id && " · Đang mở..."}{item.group_id && " · Nhóm học"}</small>
              </span>
            </button>
          </li>)}
        </ul>}
      </div>}
    </div>
  );
}
