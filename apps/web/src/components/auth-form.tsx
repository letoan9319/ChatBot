"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { browserClient, isConfigured } from "@/core/supabase-browser";
import { authErrorMessage } from "@/core/auth-errors";
import { LearningScene } from "./learning-scene";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-provider";
import { PasswordField } from "./password-field";
import { UsernameSetup } from "./username-setup";

type Mode = "login" | "signup" | "forgot" | "reset";
const titles: Record<Mode, string> = {
  login: "Trở lại góc học tập.",
  signup: "Bắt đầu hành trình học.",
  forgot: "Tìm lại lối vào.",
  reset: "Đặt mật khẩu mới.",
};
export function AuthForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(
    params.get("mode") === "reset" ? "reset" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"success" | "error">("success");
  const [choosingUsername, setChoosingUsername] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    setNoticeType("success");
    try {
      const db = browserClient();
      const origin = window.location.origin;
      if (mode === "signup") {
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${origin}/auth/callback` },
        });
        if (error) throw error;
        setPassword("");
        if (data.session) {
          router.replace("/onboarding");
          router.refresh();
          return;
        }
        setChoosingUsername(true);
      } else if (mode === "forgot") {
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?next=/auth?mode=reset`,
        });
        if (error) throw error;
        setNotice(
          "Nếu email đã được đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu.",
        );
      } else if (mode === "reset") {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        router.replace("/study");
        router.refresh();
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
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
  function change(next: Mode) {
    setMode(next);
    setNotice("");
    setPassword("");
    setChoosingUsername(false);
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
        <section className="auth-card content-transition" key={`${mode}-${choosingUsername}`}>
          {choosingUsername ? (
            <UsernameSetup email={email.trim()} verified={false} />
          ) : (
            <>
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
                      key={mode}
                      value={password}
                      onChange={setPassword}
                      reset={mode !== "login"}
                      label={mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}
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
                <p className={`notice ${noticeType}`} role={noticeType === "error" ? "alert" : "status"}>
                  {notice}
                </p>
              )}
              {params.has("error") && (
                <p className="notice">
                  Liên kết xác thực không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu
                  liên kết mới.
                </p>
              )}
              <div className="auth-links">
                {mode === "login" ? (
                  <>
                    <button className="text-link" onClick={() => change("signup")}>
                      Chưa có tài khoản? Đăng ký
                    </button>
                    <button className="text-link" onClick={() => change("forgot")}>
                      Quên mật khẩu
                    </button>
                  </>
                ) : (
                  <button className="text-link" onClick={() => change("login")}>
                    Quay lại đăng nhập
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      <p className="muted">Một câu hỏi tốt là khởi đầu của sự thấu hiểu.</p>
    </main>
  );
}
