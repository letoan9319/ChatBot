from base64 import b64decode
import json
from pathlib import Path
import struct
import tempfile

import httpx
import pymupdf
import pytest

from study_worker.config import Settings
from study_worker.documents import InvalidDocument
from study_worker.question_image import extract_question_image, ollama_question_image


def make_settings(**kwargs):
    return Settings(
        "db",
        "https://example.supabase.co",
        "service-placeholder",
        "http://127.0.0.1:6333",
        "",
        **kwargs,
    )


def make_pdf(*, pages=1, width=800, height=600, password=None):
    doc = pymupdf.open()
    for index in range(pages):
        page = doc.new_page(width=width, height=height)
        page.insert_text((40, 80), f"Cau {index + 1}: x^2 + 1 = 0")
    if password:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password)
    return doc.tobytes()


REAL_HTTPX_CLIENT = httpx.Client


def patch_ollama_client(monkeypatch, handler):
    def factory(*, base_url, timeout):
        assert base_url == "http://127.0.0.1:11434"
        return REAL_HTTPX_CLIENT(base_url=base_url, timeout=timeout, transport=httpx.MockTransport(handler))

    monkeypatch.setattr("study_worker.question_image.httpx.Client", factory)


def test_settings_question_ocr_availability():
    qwen_only = make_settings(ai_provider="ollama", chat_model="qwen3.5:4b-q4_K_M")
    assert qwen_only.mineru_available is False
    assert qwen_only.question_vision_ocr_available is True
    assert qwen_only.question_ocr_available is True

    non_vision_ollama = make_settings(ai_provider="ollama", chat_model="qwen3:4b")
    assert non_vision_ollama.mineru_available is False
    assert non_vision_ollama.question_vision_ocr_available is False
    assert non_vision_ollama.question_ocr_available is False

    with tempfile.TemporaryDirectory() as tmp_dir:
        base = Path(tmp_dir)
        mineru_py = base / "python.exe"
        mineru_py.write_text("", encoding="utf-8")
        mineru_dir = base / "mineru-model"
        mineru_dir.mkdir()
        (mineru_dir / "config.json").write_text("{}", encoding="utf-8")

        mineru_only = make_settings(
            ai_provider="ollama",
            chat_model="qwen3:4b",
            mineru_python=str(mineru_py),
            mineru_model=str(mineru_dir),
        )
        assert mineru_only.mineru_available is True
        assert mineru_only.question_vision_ocr_available is False
        assert mineru_only.question_ocr_available is True

        openrouter_qwen = make_settings(
            ai_provider="openrouter",
            chat_model="qwen3.5:4b-q4_K_M",
            mineru_python=str(mineru_py),
            mineru_model=str(mineru_dir),
        )
        assert openrouter_qwen.question_vision_ocr_available is False
        assert openrouter_qwen.question_ocr_available is True


def test_extract_question_image_uses_qwen_vision_and_keeps_model_warm(monkeypatch):
    events = []
    captured = {}

    def handler(request):
        events.append(("http", request.url.path))
        payload = json.loads(request.content)
        captured["payload"] = payload
        return httpx.Response(
            200,
            json={
                "done": True,
                "done_reason": "stop",
                "message": {
                    "content": (
                        "Câu 1: Tính $v_0 = \\sqrt{2gh}$ ![](fake/path.png)\n"
                        "<img src=\"x.png\" alt=\"diagram\" /> Hình vẽ tam giác ABC vuông tại A."
                    )
                },
            },
        )

    patch_ollama_client(monkeypatch, handler)
    settings = make_settings(ai_provider="ollama", chat_model="qwen3.5:4b-q4_K_M")

    sections = extract_question_image(make_pdf(width=1600, height=1200), settings, lambda: events.append("check"))

    assert events == ["check", ("http", "/api/chat"), "check"]
    payload = captured["payload"]
    assert payload["model"] == "qwen3.5:4b-q4_K_M"
    assert payload["think"] is False
    assert payload["stream"] is False
    assert payload["keep_alive"] == "5m"
    assert payload["options"]["temperature"] == 0
    assert len(payload["messages"]) == 1
    assert len(payload["messages"][0]["images"]) == 1
    image_bytes = b64decode(payload["messages"][0]["images"][0])
    assert image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    width, height = struct.unpack(">II", image_bytes[16:24])
    assert max(width, height) == 1400
    assert len(sections) == 1
    assert sections[0].page == 1
    assert "v_0 = \\sqrt{2gh}" in sections[0].text
    assert "Hình vẽ tam giác ABC vuông tại A." in sections[0].text
    assert "![" not in sections[0].text
    assert "<img" not in sections[0].text


def test_extract_question_image_falls_back_to_mineru_when_not_qwen35(monkeypatch):
    def fail_http(*_args, **_kwargs):
        raise AssertionError("Ollama HTTP should not be called when falling back to MinerU")

    monkeypatch.setattr("study_worker.question_image.httpx.Client", fail_http)

    commands = []

    class FakeProcess:
        def __init__(self, command, **_kwargs):
            commands.append(command)
            Path(command[3]).write_text(json.dumps([{"page": 1, "text": "De bai tu MinerU"}]), encoding="utf-8")
            self.returncode = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def poll(self):
            return 0

        def kill(self):
            pass

    monkeypatch.setattr("study_worker.question_image.subprocess.Popen", FakeProcess)
    with tempfile.TemporaryDirectory() as tmp_dir:
        base = Path(tmp_dir)
        mineru_py = base / "python.exe"
        mineru_py.write_text("", encoding="utf-8")
        mineru_dir = base / "mineru-model"
        mineru_dir.mkdir()
        (mineru_dir / "config.json").write_text("{}", encoding="utf-8")
        settings = make_settings(
            ai_provider="ollama",
            chat_model="qwen3:4b",
            mineru_python=str(mineru_py),
            mineru_model=str(mineru_dir),
        )

        sections = extract_question_image(make_pdf(), settings, lambda: None)
        assert len(commands) == 1
        assert commands[0][0] == str(mineru_py)
        assert len(sections) == 1
        assert sections[0].text == "De bai tu MinerU"
        assert sections[0].page == 1


def test_extract_question_image_requires_configured_ocr():
    settings = make_settings(ai_provider="ollama", chat_model="qwen3:4b")
    with pytest.raises(RuntimeError, match="Question OCR is not configured"):
        extract_question_image(make_pdf(), settings, lambda: None)


def test_extract_question_image_handles_timeout_http_truncation_and_empty(monkeypatch):
    settings = make_settings(ai_provider="ollama", chat_model="qwen3.5:4b-q4_K_M")
    pdf = make_pdf()

    def timeout_handler(request):
        raise httpx.ReadTimeout("timed out", request=request)

    patch_ollama_client(monkeypatch, timeout_handler)
    with pytest.raises(InvalidDocument, match="Đọc ảnh quá lâu"):
        extract_question_image(pdf, settings, lambda: None)

    def error_handler(_request):
        return httpx.Response(503, json={"error": "busy"})

    patch_ollama_client(monkeypatch, error_handler)
    with pytest.raises(RuntimeError, match="Ollama vision OCR request failed"):
        extract_question_image(pdf, settings, lambda: None)

    def truncated_handler(_request):
        return httpx.Response(
            200,
            json={"done": True, "done_reason": "length", "message": {"content": "partial"}},
        )

    patch_ollama_client(monkeypatch, truncated_handler)
    with pytest.raises(InvalidDocument, match="quá dài"):
        extract_question_image(pdf, settings, lambda: None)

    def incomplete_handler(_request):
        return httpx.Response(200, json={"done": False, "message": {"content": "partial"}})

    patch_ollama_client(monkeypatch, incomplete_handler)
    with pytest.raises(RuntimeError, match="did not complete"):
        extract_question_image(pdf, settings, lambda: None)

    def empty_tags_only_handler(_request):
        return httpx.Response(
            200,
            json={"done": True, "done_reason": "stop", "message": {"content": "![](a.png) <img src='b.png'>"}},
        )

    patch_ollama_client(monkeypatch, empty_tags_only_handler)
    with pytest.raises(InvalidDocument, match="Không nhận dạng được nội dung ảnh"):
        extract_question_image(pdf, settings, lambda: None)


def test_extract_question_image_validates_pdf_constraints():
    settings = make_settings(ai_provider="ollama", chat_model="qwen3.5:4b-q4_K_M")

    with pytest.raises(InvalidDocument, match="PDF một trang dưới 3 MB"):
        extract_question_image(b"not a pdf", settings, lambda: None)

    with pytest.raises(InvalidDocument, match="PDF một trang dưới 3 MB"):
        extract_question_image(b"%PDF-" + b"0" * (3 * 1024 * 1024), settings, lambda: None)

    with pytest.raises(InvalidDocument, match="Không đọc được ảnh câu hỏi"):
        extract_question_image(make_pdf(pages=2), settings, lambda: None)

    with pytest.raises(InvalidDocument, match="Không đọc được ảnh câu hỏi"):
        extract_question_image(make_pdf(width=1900, height=800), settings, lambda: None)

    with pytest.raises(InvalidDocument, match="Không đọc được ảnh câu hỏi"):
        extract_question_image(make_pdf(password="secret"), settings, lambda: None)


def test_extract_question_image_propagates_cancellation_from_check(monkeypatch):
    class StopNow(Exception):
        pass

    calls = 0

    def check():
        nonlocal calls
        calls += 1
        if calls == 2:
            raise StopNow()

    def handler(_request):
        return httpx.Response(200, json={"done": True, "done_reason": "stop", "message": {"content": "ok"}})

    patch_ollama_client(monkeypatch, handler)
    settings = make_settings(ai_provider="ollama", chat_model="qwen3.5:4b-q4_K_M")
    with pytest.raises(StopNow):
        extract_question_image(make_pdf(), settings, check)
    assert calls == 2


def test_ollama_question_image_default_and_custom_max_side():
    pdf = make_pdf(width=1600, height=1200)

    default_b64 = ollama_question_image(pdf)
    default_pix = pymupdf.Pixmap(b64decode(default_b64))
    assert max(default_pix.width, default_pix.height) == 1280

    custom_b64 = ollama_question_image(pdf, max_side=800)
    custom_pix = pymupdf.Pixmap(b64decode(custom_b64))
    assert max(custom_pix.width, custom_pix.height) == 800

    with pytest.raises(ValueError, match="max_side"):
        ollama_question_image(pdf, max_side=0)
