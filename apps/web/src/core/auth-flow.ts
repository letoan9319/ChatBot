import { authErrorMessage } from "./auth-errors";

export const PASSWORD_MISMATCH_MESSAGE =
  "Mật khẩu xác nhận không khớp. Vui lòng nhập lại.";

export function validatePasswordConfirmation(
  password: string,
  confirmPassword: string,
): string | null {
  return password === confirmPassword ? null : PASSWORD_MISMATCH_MESSAGE;
}

export function callbackDestination(input: {
  next?: string | null;
  type?: string | null;
  redirectType?: string | null;
}): "/auth?mode=reset" | "/onboarding" {
  if (
    input.next === "/auth?mode=reset" ||
    input.type === "recovery" ||
    input.redirectType === "recovery"
  ) {
    return "/auth?mode=reset";
  }
  return "/onboarding";
}

export function rootAuthRedirectPath(url: URL): string | null {
  if (url.pathname !== "/") return null;
  const params = url.searchParams;
  if (params.has("code")) {
    return `/auth/callback?${params.toString()}`;
  }
  if (params.has("token_hash") && params.has("type")) {
    return `/auth/confirm?${params.toString()}`;
  }
  const error = params.get("error") || "";
  if (
    params.has("error_code") ||
    ["access_denied", "unauthorized_client", "server_error"].includes(error)
  ) {
    return "/auth?error=verification";
  }
  return null;
}

export function resolveSignupOutcome(
  data: {
    session: unknown | null;
    user?: { identities?: unknown[] | null } | null;
  },
  email: string,
):
  | { action: "redirect_onboarding" }
  | { action: "show_login_notice"; noticeType: "success" | "error"; notice: string } {
  if (data.session) {
    return { action: "redirect_onboarding" };
  }
  if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
    return {
      action: "show_login_notice",
      noticeType: "error",
      notice: authErrorMessage({ code: "user_already_exists" }),
    };
  }
  return {
    action: "show_login_notice",
    noticeType: "success",
    notice: `Đăng ký thành công. Hãy mở email xác nhận gửi tới ${email.trim()} (kiểm tra cả hộp thư rác) trước khi đăng nhập.`,
  };
}
