"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/core/supabase-browser";
import { authErrorMessage } from "@/core/auth-errors";
import {
  USERNAME_HELP, usernameSchema, readUsernameDraft,
  saveUsernameDraft, clearUsernameDraft,
} from "@/core/profile";

export function UsernameSetup({ email, verified, initialError = "" }: {
  email: string;
  verified: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initialError);
  const [failed, setFailed] = useState(Boolean(initialError));
  useEffect(() => { setUsername(readUsernameDraft(email)); }, [email]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) { setFailed(true); setNotice(USERNAME_HELP); return; }
    setBusy(true);
    setNotice("");
    saveUsernameDraft(email, parsed.data);
    try {
      const { data: { user }, error } = await browserClient().auth.getUser();
      if (error && error.name !== "AuthSessionMissingError") throw error;
      if (error || !user || user.email?.toLowerCase() !== email.toLowerCase()) {
        if (verified) throw error || new Error("Session expired");
        setFailed(false);
        setNotice("Đã ghi nhớ lựa chọn trên thiết bị này. Hãy xác nhận email, sau đó tiếp tục để lưu username. Tên chưa được giữ chỗ.");
        return;
      }
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: parsed.data }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFailed(true);
        setNotice(result.error || "Chưa thể lưu username. Vui lòng thử lại.");
        return;
      }
      clearUsernameDraft(email);
      router.replace("/study");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setNotice(authErrorMessage(error));
    } finally { setBusy(false); }
  }

  return (
    <>
      <p className="eyebrow">HOÀN TẤT TÀI KHOẢN</p>
      <h1>Chọn username của bạn.</h1>
      <p className="muted">Tên này sẽ được hiển thị trong góc học tập. Bạn vẫn đăng nhập bằng email.</p>
      {!verified && (
        <p className="notice success" role="status">
          Yêu cầu đăng ký đã được tiếp nhận. Hãy mở email xác nhận gửi tới <strong>{email}</strong>.
          Bạn có thể chọn tên trước; tên được kiểm tra và lưu sau khi xác nhận email.
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="username">
          Username
          <input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => {
              const value = event.target.value;
              setUsername(value);
              const parsed = usernameSchema.safeParse(value);
              if (parsed.success) saveUsernameDraft(email, parsed.data);
            }}
            placeholder="minh_anh"
            minLength={3}
            maxLength={24}
            required
            aria-describedby="username-help"
            disabled={busy || Boolean(initialError)}
          />
        </label>
        <p id="username-help" className="muted username-help">{USERNAME_HELP}</p>
        <button className="button" disabled={busy || Boolean(initialError)} aria-busy={busy}>
          {busy ? "Đang lưu…" : verified ? "Lưu và bắt đầu học" : "Tiếp tục"}
        </button>
      </form>
      {notice && <p className={`notice ${failed ? "error" : "success"}`} role={failed ? "alert" : "status"}>{notice}</p>}
      <div className="auth-links">
        <Link className="text-link" href="/auth">
          {verified ? "Đăng nhập bằng tài khoản khác" : "Đã xác nhận email? Đăng nhập"}
        </Link>
        {initialError && <Link className="text-link" href="/onboarding">Thử lại</Link>}
      </div>
    </>
  );
}
