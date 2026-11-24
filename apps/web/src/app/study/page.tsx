import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { sessionClient } from "@/core/supabase-server";
import { StudyWorkspace } from "@/components/study-workspace";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-provider";
import { uuid } from "@/core/validation";
import type { AvatarId } from "@/core/pixel-packs";

export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export const dynamic = "force-dynamic";
export default async function StudyPage({ searchParams }: { searchParams: Promise<{ conversation?: string; library?: string }> }) {
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
  const [profileResult, { data: contentRole }] = await Promise.all([
    db.from("profiles").select("username,avatar_id").eq("id", user.id).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", user.id).eq("role", "content_manager").maybeSingle(),
  ]);
  const profile = profileResult.error?.code === "42703"
    ? (await db.from("profiles").select("username").eq("id", user.id).maybeSingle()).data
    : profileResult.data;
  if (!profile?.username) redirect("/onboarding");
  const query = await searchParams;
  const conversation = uuid.safeParse(query.conversation);
  const library = query.library === "personal" ? "documents" : query.library === "knowledge" ? "knowledge" : null;
  return <StudyWorkspace userId={user.id} username={profile.username} canManageKnowledge={Boolean(contentRole)}
    initialAvatar={(profileResult.data?.avatar_id ?? null) as AvatarId | null}
    initialConversationId={conversation.success ? conversation.data : null} initialLibrary={library} />;
}
