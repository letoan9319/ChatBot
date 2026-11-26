import { describe, expect, it } from "vitest";
import {
  appRoles,
  extractRoleNames,
  isAppRole,
  normalizeRoles,
  resolveUserPermissions,
  roleLabels,
} from "./roles";

describe("role permission matrix", () => {
  it("resolves regular learner permissions when user has no role rows", () => {
    expect(resolveUserPermissions([])).toEqual({
      isAdmin: false,
      canManageKnowledge: false,
      canModerateGroups: false,
      canManageRoles: false,
      roleLabel: "Người học",
    });
    expect(resolveUserPermissions(null)).toEqual(resolveUserPermissions(undefined));
  });

  it("resolves content_manager permissions without admin capabilities", () => {
    expect(resolveUserPermissions(["content_manager"])).toEqual({
      isAdmin: false,
      canManageKnowledge: true,
      canModerateGroups: false,
      canManageRoles: false,
      roleLabel: "Quản lý tài liệu",
    });
  });

  it("resolves admin permissions with full capabilities regardless of secondary roles", () => {
    const expected = {
      isAdmin: true,
      canManageKnowledge: true,
      canModerateGroups: true,
      canManageRoles: true,
      roleLabel: "Quản trị viên",
    };
    expect(resolveUserPermissions(["admin"])).toEqual(expected);
    expect(resolveUserPermissions(["content_manager", "admin"])).toEqual(expected);
    expect(resolveUserPermissions(["admin", "content_manager"])).toEqual(expected);
  });

  it("ignores unknown or forged role strings and deduplicates known roles", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("content_manager")).toBe(true);
    expect(isAppRole("superadmin")).toBe(false);
    expect(isAppRole("user")).toBe(false);
    expect(normalizeRoles(["unknown", "content_manager", "content_manager", "admin", "owner"])).toEqual([
      ...appRoles,
    ]);
    expect(resolveUserPermissions(["superadmin", "owner", "moderator"])).toEqual({
      isAdmin: false,
      canManageKnowledge: false,
      canModerateGroups: false,
      canManageRoles: false,
      roleLabel: roleLabels.user,
    });
  });

  it("extracts valid role strings from database query rows", () => {
    expect(
      extractRoleNames([{ role: "admin" }, { role: null }, {}, { role: "content_manager" }]),
    ).toEqual(["admin", "content_manager"]);
    expect(extractRoleNames(null)).toEqual([]);
  });
});
