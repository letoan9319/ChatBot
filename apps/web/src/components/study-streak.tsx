import type { StudyStreak } from "@/core/types";

const weekday = new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "Asia/Ho_Chi_Minh" });
const fullDate = new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeZone: "Asia/Ho_Chi_Minh" });

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
          <strong>{data.current}</strong>
          <span>ngày</span>
        </div>
        <div className="streak-copy">
          <h2>Chuỗi ngày học</h2>
          <p>{encouragement}</p>
          <small>Kỷ lục {data.longest} ngày · Tổng {data.total_days} ngày học</small>
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
              <span className="streak-weekday">{weekday.format(date)}</span>
              <span className="streak-date">{Number(day.date.slice(-2))}</span>
              <span className="streak-day-state">{day.completed ? "Đã học" : "Chưa"}</span>
            </li>
          );
        })}
      </ol>
      <details className="streak-help">
        <summary>Cách giữ chuỗi</summary>
        <p>Hoàn thành ít nhất một câu hỏi có câu trả lời kèm nguồn mỗi ngày. Mỗi ngày chỉ tính một lần,
          theo giờ Việt Nam (UTC+7). Bỏ trọn một ngày sẽ bắt đầu lại chuỗi; kỷ lục vẫn được giữ.</p>
      </details>
    </section>
  );
}
