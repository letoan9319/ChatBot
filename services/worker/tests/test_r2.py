from datetime import datetime, timezone

import httpx
import pytest

from study_worker.r2 import R2Client


def test_r2_client_signs_and_executes_head_put_get_delete():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, str(request.url), dict(request.headers), request.content))
        if request.method == "PUT":
            return httpx.Response(200)
        if request.method == "HEAD":
            if request.url.path.endswith("missing.pdf"):
                return httpx.Response(404)
            return httpx.Response(200, headers={"content-length": "5", "content-type": "image/png; charset=binary"})
        if request.method == "GET":
            return httpx.Response(200, content=b"hello")
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(405)

    client = R2Client(
        "https://acct123.r2.cloudflarestorage.com",
        "learnstep-documents",
        "AKIA123",
        "SECRET456",
    )
    client.http = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        url, headers = client.sign(
            "GET",
            "user-1/file (1).png",
            now=datetime(2026, 11, 28, 0, 0, 0, tzinfo=timezone.utc),
        )
        assert url == "https://acct123.r2.cloudflarestorage.com/learnstep-documents/user-1/file%20%281%29.png"
        assert "Credential=AKIA123/20261128/auto/s3/aws4_request" in headers["Authorization"]

        client.put_bytes("user-1/a.png", b"hello", "image/png")
        assert client.head("user-1/a.png") == {"size": 5, "content_type": "image/png"}
        assert client.head("user-1/missing.pdf") is None
        with client.stream_get("user-1/a.png") as resp:
            assert resp.read() == b"hello"
        assert client.delete("user-1/a.png").status_code == 204
    finally:
        client.close()

    assert [item[0] for item in seen] == ["PUT", "HEAD", "HEAD", "GET", "DELETE"]


def test_r2_client_requires_https_endpoint():
    with pytest.raises(ValueError, match="HTTPS"):
        R2Client("http://insecure.example", "bucket", "k", "s")
