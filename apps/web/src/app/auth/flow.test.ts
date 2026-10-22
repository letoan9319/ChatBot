import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), verify: vi.fn() }));
vi.mock("@/core/supabase-server", () => ({
  sessionClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify } }),
}));
import { GET as callback } from "./callback/route";
import { GET as confirm } from "./confirm/route";

beforeEach(() => {
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
});

describe("verification and recovery destinations", () => {
  it("sends verified signups to username onboarding and rejects arbitrary redirect destinations", async () => {
    const response = await callback(new NextRequest("https://learnstep.example/auth/callback?code=valid&next=https://other.example"));
    expect(response.headers.get("location")).toBe("https://learnstep.example/onboarding");
    const token = await confirm(new NextRequest("https://learnstep.example/auth/confirm?token_hash=valid&type=email"));
    expect(token.headers.get("location")).toBe("https://learnstep.example/onboarding");
  });
  it("preserves password reset after either verification flow", async () => {
    const response = await callback(new NextRequest("https://learnstep.example/auth/callback?code=valid&next=%2Fauth%3Fmode%3Dreset"));
    expect(response.headers.get("location")).toBe("https://learnstep.example/auth?mode=reset");
    const token = await confirm(new NextRequest("https://learnstep.example/auth/confirm?token_hash=valid&type=recovery"));
    expect(token.headers.get("location")).toBe("https://learnstep.example/auth?mode=reset");
  });
});
