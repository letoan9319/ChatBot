"use client";

import { useState } from "react";
import type { Conversation, StudyDocument, StudyStreak } from "@/core/types";
import { subjects, statuses } from "@/core/validation";
import { StreakFlame, StudyStreakCard } from "./study-streak";
import { SelectField } from "./select-field";
import styles from "./study-overview.module.css";

const formatNumber = new Intl.NumberFormat("vi-VN");
const formatDate = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short", timeZone: "Asia/Ho_Chi_Minh" });

export function StudyOverview({ username, documents, conversations, streak, streakError, loading, unavailable,
  onStudy, onNewConversation, onLibrary, onConversation }: {
  username: string;
  documents: StudyDocument[];
  conversations: Conversation[];
  streak: StudyStreak | null;
  streakError: string;
  loading: boolean;
  unavailable: boolean;
  onStudy: () => void;
  onNewConversation: () => void;
  onLibrary: () => void;
  onConversation: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const ready = documents.filter((document) => document.status === "ready").length;
  const term = query.trim().toLocaleLowerCase("vi-VN");
  const visibleDocuments = documents.filter((document) =>
    (subject === "all" || document.subject === subject) && document.name.toLocaleLowerCase("vi-VN").includes(term));
  const visibleConversations = conversations.filter((conversation) => conversation.title.toLocaleLowerCase("vi-VN").includes(term));
  const validStreak = !streakError && streak !== null;
  const value = (count: number) => loading ? "…" : unavailable ? "—" : formatNumber.format(count);
  const streakValue = (count: number) => validStreak ? formatNumber.format(count) : streakError ? "—" : "…";

  return (
    <section className={styles.overview} aria-label="Tổng quan học tập">
      <div className={styles.inner}>
        <div className={styles.controls}>
          <details className={styles.streakDisclosure} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }} onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}>
            <summary className={styles.streakChip} aria-label={validStreak ? `${streak.current} ngày học liên tiếp, xem chi tiết` : "Xem chuỗi ngày học"}>
              {validStreak && <StreakFlame days={streak.current} compact />}
              <strong>{streakValue(streak?.current ?? 0)}</strong><span>ngày</span>
            </summary>
            <div className={styles.streakDetails}>
              <StudyStreakCard data={streak} error={streakError} />
            </div>
          </details>
          <div className={styles.subjectField}>
            <SelectField label="Lọc tài liệu theo môn học" value={subject} onChange={setSubject}
              options={[{ value: "all", label: "Tất cả môn học" }, ...Object.entries(subjects).map(([value, label]) => ({ value, label }))]} />
          </div>
          <label className={styles.searchField}><span className="sr-only">Tìm tài liệu hoặc phiên học</span>
            <input type="search" value={query} placeholder="Tìm tài liệu hoặc phiên học…" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className={styles.studyButton} onClick={onStudy}>Vào học</button>
        </div>
        <div className={styles.metrics} aria-busy={loading}>
          <article className={styles.metric}>
            <div className={styles.metricTop}><h2>Chuỗi ngày học</h2>
              <span className={styles.metricFlame}>{validStreak && <StreakFlame days={streak.current} />}</span>
            </div>
            <strong className={styles.metricValue}>{streakValue(streak?.current ?? 0)}<span>ngày</span></strong>
            <p className={styles.metricDetail}>{streakError ? "Chưa thể cập nhật chuỗi ngày học."
              : !streak ? "Đang cập nhật…" : streak.today_completed ? "Đã hoàn thành hôm nay"
                : streak.current ? "Học tiếp hôm nay để giữ chuỗi" : "Bắt đầu ngày học đầu tiên"}</p>
          </article>
          <article className={styles.metric}>
            <div className={styles.metricTop}><h2>Tổng ngày học</h2>
              {validStreak && <div className={styles.weekActivity} role="img" aria-label={`Đã học ${streak.week.filter((day) => day.completed).length} trong 7 ngày gần nhất`}>
                {streak.week.map((day) => <span key={day.date} data-completed={day.completed}
                  title={`${formatDate.format(new Date(`${day.date}T12:00:00+07:00`))}: ${day.completed ? "Đã học" : "Chưa học"}`} />)}
              </div>}
            </div>
            <strong className={styles.metricValue}>{streakValue(streak?.total_days ?? 0)}<span>ngày</span></strong>
            <p className={styles.metricDetail}>{validStreak ? `Kỷ lục ${streak.longest} ngày liên tiếp` : streakError ? "Chưa thể cập nhật số ngày học." : "Đang cập nhật…"}</p>
          </article>
          <article className={styles.metric}>
            <div className={styles.metricTop}><h2>Tài liệu sẵn sàng</h2><span className={styles.metricTag}>Thư viện</span></div>
            <strong className={styles.metricValue}>{value(ready)}<span>tài liệu</span></strong>
            <p className={styles.metricDetail}>{loading ? "Đang tải thư viện…" : unavailable ? "Chưa thể cập nhật thư viện."
              : documents.length ? `${ready}/${documents.length} tài liệu đã xử lý xong` : "Tải giáo trình để bắt đầu hỏi đáp"}</p>
          </article>
          <article className={styles.metric}>
            <div className={styles.metricTop}><h2>Phiên học đã lưu</h2><span className={styles.metricTag}>Hội thoại</span></div>
            <strong className={styles.metricValue}>{value(conversations.length)}<span>phiên</span></strong>
            <p className={styles.metricDetail}>{loading ? "Đang tải lịch sử…" : unavailable ? "Chưa thể cập nhật lịch sử."
              : conversations.length ? "Mở lại và tiếp tục điều còn băn khoăn" : "Bắt đầu từ một câu hỏi của bạn"}</p>
          </article>
        </div>
        <div className={styles.recentGrid}>
          <section className={styles.recentSection} aria-label="Phiên học gần đây">
            <div className={styles.sectionHeading}><h2>Học tiếp cùng LearnStep</h2><button onClick={onNewConversation}>Phiên mới</button></div>
            {loading ? <p className={styles.empty} role="status">Đang tải phiên học…</p>
              : unavailable ? <p className={styles.empty}>Chưa tải được phiên học. Hãy thử tải lại trang.</p>
                : visibleConversations.length ? <div className={styles.recentList}>{visibleConversations.slice(0, 3).map((conversation) => (
                  <button key={conversation.id} className={styles.session} onClick={() => onConversation(conversation.id)}>
                    <strong>{conversation.title}</strong><span>{formatDate.format(new Date(conversation.created_at))}</span>
                  </button>
                ))}</div>
                  : <div className={styles.empty}><strong>{term ? "Chưa tìm thấy phiên học phù hợp" : `Chào ${username}, cùng bắt đầu nhé.`}</strong>
                    <p>{term ? "Thử một từ khóa khác hoặc tạo phiên học mới." : "Chọn tài liệu và đặt câu hỏi đầu tiên. Phiên học sẽ được lưu ở đây."}</p>
                  </div>}
          </section>
          <section className={styles.recentSection} aria-label="Tài liệu gần đây">
            <div className={styles.sectionHeading}><h2>Tài liệu của bạn</h2><button onClick={onLibrary}>Mở thư viện</button></div>
            {loading ? <p className={styles.empty} role="status">Đang tải tài liệu…</p>
              : unavailable ? <p className={styles.empty}>Chưa tải được thư viện. Hãy thử tải lại trang.</p>
                : visibleDocuments.length ? <div className={styles.recentList}>{visibleDocuments.slice(0, 3).map((document) => (
                  <button key={document.id} className={styles.document} onClick={onLibrary}>
                    <span><strong>{document.name}</strong><small>{subjects[document.subject as keyof typeof subjects]}</small></span>
                    <span className={`pill ${document.status}`}>{statuses[document.status]}</span>
                  </button>
                ))}</div>
                  : <div className={styles.empty}><strong>{term || subject !== "all" ? "Chưa tìm thấy tài liệu phù hợp" : "Thư viện đang chờ tài liệu đầu tiên"}</strong>
                    <p>{term || subject !== "all" ? "Thử đổi môn học hoặc từ khóa tìm kiếm." : "Thêm PDF hoặc DOCX để trợ giảng tìm nguồn và giải thích cùng bạn."}</p>
                  </div>}
          </section>
        </div>
      </div>
    </section>
  );
}
