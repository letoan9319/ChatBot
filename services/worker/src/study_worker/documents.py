import json
from pathlib import Path
from dataclasses import dataclass
from io import BytesIO
import os
import re
import subprocess
import time
import tempfile
from uuid import UUID, uuid5
from zipfile import ZipFile

import pymupdf
from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 1_000_000
MAX_DOCX_UNCOMPRESSED = 80 * 1024 * 1024
VECTOR_NAMESPACE = UUID("682891b0-d70a-4dbd-9773-617e3df473a2")


class InvalidDocument(Exception):
    """Permanent input failure safe to display to the owner."""


class OCRFailure(Exception):
    """OCR could not complete; the job may be retried."""


@dataclass
class Section:
    text: str
    page: int | None = None
    section: str | None = None
    paragraph: int | None = None


def clean_text(value: str) -> str:
    return re.sub(r"[ \t]+", " ", value.replace("\x00", "")).strip()


def extract(data: bytes, file_type: str, pdf_parser=None) -> list[Section]:
    if not data or len(data) > MAX_FILE_BYTES:
        raise InvalidDocument("File rỗng hoặc vượt quá 20 MB.")
    sections: list[Section] = []
    if file_type == "pdf":
        if not data.startswith(b"%PDF-"):
            raise InvalidDocument("Nội dung file không phải PDF hợp lệ.")
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:
                if pdf.needs_pass:
                    raise InvalidDocument("Chưa hỗ trợ PDF được bảo vệ bằng mật khẩu.")
                if len(pdf) > 200:
                    raise InvalidDocument("PDF vượt giới hạn 200 trang.")
                if pdf_parser is not None:
                    return pdf_parser(pdf)
                total = 0
                for index, page in enumerate(pdf):
                    text = clean_text(page.get_text(sort=True))
                    total += len(text)
                    if total > MAX_TEXT_CHARS:
                        raise InvalidDocument("Văn bản trích xuất vượt giới hạn 1.000.000 ký tự.")
                    if text:
                        sections.append(Section(text, page=index + 1))
        except (InvalidDocument, OCRFailure):
            raise
        except Exception as exc:
            if pdf_parser is not None:
                raise
            raise InvalidDocument("Không đọc được cấu trúc PDF.") from exc
    elif file_type == "docx":
        try:
            with ZipFile(BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 3000 or sum(item.file_size for item in entries) > MAX_DOCX_UNCOMPRESSED:
                    raise InvalidDocument("DOCX vượt giới hạn giải nén an toàn.")
                if any(item.flag_bits & 1 for item in entries):
                    raise InvalidDocument("Chưa hỗ trợ DOCX được mã hóa.")
                if "word/document.xml" not in archive.namelist():
                    raise InvalidDocument("Nội dung file không phải DOCX hợp lệ.")
            doc = Document(BytesIO(data))
            heading = None
            paragraph_number = 0
            total = 0
            for element in doc.element.body.iterchildren():
                if element.tag == qn("w:p"):
                    paragraph = Paragraph(element, doc)
                    text = clean_text(paragraph.text)
                    if paragraph.style and paragraph.style.name.startswith("Heading") and text:
                        heading = text[:200]
                elif element.tag == qn("w:tbl"):
                    table = Table(element, doc)
                    text = clean_text("\n".join(" | ".join(cell.text for cell in row.cells) for row in table.rows))
                else:
                    continue
                paragraph_number += 1
                total += len(text)
                if total > MAX_TEXT_CHARS:
                    raise InvalidDocument("Văn bản trích xuất vượt giới hạn 1.000.000 ký tự.")
                if text:
                    sections.append(Section(text, section=heading, paragraph=paragraph_number))
        except InvalidDocument:
            raise
        except Exception as exc:
            raise InvalidDocument("Không đọc được cấu trúc DOCX.") from exc
    else:
        raise InvalidDocument("Chỉ hỗ trợ PDF và DOCX.")
    if sum(len(section.text) for section in sections) < 30:
        raise InvalidDocument("Không đủ văn bản để xử lý. PDF scan cần OCR, hiện chưa được hỗ trợ.")
    return sections


def parse_pdf_with_mineru(pdf, check, *, min_chars=30):
    python = os.getenv("MINERU_PYTHON", "")
    model = os.getenv("MINERU_MODEL_PATH", "")
    if not os.path.isfile(python) or not os.path.isdir(model):
        raise OCRFailure("Chưa cấu hình môi trường hoặc model MinerU.")
    with tempfile.TemporaryDirectory(prefix="learnstep-mineru-") as directory:
        source = os.path.join(directory, "input.pdf")
        output = os.path.join(directory, "output.json")
        pdf.save(source)
        runner = str(Path(__file__).with_name("mineru_runner.py"))
        with tempfile.TemporaryFile() as log:
            process = subprocess.Popen([python, runner, source, output, model], stdout=log, stderr=log)
            try:
                while process.poll() is None:
                    check()
                    time.sleep(1)
                if process.returncode:
                    log.seek(0)
                    details = log.read()[-4000:].decode("utf-8", errors="replace")
                    raise OCRFailure(f"MinerU không xử lý được PDF: {details}")
                check()
                with open(output, encoding="utf-8") as result:
                    pages = json.load(result)
                sections = [Section(clean_text(page["text"]), page=page["page"]) for page in pages if page["text"].strip()]
                if sum(len(section.text) for section in sections) < min_chars:
                    raise InvalidDocument("Không đủ văn bản sau khi nhận dạng PDF.")
                return sections
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()


def chunk_sections(sections: list[Section], tokenizer, document_id: str, version: int, size=500, overlap=80):
    if not 0 <= overlap < size:
        raise ValueError("Invalid chunk overlap")
    chunks = []
    # Preserve PDF pages and DOCX section/paragraph locations; never invent page numbers.
    for section in sections:
        encoding = tokenizer.encode(section.text, add_special_tokens=False)
        offsets = encoding.offsets
        for start in range(0, len(offsets), size - overlap):
            stop = min(start + size, len(offsets))
            if stop <= start:
                break
            content = section.text[offsets[start][0] : offsets[stop - 1][1]].strip()
            if content:
                ordinal = len(chunks)
                chunks.append(
                    {
                        "id": str(uuid5(VECTOR_NAMESPACE, f"{document_id}:{version}:{ordinal}")),
                        "ordinal": ordinal,
                        "content": content,
                        "page": section.page,
                        "section": section.section,
                        "paragraph": section.paragraph,
                    }
                )
            if stop == len(offsets):
                break
    if len(chunks) > 5000:
        raise InvalidDocument("Tài liệu tạo quá nhiều đoạn. Hãy chia nhỏ file.")
    return chunks
