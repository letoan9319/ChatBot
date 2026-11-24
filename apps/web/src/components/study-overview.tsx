"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { Conversation, StudyDocument, StudyStreak } from "@/core/types";
import { normalizeSearch } from "@/core/document-catalog";
import { subjects, statuses } from "@/core/validation";
import { StudyStreakCard } from "./study-streak";
import { SelectField } from "./select-field";
import styles from "./study-overview.module.css";

const formatNumber = new Intl.NumberFormat("vi-VN");
const formatDate = new Intl.DateTimeFormat("vi-VN", {
  day: "numeric", month: "short", timeZone: "Asia/Ho_Chi_Minh",
});
const subjectOptions = [
  { value: "all", label: "Tất cả môn học" },
  ...Object.entries(subjects).map(([value, label]) => ({ value, label })),
];

export function StudyOverview({ username, documents, conversations, streak, streakError, loading, unavailable,
  onNewConversation, onLibrary, onPersonalLibrary, onHistory, onPlans, onConversation }: {
  username: string;
  documents: StudyDocument[];
  conversations: Conversation[];
  streak: StudyStreak | null;
  streakError: string;
  loading: boolean;
  unavailable: boolean;
  onNewConversation: () => void;
  onLibrary: () => void;
  onPersonalLibrary: () => void;
  onHistory: () => void;
  onPlans: () => void;
  onConversation: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const term = normalizeSearch(query);
  const ready = documents.filter((document) => document.status === "ready").length;
  const subjectLabel = (key: string) => subjects[key as keyof typeof subjects] ?? key;
  const visibleDocuments = documents.filter((document) =>
    (subject === "all" || document.subject === subject)
    && normalizeSearch(`${document.name} ${subjectLabel(document.subject)}`).includes(term));
  const visibleConversations = conversations.filter((conversation) => normalizeSearch(conversation.title).includes(term));
  const count = (value: number) => loading ? "…" : unavailable ? "—" : formatNumber.format(value);
  const recentConversation = loading || unavailable ? undefined : conversations[0];

  return (
    <section className={styles.overview} aria-label="Tổng quan học tập">
      <div className={styles.inner}>
        <div className={styles.mainColumn}>
          <section className={styles.welcome} aria-labelledby="overview-welcome">
            <h2 id="overview-welcome">Chào {username}!</h2>
            <p>{recentConversation ? "Mở lại phiên gần nhất hoặc bắt đầu với câu hỏi mới." : "Bắt đầu một phiên hỏi đáp hoặc tìm tài liệu để học."}</p>
            <div className={styles.actions}>
              {recentConversation ? <>
                <button className={styles.primary} onClick={() => onConversation(recentConversation.id)}>Học tiếp</button>
                <button className={styles.secondary} onClick={onNewConversation}>Trò chuyện mới</button>
              </> : <>
                <button className={styles.primary} onClick={onNewConversation}>Trò chuyện mới</button>
                <button className={styles.secondary} onClick={onLibrary}>Mở kho tài liệu</button>
              </>}
            </div>
            <Image className={`${styles.illustration} ${styles.mascot}`}
              src="/illustrations/study-frog.webp" alt="" width={432} height={314} loading="eager" unoptimized />
          </section>

          <div className={styles.metrics} aria-busy={loading}>
            <button className={styles.metric} onClick={onHistory}>
              <span>Phiên học đã lưu</span><strong>{count(conversations.length)}</strong>
            </button>
            <button className={styles.metric} onClick={onPersonalLibrary}>
              <span>Tài liệu cá nhân sẵn sàng</span><strong>{count(ready)}</strong>
            </button>
          </div>

          <div className={styles.resources}>
            <label className={styles.search}>
              <span className="sr-only">Tìm tài liệu hoặc phiên học gần đây</span>
              <input type="search" value={query} placeholder="Tìm tài liệu hoặc phiên học…"
                onChange={(event) => setQuery(event.target.value)} />
            </label>

            <section className={styles.panel} aria-labelledby="overview-sessions">
              <div className={styles.heading}>
                <h2 id="overview-sessions">Phiên học gần đây</h2>
                <button className={styles.textAction} onClick={onHistory}>Xem lịch sử</button>
              </div>
              {loading ? <p className={styles.empty} role="status">Đang tải phiên học…</p>
                : unavailable ? <p className={styles.empty}>Chưa tải được phiên học. Hãy thử tải lại trang.</p>
                  : visibleConversations.length ? <ul className={styles.list}>{visibleConversations.slice(0, 4).map((conversation) => (
                    <li key={conversation.id}>
                      <button className={styles.row} onClick={() => onConversation(conversation.id)}>
                        <strong>{conversation.title}</strong>
                        <time dateTime={conversation.created_at}>{formatDate.format(new Date(conversation.created_at))}</time>
                      </button>
                    </li>
                  ))}</ul>
                    : <p className={styles.empty}>{term ? "Không tìm thấy phiên học phù hợp." : "Phiên học sẽ xuất hiện ở đây sau khi bạn bắt đầu trò chuyện."}</p>}
            </section>

            <section className={styles.panel} aria-labelledby="overview-documents">
              <div className={styles.heading}>
                <h2 id="overview-documents">Tài liệu của tôi</h2>
                <button className={styles.textAction} onClick={onPersonalLibrary}>Xem tất cả</button>
              </div>
              <div className={styles.subject}>
                <SelectField label="Lọc tài liệu theo môn học" value={subject} onChange={setSubject} options={subjectOptions} />
              </div>
              {loading ? <p className={styles.empty} role="status">Đang tải tài liệu…</p>
                : unavailable ? <p className={styles.empty}>Chưa tải được tài liệu. Hãy thử tải lại trang.</p>
                  : visibleDocuments.length ? <ul className={styles.list}>{visibleDocuments.slice(0, 4).map((document) => (
                    <li key={document.id}>
                      <Link className={styles.row} href={`/study/documents/${document.id}`}>
                        <span className={styles.documentName}>
                          <strong>{document.name}</strong>
                          <small>{subjectLabel(document.subject)}</small>
                        </span>
                        <span className={`pill ${document.status}`}>{statuses[document.status]}</span>
                      </Link>
                    </li>
                  ))}</ul>
                    : term || subject !== "all" ? <p className={styles.empty}>Không tìm thấy tài liệu phù hợp.</p>
                      : <div className={`${styles.empty} ${styles.emptyLibrary}`}>
                        <Image className={`${styles.illustration} ${styles.books}`}
                          src="/illustrations/study-books.webp" alt="" width={192} height={129} unoptimized />
                        <p>Bạn có thể tải PDF hoặc DOCX lên từ kho tài liệu.</p>
                      </div>}
            </section>
          </div>
        </div>

        <aside className={styles.sideColumn} aria-label="Tiến độ và kế hoạch">
          <div className={`${styles.panel} ${styles.activity}`}>
            <StudyStreakCard data={streak} error={streakError} compact summaryIllustration={
              <Image className={`${styles.illustration} ${styles.calendar}`}
                src="/illustrations/study-calendar.webp" alt="" width={160} height={115} unoptimized />
            } />
          </div>
          <section className={`${styles.panel} ${styles.plan}`} aria-labelledby="overview-plan">
            <h2 id="overview-plan">Kế hoạch học tập</h2>
            <p>Đặt mục tiêu và theo dõi tiến độ theo từng chủ đề.</p>
            <button className={styles.secondary} onClick={onPlans}>Mở kế hoạch</button>
          </section>
          {recentConversation && <button className={styles.secondary} onClick={onLibrary}>Mở kho tài liệu chung</button>}
        </aside>
      </div>
    </section>
  );
}
