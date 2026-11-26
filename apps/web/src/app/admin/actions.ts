"use server";

import { revalidatePath } from "next/cache";
import { extractRoleNames, isAppRole, resolveUserPermissions, roleLabels } from "@/core/roles";
import { sessionClient } from "@/core/supabase-server";
import { uuid } from "@/core/validation";
import type { AdminActionFeedback } from "./types";

const REVOKE_ADMIN_CONFIRMATIONS = new Set(["THU HỒI", "THU HOI"]);

function mapAdminError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (message.includes("LAST_ADMIN")) {
    return "Không thể thu hồi quyền của quản trị viên cuối cùng trong hệ thống.";
  }
  if (message.includes("FORBIDDEN")) {
    return "Tài khoản của bạn không có quyền quản trị hệ thống.";
  }
  if (message.includes("UNAUTHORIZED")) {
    return "Phiên đã hết hạn. Hãy đăng nhập lại.";
  }
  if (message.includes("NOT_FOUND")) {
    return "Không tìm thấy người dùng hoặc dữ liệu được yêu cầu.";
  }
  if (message.includes("INVALID_INPUT")) {
    return "Dữ liệu thao tác quản trị không hợp lệ.";
  }
  return fallback;
}

type AdminSession =
  | { ok: false; error: string }
  | { ok: true; db: Awaited<ReturnType<typeof sessionClient>> };

async function requireAdminSession(): Promise<AdminSession> {
  const db = await sessionClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    return { ok: false, error: "Phiên đã hết hạn. Hãy đăng nhập lại." };
  }

  const { data: roleRows, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (roleError) {
    return { ok: false, error: "Không thể xác minh quyền quản trị. Hãy thử lại." };
  }

  const permissions = resolveUserPermissions(extractRoleNames(roleRows));
  if (!permissions.isAdmin) {
    return { ok: false, error: "Tài khoản của bạn không có quyền quản trị hệ thống." };
  }

  return { ok: true, db };
}

export async function setUserRoleAction(
  _previous: AdminActionFeedback,
  form: FormData,
): Promise<AdminActionFeedback> {
  const targetUserId = uuid.safeParse(form.get("targetUserId"));
  const rawRole = form.get("role");
  const rawGrant = form.get("grant");
  if (
    !targetUserId.success ||
    typeof rawRole !== "string" ||
    !isAppRole(rawRole) ||
    (rawGrant !== "true" && rawGrant !== "false")
  ) {
    return { error: true, message: "Thông tin phân quyền không hợp lệ." };
  }

  const grant = rawGrant === "true";
  if (rawRole === "admin" && !grant) {
    const confirmation = String(form.get("confirmation") ?? "")
      .trim()
      .toLocaleUpperCase("vi-VN");
    if (!REVOKE_ADMIN_CONFIRMATIONS.has(confirmation)) {
      return {
        error: true,
        message: "Hãy nhập chính xác “THU HỒI” để xác nhận thu hồi quyền quản trị viên.",
      };
    }
  }

  const session = await requireAdminSession();
  if (!session.ok) {
    return { error: true, message: session.error };
  }

  const { data, error } = await session.db.rpc("app_admin_set_user_role", {
    p_target_user_id: targetUserId.data,
    p_role: rawRole,
    p_grant: grant,
  });

  if (error) {
    return {
      error: true,
      message: mapAdminError(error.message, "Không thể cập nhật phân quyền người dùng. Hãy thử lại."),
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/knowledge");

  const result = data as { username?: string | null; changed?: boolean } | null;
  const targetLabel = result?.username ? `tài khoản ${result.username}` : "tài khoản đã chọn";
  const roleLabel = roleLabels[rawRole];
  if (result?.changed === false) {
    return {
      error: false,
      message: grant
        ? `${targetLabel} đã có vai trò ${roleLabel}.`
        : `${targetLabel} hiện không có vai trò ${roleLabel}.`,
    };
  }

  return {
    error: false,
    message: grant
      ? `Đã cấp vai trò ${roleLabel} cho ${targetLabel}.`
      : `Đã thu hồi vai trò ${roleLabel} khỏi ${targetLabel}.`,
  };
}

export async function deleteGroupAction(
  _previous: AdminActionFeedback,
  form: FormData,
): Promise<AdminActionFeedback> {
  const groupId = uuid.safeParse(form.get("groupId"));
  if (!groupId.success) {
    return { error: true, message: "Mã nhóm học không hợp lệ." };
  }

  const session = await requireAdminSession();
  if (!session.ok) {
    return { error: true, message: session.error };
  }

  const { data: deleted, error } = await session.db.rpc("app_admin_delete_group", {
    p_group_id: groupId.data,
  });

  if (error) {
    return {
      error: true,
      message: mapAdminError(error.message, "Không thể xóa nhóm học. Hãy thử lại."),
    };
  }

  revalidatePath("/admin");
  return {
    error: false,
    message: deleted ? "Đã xóa nhóm học vi phạm khỏi hệ thống." : "Nhóm học đã được xóa trước đó.",
  };
}
