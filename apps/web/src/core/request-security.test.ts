import { describe, expect, it, vi } from "vitest";
import { checkMutationRequest, MAX_JSON_BYTES, readJsonBody } from "./request-security";
import nextConfig from "../../next.config";

const mutation = (headers: Record<string, string> = {}) => new Request("https://learnstep.example/api/groups", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
});

describe("cookie mutation request boundary", () => {
  it("allows same-origin JSON and non-browser JSON clients", () => {
    expect(() => checkMutationRequest(mutation({ origin: "https://learnstep.example", "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => checkMutationRequest(mutation())).not.toThrow();
    expect(() => checkMutationRequest(mutation({ "content-type": "application/json; charset=utf-8" }))).not.toThrow();
  });
  it("rejects foreign, null, sibling origin and cross-site requests before reading data", () => {
    const unsafeHeaders: Record<string, string>[] = [
      { origin: "https://foreign.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { referer: "https://foreign.example/form" },
      { referer: "malformed" },
    ];
    for (const headers of unsafeHeaders) expect(() => checkMutationRequest(mutation(headers))).toThrow(expect.objectContaining({ status: 403 }));
  });
  it("uses the actual HTTP host when Next normalizes a localhost request", () => {
    const local = (headers: Record<string, string>) => new Request("http://localhost:3000/api/groups", {
      method: "POST", body: "{}", headers: { "content-type": "application/json", host: "127.0.0.1:3000", ...headers },
    });
    expect(() => checkMutationRequest(local({ origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => checkMutationRequest(local({ origin: "https://foreign.example", "x-forwarded-host": "foreign.example" })))
      .toThrow(expect.objectContaining({ status: 403 }));
    expect(() => checkMutationRequest(local({ host: "user@127.0.0.1:3000", origin: "http://127.0.0.1:3000" })))
      .toThrow(expect.objectContaining({ status: 403 }));
  });
  it("rejects browser form content types and malformed/oversized lengths", () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect(() => checkMutationRequest(mutation({ "content-type": type }))).toThrow(expect.objectContaining({ status: 415 }));
    }
    expect(() => checkMutationRequest(mutation({ "content-length": "16001" }))).toThrow(expect.objectContaining({ status: 413 }));
    expect(() => checkMutationRequest(mutation({ "content-length": "invalid" }))).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("bounded JSON stream", () => {
  it("limits UTF-8 bytes even without content-length and cancels oversized streams", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(JSON.stringify({ content: "ệ".repeat(6_000) }));
    expect(bytes.length).toBeGreaterThan(MAX_JSON_BYTES);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); }, cancel,
    });
    const input = new Request("https://learnstep.example/api/groups", {
      method: "POST", body: stream, duplex: "half",
    } as RequestInit);
    await expect(readJsonBody(input)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("reads valid Unicode over chunk boundaries and rejects malformed JSON or UTF-8", async () => {
    const bytes = new TextEncoder().encode('{"name":"Nhóm vật lý"}');
    const input = new Request("https://learnstep.example/api/groups", {
      method: "POST", duplex: "half", body: new ReadableStream({ start(controller) {
        controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close();
      } }),
    } as RequestInit);
    expect(await readJsonBody(input)).toEqual({ name: "Nhóm vật lý" });
    await expect(readJsonBody(new Request("https://learnstep.example", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(new Request("https://learnstep.example", { method: "POST", body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]) }))).rejects.toMatchObject({ status: 400 });
  });
});

describe("application security headers", () => {
  it("blocks framing, plugins and foreign form actions without blocking the Next/theme inline runtime", async () => {
    const rules = await nextConfig.headers!();
    const values = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
    expect(values["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(values["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(values["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(values["X-Content-Type-Options"]).toBe("nosniff");
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("16kb");
  });
});
