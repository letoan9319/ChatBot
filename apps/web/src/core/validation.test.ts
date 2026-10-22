import { describe, expect, it } from "vitest";
import { messageSchema, uploadSchema, MAX_FILE_SIZE } from "./validation";

const id = "318b12a1-0c59-45a3-bd28-5304d98b92e9";
describe("upload and chat boundaries", () => {
  it("accepts supported extensions and rejects disguised or oversized filenames", () => {
    const value = {
      name: "Giáo trình.PDF",
      size: MAX_FILE_SIZE,
      subject: "calculus",
      key: id,
    };
    expect(uploadSchema.safeParse(value).success).toBe(true);
    for (const change of [
      { name: "a.pdf.exe" },
      { size: MAX_FILE_SIZE + 1 },
      { size: 0 },
      { subject: "unknown" },
    ]) {
      expect(uploadSchema.safeParse({ ...value, ...change }).success).toBe(
        false,
      );
    }
  });
  it("requires selected unique IDs, a nonempty question and a stable request UUID", () => {
    const value = { question: "Đạo hàm là gì?", documentIds: [id], key: id };
    expect(messageSchema.safeParse(value).success).toBe(true);
    for (const change of [
      { question: "  " },
      { question: "a".repeat(2001) },
      { documentIds: [] },
      { documentIds: [id, id] },
      { key: "not-a-uuid" },
    ]) {
      expect(messageSchema.safeParse({ ...value, ...change }).success).toBe(
        false,
      );
    }
  });
});
