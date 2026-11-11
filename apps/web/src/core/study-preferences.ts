export type StudyPreferences = {
  answerFontSize: "normal" | "large";
  sendWithEnter: boolean;
  autoScroll: boolean;
};

export const STUDY_PREFERENCES_KEY = "learnstep-study-preferences-v1";
export const DEFAULT_STUDY_PREFERENCES: StudyPreferences = {
  answerFontSize: "normal",
  sendWithEnter: true,
  autoScroll: true,
};

export function parseStudyPreferences(raw: string | null): StudyPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_STUDY_PREFERENCES };
    const data = value as Record<string, unknown>;
    return {
      answerFontSize: data.answerFontSize === "large" ? "large" : "normal",
      sendWithEnter: typeof data.sendWithEnter === "boolean" ? data.sendWithEnter : true,
      autoScroll: typeof data.autoScroll === "boolean" ? data.autoScroll : true,
    };
  } catch {
    return { ...DEFAULT_STUDY_PREFERENCES };
  }
}

export function shouldSendQuestion(event: {
  key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean;
}, sendWithEnter: boolean) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing &&
    (sendWithEnter || event.ctrlKey || event.metaKey);
}
