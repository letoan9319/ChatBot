"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import type { FormEvent } from "react";
import { groupReactionOptions, type GroupReaction, type GroupReactionSummary } from "@/core/group-reactions";
import { PixelNavigationIcon, SidebarIcon } from "./sidebar-icon";
import { normalizeSearch } from "@/core/document-catalog";
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
  owned?: boolean;
};
type GroupMessage = {
  id: string;
  group_id: string;
  user_id: string;
  username: string | null;
  content: string;
  has_image?: boolean;
  reactions?: GroupReactionSummary[];
  created_at: string;
};
const groupEmojis = [0x1f600, 0x1f602, 0x1f914, 0x1f44d, 0x1f64c, 0x2764, 0x1f4da, 0x1f389];
type MessageSnapshot = { groupId: string; items: GroupMessage[] | null };
type RetryKey = { signature: string; key: string };
type GroupRoster = {
  can_edit: boolean;
  members: Array<{ id: string; username: string; is_owner: boolean }>;
};

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

function GroupMembers({ group, onSaved }: { group: StudyGroup; onSaved: (group: StudyGroup) => void }) {
  const [roster, setRoster] = useState<GroupRoster | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch(`/api/groups/${group.id}/members`, { cache: "no-store", signal: controller.signal })
      .then(responseData)
      .then((value) => {
        if (!Array.isArray(value?.members)) throw new Error("Danh sách thành viên chưa sẵn sàng.");
        if (!controller.signal.aborted) setRoster(value);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [group.id, group.member_count, retry]);

  useEffect(() => () => pending.current?.abort(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const updated = await responseData(await fetch(`/api/groups/${group.id}/settings`, {
        method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(fields.get("name")).trim(), description: String(fields.get("description")).trim() }),
      }));
      if (!controller.signal.aborted) { onSaved(updated); setEditing(false); }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorText(error));
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <section className={styles.membersPanel} aria-label="Thành viên và thông tin nhóm">
    {error && <p role="alert">{error}</p>}
    {!roster && (error
      ? <button type="button" className={styles.leaveButton} onClick={() => setRetry(retry + 1)}>Thử lại</button>
      : <p role="status">Đang tải thành viên…</p>)}
    {roster && <>
      <ul className={styles.memberList}>{roster.members.map((member) =>
        <li key={member.id}><strong>{member.username}</strong>{member.is_owner && <span className={styles.subjectTag}>Chủ nhóm</span>}</li>
      )}</ul>
      {roster.can_edit && !editing && <button type="button" className={styles.leaveButton}
        onClick={() => setEditing(true)}>Sửa thông tin nhóm</button>}
      {editing && <form className={styles.createForm} onSubmit={save}>
        <label htmlFor={`${id}-name`}>Tên nhóm</label>
        <input id={`${id}-name`} name="name" defaultValue={group.name} minLength={3} maxLength={80} required disabled={saving} />
        <label htmlFor={`${id}-description`}>Giới thiệu</label>
        <textarea id={`${id}-description`} name="description" defaultValue={group.description} maxLength={500} disabled={saving} />
        <div className={styles.formActions}>
          <button type="button" className={styles.secondaryButton} disabled={saving} onClick={() => { setEditing(false); setError(""); }}>Hủy</button>
          <button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>
        </div>
      </form>}
    </>}
  </section>;
}

export function StudyGroups({ initialGroupId, onSelectGroup, username }: {
  initialGroupId?: string | null;
  onSelectGroup?: (id: string) => void;
  username?: string;
}) {
  const [subject, setSubject] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [memberRoom, setMemberRoom] = useState<string | null>(null);
  const [messageSearch, setMessageSearch] = useState<{ room: string; query: string } | null>(null);
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
  const [image, setImage] = useState<File | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactionMenu, setReactionMenu] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  const reactionPending = useRef(false);
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
  const imagePicker = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const formId = useId();
  const roomTitleId = useId();
  const activeGroupId = selectedGroup?.joined ? selectedGroup.id : null;
  const groups = groupSnapshot?.subject === subject ? groupSnapshot.items : null;
  const messages = activeGroupId && messageSnapshot?.groupId === activeGroupId ? messageSnapshot.items : null;
  const groupTerm = normalizeSearch(groupQuery);
  const visibleGroups = groups?.filter((group) => (!joinedOnly || group.joined) &&
    (!groupTerm || normalizeSearch(`${group.name} ${group.description}`).includes(groupTerm)));
  const showMembers = Boolean(activeGroupId && memberRoom === activeGroupId);
  const messageQuery = messageSearch?.room === activeGroupId ? messageSearch?.query ?? "" : "";
  const messageTerm = normalizeSearch(messageQuery);
  const visibleMessages = messageTerm ? messages?.filter((message) =>
    normalizeSearch(`${message.username ?? ""} ${message.content}`).includes(messageTerm)) : messages;

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
    setImage(null);
    setEmojiOpen(false);
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
    setImage(null);
    setEmojiOpen(false);
    setReactionMenu(null);
    setMemberRoom(null);
    setMessageSearch(null);
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
        description: group.description ?? cleanDescription, joined: true, owned: true, member_count: group.member_count ?? 1 });
      setSubject("");
      setListRefresh((current) => current + 1);
      setName("");
      setDescription("");
      setDraft("");
      setImage(null);
      setEmojiOpen(false);
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
        setImage(null);
        setEmojiOpen(false);
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

  async function reactToMessage(message: GroupMessage, reaction: GroupReaction) {
    if (selectedId.current !== message.group_id || reactionPending.current) return;
    const desired = message.reactions?.some((item) => item.reaction === reaction && item.reacted) ? null : reaction;
    reactionPending.current = true;
    setReacting(true);
    setActionError("");
    const controller = new AbortController();
    mutationControllers.current.add(controller);
    try {
      const reactions: GroupReactionSummary[] = await responseData(await fetch(
        `/api/groups/${message.group_id}/messages/${message.id}/reaction`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction: desired }), signal: controller.signal },
      ));
      if (!alive.current || controller.signal.aborted || selectedId.current !== message.group_id) return;
      const current = messageSnapshotRef.current;
      if (current?.groupId === message.group_id && current.items) {
        const next = { ...current, items: current.items.map((item) =>
          item.id === message.id ? { ...item, reactions } : item) };
        messageSnapshotRef.current = next;
        setMessageSnapshot(next);
      }
      setReactionMenu(null);
      setMessageRefresh((value) => value + 1);
    } catch (error) {
      if (alive.current && !controller.signal.aborted && selectedId.current === message.group_id) {
        setActionError(errorText(error));
      }
    } finally {
      mutationControllers.current.delete(controller);
      reactionPending.current = false;
      if (alive.current) setReacting(false);
    }
  }

  function attachImage(file: File) {
    if (sending) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 524288 || file.size < 12) {
      setActionError("Chọn ảnh PNG, JPEG hoặc WebP tối đa 512 KB.");
      return;
    }
    setActionError("");
    setImage(file);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup?.joined || sending) return;
    const groupId = selectedGroup.id;
    const originalDraft = draft;
    const content = draft.trim();
    if ((!content && !image) || content.length > 2000) return;
    const controller = new AbortController();
    mutationControllers.current.add(controller);
    setSending(true);
    setActionError("");
    setNotice("");
    try {
      let attachment: { image: string; mime: string } | undefined;
      if (image) {
        const bytes = new Uint8Array(await image.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        attachment = { image: btoa(binary), mime: image.type };
      }
      if (controller.signal.aborted || selectedId.current !== groupId) return;
      const endpoint = attachment ? "images" : "messages";
      await responseData(await fetch(`/api/groups/${encodeURIComponent(groupId)}/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ content, ...attachment, key: retryKey(messageKey, JSON.stringify([groupId, content, attachment])) }),
      }));
      if (!alive.current || controller.signal.aborted) return;
      if (selectedId.current === groupId) {
        setDraft((current) => current === originalDraft ? "" : current);
        setImage(null);
        setEmojiOpen(false);
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
          <div className={styles.groupBrand}><PixelNavigationIcon name="groups" className={styles.pixel} /><h2>Nhóm học</h2></div>
          <button type="button" className={styles.createToggle} aria-expanded={creating} aria-controls={`${formId}-create`}
            onClick={() => { setCreating((current) => !current); setCreateError(""); }}>
            <PixelNavigationIcon name="new" className={styles.pixel} /> Tạo nhóm
          </button>
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
            <label className={styles.groupSearch}>
              <PixelNavigationIcon name="search" className={styles.pixel} />
              <span className="sr-only">Tìm nhóm theo tên hoặc giới thiệu</span>
              <input type="search" placeholder="Tìm nhóm học…" value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} />
            </label>
            <SelectField label="Lọc nhóm theo môn học" value={subject} options={filterOptions} onChange={setSubject} />
            <label className={styles.joinedFilter}>
              <input type="checkbox" checked={joinedOnly} onChange={(event) => setJoinedOnly(event.target.checked)} />
              Chỉ nhóm đã tham gia
            </label>
            <div className={styles.listHeading}><span>{subject ? subjects[subject as Subject] : "Khám phá nhóm học"}</span>
              <button type="button" disabled={groupsLoading} onClick={() => setListRefresh((current) => current + 1)}>{groupsLoading ? "Đang tải..." : "Làm mới"}</button></div>
          </div>
          {groupsError && <div role="alert" className={styles.listError}><p>{groupsError}</p><button type="button" onClick={() => setListRefresh((current) => current + 1)}>Thử lại</button></div>}
          {groups === null && !groupsError && <p role="status" className={styles.listEmpty}>Đang tìm các nhóm học...</p>}
          {groups?.length === 0 && <div className={styles.listEmpty}><strong>Chưa có nhóm cho môn học này</strong><p>Hãy tạo nhóm đầu tiên và bắt đầu trao đổi cùng bạn học.</p></div>}
          {Boolean(groups?.length) && visibleGroups?.length === 0 && <p role="status" className={styles.listEmpty}>Không tìm thấy nhóm phù hợp.</p>}
          {visibleGroups && visibleGroups.length > 0 && <ul className={styles.groupList}>
            {visibleGroups.map((group) => <li key={group.id}><button type="button" className={styles.groupCard} aria-pressed={selectedGroup?.id === group.id}
              onClick={() => selectGroup(group)}>
              <span className={styles.groupCardTop}><span className={styles.subjectTag}>{subjects[group.subject] ?? group.subject}</span>{group.joined && <span className={styles.joinedTag}>{group.owned ? "Chủ nhóm" : "Đã tham gia"}</span>}</span>
              <strong>{group.name}</strong>
              {group.description && <p>{group.description}</p>}
              <span className={styles.groupCardBottom}>{group.member_count} thành viên<span>{selectedGroup?.id === group.id ? "Đang xem" : "Xem nhóm"}</span></span>
            </button></li>)}
          </ul>}
        </div>
      </aside>
      <section className={styles.room} aria-labelledby={roomTitleId}>
        {selectedGroup ? <>
          <header className={styles.roomHeading}>
            <button type="button" className={styles.backButton} onClick={() => setMobileRoom(false)}>Danh sách nhóm</button>
            <div className={styles.roomIdentity}><span className={styles.subjectTag}>{subjects[selectedGroup.subject] ?? selectedGroup.subject}</span>
              <h2 id={roomTitleId}>{selectedGroup.name}</h2><p>{selectedGroup.member_count} thành viên<span> · </span>{selectedGroup.owned ? "Bạn là chủ nhóm" : selectedGroup.joined ? "Bạn đã tham gia nhóm" : "Nhóm mở để khám phá"}</p></div>
            {selectedGroup.joined && <div className={styles.roomActions}>
              <button type="button" className={styles.leaveButton} aria-expanded={showMembers}
                onClick={() => setMemberRoom(showMembers ? null : selectedGroup.id)}>
                <PixelNavigationIcon name="groups" className={styles.pixel} /> Thành viên
              </button>
              {!selectedGroup.owned && <button type="button" className={styles.leaveButton} disabled={membershipBusy !== null}
                onClick={() => void changeMembership(false)}>{membershipBusy === selectedGroup.id ? "Đang lưu..." : "Rời nhóm"}</button>}
            </div>}
          </header>
          {selectedGroup.description && <p className={styles.roomDescription}>{selectedGroup.description}</p>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
          {actionError && <div className={styles.actionError} role="alert"><p>{actionError}</p><button type="button" onClick={() => setListRefresh((current) => current + 1)}>Tải lại nhóm</button></div>}
          {selectedGroup.joined ? <>
            {showMembers && <GroupMembers key={selectedGroup.id} group={selectedGroup} onSaved={(updated) => {
              setSelectedGroup((current) => current?.id === updated.id ? { ...current, ...updated } : current);
              setListRefresh((value) => value + 1);
              setNotice("Đã lưu thông tin nhóm.");
            }} />}
            <label className={`${styles.groupSearch} ${styles.messageSearch}`}>
              <PixelNavigationIcon name="search" className={styles.pixel} />
              <span className="sr-only">Tìm trong 50 tin nhắn gần nhất</span>
              <input type="search" placeholder="Tìm trong 50 tin nhắn gần nhất…" value={messageQuery}
                onChange={(event) => setMessageSearch({ room: selectedGroup.id, query: event.target.value })} />
            </label>
            <div className={styles.feedWrapper}>
              <div ref={feed} className={styles.feed} role="log" aria-label="Tin nhắn trong nhóm" aria-live="off"
                onScroll={() => { const element = feed.current; if (!element) return; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90; if (nearBottom.current) setHasNewMessages(false); }}>
                {messagesError && <div className={styles.messageError} role="alert"><p>{messagesError}</p><button type="button" onClick={() => setMessageRefresh((current) => current + 1)}>Tải lại tin nhắn</button></div>}
                {messages === null && !messagesError && <p role="status" className={styles.loadingMessages}>Đang tải cuộc trao đổi...</p>}
                {messages?.length === 0 && <div className={styles.conversationEmpty}><span aria-hidden="true" className={styles.emptyMonogram}>NH</span><h3>Cuộc trao đổi bắt đầu từ bạn</h3><p>Chia sẻ một câu hỏi, một cách giải hay hoặc mục tiêu ôn tập hôm nay với cả nhóm.</p></div>}
                {messageTerm && Boolean(messages?.length) && visibleMessages?.length === 0 &&
                  <p role="status" className={styles.loadingMessages}>Không tìm thấy tin nhắn phù hợp.</p>}
                {visibleMessages && visibleMessages.length > 0 && <>
                  {(messages?.length ?? 0) >= 50 && <p className={styles.historyNote}>50 tin nhắn gần nhất trong nhóm</p>}
                  <ol className={styles.messageList}>
                    {visibleMessages.map((message) => <li key={message.id} data-message-id={message.id} className={styles.message}>
                      <span className={styles.memberAvatar} aria-hidden="true">{(message.username ?? "").trim().slice(0, 1).toLocaleUpperCase("vi-VN") || "B"}</span>
                      <div className={styles.messageMain}><div className={styles.messageMeta}><strong>{message.username || "Bạn học"}</strong><time dateTime={message.created_at} title={messageTime(message.created_at, true)}>{messageTime(message.created_at)}</time></div>
                        <div className={styles.bubble}>
                          {message.has_image && (
                            // The session-protected endpoint streams the original attachment.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className={styles.groupImage} src={`/api/groups/${message.group_id}/images/${message.id}`}
                              alt="Ảnh đính kèm trong nhóm" loading="lazy" />
                          )}
                          {message.content && <Markdown content={message.content} />}
                        </div>
                        <div className={styles.reactionBar}>
                          {message.reactions?.map((item) => (
                            <button type="button" className={styles.reactionChip} key={item.reaction}
                              disabled={reacting} aria-pressed={item.reacted}
                              aria-label={`${groupReactionOptions[item.reaction].label}: ${item.count}`}
                              onClick={() => void reactToMessage(message, item.reaction)}>
                              {String.fromCodePoint(groupReactionOptions[item.reaction].code)} <span>{item.count}</span>
                            </button>
                          ))}
                          <button type="button" className={styles.reactionChip} aria-label="Thả cảm xúc"
                            title="Thả cảm xúc" disabled={reacting} aria-expanded={reactionMenu === message.id}
                            onClick={() => setReactionMenu((current) => current === message.id ? null : message.id)}>
                            <SidebarIcon name="smile" />
                          </button>
                        </div>
                        {reactionMenu === message.id && (
                          <div className={styles.reactionPicker} role="group" aria-label="Cảm xúc cho tin nhắn"
                            onKeyDown={(event) => { if (event.key === "Escape") setReactionMenu(null); }}>
                            {(Object.keys(groupReactionOptions) as GroupReaction[]).map((reaction) => {
                              const option = groupReactionOptions[reaction];
                              return <button type="button" className={styles.reactionChip} key={reaction}
                                title={option.label} aria-label={option.label} disabled={reacting}
                                aria-pressed={message.reactions?.some((item) => item.reaction === reaction && item.reacted) ?? false}
                                onClick={() => void reactToMessage(message, reaction)}>{String.fromCodePoint(option.code)}</button>;
                            })}
                          </div>
                        )}
                      </div>
                    </li>)}
                  </ol>
                </>}
              </div>
              {!messageTerm && hasNewMessages && <button type="button" className={styles.jumpButton} onClick={() => { nearBottom.current = true; setHasNewMessages(false); if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }}>Có tin nhắn mới · Xem mới nhất</button>}
            </div>
            <form className={styles.composer} onSubmit={sendMessage}>
              <label className={styles.composerLabel} htmlFor={`${formId}-message`}>Gửi tin nhắn cho nhóm</label>
              <div className={styles.composerRow}>
                <textarea id={`${formId}-message`} ref={composer} value={draft} maxLength={2000} rows={2}
                onChange={(event) => setDraft(event.target.value)}
                aria-describedby={`${formId}-message-hint`} disabled={sending}
                onPaste={(event) => {
                  const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
                  if (!file) return;
                  event.preventDefault();
                  attachImage(file);
                }}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                <div className={styles.composerBar}>
                  <div className={styles.attachmentTools}>
                    <button type="button" className={styles.attachmentButton} disabled={sending}
                      title="Đính kèm ảnh tối đa 512 KB" aria-label="Đính kèm ảnh"
                      onClick={() => imagePicker.current?.click()}><SidebarIcon name="attach" /></button>
                    <input ref={imagePicker} hidden type="file" accept="image/png,image/jpeg,image/webp" disabled={sending}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (file) attachImage(file);
                        }} />
                    <button type="button" className={styles.attachmentButton} aria-expanded={emojiOpen} disabled={sending}
                      title="Chọn emoji" aria-label="Chọn emoji"
                      onClick={() => setEmojiOpen((open) => !open)}><SidebarIcon name="smile" /></button>
                    {image && <button type="button" className={styles.clearAttachment} disabled={sending}
                      title={image.name} onClick={() => setImage(null)}>Bỏ ảnh: {image.name}</button>}
                  </div>
                  <button type="submit" className={styles.sendButton} disabled={sending || (!draft.trim() && !image)}>
                    <PixelNavigationIcon name="send" className={styles.pixel} /> {sending ? "Đang gửi..." : "Gửi tin"}
                  </button>
                </div>
                {emojiOpen && <div className={styles.attachmentTools} role="group" aria-label="Chọn emoji">
                  {groupEmojis.map((code) => {
                    const value = String.fromCodePoint(code);
                    return <button key={code} type="button" onClick={() => {
                      const field = composer.current;
                      const start = field?.selectionStart ?? draft.length;
                      const end = field?.selectionEnd ?? start;
                      const next = draft.slice(0, start) + value + draft.slice(end);
                      if (next.length > 2000) return;
                      setDraft(next);
                      setEmojiOpen(false);
                      requestAnimationFrame(() => {
                        field?.focus();
                        field?.setSelectionRange(start + value.length, start + value.length);
                      });
                    }}>{value}</button>;
                  })}
                </div>}
              </div>
              <div className={styles.composerHint} id={`${formId}-message-hint`}><span>{username ? `${username} · ` : ""}Dán ảnh vào ô chat · Ctrl + Enter để gửi</span><span>{draft.length}/2000</span></div>
            </form>
          </> : <div className={styles.membershipGate}>
            <span className={styles.emptyMonogram} aria-hidden="true">NH</span><span className={styles.eyebrow}>GẶP NHỮNG NGƯỜI CÙNG HỌC</span>
            <h3>Thêm một góc nhìn, hiểu bài thêm một chút</h3><p>Tham gia nhóm để đọc và gửi tin nhắn, cùng đặt câu hỏi và chia sẻ cách giải theo môn học.</p>
            <button type="button" className={styles.primaryButton} disabled={membershipBusy !== null} onClick={() => void changeMembership(true)}>{membershipBusy === selectedGroup.id ? "Đang tham gia..." : "Tham gia nhóm học"}</button>
            <small>Tài liệu và cuộc trò chuyện riêng của bạn không được chia sẻ vào nhóm.</small>
          </div>}
        </> : <div className={styles.welcome}>
          <button type="button" className={styles.backButton} onClick={() => setMobileRoom(false)}>Danh sách nhóm</button>
          <Image src="/illustrations/study-frog.webp" alt="" width={432} height={314}
            className={styles.welcomeArt} unoptimized />
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
