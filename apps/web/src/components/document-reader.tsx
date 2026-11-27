"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DocumentDetail } from "@/core/types";
import { isImageFileType, statuses, subjects } from "@/core/validation";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-provider";
import { Markdown } from "./markdown";
import { partLabel } from "@/core/document-catalog";
import { DocumentVolumeNavigation, useDocumentVolume } from "./document-volume";
import styles from "./document-reader.module.css";

export function DocumentReader({ id, chunk, conversation, page }: { id: string; chunk?: string; conversation?: string; page?: number }) {
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [ocrText, setOcrText] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrExpanded, setOcrExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDocument(null);
    setOcrText("");
    setOcrError("");
    setOcrExpanded(false);
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${id}${chunk ? `?chunk=${chunk}` : ""}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không thể mở tài liệu.");
        if (!controller.signal.aborted) setDocument(data);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Không thể mở tài liệu.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, chunk, attempt]);

  const back = conversation ? `/study?conversation=${conversation}` : `/study?library=${document?.scope ?? "knowledge"}`;
  const excerpt = document?.excerpt;
  const volume = useDocumentVolume(id, document?.scope === "knowledge");
  const part = volume?.parts.find((item) => item.document.id === id);
  const localPage = page && part && page >= part.firstPage && page <= part.lastPage
    ? page - part.firstPage + 1
    : chunk ? excerpt?.page : undefined;
  const isImage = isImageFileType(document?.file_type);
  const fileUrl = "/api/documents/" + id + "/file" + (!isImage && localPage ? "?page=" + localPage : "");
  const formattedSize = document
    ? document.size_bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(document.size_bytes / 1024))} KB`
      : `${(document.size_bytes / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} MB`
    : "";
  async function toggleOcr() {
    if (ocrText) {
      setOcrExpanded((value) => !value);
      return;
    }
    setOcrLoading(true);
    setOcrError("");
    try {
      const response = await fetch(`/api/documents/${id}/ocr`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể tải nội dung OCR.");
      setOcrText(data.text || "");
      setOcrExpanded(true);
    } catch (cause) {
      setOcrError(cause instanceof Error ? cause.message : "Không thể tải nội dung OCR.");
    } finally {
      setOcrLoading(false);
    }
  }
  return <main className={styles.reader}>
    <header><Brand workspace /><ThemeToggle /></header>
    <div className={styles.inner}>
      <Link className={styles.back} href={back}>{conversation ? "Trở lại hội thoại" : "Về kho tài liệu"}</Link>
      {loading ? <section className={styles.state} role="status">Đang mở tài liệu…</section>
        : error ? <section className={styles.state} role="alert"><h1>Tài liệu chưa khả dụng</h1><p>{error}</p>
          <p>Tài liệu có thể đã được xóa, ngừng công bố hoặc bạn chưa có quyền truy cập.</p>
          <button onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></section>
          : document && <>
            <article className={styles.document}>
              <div className={styles.tags}><span>{document.scope === "knowledge" ? "TÀI LIỆU CHUNG · NGUỒN RAG" : "TÀI LIỆU CỦA TÔI"}</span>
                <span className={`pill ${document.status}`}>{statuses[document.status] ?? document.status}</span></div>
              <h1>{volume?.name ?? document.name}</h1>
              {part && <p className={styles.metadata}>{partLabel(part)}{page && localPage ? " · đang mở trang " + page : ""}</p>}
              <p className={styles.metadata}>{subjects[document.subject as keyof typeof subjects] ?? document.subject}
                <span> · {document.file_type.toUpperCase()} · {formattedSize}</span></p>
              {document.description && <p>{document.description}</p>}
              {document.status === "ready" && <a className={styles.openFile} href={fileUrl}
                target="_blank" rel="noopener noreferrer">{document.file_type === "pdf" ? `Mở PDF${localPage ? " tại trang " + (part ? localPage + part.firstPage - 1 : localPage) : " gốc"}` : isImage ? "Mở ảnh gốc" : "Tải tệp DOCX"}
                <span className="sr-only"> (mở trong tab mới)</span></a>}
              {document.error && <p className="inline-error">{document.error}</p>}
            </article>
            {document.status === "ready" && isImage && !volume && (
              <figure className={styles.imageFrame}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.imagePreview} src={fileUrl} alt={document.name} />
              </figure>
            )}
            {volume && <DocumentVolumeNavigation volume={volume} id={id} conversation={conversation} />}
            {volume && <iframe className={styles.pdf} src={fileUrl}
              title={volume.name + (part ? " · " + partLabel(part) : "")} />}
            {(chunk || !volume) && <section className={styles.source} aria-label={chunk ? "Đoạn nguồn trích dẫn" : "Xem trước tài liệu"}>
              <h2>{chunk ? "Đoạn nguồn được trích dẫn" : "Trích đoạn xem trước"}</h2>
              {!document.requested_chunk_available ? <p>Đoạn nguồn này không còn ở phiên bản hiện tại. Bạn vẫn có thể mở tài liệu gốc để đối chiếu.</p>
                : excerpt ? <>
                  <p className={styles.location}>{excerpt.page ? `Trang ${part ? part.firstPage + excerpt.page - 1 : excerpt.page}`
                    : [excerpt.section, excerpt.paragraph ? `Đoạn ${excerpt.paragraph}` : null].filter(Boolean).join(" · ") || "Đầu tài liệu"}</p>
                  <div className={styles.excerpt}><Markdown content={excerpt.content} /></div>
                </> : <p>{document.status !== "ready" ? "Tài liệu đang chờ xử lý. Đoạn nguồn sẽ có sau khi hoàn tất." : "Chưa có đoạn văn bản xem trước. Hãy mở tệp gốc."}</p>}
            </section>}
            {document.status === "ready" && <section className={styles.ocr} aria-label={part ? "Nội dung OCR của phần đang đọc" : "Toàn bộ nội dung đã nhận dạng"}>
              <button className={styles.ocrToggle} onClick={() => void toggleOcr()} aria-expanded={ocrExpanded} disabled={ocrLoading}>
                {ocrLoading ? "Đang tải nội dung…" : ocrExpanded ? "Thu gọn nội dung OCR" : part ? "Xem OCR của phần này" : "Xem toàn bộ nội dung OCR"}
              </button>
              {ocrError && <p className="inline-error" role="alert">{ocrError}</p>}
              {ocrExpanded && ocrText && <div className={styles.ocrContent}><Markdown content={ocrText} /></div>}
              {ocrExpanded && !ocrText && !ocrLoading && !ocrError && <p>Chưa có nội dung OCR cho tài liệu này.</p>}
            </section>}
          </>}
    </div>
  </main>;
}
