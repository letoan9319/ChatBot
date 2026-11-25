import Image from "next/image";
import type { ReactNode } from "react";
import type { StudyStreak } from "@/core/types";

const weekday = new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "Asia/Ho_Chi_Minh" });
const fullDate = new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeZone: "Asia/Ho_Chi_Minh" });

export function StreakFlame({ days, compact = false }: { days: number; compact?: boolean }) {
  const growth = Math.sqrt(Math.min(30, Math.max(0, days)) / 30);
  const height = compact ? 16 + Math.round(16 * growth) : 22 + Math.round(26 * growth);
  const width = Math.round(height * 20 / 24);
  const active = days > 0;
  return (
    <span className="streak-flame" style={{ width, height }} aria-hidden="true">
      <Image src={active ? "/illustrations/streak-fire.png" : "/illustrations/streak-idle.png"}
        className={active ? "streak-flame-frames" : undefined}
        alt="" width={active ? width * 3 : width} height={height} unoptimized />
    </span>
  );
}

export function StudyStreakCard({ data, error = "", compact = false, summaryIllustration }: {
  data: StudyStreak | null;
  error?: string;
  compact?: boolean;
  summaryIllustration?: ReactNode;
}) {
  if (error || !data) {
    return (
      <section className="study-streak streak-placeholder" aria-label="Chuỗi ngày học">
        <strong>Chuỗi ngày học</strong>
        <p role="status">{error || "Đang tải chuỗi ngày học…"}</p>
      </section>
    );
  }

  const encouragement = data.today_completed
    ? "Hôm nay đã hoàn thành. Hẹn bạn ngày mai!"
    : data.current > 0
      ? "Học tiếp hôm nay để giữ chuỗi của bạn."
      : data.total_days > 0
        ? "Một ngày mới, bắt đầu lại chuỗi của bạn nhé."
        : "Bắt đầu ngày học đầu tiên của bạn.";

  return (
    <section className="study-streak" aria-label="Chuỗi ngày học">
      <div className="streak-summary">
        <div className="streak-count" aria-label={`${data.current} ngày liên tiếp`}>
          {compact ? <StreakFlame days={data.current} compact /> : <span className="streak-flame-slot" aria-hidden="true">
            <StreakFlame days={data.current} />
          </span>}
          <span className="streak-value">
            <strong>{data.current}</strong>
            <span>ngày</span>
          </span>
        </div>
        <div className="streak-copy">
          <h2>Chuỗi ngày học</h2>
          <p>{encouragement}</p>
          <div className="streak-meta">
            <small>Kỷ lục {data.longest} ngày · Tổng {data.total_days} ngày học</small>
            <details className="streak-help">
              <summary>Cách giữ chuỗi</summary>
              <p>Đặt ít nhất một câu hỏi học tập mỗi ngày. Mỗi ngày chỉ tính một lần,
                theo giờ Việt Nam (UTC+7). Bỏ trọn một ngày sẽ bắt đầu lại chuỗi; kỷ lục vẫn được giữ.</p>
            </details>
          </div>
        </div>
        {summaryIllustration}
      </div>
      <ol className="streak-week" aria-label="7 ngày gần nhất">
        {data.week.map((day) => {
          const date = new Date(`${day.date}T00:00:00+07:00`);
          const today = day.date === data.today;
          const label = `${fullDate.format(date)}: ${day.completed ? "Đã học" : "Chưa học"}${today ? ", hôm nay" : ""}`;
          return (
            <li key={day.date} className={`${day.completed ? "is-complete" : ""} ${today ? "is-today" : ""}`}
              aria-label={label} aria-current={today ? "date" : undefined} title={label}>
              <span className="streak-weekday">{weekday.format(date).replace(/^Thứ\s*/, "T")}</span>
              <span className="streak-date">{Number(day.date.slice(-2))}</span>
              <span className="sr-only">{day.completed ? "Đã học" : "Chưa"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
