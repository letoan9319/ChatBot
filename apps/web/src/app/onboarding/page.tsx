import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionClient } from "@/core/supabase-server";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-provider";
import { UsernameSetup } from "@/components/username-setup";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect("/auth");
  }
  const db = await sessionClient(true);
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth");
  const { data: profile, error } = await db.from("profiles")
    .select("username").eq("id", user.id).maybeSingle();
  if (profile?.username && !error) redirect("/study");

  return (
    <main className="auth-shell">
      <header className="auth-header">
        <Link className="auth-back-link" href="/" aria-label="Về trang chủ">
          <span className="auth-back-arrow" aria-hidden="true" />
        </Link>
        <Brand />
        <ThemeToggle />
      </header>
      <section className="auth-card content-transition onboarding-card">
        <UsernameSetup
          email={user.email || ""}
          verified
          initialError={error ? "Dịch vụ hồ sơ tài khoản chưa sẵn sàng. Vui lòng liên hệ quản trị viên rồi thử lại." : ""}
        />
      </section>
    </main>
  );
}
