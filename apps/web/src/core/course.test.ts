import { describe, expect, it } from "vitest";
import {
  chapterProgress, course, courseProgress, draftPrompt, findLesson, lessonIdSchema, lessonSaveSchema, lessonStates,
  nextLesson, parseDraft, subjectLessons, tutorPrompt, usedSources,
} from "./course";
import { messageSchema } from "./validation";

// Mirrors the worker's EXERCISE_REQUEST and CONCEPT_QUESTION patterns (rag.py) with Unicode word boundaries.
const word = "[\\p{L}\\p{N}_]";
const exerciseRequest = new RegExp(
  `(?<!${word})(?:tính (?:giá trị|đạo hàm|tích phân|giới hạn|nghiệm)|(?:giải|làm) (?:bài|đề|phương trình|hệ phương trình)`
  + `|chứng minh rằng|tìm nghiệm|chọn đáp án|bằng bao nhiêu|solve|calculate)(?!${word})|^\\s*(?:hãy )?tính [^\\p{L}\\p{N}_\\s]*\\d`,
  "iu",
);
const conceptQuestion = new RegExp(`(?<!${word})(?:khái niệm|định nghĩa|là gì|trực quan|nguyên lý)(?!${word})`, "iu");

const passed = (id: string) => ({ lesson_id: id, best_score: 100, attempts: 1, passed_at: "2026-11-28T00:00:00Z" });

describe("course outline", () => {
  it("has eight chapters per subject with stable, unique lesson ids", () => {
    const ids = new Set<string>();
    for (const chapters of Object.values(course)) {
      expect(chapters).toHaveLength(8);
      for (const chapter of chapters) {
        expect(chapter.lessons.length).toBeGreaterThanOrEqual(2);
        for (const lesson of chapter.lessons) {
          expect(lesson.id).toMatch(/^(calculus|linear-algebra|physics)\.c[1-9]\d?\.l[1-9]\d?$/);
          expect(ids.has(lesson.id)).toBe(false);
          ids.add(lesson.id);
        }
      }
    }
    expect(findLesson("calculus.c3.l1")?.lesson.title).toBe("Định nghĩa và ý nghĩa đạo hàm");
    expect(findLesson("calculus.c3.l1")?.number).toBe("3.1");
    expect(lessonIdSchema.safeParse("calculus.c9.l1").success).toBe(false);
  });

  it("builds draft prompts the chat accepts and the worker treats as concept explanations", () => {
    for (const subject of Object.keys(course) as (keyof typeof course)[]) {
      for (const lesson of subjectLessons(subject)) {
        for (const prompt of [draftPrompt(lesson.id), tutorPrompt(lesson.id)]) {
          expect(messageSchema.safeParse({ question: prompt, documentIds: [], key: crypto.randomUUID(), subject }).success).toBe(true);
          expect(prompt, lesson.id).not.toMatch(exerciseRequest);
          expect(prompt).toMatch(conceptQuestion);
        }
      }
    }
  });
});

describe("course progress", () => {
  it("unlocks lessons strictly in order and keeps later passes visible", () => {
    const [first, second, third] = subjectLessons("physics");
    let states = lessonStates("physics", []);
    expect([states.get(first.id), states.get(second.id), states.get(third.id)]).toEqual(["current", "locked", "locked"]);
    states = lessonStates("physics", [passed(first.id), passed(third.id)]);
    expect([states.get(first.id), states.get(second.id), states.get(third.id)]).toEqual(["passed", "current", "open"]);
    expect(nextLesson("physics", [passed(first.id)])?.id).toBe(second.id);
    expect(nextLesson("physics", subjectLessons("physics").map(lesson => passed(lesson.id)))).toBeNull();
  });

  it("counts finished lessons per subject and chapter, ignoring failed attempts", () => {
    const chapter = course.calculus[0];
    const progress = [passed(chapter.lessons[0].id), { ...passed(chapter.lessons[1].id), passed_at: null }, passed("physics.c1.l1")];
    expect(chapterProgress(chapter, progress)).toEqual({ done: 1, total: 3 });
    expect(courseProgress("calculus", progress)).toEqual({ done: 1, total: 24 });
  });
});

describe("lesson drafts", () => {
  const answer = [
    "## Khái niệm",
    "Đạo hàm đo tốc độ thay đổi [S1].",
    "",
    "## Câu hỏi kiểm tra",
    "**Câu 1:** Đạo hàm của $x^2$ là gì?",
    "A. $x$",
    "B. $2x$",
    "C. $x^2$",
    "D. $2$",
    "Đáp án: B",
    "Giải thích: Quy tắc lũy thừa.",
    "",
    "Câu 2. Câu thiếu đáp án",
    "A. Một",
    "B. Hai",
    "",
    "Câu 3: Đạo hàm của hằng số?",
    "A) 0",
    "B) 1",
    "**Đáp án:** A",
  ].join("\n");

  it("separates the lecture from parseable quiz questions", () => {
    const draft = parseDraft(answer);
    expect(draft.body).toBe("## Khái niệm\nĐạo hàm đo tốc độ thay đổi [S1].");
    expect(draft.quiz).toEqual([
      { question: "Đạo hàm của $x^2$ là gì?", options: ["$x$", "$2x$", "$x^2$", "$2$"], correct: 1, explanation: "Quy tắc lũy thừa." },
      { question: "Đạo hàm của hằng số?", options: ["0", "1"], correct: 0, explanation: undefined },
    ]);
    expect(parseDraft("Chỉ có bài giảng").quiz).toEqual([]);
  });

  it("keeps only cited sources and validates what managers save", () => {
    const source = (label: string) => ({ label, document_id: "318b12a1-0c59-45a3-bd28-5304d98b92e9", document_name: "Giáo trình", page: 3, chunk_id: null });
    expect(usedSources("Theo [S2].", [source("S1"), source("S2")]).map(item => item.label)).toEqual(["S2"]);
    const value = { lessonId: "calculus.c1.l1", body: "Bài", quiz: parseDraft(answer).quiz, sources: [source("S1")], publish: true };
    expect(lessonSaveSchema.safeParse(value).success).toBe(true);
    expect(lessonSaveSchema.safeParse({ ...value, body: " " }).success).toBe(false);
    expect(lessonSaveSchema.safeParse({ ...value, quiz: [{ question: "?", options: ["a", "b"], correct: 2 }] }).success).toBe(false);
    expect(lessonSaveSchema.safeParse({ ...value, lessonId: "calculus.c1.l9" }).success).toBe(false);
  });
});
