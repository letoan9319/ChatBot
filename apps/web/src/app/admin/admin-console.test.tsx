import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  setUserRoleAction: vi.fn(),
  deleteGroupAction: vi.fn(),
}));

import { AdminConsole } from "./admin-console";
import type { AdminGroupRow, AdminOverview, AdminUserRow } from "./types";

const overview: AdminOverview = {
  counts: {
    users: 24,
    profiles: 22,
    admins: 2,
    content_managers: 3,
    ready_documents: 45,
    published_documents: 12,
    study_groups: 6,
    active_jobs: 1,
  },
  recent_audit: [
    {
      id: "audit-1",
      actor_id: "admin-1",
      actor_username: "truong_admin",
      action: "grant_role",
      target_id: "user-2",
      detail: { role: "content_manager", target_username: "minh_cm" },
      created_at: "2026-11-26T00:00:00.000Z",
    },
  ],
};

const users: AdminUserRow[] = [
  {
    user_id: "admin-1",
    username: "truong_admin",
    roles: ["admin"],
    created_at: "2026-10-01T00:00:00.000Z",
  },
  {
    user_id: "user-2",
    username: "minh_cm",
    roles: ["content_manager"],
    created_at: "2026-10-05T00:00:00.000Z",
  },
  {
    user_id: "user-3",
    username: "lan_learner",
    roles: [],
    created_at: "2026-10-10T00:00:00.000Z",
  },
];

const groups: AdminGroupRow[] = [
  {
    id: "group-1",
    name: "Ôn thi Giải tích 1",
    subject: "calculus",
    description: "Cùng trao đổi bài tập chương tích phân.",
    owner_id: "user-3",
    owner_username: "lan_learner",
    member_count: 8,
    message_count: 42,
    created_at: "2026-10-15T00:00:00.000Z",
  },
];

describe("AdminConsole rendering", () => {
  it("renders system metrics, role controls, group moderation, and audit entries cleanly", () => {
    const html = renderToStaticMarkup(
      <AdminConsole
        currentUserId="admin-1"
        search=""
        overview={overview}
        users={users}
        groups={groups}
      />,
    );

    expect(html).toContain("Tổng quan hệ thống");
    expect(html).toContain('href="/admin/knowledge"');
    expect(html).toContain("Quản lý phân quyền người dùng");
    expect(html).toContain("truong_admin");
    expect(html).toContain("minh_cm");
    expect(html).toContain("lan_learner");
    expect(html).toContain("Thu hồi quản trị");
    expect(html).toContain("Cấp quản trị viên");
    expect(html).toContain("Kiểm duyệt nhóm học");
    expect(html).toContain("Ôn thi Giải tích 1");
    expect(html).toContain("Giải tích");
    expect(html).toContain("Nhật ký quản trị gần đây");
    expect(html).toContain("Cấp vai trò");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
