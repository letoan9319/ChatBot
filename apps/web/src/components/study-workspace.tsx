"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { browserClient } from "@/core/supabase-browser";
import { chatModes, MAX_FILE_SIZE, statuses, type ChatMode } from "@/core/validation";
import type {
  Conversation,
  Message,
  Source,
  SourceDetail,
  StudyDocument,
  StudyStreak,
} from "@/core/types";
import { Markdown } from "./markdown";
import { StudyToolbar } from "./study-toolbar";
import { StudyOverview } from "./study-overview";
import { Brand } from "./brand";
import { DocumentRepository } from "./document-repository";
import { SidebarIcon } from "./sidebar-icon";
import { ChatDocumentMenu } from "./chat-document-menu";
import { SelectField } from "./select-field";
import { StudySettings } from "./study-settings";
import { LearningPlans } from "./learning-plans";
import { StudyGroups } from "./study-groups";
import { useStudyPreferences } from "./use-study-preferences";
import { shouldSendQuestion } from "@/core/study-preferences";
import styles from "./study-workspace.module.css";

async function api<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  };
  let response: Response;
  try {
    response = await fetch(`/api/${url}`, options);
  } catch {
    response = await fetch(`/api/${url}`, options);
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Không thể kết nối. Vui lòng thử lại.");
  return result;
}
type WorkerStatus = {
  online: boolean;
  provider: "ollama" | "openrouter" | "ollama_with_openrouter_fallback" | null;
  activeChat: { id: string; conversation_id: string } | null;
};
const location = (source: Source) =>
  source.page
    ? `Trang ${source.page}`
    : [source.section, source.paragraph ? `Đoạn ${source.paragraph}` : ""]
        .filter(Boolean)
        .join(" · ");

export function StudyWorkspace({ username, canManageKnowledge, initialConversationId = null, initialLibrary = null }: {
  username: string;
  canManageKnowledge: boolean;
  initialConversationId?: string | null;
  initialLibrary?: "knowledge" | "documents" | null;
}) {
  const router = useRouter();
  const { preferences, updatePreferences, storageAvailable } = useStudyPreferences();
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [knowledge, setKnowledge] = useState<StudyDocument[]>([]);
  const [knowledgeError, setKnowledgeError] = useState("");
  const currentKnowledge = useRef(knowledge);
  currentKnowledge.current = knowledge;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [worker, setWorker] = useState<WorkerStatus>({
    online: false,
    provider: null,
    activeChat: null,
  });
  const [question, setQuestion] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("documents");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [view, setView] = useState<"overview" | "study" | "library" | "groups" | "settings" | "plans">(initialConversationId ? "study" : initialLibrary ? "library" : "overview");
  const [plansOpened, setPlansOpened] = useState(false);
  const [groupToOpen, setGroupToOpen] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streak, setStreak] = useState<StudyStreak | null>(null);
  const [streakError, setStreakError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [tab, setTab] = useState(initialLibrary && !initialConversationId ? "documents" : "chat");
  const [libraryView, setLibraryView] = useState<"knowledge" | "documents" | "history">(initialLibrary ?? "knowledge");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const restoreChatFocus = useRef(false);
  const currentConversation = useRef(conversationId);
  currentConversation.current = conversationId;
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const sourceRequest = useRef(0);
  const refreshRequest = useRef(0);
  const refreshInFlight = useRef<number | null>(null);
  const conversationEpoch = useRef(0);
  const sending = useRef(false);

  const refresh = useCallback(async (active?: { documents: boolean; chat: boolean }) => {
    if (active && refreshInFlight.current !== null) return;
    const requestId = ++refreshRequest.current;
    refreshInFlight.current = requestId;
    try {
      const [docs, convs, health, history, streakResult, knowledgeResult] = await Promise.allSettled([
        !active || active.documents ? api<StudyDocument[]>("documents") : null,
        !active ? api<Conversation[]>("conversations") : null,
        api<WorkerStatus>("status"),
        conversationId && (!active || active.chat) ? api<Message[]>(`conversations/${conversationId}/messages`) : null,
        !active ? api<StudyStreak>("streak") : null,
        !active ? api<StudyDocument[]>("knowledge") : null,
      ]);
      if (currentConversation.current !== conversationId || requestId !== refreshRequest.current) return;
      const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : "Không thể cập nhật dữ liệu.";
      if (docs.status === "fulfilled" && docs.value) {
        const readyDocuments = docs.value;
        const shared = knowledgeResult.status === "fulfilled" && knowledgeResult.value
          ? knowledgeResult.value : currentKnowledge.current;
        setDocuments(readyDocuments);
        setDataError("");
        setSelected(previous => previous.filter(id =>
          [...readyDocuments, ...shared].some(doc => doc.id === id && doc.status === "ready")));
      } else if (docs.status === "rejected") {
        setDataError(errorMessage(docs.reason));
      }
      if (convs.status === "fulfilled" && convs.value) setConversations(convs.value);
      if (health.status === "fulfilled") setWorker(health.value);
      else setWorker({ online: false, provider: null, activeChat: null });
      if (history.status === "fulfilled" && history.value) setMessages(history.value);
      if (streakResult.status === "fulfilled" && streakResult.value) {
        setStreak(streakResult.value);
        setStreakError("");
      } else if (streakResult.status === "rejected") {
        setStreakError(errorMessage(streakResult.reason));
      }
      if (knowledgeResult.status === "fulfilled" && knowledgeResult.value) {
        setKnowledge(knowledgeResult.value);
        setKnowledgeError("");
      } else if (knowledgeResult.status === "rejected") {
        setKnowledgeError(errorMessage(knowledgeResult.reason));
      }
      const failure = [health, history, convs].find(result => result.status === "rejected");
      if (failure?.status === "rejected" && !active) setNotice(errorMessage(failure.reason));
      setLoading(false);
    } finally {
      if (refreshInFlight.current === requestId) refreshInFlight.current = null;
    }
  }, [conversationId]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;

  const pendingDocuments = uploading || documents.some(doc => ["queued", "processing", "deleting"].includes(doc.status));
  const pendingChat = busy || Boolean(worker.activeChat) ||
    messages.some(message => ["queued", "generating"].includes(message.status));

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(onVisible, 15000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!worker.online || (!pendingDocuments && !pendingChat)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh({ documents: pendingDocuments, chat: pendingChat });
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh, pendingDocuments, pendingChat, worker.online]);
  useEffect(() => {
    const container = chatScroll.current;
    if (!container || !container.clientHeight || !preferences.autoScroll || !followConversation.current) return;
    container.scrollTo({ top: container.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [messages.length, messages.at(-1)?.content.length, tab, sourcesOpen, view, preferences.autoScroll]);
  useEffect(() => {
    if (sourcesOpen && view === "study") sourceHeading.current?.focus({ preventScroll: true });
    else if (restoreChatFocus.current) {
      document.getElementById("show-sources")?.focus({ preventScroll: true });
      restoreChatFocus.current = false;
    }
  }, [sourcesOpen, view]);
  useEffect(() => {
    const input = questionInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 104)}px`;
  }, [question, tab, sourcesOpen, view]);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  function choose(id: string) {
    setSelected((previous) => {
      if (previous.includes(id)) return previous.filter((item) => item !== id);
      if (previous.length >= 5) {
        setNotice("Mỗi câu hỏi sử dụng tối đa 5 tài liệu.");
        return previous;
      }
      return [...previous, id];
    });
  }
  async function upload(file: File, subject: string) {
    if (
      file.size === 0 ||
      file.size > MAX_FILE_SIZE ||
      !/\.(pdf|docx)$/i.test(file.name)
    ) {
      setNotice("Chọn PDF hoặc DOCX, dung lượng tối đa 20 MB.");
      return;
    }
    setUploading(true);
    setNotice("");
    try {
      const result = await api<{
        document: StudyDocument;
        upload: { path: string; token: string } | null;
      }>("documents/upload-intent", "POST", {
        name: file.name,
        size: file.size,
        subject,
        key: crypto.randomUUID(),
      });
      if (result.upload) {
        const contentType = /\.pdf$/i.test(file.name)
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const { error } = await browserClient()
          .storage.from("documents")
          .uploadToSignedUrl(result.upload.path, result.upload.token, file, {
            contentType,
          });
        // A lost upload response may still have committed the object. The API verifies it.
        try {
          await api(`documents/${result.document.id}/complete`, "POST", {
            key: crypto.randomUUID(),
          });
        } catch (completeError) {
          if (error)
            throw new Error(
              "Tải file thất bại. Xóa bản tải dở trong danh sách rồi thử lại.",
            );
          throw completeError;
        }
      }
      setNotice(
        "Đã nhận tài liệu. Bạn có thể theo dõi tiến trình trong thư viện.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setUploading(false);
      await refresh();
    }
  }
  async function documentAction(
    id: string,
    action: "retry" | "delete" | "complete",
  ) {
    setNotice("");
    try {
      await api(
        `documents/${id}${action === "delete" ? "" : `/${action}`}`,
        action === "delete" ? "DELETE" : "POST",
        { key: crypto.randomUUID() },
      );
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!worker.online || !question.trim() || sending.current || worker.activeChat) return;

    const epoch = conversationEpoch.current;
    const submittedDraft = question;
    const documentIds = selected;
    const isCurrent = () => conversationEpoch.current === epoch;
    sending.current = true;
    setBusy(true);
    setNotice("");
    try {
      let id = currentConversation.current;
      if (!id) {
        const conversation = await api<{ id: string }>("conversations", "POST", { key: crypto.randomUUID() });
        id = conversation.id;
        if (isCurrent()) {
          currentConversation.current = id;
          setConversationId(id);
        }
      }
      const fingerprint = JSON.stringify([id, submittedDraft.trim(), documentIds, chatMode]);
      const key = isCurrent() && requestIdentity.current?.fingerprint === fingerprint
        ? requestIdentity.current.key : crypto.randomUUID();
      if (isCurrent()) requestIdentity.current = { fingerprint, key };
      await api(`conversations/${id}/messages`, "POST", {
        question: submittedDraft.trim(), documentIds, key, mode: chatMode,
      });
      if (isCurrent()) {
        followConversation.current = true;
        setQuestion(current => current === submittedDraft ? "" : current);
        requestIdentity.current = null;
      }
      void latestRefresh.current();
    } catch (error) {
      if (isCurrent()) setNotice((error as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function openSource(item: Source) {
    const requestId = ++sourceRequest.current;
    setSourceBusy(true);
    setSource(null);
    setSourcesOpen(true);
    setTab("sources");
    try {
      const result = await api<SourceDetail>(`sources/${item.id}`);
      if (requestId === sourceRequest.current) setSource(result);
    } catch (error) {
      if (requestId === sourceRequest.current) setNotice((error as Error).message);
    } finally {
      if (requestId === sourceRequest.current) setSourceBusy(false);
    }
  }
  function openConversation(id: string | null) {
    ++conversationEpoch.current;
    ++refreshRequest.current;
    setView("study");
    if (id && id === currentConversation.current) void refresh();
    ++sourceRequest.current;
    followConversation.current = true;
    currentConversation.current = id;
    setConversationId(id);
    setMessages([]);
    setSource(null);
    setSourceBusy(false);
    setSourcesOpen(false);
    setTab("chat");
    setQuestion("");
    requestIdentity.current = null;
  }
  const allSources = messages
    .filter((message) => message.status === "completed")
    .flatMap((message) => message.message_sources);
  const allWebSources = messages.filter(message => message.status === "completed")
    .flatMap(message => (message.web_sources ?? []).map(source => ({ ...source, id: `${message.id}-${source.label}` })));

  function showDocuments() {
    setView("library");
    setLibraryView("knowledge");
    setTab("documents");
    setSourcesOpen(false);
  }
  function goToStudy() {
    setView("study");
    setTab("chat");
    setSourcesOpen(false);
  }
  function openGroup(id: string) {
    setGroupToOpen(id);
    setView("groups");
  }
  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessage(message.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedMessage(null), 2000);
    } catch {
      setNotice("Trình duyệt chưa cho phép sao chép. Bạn có thể bôi đen nội dung để sao chép.");
    }
  }
  function closeSources() {
    restoreChatFocus.current = true;
    setSourcesOpen(false);
    setTab("chat");
  }
  async function signOut() {
    const { error } = await browserClient().auth.signOut();
    if (error) {
      setNotice("Không thể đăng xuất. Vui lòng kiểm tra kết nối và thử lại.");
      return;
    }
    router.replace("/auth");
    router.refresh();
  }

  return (
    <main className={styles.shell} data-answer-font-size={preferences.answerFontSize} data-view={view}>
      <aside className={styles.appNavigation} aria-label="Điều hướng ứng dụng">
        <div className={styles.navigationBrand}><Brand workspace /></div>
        <nav aria-label="Điều hướng góc học tập">
          <button className={styles.newChatButton} onClick={() => openConversation(null)}>
            <SidebarIcon name="new" className={styles.navigationIcon} /><span>Trò chuyện mới</span>
          </button>
          {([["overview", "Tổng quan"], ["study", "Học tập"], ["plans", "Kế hoạch"], ["documents", "Kho tài liệu"], ["groups", "Nhóm học"], ["history", "Lịch sử"]] as const).map(([key, label]) => (
            <button key={key} aria-current={(view === key || (view === "library" && (key === "documents" ? libraryView !== "history" : key === "history" && libraryView === "history"))) ? "page" : undefined}
              data-destination={key}
              onClick={() => {
                if (key === "overview") setView("overview");
                else if (key === "study") goToStudy();
                else if (key === "plans") { setPlansOpened(true); setView("plans"); }
                else if (key === "groups") setView("groups");
                else {
                  setView("library");
                  setLibraryView(key === "documents" ? "knowledge" : key);
                  setTab("documents");
                  setSourcesOpen(false);
                }
              }} title={label}><SidebarIcon name={key} className={styles.navigationIcon} /><span>{label}</span></button>
          ))}
          <section className={styles.sidebarRecent} aria-label="Hội thoại gần đây">
            <h2>Gần đây</h2>
            <label className="sr-only" htmlFor="sidebar-history-search">Tìm trong tên phiên học</label>
            <div className={styles.sidebarSearch}>
              <SidebarIcon name="search" className={styles.navigationIcon} />
              <input id="sidebar-history-search" type="search" placeholder="Tìm phiên học…" value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)} />
            </div>
            {loading ? <p>Đang tải…</p> : conversations.filter((item) => item.title.toLocaleLowerCase("vi-VN").includes(historyQuery.trim().toLocaleLowerCase("vi-VN"))).slice(0, 8).map((item) => (
              <button className={styles.recentConversation} key={item.id} title={item.title}
                aria-current={view === "study" && item.id === conversationId ? "true" : undefined}
                onClick={() => openConversation(item.id)}>{item.title}</button>
            ))}
            {!loading && conversations.length === 0 && <p>Phiên học mới sẽ xuất hiện ở đây.</p>}
          </section>
          <button className={styles.navigationSettings} aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")} title="Cài đặt">
            <SidebarIcon name="settings" className={styles.navigationIcon} /><span>Cài đặt</span>
          </button>
        </nav>
      </aside>
      <div className={styles.mainColumn} data-view={view}>
        <StudyToolbar username={username} canManageKnowledge={canManageKnowledge}
          online={worker.online} loading={loading} provider={worker.provider}
          streak={streak} streakError={streakError} onSignOut={signOut}
          onOpenConversation={openConversation} onOpenGroup={openGroup} onOpenSettings={() => setView("settings")}
          showStreak={view !== "overview"}
          title={view === "plans" ? "Kế hoạch học tập" : view === "groups" ? "Nhóm học tập" : view === "settings" ? "Cài đặt" : view === "overview" ? "Tổng quan học tập" : view === "study" ? "Trợ giảng LearnStep" : libraryView === "history" ? "Lịch sử học tập" : "Kho tài liệu"}
          subtitle={view === "plans" ? "Đặt mục tiêu, chọn tài liệu và theo dõi tiến độ của bạn." : view === "groups" ? "Thảo luận cùng người học cùng môn." : view === "settings" ? "Tùy chỉnh góc học tập theo cách của bạn." : view === "overview" ? "Mỗi ngày một bước, hiểu thêm một chút." : view === "study" ? "Đặt câu hỏi, đọc lời giải và đối chiếu với nguồn." : "Tài liệu và các phiên học được lưu riêng cho bạn."} />
        {notice && (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice("")}>Đóng</button>
          </div>
        )}
        {view === "overview" && <StudyOverview username={username} documents={documents} conversations={conversations}
          streak={streak} streakError={streakError} loading={loading} unavailable={Boolean(dataError)}
          onStudy={goToStudy} onNewConversation={() => openConversation(null)} onLibrary={showDocuments} onConversation={openConversation} />}
        {view === "settings" && <StudySettings preferences={preferences} onChange={updatePreferences} storageAvailable={storageAvailable} />}
        {view === "groups" && <StudyGroups username={username} initialGroupId={groupToOpen} onSelectGroup={setGroupToOpen} />}
        {plansOpened && <div className="learning-plans-panel" hidden={view !== "plans"}>
          <LearningPlans documents={Array.from(new Map([...documents, ...knowledge].map(doc => [doc.id, doc])).values())}
            onAsk={(ids, topic) => {
              openConversation(null);
              setSelected(ids.filter(id => [...documents, ...knowledge].some(doc => doc.id === id && doc.status === "ready")));
              setQuestion(`Giúp tôi học chủ đề “${topic}” dựa trên tài liệu đã chọn.`);
            }} />
        </div>}
        <div className={styles.contentGrid} hidden={view !== "study" && view !== "library"} data-view={view} data-panel={tab} data-sources-open={sourcesOpen}>
          <aside id="panel-documents" className={styles.library} aria-label="Thư viện học tập">
            <div className={styles.libraryHeading}>
              <h2>{libraryView === "history" ? "Các phiên đã lưu" : "Tất cả tài liệu"}</h2>
              <span className={styles.counter}>{libraryView === "documents" ? `${documents.length}/20 tệp cá nhân` : libraryView === "knowledge" ? `${knowledge.length} tài liệu chung` : `${conversations.length} phiên`}</span>
              <button className={styles.quietButton} onClick={() => setLibraryView(libraryView === "history" ? "knowledge" : "history")}>
                {libraryView === "history" ? "Kho tài liệu" : "Lịch sử"}</button>
              {view === "library" && <button className={styles.quietButton} onClick={goToStudy}>Vào học{selected.length > 0 ? ` · ${selected.length} tài liệu` : ""}</button>}
            </div>
            {libraryView !== "history" && <nav className={styles.libraryNav} aria-label="Các khu vực kho tài liệu">
              <button aria-pressed={libraryView === "knowledge"} aria-controls="library-knowledge"
                onClick={() => setLibraryView("knowledge")}>Tài liệu chung</button>
              <button aria-pressed={libraryView === "documents"} aria-controls="library-documents"
                onClick={() => setLibraryView("documents")}>Tài liệu của tôi</button>
            </nav>}
            <section id="library-knowledge" className={styles.librarySection} hidden={libraryView !== "knowledge"} aria-label="Tài liệu chung">
              <DocumentRepository mode="knowledge" documents={knowledge} selected={selected} loading={loading}
                error={knowledgeError} online={worker.online} uploading={uploading}
                onChoose={choose} onUpload={upload} onAction={documentAction} onRefresh={refresh} />
            </section>
            <section id="library-documents" className={styles.librarySection} hidden={libraryView !== "documents"} aria-label="Tài liệu">
              <DocumentRepository documents={documents} selected={selected} loading={loading} error={dataError}
                online={worker.online} uploading={uploading} onChoose={choose} onUpload={upload}
                onAction={documentAction} onRefresh={refresh} />
            </section>
            <section id="library-history" className={styles.historyList} hidden={libraryView !== "history"} aria-label="Lịch sử hội thoại">
              {loading ? <p className={styles.emptyText}>Đang tải lịch sử…</p>
                : conversations.length === 0 ? <div className={styles.emptyLibrary}><h3>Chưa có hội thoại</h3><p>Các phiên học của bạn sẽ được lưu tại đây.</p></div>
                  : conversations.map((conversation) => (
                    <button key={conversation.id} className={styles.historyItem} aria-current={conversation.id === conversationId ? "true" : undefined}
                      onClick={() => openConversation(conversation.id)}>
                      <strong>{conversation.title}</strong>
                      <small>{new Date(conversation.created_at).toLocaleDateString("vi-VN")}</small>
                    </button>
                  ))}
            </section>
          </aside>
          <section id="panel-chat" className={styles.chatPanel} aria-label="Hội thoại học tập">
            <div className={styles.chatHeading}>
              <div className={styles.sessionTitle}>
                <h2>{conversations.find((item) => item.id === conversationId)?.title || "Phiên học mới"}</h2>
                <button onClick={showDocuments}>{selected.length ? `${selected.length} tài liệu đã chọn` : "Chọn nguồn cụ thể"}</button>
              </div>
              <div className={styles.chatHeadingActions}>
              <button className={`${styles.quietButton} ${styles.mobileNewChat}`} type="button" aria-label="Phiên học mới" onClick={() => openConversation(null)}>Mới</button>
              <button id="show-sources" className={styles.quietButton} aria-controls="panel-sources" aria-expanded={sourcesOpen}
                onClick={() => {
                  if (sourcesOpen) closeSources();
                  else { setSourcesOpen(true); setTab("sources"); }
                }}>Nguồn <span className={styles.sourceCount}>{allSources.length + allWebSources.length}</span></button>
              </div>
            </div>
            {worker.activeChat && worker.activeChat.conversation_id !== conversationId && (
              <div className={styles.activeJob} role="status">
                <span>Một câu hỏi đang được xử lý ở phiên khác.</span>
                <button onClick={() => openConversation(worker.activeChat!.conversation_id)}>Mở phiên đó</button>
              </div>
            )}
            <div className={styles.chatScroll} ref={chatScroll} data-empty={messages.length === 0}
              key={conversationId ?? "new"} aria-live="polite" aria-relevant="additions text"
              onScroll={(event) => {
                const container = event.currentTarget;
                followConversation.current = container.scrollHeight - container.clientHeight - container.scrollTop < 72;
              }}>
              {messages.length === 0 ? (
                <div className={styles.welcome}>
                  <p className={styles.greeting}>Chào {username}</p>
                  <h2>Bạn muốn hiểu rõ điều gì?</h2>
                  <p>{chatMode === "research" ? "Đặt câu hỏi để tổng hợp và đối chiếu nhiều nguồn."
                    : chatMode === "search" ? "Đặt câu hỏi để tìm thêm nguồn trên Wikipedia."
                      : "Đặt câu hỏi để tra cứu kho tài liệu chung, hoặc dùng dấu cộng để chọn nguồn cụ thể."}</p>
                  <div className={styles.examples}>
                    {[
                      ["Hiểu khái niệm", "Giải thích khái niệm chính trong tài liệu"],
                      ["Ôn công thức", "Tóm tắt các công thức quan trọng"],
                      ["Gỡ một ví dụ", "Giải thích từng bước một ví dụ trong tài liệu"],
                    ].map(([label, text]) => (
                      <button key={label} onClick={() => { setQuestion(text); questionInput.current?.focus(); }}>
                        <strong>{label}</strong><span>{text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : messages.map((message) => (
                <article className={styles.message} data-role={message.role} key={message.id}>
                  <div className={styles.messageLabel}>
                    <strong>{message.role === "user" ? "Bạn" : "LearnStep"}</strong>
                    <span>{message.status !== "completed" ? statuses[message.status]
                      : message.role === "assistant" && message.generation_provider === "openrouter" ? "Trả lời qua OpenRouter" : ""}</span>
                  </div>
                  {message.content ? <Markdown content={message.content} />
                    : <p className={styles.emptyText}>{message.status === "queued" ? "Câu hỏi đã vào hàng đợi…" : "Đang tìm và đọc các đoạn liên quan…"}</p>}
                  {message.status === "completed" && message.message_sources.length > 0 && (
                    <div className={styles.citations}>{message.message_sources.map((item) => (
                      <Link key={item.id} href={`/study/documents/${item.document_id}?${new URLSearchParams({ chunk: item.chunk_id ?? "00000000-0000-0000-0000-000000000000", ...(conversationId ? { conversation: conversationId } : {}) })}`}>[{item.label}] {item.document_name} · {location(item)}</Link>
                    ))}</div>
                  )}
                  {message.status === "completed" && Boolean(message.web_sources?.length) && (
                    <div className={styles.citations}>{message.web_sources?.map(item => (
                      <a key={item.label} href={item.url} target="_blank" rel="noopener noreferrer">[{item.label}] {item.title} · Wikipedia</a>
                    ))}</div>
                  )}
                  {["failed", "interrupted"].includes(message.status) && <p className="inline-error">Lần trả lời này chưa hoàn tất. Bạn có thể gửi lại câu hỏi sau khi kiểm tra kết nối AI.</p>}
                  {message.content && <div className={styles.messageTools}>
                    <button type="button" onClick={() => void copyMessage(message)}>{copiedMessage === message.id ? "Đã sao chép" : "Sao chép"}</button>
                    {message.role === "user" && <button type="button" onClick={() => { setQuestion(message.content); questionInput.current?.focus(); }}>Dùng lại câu hỏi</button>}
                  </div>}
                </article>
              ))}
            </div>
            <form className={styles.composer} onSubmit={send}>
              <label className="sr-only" htmlFor="question">Câu hỏi của bạn</label>
              <div className={styles.composerBox}>
                <textarea id="question" ref={questionInput} value={question} onChange={(event) => setQuestion(event.target.value)}
                  placeholder={chatMode !== "documents" ? "Bạn muốn tìm hiểu điều gì?" : selected.length ? "Đặt câu hỏi từ tài liệu đã chọn…" : "Hỏi trên kho tài liệu chung…"}
                  maxLength={2000} rows={1} aria-describedby="composer-hint" onKeyDown={(event) => {
                    if (shouldSendQuestion({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing }, preferences.sendWithEnter)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }} />
                <div className={styles.composerTools}>
                  <div className={styles.composerOptions}>
                    <ChatDocumentMenu selected={selected.length} canUpload={worker.online && !uploading && documents.length < 20}
                      onChoose={showDocuments} onUpload={upload} />
                    <SelectField label="Chế độ trả lời" value={chatMode} compact disabled={busy}
                      options={Object.entries(chatModes).map(([value, label]) => ({ value, label }))}
                      onChange={value => setChatMode(value as ChatMode)} />
                  </div>
                  <button className={styles.sendButton}
                    disabled={!worker.online || busy || Boolean(worker.activeChat) || !question.trim()}>
                    {busy ? "Đang gửi…" : "Gửi"}
                  </button>
                </div>
              </div>
              <div className={styles.composerFooter} id="composer-hint">
                <span>{loading ? "Đang kết nối…" : !worker.online ? "AI tạm dừng · Bạn có thể xem lại hội thoại."
                  : worker.activeChat ? "Đang có câu hỏi chờ xử lý."
                    : chatMode === "research" ? "Đối chiếu nhiều truy vấn Wikipedia. Từ khóa từ câu hỏi sẽ được gửi đi."
                      : chatMode === "search" ? "Tìm trên Wikipedia. Từ khóa từ câu hỏi sẽ được gửi đi."
                        : selected.length ? "Đang dùng tài liệu đã chọn." : "Tự động tìm trong tài liệu chung."}</span>
                <span>{question.length}/2000</span>
              </div>
            </form>
          </section>
          <aside id="panel-sources" className={styles.sourcePanel} aria-label="Nguồn tham khảo"
            onKeyDown={(event) => { if (event.key === "Escape") closeSources(); }}>
            <div className={styles.sourceHeading}>
              <h2 ref={sourceHeading} tabIndex={-1}>Nguồn tham khảo</h2>
              <button className={styles.quietButton} onClick={closeSources}>Đóng</button>
            </div>
            <div className={styles.sourceScroll}>
              {sourceBusy ? <p className={styles.emptyText} role="status">Đang mở nguồn…</p>
                : source ? <article className={styles.sourceDetail} key={source.id}>
                  <span className="pill">[{source.label}]</span>
                  <h3>{source.document_name}</h3><p className={styles.sourceLocation}>{location(source)}</p>
                  {source.available ? <>
                    <p className={styles.sourceExcerpt}>{source.content}</p>
                    {source.url && <a className={styles.pdfLink} href={source.url} target="_blank" rel="noopener noreferrer">Mở trang PDF gốc</a>}
                  </> : <p className={styles.emptyText}>Tài liệu đã bị xóa hoặc nguồn không còn khả dụng.</p>}
                </article>
                  : <div className={styles.emptyLibrary}><h3>Đối chiếu lời giải</h3><p>Chọn trích dẫn bên dưới câu trả lời để đọc đoạn nguồn và mở tài liệu gốc.</p></div>}
              {(allSources.length > 0 || allWebSources.length > 0) && <div className={styles.sourceList}>
                <h3>Trong phiên học này</h3>
                {allSources.map((item) => <button key={item.id} aria-pressed={source?.id === item.id} onClick={() => void openSource(item)}>
                  <span>[{item.label}]</span><strong>{item.document_name}</strong><small>{location(item)}</small>
                </button>)}
                {allWebSources.map(item => <a className={styles.pdfLink} key={item.id} href={item.url}
                  target="_blank" rel="noopener noreferrer">[{item.label}] {item.title} · Wikipedia</a>)}
              </div>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
