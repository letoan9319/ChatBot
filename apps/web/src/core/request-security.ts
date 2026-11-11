export const MAX_JSON_BYTES = 16_000;

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Cookies authenticate these requests. JSON plus origin/fetch-metadata checks
// rejects browser form submissions and requests from another origin.
export function checkMutationRequest(request: Request) {
  const url = new URL(request.url);
  let origin = url.origin;
  // Next may normalize the internal URL to localhost. The HTTP Host remains
  // the browser's destination; do not substitute client X-Forwarded-* values.
  const host = request.headers.get("host");
  if (host !== null) {
    try {
      if (!host || /[\s/\\?#@]/.test(host)) throw new Error();
      origin = new URL(`${url.protocol}//${host}`).origin;
    } catch {
      throw new RequestError(403, "Nguồn yêu cầu không hợp lệ.");
    }
  }
  const suppliedOrigin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    (suppliedOrigin !== null && suppliedOrigin !== origin) ||
    (site !== null && !["same-origin", "none"].includes(site))
  ) {
    throw new RequestError(403, "Nguồn yêu cầu không hợp lệ.");
  }
  const referer = request.headers.get("referer");
  if (suppliedOrigin === null && referer !== null) {
    try {
      if (new URL(referer).origin !== origin) throw new Error();
    } catch {
      throw new RequestError(403, "Nguồn yêu cầu không hợp lệ.");
    }
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(415, "Yêu cầu phải dùng định dạng application/json.");
  }
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new RequestError(400, "Dung lượng yêu cầu không hợp lệ.");
    if (Number(length) > MAX_JSON_BYTES) throw new RequestError(413, "Yêu cầu quá lớn.");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "JSON không hợp lệ.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JSON_BYTES) {
        // Do not await cancellation: a server stream may be teed by Proxy.
        void reader.cancel().catch(() => undefined);
        throw new RequestError(413, "Yêu cầu quá lớn.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, "JSON không hợp lệ.");
  }
}
