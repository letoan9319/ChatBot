import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-provider";
import { extractRoleNames, resolveUserPermissions } from "@/core/roles";
import { sessionClient } from "@/core/supabase-server";
import { AdminConsole } from "./admin-console";
import type { AdminGroupRow, AdminOverview, AdminUserRow } from "./types";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bảng điều khiển quản trị | LearnStep" };

const emptyOverview: AdminOverview = {
  counts: {
    users: 0,
    profiles: 0,
    admins: 0,
    content_managers: 0,
    ready_documents: 0,
    published_documents: 0,
    study_groups: 0,
    active_jobs: 0,
  },
  recent_audit: [],
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect("/study");
  }

  const db = await sessionClient(true);
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/auth");

  const { data: roleRows, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const permissions = resolveUserPermissions(
    roleError ? [] : extractRoleNames(roleRows),
  );
  if (!roleError && !permissions.isAdmin) notFound();

  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";

  let overview: AdminOverview = emptyOverview;
  let users: AdminUserRow[] = [];
  let groups: AdminGroupRow[] = [];
  let loadFailed = Boolean(roleError);

  if (permissions.isAdmin) {
    const [overviewResult, usersResult, groupsResult] = await Promise.all([
      db.rpc("app_admin_overview"),
      db.rpc("app_admin_list_users", { p_search: search, p_limit: 50 }),
      db.rpc("app_admin_list_groups", { p_limit: 50 }),
    ]);

    const errors = [overviewResult.error, usersResult.error, groupsResult.error].filter(Boolean);
    if (errors.some((err) => err?.message.includes("FORBIDDEN"))) {
      notFound();
    }

    loadFailed = errors.length > 0;
    if (!loadFailed) {
      overview = (overviewResult.data as AdminOverview | null) ?? emptyOverview;
      users = Array.isArray(usersResult.data) ? (usersResult.data as AdminUserRow[]) : [];
      groups = Array.isArray(groupsResult.data) ? (groupsResult.data as AdminGroupRow[]) : [];
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <nav className={styles.headerNav} aria-label="Điều hướng quản trị hệ thống">
            <Link className={styles.back} href="/study">
              Về góc học tập
            </Link>
            <Link className={styles.back} href="/admin/knowledge">
              Quản lý tài liệu chung
            </Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles.intro}>
          <div>
            <h1>Bảng điều khiển quản trị</h1>
            <p>Theo dõi hệ thống, phân quyền tài khoản và kiểm duyệt nhóm học trên LearnStep.</p>
          </div>
          <div className={styles.introActions}>
            <Link className="button secondary small" href="/admin/knowledge">
              Quản lý tài liệu chung
            </Link>
          </div>
        </div>
        {loadFailed ? (
          <p className={styles.feedback} role="alert" data-error="true">
            Chưa tải được dữ liệu quản trị. <Link href="/admin">Thử lại</Link>
          </p>
        ) : (
          <AdminConsole
            currentUserId={user.id}
            search={search}
            overview={overview}
            users={users}
            groups={groups}
          />
        )}
      </div>
    </main>
  );
}
