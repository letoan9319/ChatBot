import "server-only";
import { createHash, createHmac } from "node:crypto";

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || "";
  const bucket = process.env.R2_BUCKET?.trim() || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || "";
  const explicitEndpoint = process.env.R2_ENDPOINT?.trim() || "";
  const endpoint = (
    explicitEndpoint ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")
  ).replace(/\/+$/, "");

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:") {
    throw new Error("R2_ENDPOINT must use HTTPS.");
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export function isR2Configured(): boolean {
  return readR2Config() !== null;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectPath(bucket: string, key: string): string {
  const segments = [bucket, ...key.replace(/^\/+/, "").split("/")];
  return "/" + segments.map(encodeRfc3986).join("/");
}

function formatAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([aKey, aVal], [bKey, bVal]) =>
      aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function sanitizeDownloadFilename(name: string): string {
  const ascii = name
    .replace(/[\r\n"]/g, " ")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim();
  return ascii || "document";
}

export function createR2PresignedUrl({
  method,
  key,
  expiresSeconds,
  contentType,
  downloadName,
  now = new Date(),
  config = readR2Config(),
}: {
  method: "GET" | "PUT";
  key: string;
  expiresSeconds: number;
  contentType?: string;
  downloadName?: string;
  now?: Date;
  config?: R2Config | null;
}): string {
  if (!config) {
    throw new Error("Cloudflare R2 is not configured.");
  }
  const url = new URL(config.endpoint);
  const canonicalUri = encodeObjectPath(config.bucket, key);
  const { amzDate, dateStamp } = formatAmzDate(now);
  const scope = `${dateStamp}/auto/s3/aws4_request`;

  const signedHeaderMap: Record<string, string> = { host: url.host };
  if (contentType) {
    signedHeaderMap["content-type"] = contentType;
  }
  const headerKeys = Object.keys(signedHeaderMap).sort();
  const signedHeaders = headerKeys.join(";");
  const canonicalHeaders =
    headerKeys.map((h) => `${h}:${signedHeaderMap[h]}`).join("\n") + "\n";

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(7200, Math.floor(expiresSeconds)))),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  if (method === "GET" && downloadName) {
    const fallback = sanitizeDownloadFilename(downloadName);
    const utf8 = encodeRfc3986(downloadName.replace(/[\r\n]/g, " ").trim() || "document");
    queryParams["response-content-disposition"] =
      `attachment; filename="${fallback}"; filename*=UTF-8''${utf8}`;
  }

  const query = canonicalQuery(queryParams);
  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, dateStamp),
  )
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${config.endpoint}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}

export function createR2SignedHeaders({
  method,
  key,
  payloadHash = EMPTY_SHA256,
  contentType,
  now = new Date(),
  config = readR2Config(),
}: {
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  key: string;
  payloadHash?: string;
  contentType?: string;
  now?: Date;
  config?: R2Config | null;
}): { url: string; headers: Record<string, string> } {
  if (!config) {
    throw new Error("Cloudflare R2 is not configured.");
  }
  const url = new URL(config.endpoint);
  const canonicalUri = encodeObjectPath(config.bucket, key);
  const { amzDate, dateStamp } = formatAmzDate(now);
  const scope = `${dateStamp}/auto/s3/aws4_request`;

  const headerMap: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) {
    headerMap["content-type"] = contentType;
  }
  const headerKeys = Object.keys(headerMap).sort();
  const signedHeaders = headerKeys.join(";");
  const canonicalHeaders =
    headerKeys.map((h) => `${h}:${headerMap[h]}`).join("\n") + "\n";

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, dateStamp),
  )
    .update(stringToSign, "utf8")
    .digest("hex");

  const outHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) {
    outHeaders["Content-Type"] = contentType;
  }
  return { url: `${config.endpoint}${canonicalUri}`, headers: outHeaders };
}

export async function headR2Object(
  key: string,
  config = readR2Config(),
): Promise<{ size: number; contentType: string | null } | null> {
  const { url, headers } = createR2SignedHeaders({ method: "HEAD", key, config });
  const response = await fetch(url, {
    method: "HEAD",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`R2 HEAD failed with HTTP ${response.status}`);
  }
  const rawLength = response.headers.get("content-length");
  const size = rawLength ? Number(rawLength) : NaN;
  const rawType = response.headers.get("content-type");
  const contentType = rawType ? rawType.split(";")[0].trim().toLowerCase() : null;
  return { size, contentType };
}

export function createR2SignedUploadUrl(
  key: string,
  contentType: string,
  expiresSeconds = 3600,
): string {
  return createR2PresignedUrl({
    method: "PUT",
    key,
    contentType,
    expiresSeconds,
  });
}

export function createR2SignedDownloadUrl(
  key: string,
  options?: { expiresSeconds?: number; downloadName?: string },
): string {
  return createR2PresignedUrl({
    method: "GET",
    key,
    expiresSeconds: options?.expiresSeconds ?? 120,
    downloadName: options?.downloadName,
  });
}
