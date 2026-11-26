"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { resolveUserPermissions, roleLabels } from "@/core/roles";
import { subjects } from "@/core/validation";
import { deleteGroupAction, setUserRoleAction } from "./actions";
import type { AdminAuditEntry, AdminGroupRow, AdminOverview, AdminUserRow } from "./types";
import styles from "./admin.module.css";

const dateTimeFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeZone: "Asia/Ho_Chi_Minh",
});

function formatTimestamp(value: string | null | undefined, withTime = false): string {
  if (!value) return "Chưa rõ thời gian";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Chưa rõ thời gian";
  return withTime ? dateTimeFormat.format(parsed) : dateFormat.format(parsed);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatAuditAction(action: string): string {
  if (action === "grant_role") return "Cấp vai trò";
  if (action === "revoke_role") return "Thu hồi vai trò";
  if (action === "delete_group") return "Xóa nhóm học";
  return action;
}

function formatAuditDetail(entry: AdminAuditEntry): string {
  const detail = entry.detail ?? {};
  const role = typeof detail.role === "string" ? detail.role : null;
  const groupName = typeof detail.group_name === "string"
    ? detail.group_name
    : typeof detail.name === "string"
      ? detail.name
      : null;
  const targetUsername = typeof detail.target_username === "string"
    ? detail.target_username
    : typeof detail.username === "string"
      ? detail.username
      : null;

  const parts: string[] = [];
  if (role && role in roleLabels) {
    parts.push(`Vai trò: ${roleLabels[role as keyof typeof roleLabels]}`);
  } else if (role) {
    parts.push(`Vai trò: ${role}`);
  }
  if (targetUsername) parts.push(`Tài khoản: ${targetUsername}`);
  if (groupName) parts.push(`Nhóm: ${groupName}`);
  if (parts.length === 0 && entry.target_id) {
    parts.push(`Mã đối tượng: ${shortId(entry.target_id)}`);
  }
  return parts.join(" · ");
}

function RevokeAdminDisclosure({
  userId,
  username,
  isSelf,
  action,
  pending,
}: {
  userId: string;
  username: string;
  isSelf: boolean;
  action: (form: FormData) => void;
  pending: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = ["THU HỒI", "THU HOI"].includes(
    confirmation.trim().toLocaleUpperCase("vi-VN"),
  );

  return (
    <details className={styles.disclosure}>
      <summary>Thu hồi quản trị</summary>
      <form className={styles.disclosureForm} action={action}>
        <input type="hidden" name="targetUserId" value={userId} />
        <input type="hidden" name="role" value="admin" />
        <input type="hidden" name="grant" value="false" />
        <p>
          {isSelf
            ? "Bạn đang thu hồi quyền quản trị của chính mình. Hệ thống sẽ chặn nếu đây là quản trị viên cuối cùng."
            : `Thu hồi quyền quản trị của ${username}. Người dùng sẽ không còn truy cập được trang /admin.`}
        </p>
        <label>
          Nhập “THU HỒI” để xác nhận
          <input
            type="text"
            name="confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="THU HỒI"
            autoComplete="off"
            disabled={pending}
          />
        </label>
        <button
          type="submit"
          className={`button secondary small ${styles.dangerButton}`}
          disabled={pending || !confirmed}
        >
          {pending ? "Đang cập nhật..." : "Xác nhận thu hồi quản trị"}
        </button>
      </form>
    </details>
  );
}

export function AdminConsole({
  currentUserId,
  search,
  overview,
  users,
  groups,
}: {
  currentUserId: string;
  search: string;
  overview: AdminOverview;
  users: AdminUserRow[];
  groups: AdminGroupRow[];
}) {
  const [roleFeedback, roleAction, rolePending] = useActionState(setUserRoleAction, null);
  const [groupFeedback, groupAction, groupPending] = useActionState(deleteGroupAction, null);

  const metrics: Array<{ label: string; value: number }> = [
    { label: "Tài khoản", value: overview.counts.users },
    { label: "Hồ sơ học tập", value: overview.counts.profiles },
    { label: "Quản trị viên", value: overview.counts.admins },
    { label: "Quản lý tài liệu", value: overview.counts.content_managers },
    { label: "Tài liệu sẵn sàng", value: overview.counts.ready_documents },
    { label: "Tài liệu kho chung", value: overview.counts.published_documents },
    { label: "Nhóm học", value: overview.counts.study_groups },
    { label: "Tác vụ đang chạy", value: overview.counts.active_jobs },
  ];

  return (
    <>
      <div aria-live="polite" aria-atomic="true">
        {roleFeedback && !rolePending && (
          <p className={styles.feedback} role={roleFeedback.error ? "alert" : "status"} data-error={roleFeedback.error}>
            {roleFeedback.message}
          </p>
        )}
        {groupFeedback && !groupPending && (
          <p className={styles.feedback} role={groupFeedback.error ? "alert" : "status"} data-error={groupFeedback.error}>
            {groupFeedback.message}
          </p>
        )}
      </div>

      <section className={styles.section} aria-labelledby="admin-overview-heading">
        <div className={styles.sectionHeading}>
          <h2 id="admin-overview-heading">Tổng quan hệ thống</h2>
          <Link className={styles.sectionLink} href="/admin/knowledge">
            Mở quản lý tài liệu chung
          </Link>
        </div>
        <div className={styles.metricsGrid}>
          {metrics.map((metric) => (
            <div className={styles.metricCard} key={metric.label}>
              <span className={styles.metricLabel}>{metric.label}</span>
              <strong className={styles.metricValue}>{metric.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="admin-roles-heading">
        <div className={styles.sectionHeading}>
          <h2 id="admin-roles-heading">Quản lý phân quyền người dùng</h2>
          <span>{users.length} tài khoản hiển thị</span>
        </div>
        <form className={styles.searchBar} method="get" action="/admin">
          <label className="sr-only" htmlFor="admin-user-search">
            Tìm người dùng theo username hoặc mã tài khoản
          </label>
          <input
            id="admin-user-search"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Tìm theo username..."
            maxLength={80}
          />
          <button type="submit" className="button secondary small">
            Tìm kiếm
          </button>
          {search && (
            <Link className={styles.sectionLink} href="/admin">
              Xóa bộ lọc
            </Link>
          )}
        </form>
        {users.length > 0 ? (
          <ul className={styles.list}>
            {users.map((item) => {
              const perms = resolveUserPermissions(item.roles);
              const hasAdmin = item.roles.includes("admin");
              const hasContentManager = item.roles.includes("content_manager");
              const displayName = item.username ?? "Chưa đặt username";
              const isSelf = item.user_id === currentUserId;

              return (
                <li className={styles.row} key={item.user_id}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      <strong>{displayName}</strong>
                      {isSelf && <span className={styles.badge}>Tài khoản hiện tại</span>}
                      {hasAdmin && (
                        <span className={styles.badge} data-tone="admin">
                          {roleLabels.admin}
                        </span>
                      )}
                      {hasContentManager && (
                        <span className={styles.badge} data-tone="content_manager">
                          {roleLabels.content_manager}
                        </span>
                      )}
                      {!hasAdmin && !hasContentManager && (
                        <span className={styles.badge}>{perms.roleLabel}</span>
                      )}
                    </div>
                    <p className={styles.rowMeta}>
                      Mã: <span className={styles.auditCode}>{shortId(item.user_id)}</span>
                      {" · "}
                      Tham gia: {formatTimestamp(item.created_at)}
                    </p>
                  </div>
                  <div className={styles.rowActions}>
                    <form className={styles.inlineForm} action={roleAction}>
                      <input type="hidden" name="targetUserId" value={item.user_id} />
                      <input type="hidden" name="role" value="content_manager" />
                      <input type="hidden" name="grant" value={hasContentManager ? "false" : "true"} />
                      <button
                        type="submit"
                        className="button secondary small"
                        disabled={rolePending}
                      >
                        {hasContentManager ? "Thu hồi quản lý tài liệu" : "Cấp quản lý tài liệu"}
                      </button>
                    </form>
                    {hasAdmin ? (
                      <RevokeAdminDisclosure
                        userId={item.user_id}
                        username={displayName}
                        isSelf={isSelf}
                        action={roleAction}
                        pending={rolePending}
                      />
                    ) : (
                      <details className={styles.disclosure}>
                        <summary>Cấp quản trị viên</summary>
                        <form className={styles.disclosureForm} action={roleAction}>
                          <input type="hidden" name="targetUserId" value={item.user_id} />
                          <input type="hidden" name="role" value="admin" />
                          <input type="hidden" name="grant" value="true" />
                          <p>
                            Cấp quyền quản trị hệ thống cho {displayName}, bao gồm phân quyền người dùng, quản lý tài liệu chung và kiểm duyệt nhóm học.
                          </p>
                          <button type="submit" className="button small" disabled={rolePending}>
                            {rolePending ? "Đang cập nhật..." : "Xác nhận cấp quản trị"}
                          </button>
                        </form>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.empty}>
            {search ? `Không tìm thấy tài khoản phù hợp với “${search}”.` : "Chưa có tài khoản nào trong hệ thống."}
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="admin-groups-heading">
        <div className={styles.sectionHeading}>
          <h2 id="admin-groups-heading">Kiểm duyệt nhóm học</h2>
          <span>{groups.length} nhóm</span>
        </div>
        {groups.length > 0 ? (
          <ul className={styles.list}>
            {groups.map((group) => (
              <li className={styles.row} key={group.id}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>
                    <strong>{group.name}</strong>
                    <span className={styles.badge} data-tone="subject">
                      {subjects[group.subject as keyof typeof subjects] ?? group.subject}
                    </span>
                  </div>
                  <p className={styles.rowMeta}>
                    Chủ nhóm: {group.owner_username ?? shortId(group.owner_id)}
                    {" · "}
                    {group.member_count} thành viên
                    {" · "}
                    {group.message_count} tin nhắn
                    {" · "}
                    Tạo ngày {formatTimestamp(group.created_at)}
                  </p>
                  {group.description && <p className={styles.rowDescription}>{group.description}</p>}
                </div>
                <div className={styles.rowActions}>
                  <details className={styles.disclosure}>
                    <summary>Xóa nhóm</summary>
                    <form className={styles.disclosureForm} action={groupAction}>
                      <input type="hidden" name="groupId" value={group.id} />
                      <p>
                        Xóa vĩnh viễn nhóm “{group.name}” cùng toàn bộ tin nhắn và tệp đính kèm. Thao tác này sẽ được ghi vào nhật ký quản trị.
                      </p>
                      <button
                        type="submit"
                        className={`button secondary small ${styles.dangerButton}`}
                        disabled={groupPending}
                      >
                        {groupPending ? "Đang xóa..." : "Xác nhận xóa nhóm"}
                      </button>
                    </form>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Hiện chưa có nhóm học nào cần kiểm duyệt.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="admin-audit-heading">
        <div className={styles.sectionHeading}>
          <h2 id="admin-audit-heading">Nhật ký quản trị gần đây</h2>
          <span>{overview.recent_audit.length} mục</span>
        </div>
        {overview.recent_audit.length > 0 ? (
          <ul className={styles.list}>
            {overview.recent_audit.map((entry) => {
              const detailText = formatAuditDetail(entry);
              return (
                <li className={styles.row} key={entry.id}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      <strong>{formatAuditAction(entry.action)}</strong>
                      <span className={styles.badge}>
                        {entry.actor_username ?? shortId(entry.actor_id)}
                      </span>
                    </div>
                    {detailText && <p className={styles.rowMeta}>{detailText}</p>}
                  </div>
                  <p className={styles.rowMeta}>{formatTimestamp(entry.created_at, true)}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.empty}>Chưa có thao tác quản trị nào được ghi nhận.</p>
        )}
      </section>
    </>
  );
}
