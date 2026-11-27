import { describe, expect, it } from "vitest";
import { guideTopicIds, guideTopics, shouldShowWelcomeGuide, welcomeCards, welcomeGuidePath } from "./study-guide";

describe("study guide entry", () => {
  it("opens the introduction from the username completion destination", () => {
    const url = new URL(welcomeGuidePath, "https://learnstep.example");
    expect(url.pathname).toBe("/study");
    expect(shouldShowWelcomeGuide(url.searchParams.get("welcome"), false, false)).toBe(true);
  });

  it("does not open for regular sign-in, ambiguous flags or another selected destination", () => {
    expect(shouldShowWelcomeGuide(undefined, false, false)).toBe(false);
    expect(shouldShowWelcomeGuide(["1", "1"], false, false)).toBe(false);
    expect(shouldShowWelcomeGuide("1", true, false)).toBe(false);
    expect(shouldShowWelcomeGuide("1", false, true)).toBe(false);
  });

  it("uses seven distinct topics and reuses their illustrations for the three welcome cards", () => {
    expect(new Set(guideTopicIds).size).toBe(7);
    expect(new Set(guideTopicIds.map((id) => guideTopics[id].art)).size).toBe(7);
    expect(welcomeCards.map((card) => guideTopics[card.topic].art)).toEqual(["tutor", "library", "groups"]);
  });

  it("describes the unified study chat flow without legacy mode switching", () => {
    const studySteps = guideTopics.study.steps.join(" ");
    expect(studySteps).not.toContain("Theo tài liệu");
    expect(studySteps).not.toContain("Chọn Tìm kiếm");
    expect(studySteps).toContain("đồ thị");
    expect(studySteps).toContain("ảnh minh họa");
  });
});
