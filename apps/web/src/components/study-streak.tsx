import type { StudyStreak } from "@/core/types";

const weekday = new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "Asia/Ho_Chi_Minh" });
const fullDate = new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeZone: "Asia/Ho_Chi_Minh" });

export function StreakFlame({ days, compact = false }: { days: number; compact?: boolean }) {
  const growth = Math.sqrt(Math.min(30, Math.max(0, days)) / 30);
  const height = compact ? 16 + Math.round(16 * growth) : 22 + Math.round(26 * growth);
  return (
    <svg className={`streak-flame${days === 0 ? " is-idle" : ""}`}
      width={Math.round(height * 0.8)} height={height}
      viewBox="0 0 32 40" fill="none" aria-hidden="true" focusable="false">
      <path className="streak-flame-outer"
        d="M18 2c1 8 10 12 10 22a12 12 0 0 1-24 0c0-6 3-11 7-15-1 5 1 9 4 10-1-7 1-12 3-17Z"
        strokeWidth="1.5" strokeLinejoin="round" />
      <path className="streak-flame-inner"
        d="M17 20c0 4 5 6 5 11a6 6 0 0 1-12 0c0-4 3-7 7-11Z" />
    </svg>
  );
}

export function StudyStreakCard({ data, error = "" }: { data: StudyStreak | null; error?: string }) {
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
          <span className="streak-flame-slot" aria-hidden="true">
            <StreakFlame days={data.current} />
          </span>
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
              <p>Hoàn thành ít nhất một câu hỏi có câu trả lời kèm nguồn mỗi ngày. Mỗi ngày chỉ tính một lần,
                theo giờ Việt Nam (UTC+7). Bỏ trọn một ngày sẽ bắt đầu lại chuỗi; kỷ lục vẫn được giữ.</p>
            </details>
          </div>
        </div>
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
