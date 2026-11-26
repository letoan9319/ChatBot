export const appRoles = ["admin", "content_manager"] as const;
export type AppRole = (typeof appRoles)[number];

export type UserPermissions = {
  isAdmin: boolean;
  canManageKnowledge: boolean;
  canModerateGroups: boolean;
  canManageRoles: boolean;
  roleLabel: string;
};

export const roleLabels: Record<AppRole | "user", string> = {
  admin: "Quản trị viên",
  content_manager: "Quản lý tài liệu",
  user: "Người học",
};

export function isAppRole(value: string): value is AppRole {
  return value === "admin" || value === "content_manager";
}

export function normalizeRoles(roles: Iterable<string> | null | undefined): AppRole[] {
  if (!roles) return [];
  const seen = new Set<AppRole>();
  for (const role of roles) {
    if (isAppRole(role)) seen.add(role);
  }
  return appRoles.filter((role) => seen.has(role));
}

export function extractRoleNames(
  rows: ReadonlyArray<{ role?: string | null }> | null | undefined,
): string[] {
  if (!rows) return [];
  return rows.flatMap((row) => (typeof row.role === "string" ? [row.role] : []));
}

export function resolveUserPermissions(
  roles: Iterable<string> | null | undefined,
): UserPermissions {
  const normalized = normalizeRoles(roles);
  const isAdmin = normalized.includes("admin");
  const isContentManager = normalized.includes("content_manager");

  if (isAdmin) {
    return {
      isAdmin: true,
      canManageKnowledge: true,
      canModerateGroups: true,
      canManageRoles: true,
      roleLabel: roleLabels.admin,
    };
  }

  if (isContentManager) {
    return {
      isAdmin: false,
      canManageKnowledge: true,
      canModerateGroups: false,
      canManageRoles: false,
      roleLabel: roleLabels.content_manager,
    };
  }

  return {
    isAdmin: false,
    canManageKnowledge: false,
    canModerateGroups: false,
    canManageRoles: false,
    roleLabel: roleLabels.user,
  };
}
