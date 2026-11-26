import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/core/supabase-server", () => ({
  sessionClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { deleteGroupAction, setUserRoleAction } from "./actions";
import { setPublication } from "./knowledge/actions";

const targetId = "318b12a1-0c59-45a3-bd28-5304d98b92e9";

function mockUserRoles(roles: string[]) {
  mocks.from.mockReturnValue({
    select: () => ({
      eq: async () => ({
        data: roles.map((role) => ({ role })),
        error: null,
      }),
    }),
  });
}

function makeForm(entries: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "actor-1" } } });
});

describe("admin and knowledge server actions authorization", () => {
  it("blocks regular learners and non-admin content managers from admin actions", async () => {
    for (const roles of [[], ["content_manager"]]) {
      mockUserRoles(roles);
      const roleResult = await setUserRoleAction(
        null,
        makeForm({ targetUserId: targetId, role: "content_manager", grant: "true" }),
      );
      expect(roleResult?.error).toBe(true);
      expect(roleResult?.message).toContain("không có quyền quản trị");

      const groupResult = await deleteGroupAction(null, makeForm({ groupId: targetId }));
      expect(groupResult?.error).toBe(true);
      expect(groupResult?.message).toContain("không có quyền quản trị");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation text before revoking admin role", async () => {
    mockUserRoles(["admin"]);
    const missingConfirm = await setUserRoleAction(
      null,
      makeForm({ targetUserId: targetId, role: "admin", grant: "false", confirmation: "" }),
    );
    expect(missingConfirm?.error).toBe(true);
    expect(missingConfirm?.message).toContain("THU HỒI");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps LAST_ADMIN safely when revoking the final admin", async () => {
    mockUserRoles(["admin"]);
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "LAST_ADMIN internal constraint info" },
    });
    const result = await setUserRoleAction(
      null,
      makeForm({ targetUserId: targetId, role: "admin", grant: "false", confirmation: "THU HỒI" }),
    );
    expect(result?.error).toBe(true);
    expect(result?.message).toContain("quản trị viên cuối cùng");
    expect(result?.message).not.toContain("constraint");
  });

  it("allows admins to grant roles and remove violating groups", async () => {
    mockUserRoles(["admin"]);
    mocks.rpc.mockResolvedValueOnce({
      data: { user_id: targetId, username: "linh", roles: ["content_manager"], changed: true },
      error: null,
    });
    const grantResult = await setUserRoleAction(
      null,
      makeForm({ targetUserId: targetId, role: "content_manager", grant: "true" }),
    );
    expect(grantResult?.error).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("app_admin_set_user_role", {
      p_target_user_id: targetId,
      p_role: "content_manager",
      p_grant: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");

    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    const deleteResult = await deleteGroupAction(null, makeForm({ groupId: targetId }));
    expect(deleteResult?.error).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("app_admin_delete_group", { p_group_id: targetId });
  });

  it("allows both admin and content_manager on knowledge publication while blocking regular users", async () => {
    const form = makeForm({ id: targetId, action: "publish", description: "Giáo trình chuẩn" });

    mockUserRoles([]);
    const denied = await setPublication(null, form);
    expect(denied?.error).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();

    for (const roles of [["content_manager"], ["admin"]]) {
      mockUserRoles(roles);
      mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
      const allowed = await setPublication(null, form);
      expect(allowed?.error).toBe(false);
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
