import { z } from "zod";
import { uuid } from "./validation";

export const learningPlanSchema = z.object({
  id: uuid,
  mode: z.enum(["guided", "self"]),
  revision: z.number().int().min(0).max(2147483646).nullable(),
  content: z.object({
    subject: z.enum(["calculus", "linear-algebra", "physics"]),
    topic: z.string().trim().min(1).max(120),
    goal: z.string().trim().min(1).max(400),
    baseline: z.string().max(300),
    schedule: z.string().max(300),
    documents: z.array(uuid).max(5),
    notes: z.array(z.object({ text: z.string().trim().min(1).max(600), source: uuid.nullable(), chunk: uuid.nullable() })).max(12),
    summary: z.string().max(800),
    cards: z.array(z.object({ front: z.string().trim().min(1).max(200), back: z.string().trim().min(1).max(300) })).max(12),
    attempts: z.array(z.object({ lesson: z.number().int().min(0).max(2), answer: z.number().int().min(0).max(2), date: z.iso.datetime() })).max(30),
    review: z.union([z.literal(""), z.iso.date()]),
    assessment: z.string().max(400),
  }),
});

export type PlanInput = z.infer<typeof learningPlanSchema>;
export type LearningPlan = Omit<PlanInput, "revision"> & { revision: number };

type Lesson = { title: string; explanation: string; practice: string; question: string; options: [string, string, string]; correct: number };
export const lessons: Record<PlanInput["content"]["subject"], [Lesson, Lesson, Lesson]> = {
  calculus: [
    { title: "Giới hạn", explanation: "Giới hạn mô tả giá trị mà hàm tiến gần khi biến tiến tới một điểm.", practice: "Tính giới hạn của 2x + 1 khi x tiến tới 3.", question: "Giới hạn của x² khi x tiến tới 2 là bao nhiêu?", options: ["2", "4", "8"], correct: 1 },
    { title: "Đạo hàm", explanation: "Đạo hàm biểu thị tốc độ thay đổi tức thời. Đạo hàm của xⁿ là nxⁿ⁻¹.", practice: "Tìm tốc độ thay đổi của x³ tại x = 2.", question: "Đạo hàm của x³ tại x = 2 bằng bao nhiêu?", options: ["12", "6", "8"], correct: 0 },
    { title: "Tích phân", explanation: "Tích phân xác định tính tổng tích lũy. Có thể lấy hiệu giá trị nguyên hàm tại hai cận.", practice: "Dùng nguyên hàm x² để tính tích phân của 2x từ 0 đến 3.", question: "Tích phân của 2x từ 0 đến 3 bằng bao nhiêu?", options: ["3", "6", "9"], correct: 2 },
  ],
  "linear-algebra": [
    { title: "Vectơ", explanation: "Cộng vectơ theo từng tọa độ tương ứng.", practice: "Cộng (1, 2) và (3, 4).", question: "Tổng của hai vectơ trên là gì?", options: ["(4, 6)", "(3, 8)", "(2, 2)"], correct: 0 },
    { title: "Ma trận", explanation: "Ma trận m × n có m hàng và n cột.", practice: "Viết một ma trận có hai hàng và ba cột.", question: "Ma trận vừa viết có bao nhiêu phần tử?", options: ["5", "6", "9"], correct: 1 },
    { title: "Hệ phương trình", explanation: "Có thể cộng hoặc trừ các phương trình để khử một ẩn.", practice: "Giải hệ x + y = 5 và x − y = 1.", question: "Nghiệm của hệ là gì?", options: ["(2, 3)", "(1, 4)", "(3, 2)"], correct: 2 },
  ],
  physics: [
    { title: "Chuyển động", explanation: "Vận tốc trung bình bằng độ dời chia cho khoảng thời gian.", practice: "Tính vận tốc khi độ dời là 20 m trong 4 s.", question: "Vận tốc trung bình bằng bao nhiêu?", options: ["5 m/s", "16 m/s", "80 m/s"], correct: 0 },
    { title: "Định luật Newton", explanation: "Hợp lực bằng khối lượng nhân gia tốc: F = ma.", practice: "Tìm hợp lực với m = 2 kg và a = 3 m/s².", question: "Hợp lực bằng bao nhiêu?", options: ["1 N", "5 N", "6 N"], correct: 2 },
    { title: "Động năng", explanation: "Động năng được tính theo công thức E = ½mv².", practice: "Tính động năng khi m = 2 kg và v = 3 m/s.", question: "Động năng bằng bao nhiêu?", options: ["6 J", "9 J", "18 J"], correct: 1 },
  ],
};

export function completedLessons(content: PlanInput["content"]) {
  const firstIncomplete = lessons[content.subject].findIndex((lesson, index) =>
    !content.attempts.some(attempt => attempt.lesson === index && attempt.answer === lesson.correct));
  return firstIncomplete === -1 ? lessons[content.subject].length : firstIncomplete;
}

export function recordAttempt(content: PlanInput["content"], lesson: number, answer: number) {
  const attempts = [{ lesson, answer, date: new Date().toISOString() }, ...content.attempts];
  const retained = attempts.slice(0, 30);
  for (const [index, item] of lessons[content.subject].entries()) {
    if (retained.some(attempt => attempt.lesson === index && attempt.answer === item.correct)) continue;
    const earlierPass = attempts.find(attempt => attempt.lesson === index && attempt.answer === item.correct);
    if (earlierPass) retained[retained.length - 1 - index] = earlierPass;
  }
  return retained;
}

type Content = PlanInput["content"];

export const emptyPlanContent: Content = { subject: "calculus", topic: "", goal: "", baseline: "", schedule: "",
  documents: [], notes: [], summary: "", cards: [], attempts: [], review: "", assessment: "" };

export function planProgress(mode: PlanInput["mode"], content: Content) {
  if (mode === "guided") {
    const done = completedLessons(content);
    const total = lessons[content.subject].length;
    return { done, total, label: `${done}/${total} bài` };
  }
  const steps = [content.documents.length > 0, content.notes.length > 0, content.summary.trim() !== "",
    content.cards.length > 0, content.assessment.trim() !== ""];
  const done = steps.filter(Boolean).length;
  return { done, total: steps.length, label: `${done}/${steps.length} bước tự học` };
}

export function localDate(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  return localDate(new Date(year, month - 1, date + days));
}

export type ReviewTone = "none" | "overdue" | "today" | "upcoming";

export function reviewStatus(review: string, today: string): { tone: ReviewTone; label: string } {
  if (!review) return { tone: "none", label: "Chưa đặt ngày ôn" };
  const [year, month, date] = review.split("-");
  const shown = `${date}/${month}/${year}`;
  if (review < today) return { tone: "overdue", label: `Quá hạn ôn từ ${shown}` };
  if (review === today) return { tone: "today", label: "Ôn hôm nay" };
  return { tone: "upcoming", label: `Ôn ngày ${shown}` };
}

const urgency: Record<ReviewTone, number> = { overdue: 0, today: 1, upcoming: 2, none: 2 };

export function sortByReview<T extends { content: Pick<Content, "review"> }>(plans: T[], today: string) {
  return plans.map((plan, index) => ({ plan, index, rank: urgency[reviewStatus(plan.content.review, today).tone] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.plan);
}

export const paceOptions = [
  "Mỗi ngày 20 phút",
  "2 buổi/tuần, mỗi buổi 30 phút",
  "3 buổi/tuần, mỗi buổi 45 phút",
  "Cuối tuần, mỗi buổi 60 phút",
] as const;

export type PlanTemplate = {
  id: string;
  title: string;
  description: string;
  topic: string;
  goal: string;
  baseline: string;
  schedule: string;
  reviewInDays: number;
};

export const planTemplates: PlanTemplate[] = [
  {
    id: "midterm",
    title: "Ôn thi giữa kỳ",
    description: "Hệ thống lại các dạng bài chính và luyện tốc độ làm bài.",
    topic: "Ôn thi giữa kỳ",
    goal: "Nắm chắc các dạng bài chính và làm được đề giữa kỳ trong thời gian quy định.",
    baseline: "Đã học trên lớp nhưng chưa luyện đề.",
    schedule: paceOptions[2],
    reviewInDays: 7,
  },
  {
    id: "foundation",
    title: "Học lại từ đầu",
    description: "Đi chậm từ khái niệm nền tảng, mỗi ngày một ít.",
    topic: "Kiến thức nền tảng",
    goal: "Hiểu các khái niệm nền tảng và tự giải được bài tập cơ bản.",
    baseline: "Chưa vững kiến thức nền.",
    schedule: paceOptions[0],
    reviewInDays: 3,
  },
  {
    id: "weak-spots",
    title: "Củng cố phần còn yếu",
    description: "Tập trung vào những dạng bài hay làm sai.",
    topic: "Củng cố phần còn yếu",
    goal: "Xác định và khắc phục các phần còn sai khi làm bài vận dụng.",
    baseline: "Làm được bài cơ bản, hay sai ở bài vận dụng.",
    schedule: paceOptions[1],
    reviewInDays: 5,
  },
];

export function contentFromTemplate(template: PlanTemplate | null, mode: PlanInput["mode"], today: string): Content {
  if (!template) return { ...emptyPlanContent };
  return {
    ...emptyPlanContent,
    topic: template.topic,
    goal: template.goal,
    baseline: mode === "guided" ? template.baseline : "",
    schedule: template.schedule,
    review: addDays(today, template.reviewInDays),
  };
}
