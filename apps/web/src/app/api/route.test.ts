import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  admin: vi.fn(),
  signFile: vi.fn(),
  storageBucket: vi.fn(),
}));
vi.mock("@/core/supabase-server", () => ({
  sessionClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: mocks.storageBucket },
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
  mocks.storageBucket.mockReturnValue({ createSignedUrl: mocks.signFile });
});

describe("API authorization and asynchronous boundaries", () => {
  it("reads the shared catalog and exact document/chunk through authorized RPCs", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id, scope: "knowledge" }], error: null });
    expect((await GET(request("knowledge?user_id=foreign"))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_list_knowledge_documents");
    mocks.rpc.mockResolvedValue({ data: { id, excerpt: { page: 23 } }, error: null });
    const detail = await GET(request(`documents/${id}?chunk=${id}&user_id=foreign`));
    expect(await detail.json()).toEqual({ id, excerpt: { page: 23 } });
    expect(detail.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_get_document", { p_id: id, p_chunk: id });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("signs only authorized original files through storage RLS, with a short private redirect", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    mocks.rpc.mockResolvedValue({ data: { storage_path: "authorized/file.pdf", file_type: "pdf", name: "book.pdf" }, error: null });
    mocks.signFile.mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/storage/signed/file" }, error: null });
    const response = await GET(request(`documents/${id}/file?page=23&storage_path=foreign`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.supabase.co/storage/signed/file#page=23");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("app_document_file", { p_id: id });
    expect(mocks.storageBucket).toHaveBeenCalledWith("documents");
    expect(mocks.signFile).toHaveBeenCalledWith("authorized/file.pdf", 120, undefined);
    mocks.rpc.mockResolvedValue({ data: { storage_path: "authorized/file.docx", file_type: "docx", name: "Giáo trình.docx" }, error: null });
    expect((await GET(request(`documents/${id}/file`))).status).toBe(307);
    expect(mocks.signFile).toHaveBeenLastCalledWith("authorized/file.docx", 120, { download: "Giáo trình.docx" });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("never signs denied files and rejects invalid repository identifiers or missing migrations", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NOT_FOUND private SQL detail" } });
    expect((await GET(request(`documents/${id}/file`))).status).toBe(404);
    expect(mocks.signFile).not.toHaveBeenCalled();
    expect((await GET(request("documents/invalid/file"))).status).toBe(400);
    expect((await GET(request(`documents/${id}?chunk=invalid`))).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private SQL detail" } });
    const missing = await GET(request("knowledge"));
    expect(missing.status).toBe(503);
    expect(JSON.stringify(await missing.json())).not.toContain("SQL detail");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request(`documents/${id}/file`))).status).toBe(401);
    expect((await GET(request("knowledge"))).status).toBe(401);
  });
  it("resolves an owned citation to its shared source and marks withdrawn sources unavailable", async () => {
    const source = { id, document_id: id, chunk_id: id, page: 23 };
    mocks.from.mockImplementation((table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: table === "message_sources" ? source : { content: "Authorized shared source" }, error: null,
    }) }) }) }));
    mocks.rpc.mockResolvedValue({ data: { status: "ready", file_type: "pdf", scope: "knowledge" }, error: null });
    const response = await GET(request(`sources/${id}`));
    expect(await response.json()).toEqual({ ...source, available: true, content: "Authorized shared source", url: `/api/documents/${id}/file?page=23` });
    expect(mocks.rpc).toHaveBeenCalledWith("app_get_document", { p_id: id, p_chunk: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NOT_FOUND" } });
    expect(await (await GET(request(`sources/${id}`))).json()).toEqual({ ...source, available: false });
    expect(mocks.signFile).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("supports community reads and mutations using the session without a service-role key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const group = { id, name: "Nhóm giải tích", subject: "calculus", member_count: 1, joined: true };
    mocks.rpc.mockResolvedValue({ data: [group], error: null });
    const list = await GET(request("groups?subject=calculus&user_id=foreign"));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([group]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_list_groups", { p_subject: "calculus" });
    mocks.rpc.mockResolvedValue({ data: group, error: null });
    const create = await POST(request("groups", { name: " Nhóm giải tích ", subject: "calculus", key: id }));
    expect(create.status).toBe(201);
    expect(await create.json()).toEqual(group);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_create_group", {
      p_name: "Nhóm giải tích", p_subject: "calculus", p_description: "", p_key: id,
    });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("joins and leaves only the requested group through authenticated RPCs", async () => {
    mocks.rpc.mockResolvedValue({ data: { joined: true }, error: null });
    expect((await POST(request(`groups/${id}/join`, {}))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_join_group", { p_group: id });
    expect(await (await POST(request(`groups/${id}/leave`, {}))).json()).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_leave_group", { p_group: id });
    mocks.rpc.mockClear();
    expect((await POST(request(`groups/${id}/join`, { user_id: "foreign" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("paginates group messages and validates message owners, IDs and content", async () => {
    const message = { id, content: "Bài tập giải tích", user_id: "authenticated-owner" };
    mocks.rpc.mockResolvedValue({ data: [message], error: null });
    const messages = await GET(request(`groups/${id}/messages?before=2026-10-28T00:00:00.000Z`));
    expect(await messages.json()).toEqual([message]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_group_messages", { p_group: id, p_before: "2026-10-28T00:00:00.000Z" });
    mocks.rpc.mockResolvedValue({ data: message, error: null });
    expect((await POST(request(`groups/${id}/messages`, { content: " Bài tập giải tích ", key: id }))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_post_group_message", { p_group: id, p_content: "Bài tập giải tích", p_key: id });
    mocks.rpc.mockClear();
    for (const input of [{ content: "", key: id }, { content: "x".repeat(2001), key: id }, { content: "x", key: id, user_id: "foreign" }]) {
      expect((await POST(request(`groups/${id}/messages`, input))).status).toBe(400);
    }
    expect((await GET(request(`groups/${id}/messages?before=invalid`))).status).toBe(400);
    expect((await GET(request("groups/not-a-uuid/messages"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed group metadata before database access", async () => {
    for (const input of [
      { name: "ab", subject: "calculus", key: id },
      { name: "Valid group", subject: "unknown", key: id },
      { name: "Valid group", subject: "calculus", key: id, owner_id: id },
      { name: "Valid group", subject: "calculus", key: id, description: "x".repeat(501) },
    ]) expect((await POST(request("groups", input))).status).toBe(400);
    expect((await GET(request("groups?subject=unknown"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("lists only the authenticated user's latest notifications and counts all unread", async () => {
    const items = [{ id, title: "Hoàn thành câu trả lời", read_at: null }];
    const rowFilter = vi.fn(() => ({ order: () => ({ order: () => ({ limit: async () => ({ data: items, error: null }) }) }) }));
    const countFilter = vi.fn(() => ({ is: async () => ({ count: 72, error: null }) }));
    mocks.from.mockReturnValue({ select: vi.fn()
      .mockReturnValueOnce({ eq: rowFilter })
      .mockReturnValueOnce({ eq: countFilter }) });
    const response = await GET(request("notifications?user_id=foreign"));
    expect(await response.json()).toEqual({ items, unread: 72 });
    expect(rowFilter).toHaveBeenCalledWith("user_id", "authenticated-owner");
    expect(countFilter).toHaveBeenCalledWith("user_id", "authenticated-owner");
    expect(mocks.from).toHaveBeenCalledWith("notifications");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("marks one or all owned notifications through RPC and rejects forged owner fields", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    expect((await POST(request("notifications/read", { id }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_read_notifications", { p_id: id });
    expect((await POST(request("notifications/read", {}))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("app_read_notifications", { p_id: null });
    mocks.rpc.mockClear();
    expect((await POST(request("notifications/read", { user_id: id }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies signed-out community access before touching data", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    for (const path of ["groups", "notifications", `groups/${id}/messages`]) expect((await GET(request(path))).status).toBe(401);
    expect((await POST(request(`groups/${id}/join`, {}))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("sanitizes missing community migrations, permission, conflict and rate errors", async () => {
    for (const code of ["PGRST202", "PGRST205", "42P01"]) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "Private SQL details" } });
      const response = await GET(request("groups"));
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("SQL");
    }
    for (const [code, status] of [["GROUP_OWNER", 409], ["GROUP_FULL", 409], ["GROUP_LIMIT", 409], ["NOT_FOUND", 404], ["RATE_LIMIT", 429], ["IDEMPOTENCY_CONFLICT", 409]] as const) {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: `${code} private SQL detail` } });
      const response = await POST(request(`groups/${id}/leave`, {}));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
    }
  });
  it("rejects unsafe mutation formats and oversized bodies before database access", async () => {
    const input = (headers: HeadersInit, body: string) => new NextRequest("http://localhost:3000/api/groups", { method: "POST", headers, body });
    expect((await POST(input({ "content-type": "text/plain" }, "{}"))).status).toBe(415);
    expect((await POST(input({ "content-type": "application/json", "sec-fetch-site": "cross-site" }, "{}"))).status).toBe(403);
    expect((await POST(input({ "content-type": "application/json" }, JSON.stringify({ name: "ệ".repeat(6000) })))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reads only the signed-in user's streak without service secrets or client date/owner arguments", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const data = { current: 3, longest: 5, today_completed: false };
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await GET(request("streak?user_id=foreign&today=2099-01-01"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("app_get_streak");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not award streaks from a client mutation or a signed-out request", async () => {
    expect((await POST(request("streak", { user_id: id, today: "2099-01-01" }))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request("streak"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports missing streak migrations without exposing database details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "SQL private schema details" } });
    const response = await GET(request("streak"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("SQL private");
  });
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
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "app_worker_online" ? true : "ollama_with_openrouter_fallback", error: null,
    }));
    const fallback = await GET(request("status"));
    expect((await fallback.json()).provider).toBe("ollama_with_openrouter_fallback");
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
