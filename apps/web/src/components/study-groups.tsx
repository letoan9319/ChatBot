"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { subjects } from "@/core/validation";
import { Markdown } from "./markdown";
import { SelectField } from "./select-field";
import styles from "./study-groups.module.css";

type Subject = keyof typeof subjects;
type StudyGroup = {
  id: string;
  owner_id: string;
  subject: Subject;
  name: string;
  description: string;
  created_at: string;
  member_count: number;
  joined: boolean;
};
type GroupMessage = {
  id: string;
  group_id: string;
  user_id: string;
  username: string | null;
  content: string;
  created_at: string;
};
type MessageSnapshot = { groupId: string; items: GroupMessage[] | null };
type RetryKey = { signature: string; key: string };

class CommunityError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

async function responseData(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const text = result?.code === "GROUP_OWNER"
      ? "Bạn là người tạo nhóm nên chưa thể rời nhóm. Hãy tiếp tục quản lý nhóm của mình."
      : typeof result?.error === "string" ? result.error : "Không thể kết nối với nhóm học. Vui lòng thử lại.";
    throw new CommunityError(text, response.status, result?.code);
  }
  return result;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Không thể kết nối. Vui lòng thử lại.";
}

function messageTime(value: string, full = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN", full
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const subjectOptions = Object.entries(subjects).map(([value, label]) => ({ value, label }));
const filterOptions = [{ value: "", label: "Tất cả môn học" }, ...subjectOptions];

export function StudyGroups({ initialGroupId, onSelectGroup, username }: {
  initialGroupId?: string | null;
  onSelectGroup?: (id: string) => void;
  username?: string;
}) {
  const [subject, setSubject] = useState("");
  const [groupSnapshot, setGroupSnapshot] = useState<{ subject: string; items: StudyGroup[] } | null>(null);
  const [groupsError, setGroupsError] = useState("");
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [listRefresh, setListRefresh] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState<StudyGroup | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [mobileRoom, setMobileRoom] = useState(Boolean(initialGroupId));
  const [creating, setCreating] = useState(false);
  const [createSubject, setCreateSubject] = useState<Subject>("calculus");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [membershipBusy, setMembershipBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [messageSnapshot, setMessageSnapshot] = useState<MessageSnapshot | null>(null);
  const [messagesError, setMessagesError] = useState("");
  const [messageRefresh, setMessageRefresh] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedId = useRef<string | null>(initialGroupId ?? null);
  const initialId = useRef(initialGroupId);
  const createKey = useRef<RetryKey | null>(null);
  const messageKey = useRef<RetryKey | null>(null);
  const mutationControllers = useRef(new Set<AbortController>());
  const alive = useRef(false);
  const messageSnapshotRef = useRef<MessageSnapshot | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const formId = useId();
  const roomTitleId = useId();
  const activeGroupId = selectedGroup?.joined ? selectedGroup.id : null;
  const groups = groupSnapshot?.subject === subject ? groupSnapshot.items : null;
  const messages = activeGroupId && messageSnapshot?.groupId === activeGroupId ? messageSnapshot.items : null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of mutationControllers.current) controller.abort();
      mutationControllers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (initialId.current === initialGroupId) return;
    initialId.current = initialGroupId;
    if (!initialGroupId) return;
    selectedId.current = initialGroupId;
    setSelectedGroup((current) => current?.id === initialGroupId ? current : null);
    setUnavailable(false);
    setActionError("");
    setDraft("");
    setSubject("");
    setMobileRoom(true);
    nearBottom.current = true;
    setListRefresh((current) => current + 1);
  }, [initialGroupId]);

  useEffect(() => {
    let disposed = false;
    let version = 0;
    let controller: AbortController | null = null;
    setGroupsLoading(true);
    setGroupsError("");
    async function refresh(force = false) {
      if (controller && !force) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const request = ++version;
      try {
        const result = await responseData(await fetch(`/api/groups${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`, { cache: "no-store", signal: current.signal }));
        const items = Array.isArray(result) ? result : result?.items;
        if (!Array.isArray(items)) throw new Error("Danh sách nhóm chưa hợp lệ. Vui lòng thử lại.");
        if (disposed || request !== version) return;
        setGroupSnapshot({ subject, items });
        setGroupsError("");
        const selected = items.find((group: StudyGroup) => group.id === selectedId.current);
        if (selected) {
          setSelectedGroup(selected);
          setUnavailable(false);
        } else if (selectedId.current && !subject) {
          setSelectedGroup(null);
          setUnavailable(true);
        }
      } catch (error) {
        if (!disposed && !current.signal.aborted && request === version) setGroupsError(errorText(error));
      } finally {
        if (!disposed && request === version) setGroupsLoading(false);
        if (controller === current) controller = null;
      }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 20_000);
    const onFocus = () => { void refresh(true); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      version += 1;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [subject, listRefresh]);

  useEffect(() => {
    if (!activeGroupId) return;
    const groupId = activeGroupId;
    let disposed = false;
    let version = 0;
    let controller: AbortController | null = null;
    if (messageSnapshotRef.current?.groupId !== groupId) {
      const snapshot = { groupId, items: null };
      messageSnapshotRef.current = snapshot;
      setMessageSnapshot(snapshot);
      setMessagesError("");
      setHasNewMessages(false);
      nearBottom.current = true;
      anchor.current = null;
    }
    async function refresh(force = false) {
      if (controller && !force) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const request = ++version;
      try {
        const result = await responseData(await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages`, { cache: "no-store", signal: current.signal }));
        const items: GroupMessage[] = Array.isArray(result) ? result : result?.items;
        if (!Array.isArray(items)) throw new Error("Tin nhắn chưa hợp lệ. Vui lòng thử tải lại.");
        if (disposed || request !== version) return;
        const bounded = items.slice(-50);
        const previous = messageSnapshotRef.current;
        const lastId = previous?.groupId === groupId ? previous.items?.at(-1)?.id : undefined;
        if (lastId && bounded.at(-1)?.id !== lastId && !nearBottom.current) setHasNewMessages(true);
        if (!nearBottom.current && feed.current) {
          const containerTop = feed.current.getBoundingClientRect().top;
          const firstVisible = Array.from(feed.current.querySelectorAll<HTMLElement>("[data-message-id]"))
            .find((element) => element.getBoundingClientRect().bottom > containerTop);
          anchor.current = firstVisible ? { id: firstVisible.dataset.messageId!, top: firstVisible.getBoundingClientRect().top } : null;
        }
        const snapshot = { groupId, items: bounded };
        messageSnapshotRef.current = snapshot;
        setMessageSnapshot(snapshot);
        setMessagesError("");
      } catch (error) {
        if (disposed || current.signal.aborted || request !== version) return;
        if (error instanceof CommunityError && (error.status === 403 || error.status === 404)) {
          setSelectedGroup((group) => group?.id === groupId ? { ...group, joined: false } : group);
          const snapshot = { groupId, items: null };
          messageSnapshotRef.current = snapshot;
          setMessageSnapshot(snapshot);
          setActionError("Bạn chưa có quyền đọc tin nhắn của nhóm này. Hãy kiểm tra tư cách thành viên hoặc tải lại danh sách nhóm.");
        } else setMessagesError(errorText(error));
      } finally {
        if (controller === current) controller = null;
      }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 12_000);
    const onFocus = () => { void refresh(true); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      version += 1;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [activeGroupId, messageRefresh]);

  useLayoutEffect(() => {
    if (!feed.current || !messages) return;
    if (nearBottom.current) feed.current.scrollTop = feed.current.scrollHeight;
    else if (anchor.current) {
      const retained = Array.from(feed.current.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find((element) => element.dataset.messageId === anchor.current?.id);
      if (retained) feed.current.scrollTop += retained.getBoundingClientRect().top - anchor.current.top;
    }
    anchor.current = null;
  }, [messages]);

  function selectGroup(group: StudyGroup) {
    selectedId.current = group.id;
    setSelectedGroup(group);
    setUnavailable(false);
    setActionError("");
    setMessagesError("");
    setNotice("");
    setDraft("");
    setHasNewMessages(false);
    setMobileRoom(true);
    nearBottom.current = true;
    onSelectGroup?.(group.id);
  }

  function retryKey(ref: { current: RetryKey | null }, signature: string) {
    if (ref.current?.signature !== signature) ref.current = { signature, key: crypto.randomUUID() };
    return ref.current.key;
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingGroup) return;
    const cleanName = name.trim();
    const cleanDescription = description.trim();
    if (cleanName.length < 3 || cleanName.length > 80 || cleanDescription.length > 500) {
      setCreateError("Tên nhóm cần từ 3 đến 80 ký tự; giới thiệu tối đa 500 ký tự.");
      return;
    }
    const controller = new AbortController();
    mutationControllers.current.add(controller);
    setSavingGroup(true);
    setCreateError("");
    try {
      const signature = JSON.stringify([cleanName, createSubject, cleanDescription]);
      const result = await responseData(await fetch("/api/groups", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ name: cleanName, subject: createSubject, description: cleanDescription, key: retryKey(createKey, signature) }),
      }));
      if (!alive.current || controller.signal.aborted) return;
      const group = result?.group ?? result;
      if (!group?.id) throw new Error("Nhóm đã được gửi lên máy chủ nhưng chưa nhận được mã nhóm. Hãy tải lại danh sách trước khi tạo tiếp.");
      selectedId.current = group.id;
      setSelectedGroup({ ...group, subject: group.subject ?? createSubject, name: group.name ?? cleanName,
        description: group.description ?? cleanDescription, joined: true, member_count: group.member_count ?? 1 });
      setSubject("");
      setListRefresh((current) => current + 1);
      setName("");
      setDescription("");
      setDraft("");
      setCreating(false);
      setMobileRoom(true);
      setUnavailable(false);
      setActionError("");
      setNotice("Đã tạo nhóm học. Bạn có thể bắt đầu cuộc trao đổi đầu tiên.");
      createKey.current = null;
      nearBottom.current = true;
      onSelectGroup?.(group.id);
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setCreateError(errorText(error));
    } finally {
      mutationControllers.current.delete(controller);
      if (alive.current && !controller.signal.aborted) setSavingGroup(false);
    }
  }

  async function changeMembership(join: boolean) {
    if (!selectedGroup || membershipBusy) return;
    const group = selectedGroup;
    const controller = new AbortController();
    mutationControllers.current.add(controller);
    setMembershipBusy(group.id);
    setActionError("");
    setNotice("");
    try {
      await responseData(await fetch(`/api/groups/${encodeURIComponent(group.id)}/${join ? "join" : "leave"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
      }));
      if (!alive.current || controller.signal.aborted) return;
      setSelectedGroup((current) => current?.id === group.id ? { ...current, joined: join,
        member_count: Math.max(0, current.member_count + (current.joined === join ? 0 : join ? 1 : -1)) } : current);
      setListRefresh((current) => current + 1);
      if (selectedId.current === group.id) {
        setNotice(join ? "Đã tham gia nhóm. Chào mừng bạn đến với cuộc trao đổi." : "Bạn đã rời nhóm học này.");
        setDraft("");
        if (!join) {
          const snapshot = { groupId: group.id, items: null };
          messageSnapshotRef.current = snapshot;
          setMessageSnapshot(snapshot);
        }
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted && selectedId.current === group.id) setActionError(errorText(error));
    } finally {
      mutationControllers.current.delete(controller);
      if (alive.current && !controller.signal.aborted) setMembershipBusy(null);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup?.joined || sending) return;
    const groupId = selectedGroup.id;
    const originalDraft = draft;
    const content = draft.trim();
    if (!content || content.length > 2000) return;
    const controller = new AbortController();
    mutationControllers.current.add(controller);
    setSending(true);
    setActionError("");
    setNotice("");
    try {
      await responseData(await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ content, key: retryKey(messageKey, JSON.stringify([groupId, content])) }),
      }));
      if (!alive.current || controller.signal.aborted) return;
      if (selectedId.current === groupId) {
        setDraft((current) => current === originalDraft ? "" : current);
        nearBottom.current = true;
        setHasNewMessages(false);
        setMessageRefresh((current) => current + 1);
        composer.current?.focus({ preventScroll: true });
      }
      messageKey.current = null;
    } catch (error) {
      if (!alive.current || controller.signal.aborted || selectedId.current !== groupId) return;
      setActionError(errorText(error));
      if (error instanceof CommunityError && error.status === 403) {
        setSelectedGroup((current) => current?.id === groupId ? { ...current, joined: false } : current);
        const snapshot = { groupId, items: null };
        messageSnapshotRef.current = snapshot;
        setMessageSnapshot(snapshot);
      }
    } finally {
      mutationControllers.current.delete(controller);
      if (alive.current && !controller.signal.aborted) setSending(false);
    }
  }

  return (
    <section className={styles.groups} data-mobile-room={mobileRoom} aria-label="Cộng đồng học tập">
      <aside className={styles.library} aria-label="Danh sách nhóm học">
        <header className={styles.libraryHeading}>
          <div><p>CỘNG ĐỒNG</p><h2>Học cùng nhau</h2></div>
          <button type="button" className={styles.createToggle} aria-expanded={creating} aria-controls={`${formId}-create`}
            onClick={() => { setCreating((current) => !current); setCreateError(""); }}>Tạo nhóm</button>
        </header>
        <div className={styles.libraryScroll}>
          {creating && <form id={`${formId}-create`} className={styles.createForm} onSubmit={createGroup}>
            <h3>Một góc học tập mới</h3>
            <p>Cùng ôn bài và trao đổi với bạn học theo môn.</p>
            <label htmlFor={`${formId}-name`}>Tên nhóm</label>
            <input id={`${formId}-name`} value={name} onChange={(event) => setName(event.target.value)} required minLength={3} maxLength={80}
              placeholder="Ví dụ: Cùng chinh phục Giải tích" disabled={savingGroup} autoComplete="off" />
            <label htmlFor={`${formId}-subject`}>Môn học</label>
            <SelectField id={`${formId}-subject`} label="Môn học của nhóm mới" value={createSubject} options={subjectOptions}
              onChange={(value) => setCreateSubject(value as Subject)} disabled={savingGroup} />
            <label htmlFor={`${formId}-description`}>Giới thiệu <span>(không bắt buộc)</span></label>
            <textarea id={`${formId}-description`} rows={3} value={description} onChange={(event) => setDescription(event.target.value)}
              maxLength={500} placeholder="Nhóm của bạn sẽ cùng học điều gì?" disabled={savingGroup} />
            <span className={styles.fieldHint}>{description.length}/500 ký tự</span>
            {createError && <p role="alert" className={styles.formError}>{createError}</p>}
            <div className={styles.formActions}><button type="button" disabled={savingGroup} className={styles.secondaryButton} onClick={() => setCreating(false)}>Để sau</button>
              <button type="submit" className={styles.primaryButton} disabled={savingGroup || name.trim().length < 3}>{savingGroup ? "Đang tạo..." : "Tạo nhóm học"}</button></div>
          </form>}
          <div className={styles.filter}>
            <SelectField label="Lọc nhóm theo môn học" value={subject} options={filterOptions} onChange={setSubject} />
            <div className={styles.listHeading}><span>{subject ? subjects[subject as Subject] : "Khám phá nhóm học"}</span>
              <button type="button" disabled={groupsLoading} onClick={() => setListRefresh((current) => current + 1)}>{groupsLoading ? "Đang tải..." : "Làm mới"}</button></div>
          </div>
          {groupsError && <div role="alert" className={styles.listError}><p>{groupsError}</p><button type="button" onClick={() => setListRefresh((current) => current + 1)}>Thử lại</button></div>}
          {groups === null && !groupsError && <p role="status" className={styles.listEmpty}>Đang tìm các nhóm học...</p>}
          {groups?.length === 0 && <div className={styles.listEmpty}><strong>Chưa có nhóm cho môn học này</strong><p>Hãy tạo nhóm đầu tiên và bắt đầu trao đổi cùng bạn học.</p></div>}
          {groups && groups.length > 0 && <ul className={styles.groupList}>
            {groups.map((group) => <li key={group.id}><button type="button" className={styles.groupCard} aria-pressed={selectedGroup?.id === group.id}
              onClick={() => selectGroup(group)}>
              <span className={styles.groupCardTop}><span className={styles.subjectTag}>{subjects[group.subject] ?? group.subject}</span>{group.joined && <span className={styles.joinedTag}>Đã tham gia</span>}</span>
              <strong>{group.name}</strong>
              {group.description && <p>{group.description}</p>}
              <span className={styles.groupCardBottom}>{group.member_count} thành viên<span>{selectedGroup?.id === group.id ? "Đang xem" : "Xem nhóm"}</span></span>
            </button></li>)}
          </ul>}
          <p className={styles.communityNote}>Một câu hỏi hay có thể giúp cả nhóm tiến bộ. Hãy giữ cuộc trao đổi cởi mở và tôn trọng nhau.</p>
        </div>
      </aside>
      <section className={styles.room} aria-labelledby={roomTitleId}>
        {selectedGroup ? <>
          <header className={styles.roomHeading}>
            <button type="button" className={styles.backButton} onClick={() => setMobileRoom(false)}>Danh sách nhóm</button>
            <div className={styles.roomIdentity}><span className={styles.subjectTag}>{subjects[selectedGroup.subject] ?? selectedGroup.subject}</span>
              <h2 id={roomTitleId}>{selectedGroup.name}</h2><p>{selectedGroup.member_count} thành viên<span> · </span>{selectedGroup.joined ? "Bạn đã tham gia nhóm" : "Nhóm mở để khám phá"}</p></div>
            {selectedGroup.joined && <button type="button" className={styles.leaveButton} disabled={membershipBusy !== null}
              onClick={() => void changeMembership(false)}>{membershipBusy === selectedGroup.id ? "Đang lưu..." : "Rời nhóm"}</button>}
          </header>
          {selectedGroup.description && <p className={styles.roomDescription}>{selectedGroup.description}</p>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
          {actionError && <div className={styles.actionError} role="alert"><p>{actionError}</p><button type="button" onClick={() => setListRefresh((current) => current + 1)}>Tải lại nhóm</button></div>}
          {selectedGroup.joined ? <>
            <div className={styles.feedWrapper}>
              <div ref={feed} className={styles.feed} role="log" aria-label="Tin nhắn trong nhóm" aria-live="off"
                onScroll={() => { const element = feed.current; if (!element) return; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; if (nearBottom.current) setHasNewMessages(false); }}>
                {messagesError && <div className={styles.messageError} role="alert"><p>{messagesError}</p><button type="button" onClick={() => setMessageRefresh((current) => current + 1)}>Tải lại tin nhắn</button></div>}
                {messages === null && !messagesError && <p role="status" className={styles.loadingMessages}>Đang tải cuộc trao đổi...</p>}
                {messages?.length === 0 && <div className={styles.conversationEmpty}><span aria-hidden="true" className={styles.emptyMonogram}>NH</span><h3>Cuộc trao đổi bắt đầu từ bạn</h3><p>Chia sẻ một câu hỏi, một cách giải hay hoặc mục tiêu ôn tập hôm nay với cả nhóm.</p></div>}
                {messages && messages.length > 0 && <>
                  <p className={styles.historyNote}>{messages.length >= 50 ? "50 tin nhắn gần nhất trong nhóm" : "Cùng chia sẻ để hiểu bài sâu hơn"}</p>
                  <ol className={styles.messageList}>
                    {messages.map((message) => <li key={message.id} data-message-id={message.id} className={styles.message}>
                      <span className={styles.memberAvatar} aria-hidden="true">{(message.username ?? "").trim().slice(0, 1).toLocaleUpperCase("vi-VN") || "B"}</span>
                      <div className={styles.messageMain}><div className={styles.messageMeta}><strong>{message.username || "Bạn học"}</strong><time dateTime={message.created_at} title={messageTime(message.created_at, true)}>{messageTime(message.created_at)}</time></div>
                        <div className={styles.bubble}><Markdown content={message.content} /></div></div>
                    </li>)}
                  </ol>
                </>}
              </div>
              {hasNewMessages && <button type="button" className={styles.jumpButton} onClick={() => { nearBottom.current = true; setHasNewMessages(false); if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }}>Có tin nhắn mới · Xem mới nhất</button>}
            </div>
            <form className={styles.composer} onSubmit={sendMessage}>
              <label className={styles.composerLabel} htmlFor={`${formId}-message`}>Gửi tin nhắn cho nhóm</label>
              <div className={styles.composerRow}><textarea id={`${formId}-message`} ref={composer} value={draft} maxLength={2000} rows={2}
                placeholder="Câu hỏi hôm nay của bạn là gì?" onChange={(event) => setDraft(event.target.value)}
                aria-describedby={`${formId}-message-hint`} disabled={sending}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                <button type="submit" className={styles.sendButton} disabled={sending || !draft.trim()}>{sending ? "Đang gửi..." : "Gửi tin"}</button></div>
              <div className={styles.composerHint} id={`${formId}-message-hint`}><span>{username ? `${username} · ` : ""}Ctrl + Enter để gửi</span><span>{draft.length}/2000</span></div>
            </form>
          </> : <div className={styles.membershipGate}>
            <span className={styles.emptyMonogram} aria-hidden="true">NH</span><span className={styles.eyebrow}>GẶP NHỮNG NGƯỜI CÙNG HỌC</span>
            <h3>Thêm một góc nhìn, hiểu bài thêm một chút</h3><p>Tham gia nhóm để đọc và gửi tin nhắn, cùng đặt câu hỏi và chia sẻ cách giải theo môn học.</p>
            <button type="button" className={styles.primaryButton} disabled={membershipBusy !== null} onClick={() => void changeMembership(true)}>{membershipBusy === selectedGroup.id ? "Đang tham gia..." : "Tham gia nhóm học"}</button>
            <small>Tài liệu và cuộc trò chuyện riêng của bạn không được chia sẻ vào nhóm.</small>
          </div>}
        </> : <div className={styles.welcome}>
          <button type="button" className={styles.backButton} onClick={() => setMobileRoom(false)}>Danh sách nhóm</button>
          <span className={styles.emptyMonogram} aria-hidden="true">NH</span><span className={styles.eyebrow}>MỖI NGÀY, CÙNG TIẾN BỘ</span>
          <h2 id={roomTitleId}>{unavailable ? "Chưa tìm thấy nhóm học này" : "Bài khó cũng dễ hơn khi có bạn học"}</h2>
          <p>{unavailable ? "Nhóm không có trong danh sách hiện tại. Hãy tải lại danh sách hoặc chọn một nhóm khác để tiếp tục." : "Chọn một nhóm theo môn để cùng đặt câu hỏi, chia sẻ cách giải và giữ nhịp học tập mỗi ngày."}</p>
          {unavailable ? <button type="button" className={styles.primaryButton} onClick={() => { setSubject(""); setListRefresh((current) => current + 1); }}>Tải lại danh sách nhóm</button>
            : <button type="button" className={styles.primaryButton} onClick={() => { setMobileRoom(false); setCreating(true); }}>Tạo nhóm học của bạn</button>}
          <div className={styles.welcomeSubjects}>{subjectOptions.map((option) => <button type="button" key={option.value} onClick={() => { setSubject(option.value); setMobileRoom(false); }}>{option.label}</button>)}</div>
        </div>}
      </section>
    </section>
  );
}
