import { z } from "zod";

export const uuid = z.uuid();
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const subjects = {
  calculus: "Giải tích",
  "linear-algebra": "Đại số tuyến tính",
  physics: "Vật lý đại cương",
} as const;
export const uploadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .regex(/\.(pdf|docx)$/i, "Chỉ hỗ trợ PDF và DOCX."),
  size: z.number().int().min(1).max(MAX_FILE_SIZE),
  subject: z.enum(["calculus", "linear-algebra", "physics"]),
  key: uuid,
});
export const messageSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  documentIds: z
    .array(uuid)
    .min(1)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length),
  key: uuid,
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
  interrupted: "Bị gián đoạn",
  running: "Đang chạy",
};
