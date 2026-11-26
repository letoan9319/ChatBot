import { describe, expect, it } from "vitest";
import {
  addDays, contentFromTemplate, emptyPlanContent, learningPlanSchema, lessons, localDate, planProgress,
  planTemplates, reviewStatus, sortByReview,
} from "./learning-plan";

describe("learning plan helpers", () => {
  it("formats local dates and adds days across month boundaries", () => {
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("labels review dates relative to today", () => {
    const today = "2026-11-27";
    expect(reviewStatus("", today)).toEqual({ tone: "none", label: "Chưa đặt ngày ôn" });
    expect(reviewStatus("2026-11-20", today)).toEqual({ tone: "overdue", label: "Quá hạn ôn từ 20/11/2026" });
    expect(reviewStatus(today, today).tone).toBe("today");
    expect(reviewStatus("2026-12-01", today)).toEqual({ tone: "upcoming", label: "Ôn ngày 01/12/2026" });
  });

  it("puts overdue and due-today plans first while keeping the rest in order", () => {
    const today = "2026-11-27";
    const plan = (id: string, review: string) => ({ id, content: { review } });
    const sorted = sortByReview([plan("a", ""), plan("b", "2026-12-01"), plan("c", today), plan("d", "2026-11-01")], today);
    expect(sorted.map(item => item.id)).toEqual(["d", "c", "a", "b"]);
  });

  it("measures guided progress by passed lessons and self study by completed steps", () => {
    const lesson = lessons.calculus[0];
    const guided = { ...emptyPlanContent, attempts: [{ lesson: 0, answer: lesson.correct, date: new Date().toISOString() }] };
    expect(planProgress("guided", guided)).toEqual({ done: 1, total: 3, label: "1/3 bài" });
    const self = { ...emptyPlanContent, summary: "Tóm tắt", cards: [{ front: "a", back: "b" }] };
    expect(planProgress("self", self)).toEqual({ done: 2, total: 5, label: "2/5 bước tự học" });
  });

  it("builds valid plan content from every template", () => {
    for (const template of planTemplates) {
      const content = contentFromTemplate(template, "guided", "2026-11-27");
      expect(content.review).toBe(addDays("2026-11-27", template.reviewInDays));
      expect(learningPlanSchema.safeParse({ id: "318b12a1-0c59-45a3-bd28-5304d98b92e9", mode: "guided", revision: null, content }).success).toBe(true);
      expect(contentFromTemplate(template, "self", "2026-11-27").baseline).toBe("");
    }
    expect(contentFromTemplate(null, "self", "2026-11-27")).toEqual(emptyPlanContent);
  });
});
