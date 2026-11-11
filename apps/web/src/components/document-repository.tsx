"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { StudyDocument } from "@/core/types";
import { statuses, subjects } from "@/core/validation";
import { SelectField } from "./select-field";
import styles from "./document-repository.module.css";

type DocumentAction = "retry" | "delete" | "complete";
const documentStates = ["ready", "queued", "processing", "failed", "uploading", "deleting"];
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });
const normalize = (value: string) => value.toLocaleLowerCase("vi-VN").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d");
const subjectName = (value: string) => subjects[value as keyof typeof subjects] ?? value;
const fileSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;

export function DocumentRepository({ documents, selected, loading, error, online, uploading, mode = "personal",
  onChoose, onUpload, onAction, onRefresh }: {
  documents: StudyDocument[];
  selected: string[];
  loading: boolean;
  error: string;
  online: boolean;
  uploading: boolean;
  mode?: "personal" | "knowledge";
  onChoose: (id: string) => void;
  onUpload: (file: File, subject: string) => Promise<void>;
  onAction: (id: string, action: DocumentAction) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [uploadSubject, setUploadSubject] = useState("calculus");
  const [actionId, setActionId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ready = documents.filter((doc) => doc.status === "ready").length;
  const processing = documents.filter((doc) => ["uploading", "queued", "processing"].includes(doc.status)).length;
  const term = normalize(query.trim());
  const filtered = documents.filter((doc) => (subject === "all" || doc.subject === subject)
    && (status === "all" || doc.status === status)
    && normalize(`${doc.name} ${subjectName(doc.subject)}`).includes(term)).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "vi-VN", { numeric: true });
    const diff = Date.parse(b.created_at) - Date.parse(a.created_at);
    return (sort === "oldest" ? -diff : diff) || a.id.localeCompare(b.id);
  });
  const filteredActive = Boolean(query || subject !== "all" || status !== "all");
  const uploadDisabled = !online || uploading || documents.length >= 20;

  function resetFilters() {
    setQuery("");
    setSubject("all");
    setStatus("all");
  }
  async function act(doc: StudyDocument, action: DocumentAction) {
    if (actionId) return;
    if (action === "delete" && !window.confirm(`Xóa tài liệu “${doc.name}” và các đoạn nguồn?`)) return;
    setActionId(doc.id);
    try { await onAction(doc.id, action); } finally { setActionId(null); }
  }

  return (
    <div className={styles.repository}>
      <div className={styles.intro}>
        <div className={styles.summary}>
          <p>{mode === "knowledge" ? "Nguồn kiến thức chung được dùng cho RAG. Chọn tài liệu để bắt đầu hỏi đáp." : "Các tài liệu bạn đã tải lên, được lưu riêng theo tài khoản."}</p>
          <div aria-live="polite">
            <span><strong>{loading ? "…" : ready}</strong> sẵn sàng</span>
            {mode === "personal" && <span><strong>{loading ? "…" : processing}</strong> đang xử lý</span>}
            <span>{mode === "knowledge" ? "Nguồn RAG của hệ thống" : "Riêng tư theo tài khoản"}</span>
          </div>
        </div>
        {mode === "personal" && <div className={styles.upload}>
          <span className={styles.uploadLabel}>Thêm tài liệu</span>
          <div className={styles.uploadControls}>
            <SelectField label="Môn học của tài liệu tải lên" value={uploadSubject} onChange={setUploadSubject}
              disabled={uploading} compact options={Object.entries(subjects).map(([value, label]) => ({ value, label }))} />
            <input className="sr-only" ref={fileInput} type="file" accept=".pdf,.docx" aria-label="Chọn PDF hoặc DOCX để tải lên"
              disabled={uploadDisabled} onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (file) void onUpload(file, uploadSubject).finally(() => { input.value = ""; });
              }} />
            <button className={styles.uploadButton} disabled={uploadDisabled} onClick={() => fileInput.current?.click()}>
              {uploading ? "Đang tải…" : "Tải tài liệu lên"}
            </button>
          </div>
          <small>{documents.length >= 20 ? "Đã đạt giới hạn 20 tài liệu. Xóa bớt để tải thêm."
            : !online ? "AI đang tạm dừng. Bạn vẫn có thể mở tài liệu sẵn sàng."
              : "PDF, DOCX · Tối đa 20 MB mỗi tệp"}</small>
        </div>}
      </div>
      <div className={styles.filters}>
        <label className={styles.search}><span className="sr-only">Tìm trong kho tài liệu</span>
          <input type="search" value={query} placeholder="Tìm tên tài liệu hoặc môn học…" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <SelectField label="Lọc môn học" value={subject} onChange={setSubject} compact
          options={[{ value: "all", label: "Tất cả môn học" }, ...Object.entries(subjects).map(([value, label]) => ({ value, label }))]} />
        <SelectField label="Lọc trạng thái" value={status} onChange={setStatus} compact
          options={[{ value: "all", label: "Mọi trạng thái" }, ...documentStates.map((value) => ({ value, label: statuses[value] }))]} />
        <SelectField label="Sắp xếp tài liệu" value={sort} onChange={setSort} compact
          options={[{ value: "newest", label: "Mới nhất" }, { value: "oldest", label: "Cũ nhất" }, { value: "name", label: "Theo tên A–Z" }]} />
      </div>
      {error && <div className={styles.error} role="alert"><span>Chưa thể cập nhật kho tài liệu. {documents.length > 0 ? "Đang hiển thị dữ liệu lần tải trước." : error}</span>
        <button onClick={() => void onRefresh()} disabled={loading}>Thử lại</button></div>}
      <div className={styles.results}>
        <p role="status">{loading ? "Đang tải tài liệu…" : `${filtered.length}/${documents.length} tài liệu`}
          <span>Đã chọn {selected.length}/5 để hỏi đáp</span></p>
        {filteredActive && <button onClick={resetFilters}>Xóa bộ lọc</button>}
      </div>
      <div className={styles.grid} aria-busy={loading}>
        {loading ? <div className={styles.empty}><p>Đang tải kho tài liệu của bạn…</p></div>
          : error && documents.length === 0 ? <div className={styles.empty}><h3>Kho tài liệu chưa tải được</h3><p>Thử tải lại để xem tài liệu hiện có.</p></div>
            : filtered.length === 0 ? <div className={styles.empty}>
              <span className={styles.emptyLabel}>{documents.length ? "KHÔNG CÓ KẾT QUẢ" : "KHO TÀI LIỆU"}</span>
              <h3>{documents.length ? "Chưa tìm thấy tài liệu phù hợp" : mode === "knowledge" ? "Chưa có tài liệu chung" : "Giáo trình của bạn sẽ ở đây"}</h3>
              <p>{documents.length ? "Thử một tên khác hoặc bỏ bớt bộ lọc."
                : mode === "knowledge" ? "Các nguồn RAG đã được quản trị viên xử lý và công bố sẽ xuất hiện tại đây. Tài liệu cá nhân nằm ở tab Tài liệu của tôi."
                  : "Chọn môn học rồi tải PDF hoặc DOCX lên. Tài liệu đã xử lý sẽ xuất hiện trong kho để đọc lại và hỏi đáp."}</p>
              {documents.length > 0 && <button onClick={resetFilters}>Xem tất cả tài liệu</button>}
            </div> : filtered.map((doc) => {
              const chosen = selected.includes(doc.id);
              const date = new Date(doc.created_at);
              return <article className={styles.card} key={doc.id} data-selected={chosen}>
                <div className={styles.cardTop}>
                  <span className={styles.fileType} data-type={doc.file_type}>{doc.file_type.toUpperCase()}</span>
                  <span className={`pill ${doc.status}`}>{statuses[doc.status] ?? doc.status}</span>
                </div>
                <span className={styles.subject}>{subjectName(doc.subject)}</span>
                <h3 title={doc.name}><Link href={`/study/documents/${doc.id}`}>{doc.name}</Link></h3>
                {doc.description && <p className={styles.description}>{doc.description}</p>}
                <p className={styles.metadata}>{fileSize(doc.size_bytes)}<span aria-hidden="true"> · </span>
                  <time dateTime={doc.created_at}>{Number.isNaN(date.getTime()) ? "Chưa xác định ngày" : dateFormat.format(date)}</time></p>
                {doc.error && <p className={styles.cardError}>{doc.error}</p>}
                <div className={styles.cardBottom}>
                  <label className={styles.choose}>
                    <input type="checkbox" checked={chosen} aria-label={`Chọn ${doc.name} để hỏi đáp`}
                      disabled={doc.status !== "ready" || (!chosen && selected.length >= 5)} onChange={() => onChoose(doc.id)} />
                    <span>{chosen ? "Đã chọn hỏi đáp" : "Chọn hỏi đáp"}</span>
                  </label>
                  <div className={styles.actions}>
                    {doc.status === "ready" ? <a className={styles.openFile} href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener noreferrer">
                      {doc.file_type === "pdf" ? "Mở PDF" : "Tải DOCX"}<span className="sr-only">: {doc.name} (mở trong tab mới)</span>
                    </a> : <span className={styles.notReady}>{doc.status === "deleting" ? "Đang dọn dữ liệu" : "Mở sau khi xử lý xong"}</span>}
                    {mode === "personal" && doc.status === "failed" && <button disabled={!online || actionId !== null} onClick={() => void act(doc, "retry")}>Thử xử lý lại</button>}
                    {mode === "personal" && doc.status === "uploading" && <button disabled={!online || actionId !== null} onClick={() => void act(doc, "complete")}>Xác nhận tải</button>}
                    {mode === "personal" && doc.status === "deleting" && doc.error && <button disabled={actionId !== null} onClick={() => void act(doc, "delete")}>Thử xóa lại</button>}
                    {mode === "personal" && doc.status !== "deleting" && <button className={styles.delete} disabled={actionId !== null} onClick={() => void act(doc, "delete")}>
                      {actionId === doc.id ? "Đang gửi…" : "Xóa"}<span className="sr-only"> {doc.name}</span></button>}
                  </div>
                </div>
              </article>;
            })}
      </div>
    </div>
  );
}
