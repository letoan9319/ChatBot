import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-provider";
import { sessionClient } from "@/core/supabase-server";
import { KnowledgeManager, type ManageableDocument, type PublishedDocument } from "./knowledge-manager";
import styles from "./knowledge.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quản lý tài liệu chung | LearnStep" };

export default async function KnowledgeAdminPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/study");
  const db = await sessionClient(true);
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth");

  const { data: role, error: roleError } = await db.from("user_roles").select("role")
    .eq("user_id", user.id).eq("role", "content_manager").maybeSingle();
  if (!roleError && !role) notFound();

  let documents: ManageableDocument[] = [];
  let published: PublishedDocument[] = [];
  let loadFailed = Boolean(roleError);
  if (role) {
    const [own, shared] = await Promise.all([
      db.from("documents").select("id,name,subject,file_type").eq("user_id", user.id)
        .eq("status", "ready").order("created_at", { ascending: false }),
      db.rpc("app_list_knowledge_documents"),
    ]);
    loadFailed = Boolean(own.error || shared.error);
    if (!loadFailed) {
      published = shared.data as PublishedDocument[];
      const publishedIds = new Set(published.map((document) => document.id));
      documents = (own.data as ManageableDocument[]).filter((document) => !publishedIds.has(document.id));
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.back} href="/study">Về góc học tập</Link>
          <ThemeToggle />
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.intro}>
          <h1>Quản lý tài liệu chung</h1>
          <p>Công bố tài liệu để người học có thể đọc và dùng làm nguồn khi hỏi trợ giảng.</p>
        </div>
        {loadFailed ? (
          <p className={styles.feedback} role="alert" data-error="true">
            Chưa tải được kho tài liệu. <Link href="/admin/knowledge">Thử lại</Link>
          </p>
        ) : (
          <KnowledgeManager documents={documents} published={published} />
        )}
      </div>
    </main>
  );
}
