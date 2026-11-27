import { describe, expect, it } from "vitest";
import {
  fileTypeMime,
  isImageFileType,
  MAX_FILE_SIZE,
  MAX_QUESTION_IMAGE_SIZE,
  messageSchema,
  mimeForFilename,
  uploadSchema,
} from "./validation";
import { buildQuestionImageName } from "./chat-image";

const id = "318b12a1-0c59-45a3-bd28-5304d98b92e9";
describe("upload and chat boundaries", () => {
  it("accepts supported extensions, native question images, and rejects disguised or oversized filenames", () => {
    const value = {
      name: "Giáo trình.PDF",
      size: MAX_FILE_SIZE,
      subject: "calculus",
      key: id,
    };
    expect(uploadSchema.safeParse(value).success).toBe(true);
    expect(
      uploadSchema.safeParse({
        ...value,
        name: "Ảnh câu hỏi - bai1.png",
        size: MAX_QUESTION_IMAGE_SIZE,
      }).success,
    ).toBe(true);
    expect(
      uploadSchema.safeParse({
        ...value,
        name: "Ảnh câu hỏi - bai2.jpeg",
        size: 120_000,
      }).success,
    ).toBe(true);
    expect(
      uploadSchema.safeParse({
        ...value,
        name: "Ảnh câu hỏi - bai3.webp",
        size: 80_000,
      }).success,
    ).toBe(true);
    for (const change of [
      { name: "a.pdf.exe" },
      { name: "photo.png", size: 10_000 },
      { name: "Ảnh câu hỏi - huge.png", size: MAX_QUESTION_IMAGE_SIZE + 1 },
      { size: MAX_FILE_SIZE + 1 },
      { size: 0 },
      { subject: "unknown" },
    ]) {
      expect(uploadSchema.safeParse({ ...value, ...change }).success).toBe(
        false,
      );
    }
    expect(isImageFileType("png")).toBe(true);
    expect(isImageFileType("pdf")).toBe(false);
    expect(fileTypeMime("jpg")).toBe("image/jpeg");
    expect(mimeForFilename("Ảnh câu hỏi - de1.png")).toBe("image/png");
    expect(buildQuestionImageName("image.png", "image/png")).toBe("Ảnh câu hỏi - image.png");
    expect(buildQuestionImageName("photo.JPEG", "image/jpeg")).toBe("Ảnh câu hỏi - photo.jpeg");
    expect(buildQuestionImageName("clip", "image/jpeg")).toBe("Ảnh câu hỏi - clip.jpg");
  });
  it("accepts automatic source selection and validates explicit sources and request IDs", () => {
    const value = { question: "Đạo hàm là gì?", documentIds: [id], key: id };
    expect(messageSchema.safeParse(value).success).toBe(true);
    expect(messageSchema.safeParse({ ...value, documentIds: [] }).success).toBe(true);
    expect(messageSchema.safeParse({ ...value, mode: "documents" }).success).toBe(true);
    expect(messageSchema.safeParse({ ...value, mode: "search" }).success).toBe(true);
    expect(messageSchema.safeParse({ ...value, mode: "research" }).success).toBe(false);
    for (const change of [
      { question: "  " },
      { question: "a".repeat(2001) },
      { documentIds: [id, id] },
      { key: "not-a-uuid" },
    ]) {
      expect(messageSchema.safeParse({ ...value, ...change }).success).toBe(
        false,
      );
    }
  });
});
