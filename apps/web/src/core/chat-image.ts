const MAX_FILE_SIZE = 3 * 1024 * 1024;

export function validateChatImage(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > MAX_FILE_SIZE) {
    throw new Error("Chọn ảnh PNG, JPEG hoặc WebP tối đa 3 MB.");
  }
}

export async function chatImageToPdf(file: File): Promise<File> {
  validateChatImage(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Không đọc được ảnh đã dán. Hãy thử chụp hoặc sao chép lại ảnh.");
  });
  try {
    const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Trình duyệt không thể chuẩn bị ảnh.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const original = scale === 1 && file.type === "image/png" && file.size < MAX_FILE_SIZE / 2;
    const image = original
      ? await pdf.embedPng(await file.arrayBuffer())
      : await pdf.embedJpg(await new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) reject(new Error("Không thể mã hóa ảnh."));
          else blob.arrayBuffer().then(resolve, reject);
        }, "image/jpeg", 0.94);
      }));
    const dimensions = image.scale(Math.min(1, 1200 / Math.max(image.width, image.height)));
    const page = pdf.addPage([dimensions.width, dimensions.height]);
    page.drawImage(image, { x: 0, y: 0, ...dimensions });
    const bytes = Uint8Array.from(await pdf.save());
    if (bytes.byteLength > MAX_FILE_SIZE) throw new Error("Ảnh sau khi chuẩn bị vượt quá 3 MB. Hãy cắt bớt vùng ảnh.");
    const stem = file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "clipboard";
    return new File([bytes], "Ảnh câu hỏi - " + stem + ".pdf", { type: "application/pdf" });
  } finally {
    bitmap.close();
  }
}
