import { z } from "zod";

export const uuid = z.uuid();
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_QUESTION_IMAGE_SIZE = 3 * 1024 * 1024;
export const QUESTION_IMAGE_PREFIX = "Ảnh câu hỏi - ";
export const IMAGE_FILE_TYPES = ["png", "jpg", "jpeg", "webp"] as const;
export type ImageFileType = (typeof IMAGE_FILE_TYPES)[number];

const IMAGE_FILE_TYPE_SET = new Set<string>(IMAGE_FILE_TYPES);
const FILE_TYPE_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function isImageFileType(fileType: string | null | undefined): boolean {
  return Boolean(fileType && IMAGE_FILE_TYPE_SET.has(fileType.toLowerCase()));
}

export function fileTypeMime(fileType: string | null | undefined): string | null {
  if (!fileType) return null;
  return FILE_TYPE_MIME[fileType.toLowerCase()] ?? null;
}

export function mimeForFilename(name: string): string | null {
  const match = /\.([^.]+)$/.exec(name.trim());
  return match ? fileTypeMime(match[1]) : null;
}

export function isQuestionImageName(name: string): boolean {
  return name.startsWith(QUESTION_IMAGE_PREFIX);
}

export const subjects = {
  calculus: "Giải tích",
  "linear-algebra": "Đại số tuyến tính",
  physics: "Vật lý đại cương",
} as const;
export const subjectSchema = z.enum(["calculus", "linear-algebra", "physics"]);
export type Subject = keyof typeof subjects;

export const uploadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(/\.(pdf|docx|png|jpe?g|webp)$/i, "Chỉ hỗ trợ PDF, DOCX hoặc ảnh câu hỏi PNG, JPEG, WebP."),
    size: z.number().int().min(1).max(MAX_FILE_SIZE),
    subject: subjectSchema,
    key: uuid,
  })
  .superRefine((value, ctx) => {
    const ext = value.name.split(".").pop()?.toLowerCase() ?? "";
    if (isImageFileType(ext)) {
      if (!isQuestionImageName(value.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "Chỉ hỗ trợ PDF và DOCX trong kho tài liệu.",
        });
      }
      if (value.size > MAX_QUESTION_IMAGE_SIZE) {
        ctx.addIssue({
          code: "custom",
          path: ["size"],
          message: "Ảnh câu hỏi vượt quá 3 MB.",
        });
      }
    }
  });

export const messageSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  documentIds: z
    .array(uuid)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length),
  key: uuid,
  mode: z.enum(["documents", "search"]).optional(),
  subject: subjectSchema.optional(),
});
export const keySchema = z.object({ key: uuid });

export const statuses: Record<string, string> = {
  uploading: "Đang tải lên",
  queued: "Đang chờ",
  processing: "Đang xử lý",
  ready: "Sẵn sàng",
  failed: "Thất bại",
  deleting: "Đang xóa",
  deleted: "Đã xóa",
  generating: "Đang trả lời",
  completed: "Hoàn tất",
  stopped: "Đã dừng",
  interrupted: "Bị gián đoạn",
  running: "Đang chạy",
};
