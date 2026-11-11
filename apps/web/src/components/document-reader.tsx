"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DocumentDetail } from "@/core/types";
import { statuses, subjects } from "@/core/validation";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-provider";
import { Markdown } from "./markdown";
import styles from "./document-reader.module.css";

export function DocumentReader({ id, chunk, conversation }: { id: string; chunk?: string; conversation?: string }) {
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDocument(null);
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
              <h1>{document.name}</h1>
              <p className={styles.metadata}>{subjects[document.subject as keyof typeof subjects] ?? document.subject}
                <span> · {document.file_type.toUpperCase()} · {(document.size_bytes / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} MB</span></p>
              {document.description && <p>{document.description}</p>}
              {document.status === "ready" && <a className={styles.openFile} href={`/api/documents/${id}/file${excerpt?.page ? `?page=${excerpt.page}` : ""}`}
                target="_blank" rel="noopener noreferrer">{document.file_type === "pdf" ? `Mở PDF${excerpt?.page ? ` tại trang ${excerpt.page}` : " gốc"}` : "Tải tệp DOCX"}
                <span className="sr-only"> (mở trong tab mới)</span></a>}
              {document.error && <p className="inline-error">{document.error}</p>}
            </article>
            <section className={styles.source} aria-label={chunk ? "Đoạn nguồn trích dẫn" : "Xem trước tài liệu"}>
              <h2>{chunk ? "Đoạn nguồn được trích dẫn" : "Trích đoạn xem trước"}</h2>
              {!document.requested_chunk_available ? <p>Đoạn nguồn này không còn ở phiên bản hiện tại. Bạn vẫn có thể mở tài liệu gốc để đối chiếu.</p>
                : excerpt ? <>
                  <p className={styles.location}>{excerpt.page ? `Trang ${excerpt.page}`
                    : [excerpt.section, excerpt.paragraph ? `Đoạn ${excerpt.paragraph}` : null].filter(Boolean).join(" · ") || "Đầu tài liệu"}</p>
                  <div className={styles.excerpt}><Markdown content={excerpt.content} /></div>
                </> : <p>{document.status !== "ready" ? "Tài liệu đang chờ xử lý. Đoạn nguồn sẽ có sau khi hoàn tất." : "Chưa có đoạn văn bản xem trước. Hãy mở tệp gốc."}</p>}
            </section>
          </>}
    </div>
  </main>;
}
