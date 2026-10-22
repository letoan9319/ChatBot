import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="auth-shell">Đang tải…</main>}>
      <AuthForm />
    </Suspense>
  );
}
