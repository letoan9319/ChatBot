"use server";

import { revalidatePath } from "next/cache";
import { sessionClient } from "@/core/supabase-server";
import { uuid } from "@/core/validation";

type PublicationFeedback = { message: string; error: boolean } | null;

export async function setPublication(
  _previous: PublicationFeedback, form: FormData,
): Promise<PublicationFeedback> {
  const id = uuid.safeParse(form.get("id"));
  const action = form.get("action");
  const description = form.get("description");
  if (!id.success || (action !== "publish" && action !== "revoke")) {
    return { error: true, message: "Thao tác hoặc tài liệu không hợp lệ." };
  }
  if (action === "publish" && (typeof description !== "string" || Array.from(description.trim()).length > 2000)) {
    return { error: true, message: "Mô tả được phép dài tối đa 2.000 ký tự." };
  }

  const db = await sessionClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: true, message: "Phiên đã hết hạn. Hãy đăng nhập lại." };

  const { data: changed, error } = await db.rpc("app_set_knowledge_publication", {
    p_document_id: id.data,
    p_publish: action === "publish",
    p_description: typeof description === "string" && action === "publish" ? description.trim() : "",
  });
  if (error) {
    const messages: Record<string, string> = {
      FORBIDDEN: "Tài khoản của bạn không có quyền quản lý tài liệu chung.",
      UNAUTHORIZED: "Phiên đã hết hạn. Hãy đăng nhập lại.",
      DOCUMENT_NOT_PUBLISHABLE: "Chỉ có thể công bố tài liệu của bạn đã xử lý xong.",
      INVALID_INPUT: "Thông tin công bố không hợp lệ.",
    };
    return { error: true, message: messages[error.message] ?? "Không thể cập nhật kho chung. Hãy thử lại." };
  }

  revalidatePath("/admin/knowledge");
  return {
    error: false,
    message: action === "publish"
      ? (changed ? "Đã công bố tài liệu." : "Tài liệu đã có trong kho chung.")
      : (changed ? "Đã thu hồi tài liệu khỏi kho chung." : "Tài liệu đã được gỡ khỏi kho chung."),
  };
}
