import { z } from "zod";
import { subjects, type Subject } from "./validation";

export type CourseLesson = { id: string; title: string; objectives: string[] };
export type CourseChapter = { id: string; number: number; title: string; summary: string; lessons: CourseLesson[] };

type Outline = [title: string, summary: string, lessons: [title: string, objectives: string[]][]][];

const outlines: Record<Subject, Outline> = {
  calculus: [
    ["Hàm số và giới hạn", "Ôn lại hàm số và làm quen với khái niệm giới hạn.", [
      ["Hàm số và đồ thị", ["Nhận biết tập xác định, tập giá trị và đồ thị của hàm sơ cấp", "Thực hiện phép hợp hàm và tìm hàm ngược"]],
      ["Giới hạn của hàm số", ["Hiểu định nghĩa giới hạn và giới hạn một phía", "Áp dụng các quy tắc cơ bản để tìm giới hạn"]],
      ["Các dạng vô định", ["Khử dạng 0/0 và ∞/∞ bằng biến đổi đại số", "Dùng các giới hạn đặc biệt và vô cùng bé tương đương"]],
    ]],
    ["Hàm số liên tục", "Tính liên tục và các định lý quan trọng trên đoạn.", [
      ["Liên tục tại một điểm", ["Kiểm tra tính liên tục của hàm tại một điểm", "Phân loại điểm gián đoạn"]],
      ["Liên tục trên khoảng và đoạn", ["Xét tính liên tục của hàm sơ cấp và hàm ghép", "Nhận biết vai trò của đoạn đóng"]],
      ["Định lý giá trị trung gian", ["Phát biểu định lý giá trị trung gian và định lý Weierstrass", "Chứng minh phương trình có nghiệm trên một khoảng"]],
    ]],
    ["Đạo hàm", "Khái niệm đạo hàm và các quy tắc tính.", [
      ["Định nghĩa và ý nghĩa đạo hàm", ["Dùng định nghĩa để tìm đạo hàm", "Hiểu ý nghĩa hình học và vật lý của đạo hàm"]],
      ["Các quy tắc đạo hàm", ["Áp dụng quy tắc tổng, tích, thương và hàm hợp", "Nắm đạo hàm của các hàm sơ cấp cơ bản"]],
      ["Đạo hàm cấp cao và vi phân", ["Tìm đạo hàm cấp cao", "Dùng vi phân để tính gần đúng"]],
    ]],
    ["Ứng dụng của đạo hàm", "Dùng đạo hàm để khảo sát hàm và tìm giới hạn.", [
      ["Định lý giá trị trung bình", ["Phát biểu định lý Rolle và Lagrange", "Áp dụng để chứng minh bất đẳng thức"]],
      ["Quy tắc L'Hôpital", ["Nhận biết điều kiện áp dụng quy tắc L'Hôpital", "Khử các dạng vô định bằng đạo hàm"]],
      ["Khảo sát hàm số và cực trị", ["Tìm khoảng đơn điệu, cực trị và điểm uốn", "Vận dụng vào bài toán tối ưu đơn giản"]],
    ]],
    ["Tích phân bất định", "Nguyên hàm và các phương pháp tìm nguyên hàm.", [
      ["Nguyên hàm và bảng cơ bản", ["Hiểu quan hệ giữa nguyên hàm và đạo hàm", "Dùng bảng nguyên hàm cơ bản"]],
      ["Phương pháp đổi biến", ["Chọn phép đổi biến phù hợp", "Tính nguyên hàm bằng đổi biến"]],
      ["Tích phân từng phần và hàm hữu tỉ", ["Áp dụng công thức tích phân từng phần", "Phân tích hàm hữu tỉ thành phân thức đơn giản"]],
    ]],
    ["Tích phân xác định", "Tích phân Riemann và định lý cơ bản của giải tích.", [
      ["Định nghĩa tích phân xác định", ["Hiểu tổng Riemann và ý nghĩa diện tích", "Nắm các tính chất của tích phân xác định"]],
      ["Định lý cơ bản của giải tích", ["Phát biểu công thức Newton-Leibniz", "Lấy đạo hàm của tích phân cận biến thiên"]],
      ["Tích phân suy rộng", ["Phân biệt tích phân suy rộng loại 1 và loại 2", "Xét sự hội tụ bằng định nghĩa và so sánh"]],
    ]],
    ["Ứng dụng của tích phân", "Tính diện tích, thể tích và độ dài bằng tích phân.", [
      ["Diện tích hình phẳng", ["Lập tích phân tính diện tích giữa các đường cong", "Chọn biến lấy tích phân phù hợp"]],
      ["Thể tích vật thể tròn xoay", ["Tính thể tích bằng phương pháp đĩa và vỏ trụ", "Nhận biết trục quay và miền quay"]],
      ["Độ dài cung và diện tích mặt", ["Tính độ dài đường cong phẳng", "Tính diện tích mặt tròn xoay"]],
    ]],
    ["Chuỗi số", "Chuỗi số và các tiêu chuẩn hội tụ.", [
      ["Khái niệm chuỗi số", ["Hiểu tổng riêng và sự hội tụ của chuỗi", "Nhận biết chuỗi hình học và điều kiện cần hội tụ"]],
      ["Chuỗi số dương", ["Áp dụng tiêu chuẩn so sánh, D'Alembert và Cauchy", "Dùng tiêu chuẩn tích phân"]],
      ["Chuỗi đan dấu", ["Áp dụng tiêu chuẩn Leibniz", "Phân biệt hội tụ tuyệt đối và bán hội tụ"]],
    ]],
  ],
  "linear-algebra": [
    ["Ma trận", "Các phép toán trên ma trận và ma trận khả nghịch.", [
      ["Khái niệm và các loại ma trận", ["Nhận biết cấp và các loại ma trận đặc biệt", "Hiểu ký hiệu phần tử của ma trận"]],
      ["Các phép toán ma trận", ["Thực hiện cộng, nhân vô hướng, nhân ma trận và chuyển vị", "Nắm các tính chất của phép nhân ma trận"]],
      ["Ma trận nghịch đảo", ["Kiểm tra ma trận khả nghịch", "Tìm ma trận nghịch đảo bằng biến đổi sơ cấp"]],
    ]],
    ["Định thức", "Định nghĩa, tính chất và cách tính định thức.", [
      ["Định nghĩa định thức", ["Tính định thức cấp 2 và cấp 3", "Hiểu khai triển theo hàng và cột"]],
      ["Tính chất định thức", ["Áp dụng tính chất để đơn giản hóa định thức", "Hiểu ảnh hưởng của phép biến đổi sơ cấp"]],
      ["Ứng dụng định thức", ["Tìm ma trận nghịch đảo bằng ma trận phụ hợp", "Áp dụng quy tắc Cramer"]],
    ]],
    ["Hệ phương trình tuyến tính", "Giải và biện luận hệ phương trình tuyến tính.", [
      ["Phương pháp Gauss", ["Đưa ma trận về dạng bậc thang", "Giải hệ bằng phương pháp khử Gauss"]],
      ["Hạng ma trận và định lý Kronecker-Capelli", ["Tính hạng của ma trận", "Biện luận số nghiệm của hệ"]],
      ["Hệ thuần nhất", ["Mô tả nghiệm tổng quát của hệ thuần nhất", "Hiểu cấu trúc tập nghiệm"]],
    ]],
    ["Không gian vectơ", "Không gian con, độc lập tuyến tính, cơ sở và số chiều.", [
      ["Không gian và không gian con", ["Kiểm tra các tiên đề không gian vectơ", "Nhận biết không gian con"]],
      ["Độc lập và phụ thuộc tuyến tính", ["Kiểm tra hệ vectơ độc lập tuyến tính", "Biểu diễn vectơ qua tổ hợp tuyến tính"]],
      ["Cơ sở, số chiều và tọa độ", ["Tìm cơ sở và số chiều", "Đổi tọa độ khi đổi cơ sở"]],
    ]],
    ["Ánh xạ tuyến tính", "Ánh xạ tuyến tính và ma trận biểu diễn.", [
      ["Định nghĩa ánh xạ tuyến tính", ["Kiểm tra một ánh xạ có tuyến tính không", "Nhận biết các ánh xạ tuyến tính thường gặp"]],
      ["Nhân và ảnh", ["Tìm nhân và ảnh của ánh xạ tuyến tính", "Áp dụng định lý số chiều"]],
      ["Ma trận của ánh xạ tuyến tính", ["Lập ma trận biểu diễn theo cơ sở", "Hiểu ma trận đồng dạng khi đổi cơ sở"]],
    ]],
    ["Trị riêng và vectơ riêng", "Trị riêng, vectơ riêng và chéo hóa ma trận.", [
      ["Trị riêng và vectơ riêng", ["Lập phương trình đặc trưng", "Tìm trị riêng và vectơ riêng"]],
      ["Chéo hóa ma trận", ["Nêu điều kiện chéo hóa được", "Chéo hóa ma trận vuông"]],
      ["Ứng dụng chéo hóa", ["Tính lũy thừa của ma trận", "Nhận biết ứng dụng trong hệ động lực rời rạc"]],
    ]],
    ["Không gian Euclid", "Tích vô hướng, trực giao và chéo hóa trực giao.", [
      ["Tích vô hướng và chuẩn", ["Tính tích vô hướng, độ dài và góc", "Nắm bất đẳng thức Cauchy-Schwarz"]],
      ["Trực giao hóa Gram-Schmidt", ["Kiểm tra hệ trực giao và trực chuẩn", "Áp dụng quá trình Gram-Schmidt"]],
      ["Chéo hóa trực giao", ["Chéo hóa trực giao ma trận đối xứng", "Hiểu tính chất trị riêng của ma trận đối xứng"]],
    ]],
    ["Dạng toàn phương", "Đưa dạng toàn phương về dạng chính tắc.", [
      ["Dạng toàn phương và ma trận", ["Viết ma trận của dạng toàn phương", "Đổi biến tuyến tính trên dạng toàn phương"]],
      ["Đưa về dạng chính tắc", ["Dùng phương pháp Lagrange", "Dùng chéo hóa trực giao"]],
      ["Dạng toàn phương xác định dấu", ["Áp dụng tiêu chuẩn Sylvester", "Phân loại dạng toàn phương"]],
    ]],
  ],
  physics: [
    ["Động học chất điểm", "Mô tả chuyển động bằng vị trí, vận tốc và gia tốc.", [
      ["Vận tốc và gia tốc", ["Phân biệt vận tốc trung bình và tức thời", "Tính gia tốc từ phương trình chuyển động"]],
      ["Chuyển động thẳng", ["Vận dụng cho chuyển động thẳng đều và biến đổi đều", "Đọc đồ thị vị trí và vận tốc"]],
      ["Chuyển động cong và ném xiên", ["Phân tích chuyển động ném xiên", "Tính gia tốc tiếp tuyến và pháp tuyến"]],
    ]],
    ["Động lực học chất điểm", "Các định luật Newton và các lực cơ học.", [
      ["Các định luật Newton", ["Phát biểu ba định luật Newton", "Vẽ giản đồ lực cho vật"]],
      ["Các lực cơ học", ["Tính trọng lực, phản lực, lực ma sát và lực đàn hồi", "Phân tích hệ vật có ròng rọc"]],
      ["Hệ quy chiếu phi quán tính", ["Hiểu lực quán tính", "Phân tích chuyển động trong hệ quy chiếu có gia tốc"]],
    ]],
    ["Công và năng lượng", "Công, động năng, thế năng và định luật bảo toàn cơ năng.", [
      ["Công và công suất", ["Tính công của lực không đổi và biến đổi", "Tính công suất"]],
      ["Động năng và thế năng", ["Áp dụng định lý động năng", "Hiểu lực thế và thế năng"]],
      ["Bảo toàn cơ năng", ["Áp dụng định luật bảo toàn cơ năng", "Xét trường hợp có lực ma sát"]],
    ]],
    ["Động lượng và va chạm", "Động lượng, xung lượng và các loại va chạm.", [
      ["Động lượng và xung lượng", ["Tính động lượng và xung lượng của lực", "Liên hệ xung lượng với biến thiên động lượng"]],
      ["Bảo toàn động lượng", ["Nhận biết hệ kín", "Áp dụng bảo toàn động lượng"]],
      ["Va chạm đàn hồi và mềm", ["Phân biệt va chạm đàn hồi và không đàn hồi", "Phân tích va chạm một chiều"]],
    ]],
    ["Cơ học vật rắn", "Chuyển động quay, momen quán tính và momen động lượng.", [
      ["Chuyển động quay của vật rắn", ["Mô tả chuyển động quay bằng vận tốc góc và gia tốc góc", "Liên hệ đại lượng góc và đại lượng dài"]],
      ["Momen lực và momen quán tính", ["Tính momen quán tính của vật đơn giản", "Áp dụng phương trình động lực học vật rắn quay"]],
      ["Momen động lượng", ["Áp dụng định luật bảo toàn momen động lượng", "Tính động năng quay"]],
    ]],
    ["Dao động cơ", "Dao động điều hòa, tắt dần và cưỡng bức.", [
      ["Dao động điều hòa", ["Viết phương trình dao động điều hòa", "Tính chu kỳ của con lắc lò xo và con lắc đơn"]],
      ["Năng lượng dao động", ["Tính năng lượng của dao động điều hòa", "Tổng hợp hai dao động cùng phương"]],
      ["Dao động tắt dần và cưỡng bức", ["Hiểu nguyên nhân dao động tắt dần", "Nhận biết hiện tượng cộng hưởng"]],
    ]],
    ["Nhiệt học", "Thuyết động học phân tử và nguyên lý thứ nhất nhiệt động lực học.", [
      ["Khí lý tưởng", ["Áp dụng phương trình trạng thái khí lý tưởng", "Hiểu ý nghĩa vi mô của nhiệt độ và áp suất"]],
      ["Nguyên lý thứ nhất", ["Tính nội năng, công và nhiệt lượng", "Áp dụng cho các quá trình đẳng tích, đẳng áp, đẳng nhiệt"]],
      ["Quá trình đoạn nhiệt", ["Viết phương trình quá trình đoạn nhiệt", "Tính công trong quá trình đoạn nhiệt"]],
    ]],
    ["Nguyên lý thứ hai nhiệt động lực học", "Máy nhiệt, chu trình Carnot và entropy.", [
      ["Máy nhiệt và máy lạnh", ["Tính hiệu suất máy nhiệt", "Tính hệ số làm lạnh"]],
      ["Chu trình Carnot", ["Mô tả các giai đoạn của chu trình Carnot", "Tính hiệu suất Carnot"]],
      ["Entropy", ["Hiểu khái niệm entropy", "Tính biến thiên entropy trong quá trình đơn giản"]],
    ]],
  ],
};

export const course: Record<Subject, CourseChapter[]> = Object.fromEntries(
  (Object.keys(outlines) as Subject[]).map(subject => [subject, outlines[subject].map(([title, summary, lessons], index) => ({
    id: `${subject}.c${index + 1}`,
    number: index + 1,
    title,
    summary,
    lessons: lessons.map(([lessonTitle, objectives], lessonIndex) => ({
      id: `${subject}.c${index + 1}.l${lessonIndex + 1}`,
      title: lessonTitle,
      objectives,
    })),
  }))]),
) as Record<Subject, CourseChapter[]>;

const allLessons = new Map<string, { subject: Subject; chapter: CourseChapter; lesson: CourseLesson; number: string }>();
for (const subject of Object.keys(course) as Subject[]) {
  for (const chapter of course[subject]) {
    chapter.lessons.forEach((lesson, index) =>
      allLessons.set(lesson.id, { subject, chapter, lesson, number: `${chapter.number}.${index + 1}` }));
  }
}

export const lessonIdSchema = z.string().refine(id => allLessons.has(id), "Bài học không tồn tại.");
export const findLesson = (id: string) => allLessons.get(id);
export const subjectLessons = (subject: Subject) => course[subject].flatMap(chapter => chapter.lessons);

export type LessonProgress = { lesson_id: string; best_score: number; attempts: number; passed_at: string | null };

export type LessonState = "passed" | "current" | "open" | "locked";

/** A lesson unlocks once every lesson before it in the course has been passed. */
export function lessonStates(subject: Subject, progress: LessonProgress[]) {
  const passed = new Set(progress.filter(item => item.passed_at).map(item => item.lesson_id));
  const states = new Map<string, LessonState>();
  let blocked = false;
  for (const lesson of subjectLessons(subject)) {
    if (passed.has(lesson.id) && !blocked) states.set(lesson.id, "passed");
    else if (!blocked) { states.set(lesson.id, "current"); blocked = true; }
    else states.set(lesson.id, passed.has(lesson.id) ? "open" : "locked");
  }
  return states;
}

export function nextLesson(subject: Subject, progress: LessonProgress[]) {
  const states = lessonStates(subject, progress);
  return subjectLessons(subject).find(lesson => states.get(lesson.id) === "current") ?? null;
}

export function courseProgress(subject: Subject, progress: LessonProgress[]) {
  const ids = new Set(subjectLessons(subject).map(lesson => lesson.id));
  const done = progress.filter(item => item.passed_at && ids.has(item.lesson_id)).length;
  return { done, total: ids.size };
}

export function chapterProgress(chapter: CourseChapter, progress: LessonProgress[]) {
  const passed = new Set(progress.filter(item => item.passed_at).map(item => item.lesson_id));
  return { done: chapter.lessons.filter(lesson => passed.has(lesson.id)).length, total: chapter.lessons.length };
}

export const PASS_SCORE = 70;

export type QuizItem = { question: string; options: string[]; correct: number; explanation?: string };
export type LessonSource = { label: string; document_id: string; document_name: string; page: number | null; chunk_id: string | null };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const quizItemSchema = z.object({
  question: z.string().trim().min(1).max(600),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(5),
  correct: z.number().int().min(0).max(4),
  explanation: z.string().max(1000).optional(),
}).refine(item => item.correct < item.options.length, "Đáp án đúng không hợp lệ.");

export const lessonSaveSchema = z.object({
  lessonId: lessonIdSchema,
  body: z.string().max(40000),
  quiz: z.array(quizItemSchema).max(10),
  sources: z.array(z.object({
    label: z.string().regex(/^S\d{1,2}$/),
    document_id: z.string().regex(uuidPattern),
    document_name: z.string().min(1).max(300),
    page: z.number().int().nullable(),
    chunk_id: z.string().regex(uuidPattern).nullable(),
  })).max(20),
  publish: z.boolean(),
}).strict().refine(value => !value.publish || value.body.trim().length > 0, "Bài giảng trống không thể công bố.");

export const quizSubmitSchema = z.object({ answers: z.array(z.number().int().min(0).max(4)).min(1).max(10) }).strict();

const QUIZ_HEADING = "## Câu hỏi kiểm tra";

/** Short request sent through the shared-library chat so the draft cites curriculum documents. */
export function draftPrompt(lessonId: string) {
  const found = findLesson(lessonId);
  if (!found) throw new Error("Bài học không tồn tại.");
  const { subject, chapter, lesson } = found;
  return [
    `Soạn bài giảng giải thích khái niệm cho sinh viên đại học, môn ${subjects[subject]}, chương ${chapter.number} "${chapter.title}", bài "${lesson.title}".`,
    `Mục tiêu bài học: ${lesson.objectives.join("; ")}.`,
    "Trình bày theo các mục: khái niệm và định nghĩa, công thức hoặc định lý chính, giải thích trực quan, 2 ví dụ có lời giải đầy đủ từng bước, lỗi thường gặp, tóm tắt.",
    `Cuối bài viết đúng tiêu đề "${QUIZ_HEADING}" rồi 4 câu trắc nghiệm theo mẫu:`,
    "Câu 1: <nội dung>\nA. <phương án>\nB. <phương án>\nC. <phương án>\nD. <phương án>\nĐáp án: <chữ cái>\nGiải thích: <một câu>",
  ].join("\n");
}

/** Learner request to the tutor for a lesson that has no reviewed lecture yet, or for extra help. */
export function tutorPrompt(lessonId: string) {
  const found = findLesson(lessonId);
  if (!found) throw new Error("Bài học không tồn tại.");
  const { subject, chapter, lesson } = found;
  return `Giảng giúp mình bài "${lesson.title}" (chương ${chapter.number}: ${chapter.title}, môn ${subjects[subject]}). `
    + `Mục tiêu: ${lesson.objectives.join("; ")}. Giải thích khái niệm, công thức chính kèm ví dụ minh họa dễ hiểu.`;
}

/** Split an AI draft into the lecture body and editable quiz items; unparseable questions are dropped. */
export function parseDraft(answer: string): { body: string; quiz: QuizItem[] } {
  const marker = answer.search(/^#{1,4}\s*Câu hỏi kiểm tra\s*$/im);
  if (marker === -1) return { body: answer.trim(), quiz: [] };
  const body = answer.slice(0, marker).trim();
  const quiz: QuizItem[] = [];
  const blocks = answer.slice(marker).split(/^\s*\**\s*Câu\s+\d+\s*[:.)]\s*\**\s*/im).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    const options: string[] = [];
    const question: string[] = [];
    let correct = -1;
    let explanation = "";
    for (const line of lines) {
      const option = line.match(/^\**([A-E])[.)]\**\s+(.+)$/);
      const key = line.match(/^\**Đáp án\**\s*:\s*\**\s*([A-E])\b/i);
      const why = line.match(/^\**Giải thích\**\s*:\s*(.+)$/i);
      if (key) correct = key[1].toUpperCase().charCodeAt(0) - 65;
      else if (why) explanation = why[1].trim();
      else if (option && options.length === option[1].charCodeAt(0) - 65) options.push(option[2].trim());
      else if (!options.length) question.push(line);
    }
    const item = { question: question.join(" ").trim(), options, correct, explanation: explanation || undefined };
    if (quizItemSchema.safeParse(item).success) quiz.push(item);
    if (quiz.length === 10) break;
  }
  return { body, quiz };
}

/** Keep only citations the lecture body still uses, so learners never see dangling labels. */
export function usedSources(body: string, sources: LessonSource[]) {
  const labels = new Set(Array.from(body.matchAll(/\[(S\d{1,2})\]/g), match => match[1]));
  return sources.filter(source => labels.has(source.label));
}
