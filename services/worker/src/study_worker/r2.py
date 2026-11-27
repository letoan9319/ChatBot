from datetime import datetime, timezone
import hashlib
import hmac
from urllib.parse import quote, urlparse

import httpx

EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def _rfc3986(value: str) -> str:
    return quote(value, safe="-_.~")


def _encode_path(bucket: str, key: str) -> str:
    segments = [bucket, *key.lstrip("/").split("/")]
    return "/" + "/".join(_rfc3986(seg) for seg in segments)


def _hmac(key: bytes, value: str) -> bytes:
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret_access_key: str, date_stamp: str) -> bytes:
    k_date = _hmac(f"AWS4{secret_access_key}".encode("utf-8"), date_stamp)
    k_region = _hmac(k_date, "auto")
    k_service = _hmac(k_region, "s3")
    return _hmac(k_service, "aws4_request")


class R2Client:
    """Zero-dependency Cloudflare R2 S3-compatible client using AWS SigV4 + httpx."""

    def __init__(self, endpoint: str, bucket: str, access_key_id: str, secret_access_key: str, *, timeout: float = 60.0):
        parsed = urlparse(endpoint.rstrip("/"))
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("R2 endpoint must be a valid HTTPS URL.")
        self.endpoint = endpoint.rstrip("/")
        self.host = parsed.netloc
        self.bucket = bucket.strip()
        self.access_key_id = access_key_id.strip()
        self.secret_access_key = secret_access_key.strip()
        self.http = httpx.Client(timeout=timeout)

    def close(self):
        self.http.close()

    def sign(
        self,
        method: str,
        key: str,
        *,
        payload_hash: str = EMPTY_SHA256,
        content_type: str | None = None,
        now: datetime | None = None,
    ) -> tuple[str, dict[str, str]]:
        ts = now or datetime.now(timezone.utc)
        amz_date = ts.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = ts.strftime("%Y%m%d")
        scope = f"{date_stamp}/auto/s3/aws4_request"
        canonical_uri = _encode_path(self.bucket, key)

        header_map = {
            "host": self.host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if content_type:
            header_map["content-type"] = content_type

        sorted_keys = sorted(header_map)
        signed_headers = ";".join(sorted_keys)
        canonical_headers = "".join(f"{k}:{header_map[k]}\n" for k in sorted_keys)

        canonical_request = "\n".join(
            [
                method.upper(),
                canonical_uri,
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )
        req_hash = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
        string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, req_hash])
        signature = hmac.new(
            _signing_key(self.secret_access_key, date_stamp),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        headers = {
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": (
                f"AWS4-HMAC-SHA256 Credential={self.access_key_id}/{scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            ),
        }
        if content_type:
            headers["Content-Type"] = content_type
        return f"{self.endpoint}{canonical_uri}", headers

    def stream_get(self, key: str):
        url, headers = self.sign("GET", key)
        return self.http.stream("GET", url, headers=headers)

    def head(self, key: str) -> dict | None:
        url, headers = self.sign("HEAD", key)
        response = self.http.head(url, headers=headers)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        raw_len = response.headers.get("content-length")
        raw_type = response.headers.get("content-type")
        return {
            "size": int(raw_len) if raw_len and raw_len.isdigit() else None,
            "content_type": raw_type.split(";")[0].strip().lower() if raw_type else None,
        }

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        payload_hash = hashlib.sha256(data).hexdigest()
        url, headers = self.sign("PUT", key, payload_hash=payload_hash, content_type=content_type)
        response = self.http.put(url, headers=headers, content=data)
        response.raise_for_status()

    def delete(self, key: str) -> httpx.Response:
        url, headers = self.sign("DELETE", key)
        response = self.http.delete(url, headers=headers)
        if response.status_code != 404:
            response.raise_for_status()
        return response
