from base64 import b64encode
import json
from pathlib import Path
import subprocess  # nosec B404
import tempfile
import time

import pymupdf

from .documents import InvalidDocument, Section, clean_text


def is_question_image(doc):
    return doc.get("file_type") == "pdf" and doc.get("name", "").startswith("Ảnh câu hỏi - ")


def extract_question_image(data, settings, check):
    if not settings.mineru_available:
        raise RuntimeError("MinerU is not configured")
    if len(data) > 3 * 1024 * 1024 or not data.startswith(b"%PDF-"):
        raise InvalidDocument("Ảnh câu hỏi phải là PDF một trang dưới 3 MB.")
    try:
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            if pdf.needs_pass or len(pdf) != 1 or max(pdf[0].rect.width, pdf[0].rect.height) > 1800:
                raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.")
    except (ValueError, RuntimeError) as exc:
        raise InvalidDocument("Không đọc được ảnh câu hỏi. Hãy dán lại ảnh gốc.") from exc

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


def ollama_question_image(data):
    """Render the authorized single-page question PDF for local vision."""
    if not data.startswith(b"%PDF-") or len(data) > 3 * 1024 * 1024:
        raise InvalidDocument("Ảnh câu hỏi không hợp lệ.")
    try:
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            if pdf.needs_pass or len(pdf) != 1:
                raise InvalidDocument("Ảnh câu hỏi phải có đúng một trang.")
            page = pdf[0]
            side = max(page.rect.width, page.rect.height)
            if not 0 < side <= 1800:
                raise InvalidDocument("Kích thước ảnh câu hỏi không hợp lệ.")
            scale = 1024 / side
            pixels = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, colorspace=pymupdf.csRGB)
            return b64encode(pixels.tobytes("jpeg", jpg_quality=90)).decode("ascii")
    except (ValueError, RuntimeError) as exc:
        raise InvalidDocument("Không thể đọc ảnh câu hỏi.") from exc
