import { describe, expect, it } from "vitest";
import { DEFAULT_STUDY_PREFERENCES, parseStudyPreferences, shouldSendQuestion } from "./study-preferences";

describe("study preferences", () => {
  it("keeps explicitly disabled preferences after reading saved settings", () => {
    expect(parseStudyPreferences(JSON.stringify({ answerFontSize: "large", sendWithEnter: false, autoScroll: false })))
      .toEqual({ answerFontSize: "large", sendWithEnter: false, autoScroll: false });
  });
  it("recovers safely from old, incomplete or corrupt browser storage", () => {
    for (const raw of [null, "{broken", "null", "[]", "false", '{"answerFontSize":"huge","sendWithEnter":"false","autoScroll":0}']) {
      expect(parseStudyPreferences(raw)).toEqual(DEFAULT_STUDY_PREFERENCES);
    }
    expect(parseStudyPreferences('{"sendWithEnter":false}'))
      .toEqual({ ...DEFAULT_STUDY_PREFERENCES, sendWithEnter: false });
  });
  it("allows a multiline preference without accidentally sending Enter or IME confirmation", () => {
    const enter = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false };
    expect(shouldSendQuestion(enter, true)).toBe(true);
    expect(shouldSendQuestion(enter, false)).toBe(false);
    expect(shouldSendQuestion({ ...enter, ctrlKey: true }, false)).toBe(true);
    expect(shouldSendQuestion({ ...enter, metaKey: true }, false)).toBe(true);
    expect(shouldSendQuestion({ ...enter, shiftKey: true }, true)).toBe(false);
    expect(shouldSendQuestion({ ...enter, isComposing: true }, true)).toBe(false);
    expect(shouldSendQuestion({ ...enter, ctrlKey: true, isComposing: true }, false)).toBe(false);
    expect(shouldSendQuestion({ ...enter, key: "a" }, true)).toBe(false);
  });
});
