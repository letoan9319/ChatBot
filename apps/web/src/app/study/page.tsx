import { redirect } from "next/navigation";
import { sessionClient } from "@/core/supabase-server";
import { StudyWorkspace } from "@/components/study-workspace";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-provider";

export const dynamic = "force-dynamic";
export default async function StudyPage() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return (
      <main className="auth-shell">
        <Brand />
        <ThemeToggle />
        <section className="auth-card">
          <p className="eyebrow">THIẾT LẬP BAN ĐẦU</p>
          <h1>Chuẩn bị góc học tập.</h1>
          <p>
            Điền biến môi trường trong <code>apps/web/.env.local</code>, áp dụng
            migration Supabase và khởi động worker theo README để bắt đầu.
          </p>
          <Link className="button" href="/">
            Về trang chủ
          </Link>
        </section>
      </main>
    );
  }
  const db = await sessionClient(true);
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/auth");
  return <StudyWorkspace email={user.email || "Sinh viên"} />;
}
