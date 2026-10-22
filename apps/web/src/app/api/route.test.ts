import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("@/core/supabase-server", () => ({
  sessionClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
  storageAdmin: mocks.admin,
}));
import { GET, POST } from "./[[...path]]/route";

const id = "318b12a1-0c59-45a3-bd28-5304d98b92e9";
const request = (
  path: string,
  body?: unknown,
  origin = "http://localhost:3000",
) =>
  new NextRequest(`http://localhost:3000/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "authenticated-owner" } },
  });
});

describe("API authorization and asynchronous boundaries", () => {
  it("reports the active provider without exposing AI credentials", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "app_worker_online" ? true : "openrouter", error: null,
    }));
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ in: () => ({
      limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }) }) }) });
    const response = await GET(request("status"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ online: true, provider: "openrouter", activeChat: null });
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "SQL details" } });
    const missing = await GET(request("status"));
    expect(missing.status).toBe(503);
    expect(JSON.stringify(await missing.json())).not.toContain("SQL details");
  });
  it("saves a username for the authenticated owner without trusting a client user ID", async () => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    mocks.rpc.mockResolvedValue({ data: "minh_anh", error: null });
    const response = await POST(request("profile", { username: " Minh_Anh " }));
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("app_set_username", { p_username: "minh_anh" });
    expect(await response.json()).toEqual({ username: "minh_anh" });
    mocks.rpc.mockClear();
    const forged = await POST(request("profile", { username: "minh_anh", user_id: id }));
    expect(forged.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects signed-out username claims and invalid names", async () => {
    expect((await POST(request("profile", { username: "ab" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request("profile", { username: "valid_name" }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("explains duplicate usernames and missing profile migrations without database details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "USERNAME_TAKEN SQL detail" } });
    const duplicate = await POST(request("profile", { username: "taken_name" }));
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(await duplicate.json())).not.toContain("SQL");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing RPC SQL detail" } });
    expect((await POST(request("profile", { username: "new_name" }))).status).toBe(503);
  });
  it("returns 401 before touching data for a signed-out user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request("documents"))).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects cross-origin cookie mutations", async () => {
    expect(
      (
        await POST(
          request("conversations", { key: id }, "https://foreign.example"),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("queues chat with a request key and never forwards a client owner ID", async () => {
    mocks.rpc.mockResolvedValue({
      data: { id, status: "queued" },
      error: null,
    });
    const response = await POST(
      request(`conversations/${id}/messages`, {
        key: id,
        question: "Giải thích đạo hàm",
        documentIds: [id],
        user_id: "forged-owner",
      }),
    );
    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith("app_send_message", {
      p_conversation: id,
      p_question: "Giải thích đạo hàm",
      p_documents: [id],
      p_key: id,
    });
  });
  it("maps offline and quota errors without leaking database details", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORKER_OFFLINE internal SQL context" },
    });
    const response = await POST(request("conversations", { key: id }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("SQL");
  });
  it("does not sign a URL for inaccessible or removed sources", async () => {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    });
    expect((await GET(request(`sources/${id}`))).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects malformed files before creating upload credentials", async () => {
    expect(
      (
        await POST(
          request("documents/upload-intent", {
            name: "bad.exe",
            size: 123,
            subject: "calculus",
            key: id,
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
