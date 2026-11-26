import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  verify: vi.fn(),
  searchParams: new URLSearchParams(),
}));
vi.mock("@/core/supabase-server", () => ({
  sessionClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify },
  }),
}));
vi.mock("@/core/supabase-browser", () => ({
  isConfigured: true,
  browserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { GET as callback } from "./callback/route";
import { GET as confirm } from "./confirm/route";
import { proxy } from "@/proxy";
import { AuthForm } from "@/components/auth-form";
import {
  PASSWORD_MISMATCH_MESSAGE,
  resolveSignupOutcome,
  rootAuthRedirectPath,
  validatePasswordConfirmation,
} from "@/core/auth-flow";

beforeEach(() => {
  mocks.exchange.mockResolvedValue({ data: { redirectType: null }, error: null });
  mocks.verify.mockResolvedValue({ error: null });
  mocks.searchParams = new URLSearchParams();
});

describe("verification and recovery destinations", () => {
  it("sends verified signups to username onboarding and rejects arbitrary redirect destinations", async () => {
    const response = await callback(
      new NextRequest(
        "https://learnstep.example/auth/callback?code=valid&next=https://other.example",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://learnstep.example/onboarding",
    );
    const token = await confirm(
      new NextRequest(
        "https://learnstep.example/auth/confirm?token_hash=valid&type=email",
      ),
    );
    expect(token.headers.get("location")).toBe(
      "https://learnstep.example/onboarding",
    );
  });

  it("preserves password reset after either verification flow or PKCE recovery metadata", async () => {
    const response = await callback(
      new NextRequest(
        "https://learnstep.example/auth/callback?code=valid&next=%2Fauth%3Fmode%3Dreset",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://learnstep.example/auth?mode=reset",
    );

    mocks.exchange.mockResolvedValueOnce({
      data: { redirectType: "recovery" },
      error: null,
    });
    const pkceRecovery = await callback(
      new NextRequest("https://learnstep.example/auth/callback?code=valid"),
    );
    expect(pkceRecovery.headers.get("location")).toBe(
      "https://learnstep.example/auth?mode=reset",
    );

    const token = await confirm(
      new NextRequest(
        "https://learnstep.example/auth/confirm?token_hash=valid&type=recovery",
      ),
    );
    expect(token.headers.get("location")).toBe(
      "https://learnstep.example/auth?mode=reset",
    );
  });

  it("forwards Site URL root auth callbacks to callback, confirm, or error pages", async () => {
    expect(
      rootAuthRedirectPath(new URL("https://learnstep.example/?code=abc")),
    ).toBe("/auth/callback?code=abc");
    expect(
      rootAuthRedirectPath(
        new URL("https://learnstep.example/?token_hash=xyz&type=recovery"),
      ),
    ).toBe("/auth/confirm?token_hash=xyz&type=recovery");
    expect(
      rootAuthRedirectPath(
        new URL(
          "https://learnstep.example/?error=access_denied&error_code=otp_expired",
        ),
      ),
    ).toBe("/auth?error=verification");
    expect(rootAuthRedirectPath(new URL("https://learnstep.example/"))).toBeNull();

    const redirected = await proxy(
      new NextRequest("https://learnstep.example/?code=pkce-code"),
    );
    expect(redirected.headers.get("location")).toBe(
      "https://learnstep.example/auth/callback?code=pkce-code",
    );
  });
});

describe("signup confirmation and password matching", () => {
  it("requires matching password confirmation on signup and password reset", () => {
    expect(validatePasswordConfirmation("password123", "password123")).toBeNull();
    expect(validatePasswordConfirmation("password123", "password124")).toBe(
      PASSWORD_MISMATCH_MESSAGE,
    );
  });

  it("does not prompt for username before email confirmation", () => {
    const unconfirmed = resolveSignupOutcome(
      { session: null, user: { identities: [{ id: "1" }] } },
      " student@truong.edu.vn ",
    );
    expect(unconfirmed).toEqual({
      action: "show_login_notice",
      noticeType: "success",
      notice:
        "Đăng ký thành công. Hãy mở email xác nhận gửi tới student@truong.edu.vn (kiểm tra cả hộp thư rác) trước khi đăng nhập.",
    });

    const duplicate = resolveSignupOutcome(
      { session: null, user: { identities: [] } },
      "student@truong.edu.vn",
    );
    expect(duplicate.action).toBe("show_login_notice");
    if (duplicate.action === "show_login_notice") {
      expect(duplicate.noticeType).toBe("error");
      expect(duplicate.notice).toContain("đã được đăng ký");
    }

    const activeSession = resolveSignupOutcome(
      { session: { access_token: "token" }, user: { identities: [{ id: "1" }] } },
      "student@truong.edu.vn",
    );
    expect(activeSession).toEqual({ action: "redirect_onboarding" });
  });

  it("renders distinct password and confirm-password inputs in signup and reset modes without username setup", () => {
    const signupHtml = renderToStaticMarkup(
      createElement(AuthForm, { initialMode: "signup" }),
    );
    expect(signupHtml).toContain("Xác nhận lại mật khẩu");
    expect(signupHtml).toContain('id="account-password"');
    expect(signupHtml).toContain('id="account-password-confirm"');
    expect(signupHtml).not.toContain("Chọn username của bạn");

    const resetHtml = renderToStaticMarkup(
      createElement(AuthForm, { initialMode: "reset" }),
    );
    expect(resetHtml).toContain("Mật khẩu mới");
    expect(resetHtml).toContain("Xác nhận lại mật khẩu mới");
    expect(resetHtml).toContain('id="account-password-confirm"');
  });
});
