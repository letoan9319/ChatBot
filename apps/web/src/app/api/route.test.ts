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
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "authenticated-owner" } },
  });
});

describe("API authorization and asynchronous boundaries", () => {
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
