import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyStreak } from "@/core/types";
import { StudyStreakCard } from "./study-streak";

const streak: StudyStreak = {
  current: 3, longest: 7, total_days: 12, today: "2026-10-22", today_completed: false,
  last_study_date: "2026-10-21", timezone: "Asia/Ho_Chi_Minh",
  week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${16 + i}`, completed: i >= 3 && i < 6 })),
};

describe("learning streak", () => {
  it("shows the record, days completed, and today's remaining goal with an accessible calendar", () => {
    const html = renderToStaticMarkup(<StudyStreakCard data={streak} />);
    expect(html).toContain('aria-label="3 ngày liên tiếp"');
    expect(html).toContain("Kỷ lục 7 ngày");
    expect(html).toContain("Tổng 12 ngày học");
    expect(html).toContain("Học tiếp hôm nay");
    expect(html.match(/<li /g)).toHaveLength(7);
    expect(html.match(/>Đã học</g)).toHaveLength(3);
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("UTC+7");
  });
  it("distinguishes a completed goal, first day, and a broken streak", () => {
    expect(renderToStaticMarkup(<StudyStreakCard data={{ ...streak, today_completed: true }} />))
      .toContain("Hôm nay đã hoàn thành");
    expect(renderToStaticMarkup(<StudyStreakCard data={{ ...streak, current: 0, total_days: 0 }} />))
      .toContain("Bắt đầu ngày học đầu tiên");
    expect(renderToStaticMarkup(<StudyStreakCard data={{ ...streak, current: 0 }} />))
      .toContain("bắt đầu lại chuỗi");
  });
  it("does not invent a zero streak while loading or display stale results after a failed refresh", () => {
    const loading = renderToStaticMarkup(<StudyStreakCard data={null} />);
    expect(loading).toContain("Đang tải");
    expect(loading).not.toContain("ngày liên tiếp");
    const unavailable = renderToStaticMarkup(<StudyStreakCard data={streak} error="Chưa thể cập nhật streak." />);
    expect(unavailable).toContain("Chưa thể cập nhật streak.");
    expect(unavailable).not.toContain("ngày liên tiếp");
  });
});
