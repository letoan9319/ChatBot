from base64 import b64encode
import json
from pathlib import Path
import re
import subprocess  # nosec B404
import tempfile
import time

import httpx
import pymupdf

from .documents import InvalidDocument, Section, clean_text

MAX_QUESTION_IMAGE_BYTES = 3 * 1024 * 1024
MAX_IMAGE_SIDE_PX = 8000
MAX_IMAGE_PIXELS = 25_000_000
IMAGE_FILE_TYPES = ("png", "jpg", "jpeg", "webp")
QUESTION_IMAGE_FILE_TYPES = ("pdf", *IMAGE_FILE_TYPES)

QUESTION_OCR_PROMPT = (
    "Transcribe all text, choices, and formulas from this exercise image in reading order. "
    "Preserve Vietnamese diacritics exactly and write math/science formulas in LaTeX. "
    "If there is a physics, chemistry, or geometry diagram, graph, or table, describe its labels, "
    "values, and relationships concisely in Vietnamese. "
    "Output only the transcription; do not solve, explain, or add commentary."
)


def is_question_image(doc):
    return (
        doc.get("file_type") in QUESTION_IMAGE_FILE_TYPES
        and doc.get("name", "").startswith("Ảnh câu hỏi - ")
    )


def _detect_question_filetype(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _encode_pixmap(pixels: pymupdf.Pixmap, *, image_format: str) -> str:
    if pixels.alpha or pixels.colorspace != pymupdf.csRGB:
        pixels = pymupdf.Pixmap(pymupdf.csRGB, pixels)
    if image_format == "png":
        raw = pixels.tobytes("png")
    else:
        raw = pixels.tobytes("jpeg", jpg_quality=92)
    return b64encode(raw).decode("ascii")


def _render_page_image(page, *, max_side, image_format="jpeg", max_scale=2.0):
    side = max(page.rect.width, page.rect.height)
    scale = min(max_scale, max_side / side)
    pixels = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, colorspace=pymupdf.csRGB)
    return _encode_pixmap(pixels, image_format=image_format)


def _prepare_raster_image(data: bytes, filetype: str, *, max_side: int, image_format: str):
    if filetype == "webp":
        return b64encode(data).decode("ascii"), None
    try:
        pix = pymupdf.Pixmap(data)
        width, height = pix.width, pix.height
        if (
            width <= 0
            or height <= 0
            or max(width, height) > MAX_IMAGE_SIDE_PX
            or width * height > MAX_IMAGE_PIXELS
        ):
            raise InvalidDocument("Kích thước ảnh câu hỏi không hợp lệ.")
        with pymupdf.open(stream=data, filetype=filetype) as doc:
            if len(doc) != 1:
                raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.")
            if max(width, height) > max_side:
                page = doc[0]
                side = max(page.rect.width, page.rect.height)
                scale = max_side / side
                rendered = page.get_pixmap(
                    matrix=pymupdf.Matrix(scale, scale),
                    alpha=False,
                    colorspace=pymupdf.csRGB,
                )
                encoded = _encode_pixmap(rendered, image_format=image_format)
            else:
                encoded = _encode_pixmap(pix, image_format=image_format)
            mineru_pdf = doc.convert_to_pdf()
            return encoded, mineru_pdf
    except InvalidDocument:
        raise
    except (ValueError, RuntimeError) as exc:
        raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.") from exc


def _clean_ocr_text(raw: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", raw)
    text = re.sub(r"<img\b[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return clean_text(text)


def _extract_with_ollama_vision(image_b64, settings, check):
    check()
    try:
        with httpx.Client(base_url=settings.ollama_url, timeout=httpx.Timeout(180, connect=10)) as client:
            response = client.post(
                "/api/chat",
                json={
                    "model": settings.chat_model,
                    "stream": False,
                    "think": False,
                    "keep_alive": "5m",
                    "messages": [
                        {
                            "role": "user",
                            "content": QUESTION_OCR_PROMPT,
                            "images": [image_b64],
                        }
                    ],
                    "options": {
                        "num_ctx": 7168,
                        "num_predict": 2048,
                        "temperature": 0,
                    },
                },
            )
            response.raise_for_status()
            result = response.json()
    except httpx.TimeoutException as exc:
        raise InvalidDocument("Đọc ảnh quá lâu. Hãy thử ảnh nhỏ và rõ hơn.") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError("Ollama vision OCR request failed") from exc
    except ValueError as exc:
        raise RuntimeError("Ollama vision OCR returned invalid response") from exc
    check()
    if result.get("error"):
        raise RuntimeError("Ollama vision OCR failed")
    if result.get("done_reason") == "length":
        raise InvalidDocument("Nội dung ảnh quá dài để đọc trọn vẹn. Hãy cắt gọn từng câu hỏi rồi dán lại.")
    if not result.get("done"):
        raise RuntimeError("Ollama vision OCR did not complete")
    raw = result.get("message", {}).get("content", "")
    text = _clean_ocr_text(raw if isinstance(raw, str) else "")
    if not text:
        raise InvalidDocument("Không nhận dạng được nội dung ảnh. Hãy thử ảnh rõ hơn.")
    return [Section(text, page=1)]


def _extract_with_mineru(data, settings, check):
    runner = Path(__file__).with_name("mineru_runner.py")
    with tempfile.TemporaryDirectory(prefix="learnstep-question-") as directory:
        source = Path(directory) / "question.pdf"
        output = Path(directory) / "text.json"
        source.write_bytes(data)
        # Executable and model directory are configured by the worker operator.
        command = [settings.mineru_python, str(runner), str(source), str(output), settings.mineru_model]
        with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:  # nosec B603
            deadline = time.monotonic() + 180
            try:
                while process.poll() is None:
                    check()
                    if time.monotonic() >= deadline:
                        raise InvalidDocument("Đọc ảnh quá lâu. Hãy thử ảnh nhỏ và rõ hơn.")
                    time.sleep(0.5)
                check()
                if process.returncode != 0:
                    raise RuntimeError("MinerU helper failed")
                text = clean_text(json.loads(output.read_text(encoding="utf-8"))[0]["text"])
            finally:
                if process.poll() is None:
                    process.kill()
    if not text:
        raise InvalidDocument("Không nhận dạng được nội dung ảnh. Hãy thử ảnh rõ hơn.")
    return [Section(text, page=1)]


def extract_question_image(data, settings, check):
    use_vision = bool(getattr(settings, "question_vision_ocr_available", False))
    use_mineru = bool(getattr(settings, "mineru_available", False))
    if not use_vision and not use_mineru:
        raise RuntimeError("Question OCR is not configured")
    filetype = _detect_question_filetype(data)
    if len(data) > MAX_QUESTION_IMAGE_BYTES or filetype is None:
        raise InvalidDocument("Ảnh câu hỏi phải là ảnh PNG, JPEG, WebP hoặc PDF một trang dưới 3 MB.")

    rendered_image = None
    mineru_bytes = data
    if filetype == "pdf":
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:
                if pdf.needs_pass or len(pdf) != 1:
                    raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.")
                page = pdf[0]
                side = max(page.rect.width, page.rect.height)
                if not 0 < side <= 1800:
                    raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.")
                if use_vision:
                    rendered_image = _render_page_image(page, max_side=1400, image_format="png")
        except InvalidDocument:
            raise
        except (ValueError, RuntimeError) as exc:
            raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.") from exc
    else:
        rendered_image, mineru_bytes = _prepare_raster_image(
            data, filetype, max_side=1400, image_format="png"
        )
        if not use_vision and mineru_bytes is None:
            raise InvalidDocument("Không đọc được ảnh câu hỏi định dạng WebP với MinerU. Hãy dùng PNG hoặc JPEG.")

    if use_vision:
        return _extract_with_ollama_vision(rendered_image, settings, check)
    return _extract_with_mineru(mineru_bytes, settings, check)


def ollama_question_image(data, *, max_side=1280):
    """Render an authorized question image (native PNG/JPEG/WebP or legacy 1-page PDF) for local vision."""
    if max_side <= 0:
        raise ValueError("max_side must be positive")
    filetype = _detect_question_filetype(data)
    if filetype is None or len(data) > MAX_QUESTION_IMAGE_BYTES:
        raise InvalidDocument("Ảnh câu hỏi không hợp lệ.")
    if filetype == "pdf":
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:
                if pdf.needs_pass or len(pdf) != 1:
                    raise InvalidDocument("Ảnh câu hỏi phải có đúng một trang.")
                page = pdf[0]
                side = max(page.rect.width, page.rect.height)
                if not 0 < side <= 1800:
                    raise InvalidDocument("Kích thước ảnh câu hỏi không hợp lệ.")
                return _render_page_image(page, max_side=max_side, image_format="jpeg")
        except InvalidDocument:
            raise
        except (ValueError, RuntimeError) as exc:
            raise InvalidDocument("Không thể đọc ảnh câu hỏi.") from exc
    encoded, _ = _prepare_raster_image(data, filetype, max_side=max_side, image_format="jpeg")
    return encoded
