import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveUserPermissions } from "@/core/roles";
import { StudyToolbar } from "./study-toolbar";

const noop = () => {};
const noopAsync = async () => {};

function renderToolbar(roles: string[]) {
  return renderToStaticMarkup(
    <StudyToolbar
      username="minh_anh"
      avatar={null}
      permissions={resolveUserPermissions(roles)}
      online
      loading={false}
      provider="ollama"
      streak={null}
      streakError=""
      title="Tổng quan"
      subtitle=""
      onSignOut={noopAsync}
      onOpenConversation={noop}
      onOpenGroup={noop}
      onOpenSettings={noop}
      onOpenGuide={noop}
    />,
  );
}

describe("StudyToolbar role gating", () => {
  it("hides all admin navigation for regular learners", () => {
    const html = renderToolbar([]);
    expect(html).toContain("Người học");
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain('href="/admin/knowledge"');
    expect(html).not.toContain("Bảng điều khiển quản trị");
    expect(html).not.toContain("Quản lý tài liệu chung");
  });

  it("shows only knowledge management for content managers", () => {
    const html = renderToolbar(["content_manager"]);
    expect(html).toContain("Quản lý tài liệu");
    expect(html).toContain('href="/admin/knowledge"');
    expect(html).toContain("Quản lý tài liệu chung");
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain("Bảng điều khiển quản trị");
  });

  it("shows both admin console and knowledge management for admins", () => {
    const html = renderToolbar(["admin"]);
    expect(html).toContain("Quản trị viên");
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Bảng điều khiển quản trị");
    expect(html).toContain('href="/admin/knowledge"');
    expect(html).toContain("Quản lý tài liệu chung");
  });
});
