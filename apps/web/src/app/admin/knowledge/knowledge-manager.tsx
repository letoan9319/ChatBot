"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { subjects } from "@/core/validation";
import { setPublication } from "./actions";
import styles from "./knowledge.module.css";

export type ManageableDocument = {
  id: string;
  name: string;
  subject: keyof typeof subjects;
  file_type: "pdf" | "docx";
};

export type PublishedDocument = ManageableDocument & {
  description: string;
  published_at: string;
};

const date = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });

function PublicationForm({ id, publish, action, pending }: {
  id: string;
  publish: boolean;
  action: (form: FormData) => void;
  pending: boolean;
}) {
  const [description, setDescription] = useState("");
  return (
    <details className={styles.change}>
      <summary>{publish ? "Công bố" : "Thu hồi"}</summary>
      <form action={action}>
        <fieldset disabled={pending}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value={publish ? "publish" : "revoke"} />
          {publish ? (
            <>
              <p>Người dùng đã đăng nhập có thể mở tệp gốc và dùng nội dung này khi hỏi trợ giảng.</p>
              <label>
                Mô tả trong kho chung (không bắt buộc)
                <textarea name="description" rows={3} maxLength={2000}
                  value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </>
          ) : (
            <p>Tài liệu sẽ rời kho chung và ngừng được dùng làm nguồn chung. Tệp gốc vẫn thuộc về người đã tải lên.</p>
          )}
          <button className={publish ? "button small" : `button secondary small ${styles.danger}`}>
            {pending ? "Đang cập nhật…" : publish ? "Xác nhận công bố" : "Xác nhận thu hồi"}
          </button>
        </fieldset>
      </form>
    </details>
  );
}

export function KnowledgeManager({ documents, published }: {
  documents: ManageableDocument[];
  published: PublishedDocument[];
}) {
  const [feedback, action, pending] = useActionState(setPublication, null);
  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        {feedback && !pending && <p className={styles.feedback} data-error={feedback.error}>{feedback.message}</p>}
      </div>
      <section className={styles.section} aria-labelledby="published-heading">
        <div className={styles.sectionHeading}>
          <h2 id="published-heading">Đang có trong kho chung</h2>
          <span>{published.length} tài liệu</span>
        </div>
        {published.length ? (
          <ul className={styles.list}>
            {published.map((document) => (
              <li className={styles.row} key={document.id}>
                <div className={styles.document}>
                  <Link href={`/study/documents/${document.id}`}>{document.name}</Link>
                  <p>{subjects[document.subject]} · {document.file_type.toUpperCase()} · Công bố ngày {date.format(new Date(document.published_at))}</p>
                  {document.description && <p className={styles.description}>{document.description}</p>}
                </div>
                <PublicationForm id={document.id} publish={false} action={action} pending={pending} />
              </li>
            ))}
          </ul>
        ) : <p className={styles.empty}>Kho chung chưa có tài liệu.</p>}
      </section>
      <section className={styles.section} aria-labelledby="ready-heading">
        <div className={styles.sectionHeading}>
          <h2 id="ready-heading">Tài liệu của bạn có thể công bố</h2>
          <span>{documents.length} tài liệu</span>
        </div>
        {documents.length ? (
          <ul className={styles.list}>
            {documents.map((document) => (
              <li className={styles.row} key={document.id}>
                <div className={styles.document}>
                  <Link href={`/study/documents/${document.id}`}>{document.name}</Link>
                  <p>{subjects[document.subject]} · {document.file_type.toUpperCase()}</p>
                </div>
                <PublicationForm id={document.id} publish action={action} pending={pending} />
              </li>
            ))}
          </ul>
        ) : <p className={styles.empty}>Hãy tải tài liệu lên và chờ xử lý xong để công bố.</p>}
        <div className={styles.sectionFooter}><Link href="/study?library=personal">Mở Tài liệu của tôi</Link></div>
      </section>
    </>
  );
}
