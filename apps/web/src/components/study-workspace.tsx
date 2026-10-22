"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/core/supabase-browser";
import { MAX_FILE_SIZE, statuses, subjects } from "@/core/validation";
import type {
  Conversation,
  Message,
  Source,
  SourceDetail,
  StudyDocument,
} from "@/core/types";
import { Markdown } from "./markdown";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-provider";

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
  activeChat: { id: string; conversation_id: string } | null;
};
const location = (source: Source) =>
  source.page
    ? `Trang ${source.page}`
    : [source.section, source.paragraph ? `Đoạn ${source.paragraph}` : ""]
        .filter(Boolean)
        .join(" · ");

export function StudyWorkspace({ email }: { email: string }) {
  const router = useRouter();
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [worker, setWorker] = useState<WorkerStatus>({
    online: false,
    activeChat: null,
  });
  const [subject, setSubject] = useState("calculus");
  const [question, setQuestion] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [tab, setTab] = useState("chat");
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const currentConversation = useRef(conversationId);
  currentConversation.current = conversationId;
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const sourceRequest = useRef(0);
  const refreshRequest = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequest.current;
    try {
      const [docs, convs, health, history] = await Promise.all([
        api<StudyDocument[]>("documents"),
        api<Conversation[]>("conversations"),
        api<WorkerStatus>("status"),
        conversationId
          ? api<Message[]>(`conversations/${conversationId}/messages`)
          : Promise.resolve([]),
      ]);
      if (
        currentConversation.current !== conversationId ||
        requestId !== refreshRequest.current
      )
        return;
      setDocuments(docs);
      setConversations(convs);
      setWorker(health);
      setMessages(history);
      setSelected((previous) =>
        previous.filter((id) =>
          docs.some((doc) => doc.id === id && doc.status === "ready"),
        ),
      );
      setLoading(false);
    } catch (error) {
      setNotice((error as Error).message);
      setLoading(false);
    }
  }, [conversationId]);
  const pending =
    uploading ||
    busy ||
    Boolean(worker.activeChat) ||
    documents.some((doc) =>
      ["queued", "processing", "deleting"].includes(doc.status),
    ) ||
    messages.some((message) =>
      ["queued", "generating"].includes(message.status),
    );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pending ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [refresh, pending]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, messages.at(-1)?.content.length]);

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
  async function upload(file: File) {
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
      if (fileInput.current) fileInput.current.value = "";
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
    if (!question.trim() || !selected.length || busy || worker.activeChat)
      return;
    setBusy(true);
    setNotice("");
    try {
      let id = conversationId;
      if (!id) {
        const conversation = await api<{ id: string }>(
          "conversations",
          "POST",
          { key: crypto.randomUUID() },
        );
        id = conversation.id;
        currentConversation.current = id;
        setConversationId(id);
      }
      const fingerprint = JSON.stringify([id, question.trim(), selected]);
      if (requestIdentity.current?.fingerprint !== fingerprint)
        requestIdentity.current = { fingerprint, key: crypto.randomUUID() };
      await api(`conversations/${id}/messages`, "POST", {
        question: question.trim(),
        documentIds: selected,
        key: requestIdentity.current.key,
      });
      setQuestion("");
      requestIdentity.current = null;
      ++refreshRequest.current;
      const history = await api<Message[]>(`conversations/${id}/messages`);
      if (currentConversation.current === id) setMessages(history);
      const health = await api<WorkerStatus>("status");
      setWorker(health);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openSource(item: Source) {
    const requestId = ++sourceRequest.current;
    setSourceBusy(true);
    setTab("sources");
    try {
      const result = await api<SourceDetail>(`sources/${item.id}`);
      if (requestId === sourceRequest.current) setSource(result);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      if (requestId === sourceRequest.current) setSourceBusy(false);
    }
  }
  function openConversation(id: string | null) {
    currentConversation.current = id;
    setConversationId(id);
    setMessages([]);
    setSource(null);
    setTab("chat");
  }
  const allSources = messages
    .filter((message) => message.status === "completed")
    .flatMap((message) => message.message_sources);

  return (
    <main className="workspace">
      <header className="workspace-header">
        <Brand workspace />
        <div className="header-status">
          <span className={`status-dot ${worker.online ? "online" : ""}`} />
          <span>
            {worker.online ? "Trợ giảng sẵn sàng" : "AI đang offline"}
          </span>
        </div>
        <div className="account">
          <ThemeToggle />
          <span>{email}</span>
          <button
            onClick={async () => {
              const { error } = await browserClient().auth.signOut();
              if (error) {
                setNotice(
                  "Không thể đăng xuất. Vui lòng kiểm tra kết nối và thử lại.",
                );
                return;
              }
              router.replace("/auth");
              router.refresh();
            }}
            className="text-link"
          >
            Đăng xuất
          </button>
        </div>
      </header>
      <div className="mobile-tabs" role="tablist" aria-label="Khu vực học tập">
        {[
          ["documents", "Tài liệu"],
          ["chat", "Hội thoại"],
          ["sources", "Nguồn"],
        ].map(([key, label]) => (
          <button
            key={key}
            id={`tab-${key}`}
            role="tab"
            aria-controls={`panel-${key}`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              const tabs = ["documents", "chat", "sources"];
              const index = tabs.indexOf(key);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % 3
                  : event.key === "ArrowLeft"
                    ? (index + 2) % 3
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`tab-${tabs[next]}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <div className="workspace-notice" role="status">
          <span>{notice}</span>
          <button className="text-link" onClick={() => setNotice("")}>
            Đóng
          </button>
        </div>
      )}
      <div className="workspace-grid">
        <aside
          id="panel-documents"
          role="tabpanel"
          aria-labelledby="tab-documents"
          className={`library pane ${tab === "documents" ? "mobile-visible" : ""}`}
        >
          <div className="pane-heading">
            <p className="eyebrow">THƯ VIỆN CỦA BẠN</p>
            <h2>
              Tài liệu học tập
              <span className="count">{documents.length}/20</span>
            </h2>
            <p className="muted">Chọn tối đa 5 tài liệu cho mỗi câu hỏi.</p>
          </div>
          <div className="upload-area">
            <label htmlFor="subject">Môn học</label>
            <select
              id="subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            >
              {Object.entries(subjects).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="sr-only"
              id="document-file"
              ref={fileInput}
              type="file"
              accept=".pdf,.docx"
              disabled={!worker.online || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              className="upload-button"
              disabled={!worker.online || uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Đang tải tài liệu…" : "Tải tài liệu lên"}
              <small>PDF, DOCX · Tối đa 20 MB</small>
            </button>
          </div>
          <div className="document-list">
            {loading ? (
              <p className="muted">Đang tải thư viện…</p>
            ) : documents.length === 0 ? (
              <div className="empty-library">
                <span className="empty-index">01</span>
                <h3>Bắt đầu từ giáo trình.</h3>
                <p>
                  Tải tài liệu đầu tiên để trợ giảng có thể đồng hành cùng bạn.
                </p>
              </div>
            ) : (
              documents.map((doc) => (
                <article
                  className={`document-card ${selected.includes(doc.id) ? "selected" : ""}`}
                  key={doc.id}
                >
                  <label className="document-select">
                    <input
                      type="checkbox"
                      checked={selected.includes(doc.id)}
                      disabled={doc.status !== "ready"}
                      onChange={() => choose(doc.id)}
                    />
                    <span>
                      <strong>{doc.name}</strong>
                      <small>
                        {subjects[doc.subject as keyof typeof subjects]} ·{" "}
                        {(doc.size_bytes / 1024 / 1024).toFixed(1)} MB
                      </small>
                    </span>
                  </label>
                  <div className="document-meta">
                    <span className={`pill ${doc.status}`}>
                      {statuses[doc.status]}
                    </span>
                    <div>
                      {doc.status === "failed" && (
                        <button
                          className="text-link"
                          onClick={() => void documentAction(doc.id, "retry")}
                          disabled={!worker.online}
                        >
                          Thử lại
                        </button>
                      )}
                      {doc.status === "uploading" && (
                        <button
                          className="text-link"
                          disabled={!worker.online}
                          onClick={() =>
                            void documentAction(doc.id, "complete")
                          }
                        >
                          Xác nhận file
                        </button>
                      )}
                      {doc.status === "deleting" && doc.error && (
                        <button
                          className="text-link"
                          onClick={() => void documentAction(doc.id, "delete")}
                        >
                          Thử xóa lại
                        </button>
                      )}
                      {doc.status !== "deleting" && (
                        <button
                          className="text-link danger"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Xóa tài liệu “${doc.name}” và các đoạn nguồn?`,
                              )
                            )
                              void documentAction(doc.id, "delete");
                          }}
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  </div>
                  {doc.error && <p className="inline-error">{doc.error}</p>}
                </article>
              ))
            )}
          </div>
          <section className="history">
            <div className="history-heading">
              <p className="eyebrow">LỊCH SỬ PHIÊN HỌC</p>
              <button
                className="text-link"
                onClick={() => openConversation(null)}
              >
                Tạo mới
              </button>
            </div>
            {conversations.length === 0 && (
              <p className="muted">Hội thoại sẽ được lưu tại đây.</p>
            )}
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`history-item ${conversation.id === conversationId ? "active" : ""}`}
                onClick={() => openConversation(conversation.id)}
              >
                {conversation.title}
                <small>
                  {new Date(conversation.created_at).toLocaleDateString(
                    "vi-VN",
                  )}
                </small>
              </button>
            ))}
          </section>
        </aside>
        <section
          id="panel-chat"
          role="tabpanel"
          aria-labelledby="tab-chat"
          className={`chat-pane pane ${tab === "chat" ? "mobile-visible" : ""}`}
        >
          <div className="chat-heading">
            <div>
              <p className="eyebrow">CÙNG NHAU GỠ RỐI KIẾN THỨC</p>
              <h2>
                {conversations.find((item) => item.id === conversationId)
                  ?.title || "Phiên học mới"}
              </h2>
            </div>
            <span className="pill">{selected.length} tài liệu được chọn</span>
          </div>
          {!worker.online && (
            <div className="offline-note">
              Máy xử lý AI chưa kết nối. Bạn vẫn có thể đọc lại lịch sử; tài
              liệu và câu hỏi đang chờ sẽ tiếp tục khi máy hoạt động.
            </div>
          )}
          {worker.activeChat &&
            worker.activeChat.conversation_id !== conversationId && (
              <div className="offline-note">
                Bạn đang có câu hỏi ở phiên khác.{" "}
                <button
                  className="text-link"
                  onClick={() =>
                    openConversation(worker.activeChat!.conversation_id)
                  }
                >
                  Mở phiên đang xử lý
                </button>
              </div>
            )}
          <div
            className="chat-scroll"
            key={conversationId ?? "new"}
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <p className="eyebrow">MỘT CÂU HỎI, THÊM MỘT ĐIỀU HAY</p>
                <h1>
                  Chào bạn! Hôm nay,
                  <br />
                  mình cùng hiểu <em>điều gì?</em>
                </h1>
                <p>
                  Chọn tài liệu ở thư viện và bắt đầu bằng điều bạn còn băn
                  khoăn. Trợ giảng sẽ tìm những đoạn liên quan để cùng bạn giải
                  thích.
                </p>
                <div className="question-examples">
                  {[
                    "Giải thích khái niệm chính trong tài liệu",
                    "Tóm tắt các công thức quan trọng",
                    "Giải thích từng bước một ví dụ trong tài liệu",
                  ].map((text) => (
                    <button key={text} onClick={() => setQuestion(text)}>
                      {text}
                    </button>
                  ))}
                </div>
                <div className="welcome-rule">
                  <span>ĐỌC</span>
                  <span>ĐẶT CÂU HỎI</span>
                  <span>ĐỐI CHIẾU</span>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-label">
                    {message.role === "user" ? "BẠN" : "TRỢ GIẢNG"}
                    <span>
                      {message.status !== "completed"
                        ? statuses[message.status]
                        : ""}
                    </span>
                  </div>
                  {message.content ? (
                    <Markdown content={message.content} />
                  ) : (
                    <p className="muted">
                      {message.status === "queued"
                        ? "Câu hỏi đã vào hàng đợi…"
                        : "Đang tìm và đọc các đoạn liên quan…"}
                    </p>
                  )}
                  {message.status === "completed" &&
                    message.message_sources.length > 0 && (
                      <div className="message-citations">
                        {message.message_sources.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => void openSource(item)}
                          >
                            [{item.label}] {item.document_name} ·{" "}
                            {location(item)}
                          </button>
                        ))}
                      </div>
                    )}
                  {["failed", "interrupted"].includes(message.status) && (
                    <p className="inline-error">
                      Lần trả lời này chưa hoàn tất. Bạn có thể gửi lại câu hỏi
                      sau khi kiểm tra kết nối AI.
                    </p>
                  )}
                </article>
              ))
            )}
            <div ref={end} />
          </div>
          <form className="composer" onSubmit={send}>
            <label className="sr-only" htmlFor="question">
              Câu hỏi của bạn
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                selected.length
                  ? "Đặt câu hỏi từ tài liệu của bạn…"
                  : "Chọn tài liệu sẵn sàng trước khi đặt câu hỏi…"
              }
              maxLength={2000}
              rows={3}
            />
            <div className="composer-bottom">
              <span>
                {question.length}/2000 ·{" "}
                {worker.activeChat
                  ? "Đang có câu hỏi chờ xử lý"
                  : "Câu trả lời có thể cần thời gian để suy luận"}
              </span>
              <button
                className="button small"
                disabled={
                  !worker.online ||
                  busy ||
                  Boolean(worker.activeChat) ||
                  selected.length === 0 ||
                  !question.trim()
                }
              >
                {busy ? "Đang gửi…" : "Gửi câu hỏi"}
              </button>
            </div>
            <p className="composer-disclaimer">
              AI có thể nhầm lẫn. Hãy đối chiếu công thức và lời giải với tài
              liệu nguồn.
            </p>
          </form>
        </section>
        <aside
          id="panel-sources"
          role="tabpanel"
          aria-labelledby="tab-sources"
          className={`sources-pane pane ${tab === "sources" ? "mobile-visible" : ""}`}
        >
          <div className="pane-heading">
            <p className="eyebrow">HIỂU ĐẾN TẬN NGUỒN</p>
            <h2>Nguồn tham khảo</h2>
            <p className="muted">Mở trích dẫn để đọc ngữ cảnh gốc.</p>
          </div>
          {sourceBusy ? (
            <p className="muted">Đang mở nguồn…</p>
          ) : source ? (
            <article className="source-detail content-transition" key={source.id}>
              <span className="pill">[{source.label}]</span>
              <h3>{source.document_name}</h3>
              <p className="source-location">{location(source)}</p>
              {source.available ? (
                <>
                  <p className="source-excerpt">{source.content}</p>
                  {source.url && (
                    <a
                      className="button secondary small"
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở trang PDF gốc
                    </a>
                  )}
                </>
              ) : (
                <p className="notice">
                  Tài liệu đã bị xóa hoặc nguồn không còn khả dụng.
                </p>
              )}
            </article>
          ) : (
            <div className="source-empty">
              <span className="empty-index">[S1]</span>
              <h3>
                Mỗi lời giải,
                <br />
                một điểm tựa.
              </h3>
              <p>
                Nguồn được hiển thị khi trợ giảng sử dụng tài liệu để trả lời.
                Chọn một trích dẫn bên dưới câu trả lời để đọc chi tiết.
              </p>
            </div>
          )}
          {allSources.length > 0 && (
            <div className="source-list">
              <p className="eyebrow">TRONG PHIÊN HỌC NÀY</p>
              {allSources.map((item) => (
                <button key={item.id} onClick={() => void openSource(item)}>
                  <span>[{item.label}]</span>
                  <strong>{item.document_name}</strong>
                  <small>{location(item)}</small>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
