import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("@/core/supabase-server", () => ({
  sessionClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

import AdminPage from "./page";
import KnowledgeAdminPage from "./knowledge/page";

function mockRoles(roles: string[]) {
  mocks.from.mockImplementation((table: string) => {
    if (table === "user_roles") {
      return {
        select: () => ({
          eq: async () => ({
            data: roles.map((role) => ({ role })),
            error: null,
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("server component page gating for /admin and /admin/knowledge", () => {
  it("returns notFound on /admin for regular users and non-admin content managers", async () => {
    for (const roles of [[], ["content_manager"]]) {
      mockRoles(roles);
      await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("loads /admin for admin users", async () => {
    mockRoles(["admin"]);
    mocks.rpc.mockResolvedValue({
      data: {
        counts: {
          users: 1,
          profiles: 1,
          admins: 1,
          content_managers: 0,
          ready_documents: 0,
          published_documents: 0,
          study_groups: 0,
          active_jobs: 0,
        },
        recent_audit: [],
      },
      error: null,
    });
    const element = await AdminPage({ searchParams: Promise.resolve({ q: "minh" }) });
    expect(element).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith("app_admin_overview");
    expect(mocks.rpc).toHaveBeenCalledWith("app_admin_list_users", { p_search: "minh", p_limit: 50 });
    expect(mocks.rpc).toHaveBeenCalledWith("app_admin_list_groups", { p_limit: 50 });
  });

  it("returns notFound on /admin/knowledge for regular users and allows both content_manager and admin", async () => {
    mockRoles([]);
    await expect(KnowledgeAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.rpc).not.toHaveBeenCalled();

    for (const roles of [["content_manager"], ["admin"]]) {
      mockRoles(roles);
      mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
      const element = await KnowledgeAdminPage();
      expect(element).toBeTruthy();
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("app_list_knowledge_documents");
  });

  it("redirects signed-out visitors to /auth", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/auth");
    await expect(KnowledgeAdminPage()).rejects.toThrow("NEXT_REDIRECT:/auth");
  });
});
