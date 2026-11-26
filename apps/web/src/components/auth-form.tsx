"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserClient, isConfigured } from "@/core/supabase-browser";
import { authErrorMessage } from "@/core/auth-errors";
import {
  resolveSignupOutcome,
  validatePasswordConfirmation,
} from "@/core/auth-flow";
import { LearningScene } from "./learning-scene";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-provider";
import { PasswordField } from "./password-field";

export type AuthMode = "login" | "signup" | "forgot" | "reset";

const titles: Record<AuthMode, string> = {
  login: "Trở lại góc học tập.",
  signup: "Bắt đầu hành trình học.",
  forgot: "Tìm lại lối vào.",
  reset: "Đặt mật khẩu mới.",
};

function parseMode(raw: string | null): AuthMode {
  if (raw === "signup" || raw === "forgot" || raw === "reset") return raw;
  return "login";
}

export function AuthForm({ initialMode }: { initialMode?: AuthMode }) {
  const params = useSearchParams();
  const router = useRouter();
  const urlMode = params.get("mode");
  const [mode, setMode] = useState<AuthMode>(
    initialMode ?? parseMode(urlMode),
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"success" | "error">("success");
  const [dismissedUrlError, setDismissedUrlError] = useState(false);

  useEffect(() => {
    if (urlMode === "reset") {
      setMode("reset");
      setNotice("");
      setDismissedUrlError(true);
    }
  }, [urlMode]);

  useEffect(() => {
    if (!isConfigured) return;
    const db = browserClient();
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("reset");
        setNotice("");
        setDismissedUrlError(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setDismissedUrlError(true);
    if (mode === "signup" || mode === "reset") {
      const mismatch = validatePasswordConfirmation(password, confirmPassword);
      if (mismatch) {
        setNoticeType("error");
        setNotice(mismatch);
        return;
      }
    }
    setBusy(true);
    setNotice("");
    setNoticeType("success");
    try {
      const db = browserClient();
      const origin = window.location.origin;
      const trimmedEmail = email.trim();
      if (mode === "signup") {
        const { data, error } = await db.auth.signUp({
          email: trimmedEmail,
          password,
          options: { emailRedirectTo: `${origin}/auth/callback` },
        });
        if (error) throw error;
        setPassword("");
        setConfirmPassword("");
        const outcome = resolveSignupOutcome(data, trimmedEmail);
        if (outcome.action === "redirect_onboarding") {
          router.replace("/onboarding");
          router.refresh();
          return;
        }
        setMode("login");
        setNoticeType(outcome.noticeType);
        setNotice(outcome.notice);
      } else if (mode === "forgot") {
        const { error } = await db.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${origin}/auth/callback`,
        });
        if (error) throw error;
        setNotice(
          "Nếu email đã được đăng ký, liên kết đặt lại mật khẩu đã được gửi. Hãy mở liên kết trên cùng trình duyệt này (kiểm tra cả thư rác).",
        );
      } else if (mode === "reset") {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setConfirmPassword("");
        router.replace("/study");
        router.refresh();
      } else {
        const { error } = await db.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        router.replace("/study");
        router.refresh();
      }
    } catch (error) {
      setNoticeType("error");
      setNotice(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function change(next: AuthMode) {
    setMode(next);
    setNotice("");
    setPassword("");
    setConfirmPassword("");
    setDismissedUrlError(true);
  }

  return (
    <main className="auth-shell">
      <header className="auth-header">
        <Link
          href="/"
          className="auth-back-link"
          aria-label="Về trang chủ"
          title="Về trang chủ"
        >
          <span className="auth-back-arrow" aria-hidden="true" />
        </Link>
        <Brand />
        <ThemeToggle />
      </header>
      <div className="auth-layout">
        <aside className="auth-aside" aria-label="Đồng hành cùng bạn học">
          <p className="eyebrow">MANG THEO MỘT CHÚT TÒ MÒ</p>
          <h2>
            Câu hỏi nhỏ.
            <br />
            <em>Khám phá lớn.</em>
          </h2>
          <p>Mỗi điều chưa hiểu đều là một cơ hội để học thêm.</p>
          <LearningScene compact />
        </aside>
        <section className="auth-card content-transition" key={mode}>
          <p className="eyebrow">MỖI NGÀY, HIỂU THÊM MỘT CHÚT</p>
          <h1>{titles[mode]}</h1>
          <p className="muted">
            Tài liệu và hội thoại được lưu riêng theo tài khoản của bạn.
          </p>
          {!isConfigured ? (
            <div className="notice">
              Chưa cấu hình Supabase. Điền biến môi trường theo README để bật
              đăng nhập và xử lý tài liệu.
            </div>
          ) : (
            <form onSubmit={submit}>
              {mode !== "reset" && (
                <label>
                  Email
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="ban@truong.edu.vn"
                  />
                </label>
              )}
              {mode !== "forgot" && (
                <PasswordField
                  id="account-password"
                  key={`${mode}-password`}
                  value={password}
                  onChange={setPassword}
                  reset={mode !== "login"}
                  label={mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}
                  disabled={busy}
                />
              )}
              {(mode === "signup" || mode === "reset") && (
                <PasswordField
                  id="account-password-confirm"
                  key={`${mode}-confirm`}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  reset
                  label={
                    mode === "reset"
                      ? "Xác nhận lại mật khẩu mới"
                      : "Xác nhận lại mật khẩu"
                  }
                  placeholder={
                    mode === "reset"
                      ? "Nhập lại mật khẩu mới"
                      : "Nhập lại mật khẩu"
                  }
                  disabled={busy}
                />
              )}
              <button className="button" disabled={busy} aria-busy={busy}>
                {busy
                  ? "Đang xử lý…"
                  : {
                      login: "Đăng nhập",
                      signup: "Tạo tài khoản",
                      forgot: "Gửi liên kết đặt lại",
                      reset: "Lưu mật khẩu",
                    }[mode]}
              </button>
            </form>
          )}
          {notice && (
            <p
              className={`notice ${noticeType}`}
              role={noticeType === "error" ? "alert" : "status"}
            >
              {notice}
            </p>
          )}
          {params.has("error") && !dismissedUrlError && (
            <p className="notice">
              Liên kết xác thực không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu
              liên kết mới.
            </p>
          )}
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => change("signup")}
                >
                  Chưa có tài khoản? Đăng ký
                </button>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => change("forgot")}
                >
                  Quên mật khẩu
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-link"
                onClick={() => change("login")}
              >
                Quay lại đăng nhập
              </button>
            )}
          </div>
        </section>
      </div>
      <p className="muted">Một câu hỏi tốt là khởi đầu của sự thấu hiểu.</p>
    </main>
  );
}
