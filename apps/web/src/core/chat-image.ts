import { MAX_QUESTION_IMAGE_SIZE, QUESTION_IMAGE_PREFIX } from "./validation";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function validateChatImage(file: File) {
  if (!(file.type in MIME_TO_EXT) || !file.size || file.size > MAX_QUESTION_IMAGE_SIZE) {
    throw new Error("Chọn ảnh PNG, JPEG hoặc WebP tối đa 3 MB.");
  }
}

export function buildQuestionImageName(originalName: string, mimeType: string): string {
  const fallbackExt = MIME_TO_EXT[mimeType] ?? "png";
  const rawMatch = /\.([^.]+)$/.exec(originalName.trim());
  const rawExt = rawMatch?.[1]?.toLowerCase() ?? "";
  const ext =
    mimeType === "image/jpeg" && (rawExt === "jpg" || rawExt === "jpeg")
      ? rawExt
      : fallbackExt;
  const stem =
    originalName
      .trim()
      .replace(/\.[^.]+$/, "")
      .replace(/\s+/g, " ")
      .slice(0, 100) || "clipboard";
  return `${QUESTION_IMAGE_PREFIX}${stem}.${ext}`;
}

async function transcodeWebpToImage(bitmap: ImageBitmap, originalName: string): Promise<File> {
  const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Trình duyệt không thể chuẩn bị ảnh.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const toBlob = (type: "image/png" | "image/jpeg", quality?: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Không thể mã hóa ảnh."))),
        type,
        quality,
      );
    });

  let blob = await toBlob("image/png");
  let targetMime: "image/png" | "image/jpeg" = "image/png";
  if (blob.size > MAX_QUESTION_IMAGE_SIZE) {
    blob = await toBlob("image/jpeg", 0.92);
    targetMime = "image/jpeg";
  }
  if (blob.size > MAX_QUESTION_IMAGE_SIZE) {
    throw new Error("Ảnh sau khi chuẩn bị vượt quá 3 MB. Hãy cắt bớt vùng ảnh.");
  }
  return new File([blob], buildQuestionImageName(originalName, targetMime), {
    type: targetMime,
  });
}

export async function prepareChatImageFile(file: File): Promise<File> {
  validateChatImage(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Không đọc được ảnh đã dán. Hãy thử chụp hoặc sao chép lại ảnh.");
  });
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("Không đọc được kích thước ảnh đã dán.");
    }
    if (file.type === "image/webp") {
      return await transcodeWebpToImage(bitmap, file.name);
    }
  } finally {
    bitmap.close();
  }
  return new File([file], buildQuestionImageName(file.name, file.type), {
    type: file.type,
    lastModified: file.lastModified,
  });
}
