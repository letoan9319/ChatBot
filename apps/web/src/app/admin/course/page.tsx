import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-provider";
import { extractRoleNames, resolveUserPermissions } from "@/core/roles";
import { sessionClient } from "@/core/supabase-server";
import styles from "../knowledge/knowledge.module.css";
import { CourseManager } from "./course-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Soạn lộ trình học | LearnStep" };

export default async function CourseAdminPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/study");
  const db = await sessionClient(true);
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/auth");

  const { data: roleRows, error: roleError } = await db.from("user_roles").select("role").eq("user_id", user.id);
  const permissions = resolveUserPermissions(roleError ? [] : extractRoleNames(roleRows));
  if (!roleError && !permissions.canManageKnowledge) notFound();

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <nav className={styles.headerNav} aria-label="Điều hướng soạn lộ trình">
            <Link className={styles.back} href="/study">Về góc học tập</Link>
            <Link className={styles.back} href="/admin/knowledge">Quản lý tài liệu chung</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <div className={styles.content} data-wide="true">
        <div className={styles.intro}>
          <h1>Soạn lộ trình học</h1>
          <p>
            Tạo bản nháp bài giảng bằng AI từ tài liệu chung của môn, chỉnh sửa nội dung và câu hỏi kiểm tra,
            rồi công bố để người học dùng trong mục Học theo tiến trình.
          </p>
        </div>
        {roleError ? (
          <p className={styles.feedback} role="alert" data-error="true">
            Không thể xác minh quyền tài khoản. <Link href="/admin/course">Thử lại</Link>
          </p>
        ) : (
          <CourseManager />
        )}
      </div>
    </main>
  );
}
