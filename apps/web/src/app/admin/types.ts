import type { AppRole } from "@/core/roles";

export type AdminCounts = {
  users: number;
  profiles: number;
  admins: number;
  content_managers: number;
  ready_documents: number;
  published_documents: number;
  study_groups: number;
  active_jobs: number;
};

export type AdminAuditAction = "grant_role" | "revoke_role" | "delete_group";

export type AdminAuditEntry = {
  id: string;
  actor_id: string;
  actor_username: string | null;
  action: AdminAuditAction | string;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type AdminOverview = {
  counts: AdminCounts;
  recent_audit: AdminAuditEntry[];
};

export type AdminUserRow = {
  user_id: string;
  username: string | null;
  roles: AppRole[];
  created_at: string | null;
};

export type AdminGroupRow = {
  id: string;
  name: string;
  subject: string;
  description: string;
  owner_id: string;
  owner_username: string | null;
  member_count: number;
  message_count: number;
  created_at: string;
};

export type AdminActionFeedback = {
  error: boolean;
  message: string;
} | null;
