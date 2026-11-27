import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createR2PresignedUrl,
  createR2SignedHeaders,
  headR2Object,
  isR2Configured,
  type R2Config,
} from "./r2-storage";

vi.mock("server-only", () => ({}));

const sampleConfig: R2Config = {
  endpoint: "https://acct123.r2.cloudflarestorage.com",
  bucket: "learnstep-documents",
  accessKeyId: "AKIAEXAMPLE123",
  secretAccessKey: "secret-example-key-456",
};

const envKeys = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
] as const;

afterEach(() => {
  for (const key of envKeys) delete process.env[key];
  vi.unstubAllGlobals();
});

describe("Cloudflare R2 SigV4 storage helper", () => {
  it("reports configured only when all required R2 variables are set", () => {
    expect(isR2Configured()).toBe(false);
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_BUCKET = "learnstep-documents";
    process.env.R2_ACCESS_KEY_ID = "key";
    expect(isR2Configured()).toBe(false);
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    expect(isR2Configured()).toBe(true);
  });

  it("signs deterministic presigned PUT and GET URLs with content-type and attachment disposition", () => {
    const fixed = new Date("2026-11-28T00:00:00.000Z");
    const putUrl = new URL(
      createR2PresignedUrl({
        method: "PUT",
        key: "user-1/doc-1.png",
        contentType: "image/png",
        expiresSeconds: 3600,
        now: fixed,
        config: sampleConfig,
      }),
    );
    expect(putUrl.origin).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(putUrl.pathname).toBe("/learnstep-documents/user-1/doc-1.png");
    expect(putUrl.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(putUrl.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAEXAMPLE123/20261128/auto/s3/aws4_request",
    );
    expect(putUrl.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host",
    );
    expect(putUrl.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);

    const getUrl = new URL(
      createR2PresignedUrl({
        method: "GET",
        key: "user-1/doc-2.docx",
        expiresSeconds: 120,
        downloadName: "Giáo trình.docx",
        now: fixed,
        config: sampleConfig,
      }),
    );
    expect(getUrl.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(getUrl.searchParams.get("response-content-disposition")).toContain(
      "attachment;",
    );
    expect(getUrl.searchParams.get("response-content-disposition")).toContain(
      "filename*=UTF-8''",
    );
  });

  it("builds signed HEAD headers and parses Content-Length and Content-Type cleanly", async () => {
    const signed = createR2SignedHeaders({
      method: "HEAD",
      key: "user-1/doc-1.pdf",
      now: new Date("2026-11-28T00:00:00.000Z"),
      config: sampleConfig,
    });
    expect(signed.url).toBe(
      "https://acct123.r2.cloudflarestorage.com/learnstep-documents/user-1/doc-1.pdf",
    );
    expect(signed.headers.Authorization).toContain(
      "Credential=AKIAEXAMPLE123/20261128/auto/s3/aws4_request",
    );

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: {
              "content-length": "12345",
              "content-type": "application/pdf; charset=binary",
            },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 404 })),
    );

    expect(await headR2Object("user-1/doc-1.pdf", sampleConfig)).toEqual({
      size: 12345,
      contentType: "application/pdf",
    });
    expect(await headR2Object("user-1/missing.pdf", sampleConfig)).toBeNull();
  });
});
