"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { browserClient, isConfigured } from "@/core/supabase-browser";
import { LearningScene } from "./learning-scene";
import { Brand } from "./brand";

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
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const db = browserClient();
      const origin = window.location.origin;
      if (mode === "signup") {
        const { error } = await db.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${origin}/auth/callback` },
        });
        if (error) throw error;
        setNotice(
          "Hãy kiểm tra email và xác nhận tài khoản trước khi đăng nhập.",
        );
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
    } catch {
      setNotice(
        "Không thể hoàn thành. Kiểm tra thông tin đăng nhập, email xác nhận hoặc thử lại sau.",
      );
    } finally {
      setBusy(false);
    }
  }
  function change(next: Mode) {
    setMode(next);
    setNotice("");
    setPassword("");
  }
  return (
    <main className="auth-shell">
      <Brand />
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
        <section className="auth-card">
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
                <label>
                  {mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Ít nhất 8 ký tự"
                  />
                </label>
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
            <p className="notice" role="status">
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
        </section>
      </div>
      <p className="muted">Một câu hỏi tốt là khởi đầu của sự thấu hiểu.</p>
    </main>
  );
}
