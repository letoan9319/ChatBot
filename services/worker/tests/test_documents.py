from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pymupdf
import pytest
from docx import Document
from tokenizers import Tokenizer, models, pre_tokenizers

from study_worker.documents import InvalidDocument, Section, chunk_sections, extract


@pytest.fixture
def tokenizer():
    value = Tokenizer(models.WordLevel({"[UNK]": 0}, unk_token="[UNK]"))
    value.pre_tokenizer = pre_tokenizers.Whitespace()
    return value


def pdf_bytes(text="A derivative measures the instantaneous rate of change."):
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((72, 72), text)
    data = pdf.tobytes()
    pdf.close()
    return data


def test_pdf_keeps_real_page_and_rejects_spoofed_pdf():
    result = extract(pdf_bytes(), "pdf")
    assert result[0].page == 1
    assert "instantaneous" in result[0].text
    with pytest.raises(InvalidDocument, match="PDF hợp lệ"):
        extract(b"not a pdf", "pdf")


def test_scanned_encrypted_and_excessively_long_pdfs_are_rejected():
    pdf = pymupdf.open()
    pdf.new_page()
    with pytest.raises(InvalidDocument, match="OCR"):
        extract(pdf.tobytes(), "pdf")
    encrypted = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
    with pytest.raises(InvalidDocument, match="mật khẩu"):
        extract(encrypted, "pdf")
    for _ in range(200):
        pdf.new_page()
    with pytest.raises(InvalidDocument, match="200 trang"):
        extract(pdf.tobytes(), "pdf")
    pdf.close()


def test_docx_heading_table_and_paragraph_order():
    doc = Document()
    doc.add_heading("Vector spaces", 1)
    doc.add_paragraph("A vector space is closed under addition and scalar multiplication.")
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Dimension"
    table.cell(0, 1).text = "Number of basis vectors"
    doc.add_paragraph("Vectors in a basis are linearly independent.")
    buffer = BytesIO()
    doc.save(buffer)
    sections = extract(buffer.getvalue(), "docx")
    assert sections[2].paragraph == 3
    assert "Dimension | Number" in sections[2].text
    assert sections[3].paragraph == 4
    assert all(section.page is None and section.section == "Vector spaces" for section in sections)


def test_docx_zip_bomb_is_rejected_before_parsing(monkeypatch):
    monkeypatch.setattr("study_worker.documents.MAX_DOCX_UNCOMPRESSED", 100)
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "A" * 1000)
    with pytest.raises(InvalidDocument, match="giải nén"):
        extract(buffer.getvalue(), "docx")


def test_deterministic_chunk_ids_overlap_and_source_locations(tokenizer):
    text = " ".join(f"word{i}" for i in range(1200))
    sections = [Section(text, page=7)]
    first = chunk_sections(sections, tokenizer, "doc-id", 1)
    assert len(first) == 3
    assert first[0]["content"].split()[-80:] == first[1]["content"].split()[:80]
    assert all(chunk["page"] == 7 for chunk in first)
    assert first == chunk_sections(sections, tokenizer, "doc-id", 1)
    assert first[0]["id"] != chunk_sections(sections, tokenizer, "doc-id", 2)[0]["id"]


def test_size_and_extracted_text_limits(monkeypatch):
    monkeypatch.setattr("study_worker.documents.MAX_FILE_BYTES", 5)
    with pytest.raises(InvalidDocument, match="20 MB"):
        extract(b"a" * 6, "pdf")
    monkeypatch.setattr("study_worker.documents.MAX_FILE_BYTES", 20 * 1024 * 1024)
    monkeypatch.setattr("study_worker.documents.MAX_TEXT_CHARS", 20)
    with pytest.raises(InvalidDocument, match="1.000.000"):
        extract(pdf_bytes(), "pdf")
