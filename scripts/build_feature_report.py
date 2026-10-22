"""Create the Vietnamese LearnStep feature report. Requires reportlab.

Run with the bundled artifact Python runtime; this is separate from app dependencies.
"""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "LearnStep-Bao-cao-tinh-nang-hien-tai.pdf"
FONT_ROOT = Path("C:/Windows/Fonts")
GREEN = colors.HexColor("#367c00")
LIME = colors.HexColor("#58cc02")
INK = colors.HexColor("#303b2b")
MUTED = colors.HexColor("#626b5d")
LINE = colors.HexColor("#dce5d6")
PALE = colors.HexColor("#effbdc")
PURPLE = colors.HexColor("#4b206d")
LAVENDER = colors.HexColor("#f7edff")
YELLOW = colors.HexColor("#fff8db")
PAGE_W, PAGE_H = A4
WIDTH = PAGE_W - 88


class Rule(Flowable):
    def __init__(self, width=WIDTH, height=10):
        super().__init__()
        self.width, self.height = width, height

    def draw(self):
        self.canv.setStrokeColor(LINE)
        self.canv.setLineWidth(0.7)
        self.canv.line(0, self.height / 2, self.width, self.height / 2)


def build():
    pdfmetrics.registerFont(TTFont("LearnStepBody", str(FONT_ROOT / "arial.ttf")))
    pdfmetrics.registerFont(TTFont("LearnStepBold", str(FONT_ROOT / "arialbd.ttf")))
    pdfmetrics.registerFontFamily("LearnStepBody", normal="LearnStepBody", bold="LearnStepBold")
    styles = getSampleStyleSheet()
    base = dict(fontName="LearnStepBody", textColor=INK)
    styles.add(ParagraphStyle(name="LSBody", fontSize=10, leading=15.3, spaceAfter=8, **base))
    styles.add(ParagraphStyle(name="LSSmall", fontSize=8.5, leading=12.6, spaceAfter=6, **base))
    styles.add(ParagraphStyle(name="LSMuted", fontName="LearnStepBody", textColor=MUTED, fontSize=9, leading=13.5, spaceAfter=8))
    styles.add(ParagraphStyle(name="LSTitle", fontName="LearnStepBold", textColor=INK, fontSize=27, leading=34, spaceAfter=14))
    styles.add(ParagraphStyle(name="LSH1", fontName="LearnStepBold", textColor=INK, fontSize=20, leading=27, spaceAfter=12))
    styles.add(ParagraphStyle(name="LSH2", fontName="LearnStepBold", textColor=GREEN, fontSize=12.5, leading=18, spaceBefore=12, spaceAfter=7, keepWithNext=True))
    styles.add(ParagraphStyle(name="LSLabel", fontName="LearnStepBold", textColor=GREEN, fontSize=9, leading=13, spaceAfter=12))
    styles.add(ParagraphStyle(name="LSTable", fontSize=9, leading=13.3, spaceAfter=0, **base))
    styles.add(ParagraphStyle(name="LSTableHead", fontName="LearnStepBold", fontSize=9, leading=13, textColor=GREEN))
    styles.add(ParagraphStyle(name="LSStat", fontName="LearnStepBold", fontSize=20, leading=26, textColor=GREEN, alignment=TA_CENTER))
    styles.add(ParagraphStyle(name="LSStatLabel", fontSize=8.5, leading=12, alignment=TA_CENTER, **base))
    styles.add(ParagraphStyle(name="LSFooter", fontSize=8, leading=11, **base))

    def p(text, style="LSBody"):
        return Paragraph(text, styles[style])

    def h2(text):
        return p(text, "LSH2")

    def table(headers, rows, widths):
        data = [[p(escape(str(item)), "LSTableHead") for item in headers]]
        data += [[p(str(item), "LSTable") for item in row] for row in rows]
        result = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
        result.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, 0), PALE),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8faf6")]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, LINE),
            ("LINEBELOW", (0, 1), (-1, -1), .45, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]))
        return result

    def box(title, text, background=PALE):
        result = Table([[p(title, "LSH2")], [p(text, "LSBody")]], colWidths=[WIDTH], hAlign="LEFT")
        result.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), background),
            ("LEFTPADDING", (0, 0), (-1, -1), 14),
            ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (-1, 0), 7),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
            ("TOPPADDING", (0, 1), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 9),
        ]))
        return KeepTogether([Spacer(1, 8), result, Spacer(1, 8)])

    def bullet(title, text):
        return p(f"<b>{escape(title)}</b> {text}")

    def page(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(LIME)
        canvas.rect(0, PAGE_H - 6, PAGE_W, 6, fill=1, stroke=0)
        canvas.setFont("LearnStepBold", 15)
        canvas.setFillColor(GREEN)
        canvas.drawString(44, PAGE_H - 39, "LearnStep")
        canvas.setFont("LearnStepBody", 8.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_W - 44, PAGE_H - 37, "BÁO CÁO TÍNH NĂNG | 22.10.2026")
        canvas.setStrokeColor(LINE)
        canvas.line(44, 42, PAGE_W - 44, 42)
        canvas.setFont("LearnStepBody", 8)
        canvas.drawString(44, 27, "LearnStep - Hiểu thêm mỗi ngày")
        canvas.drawRightString(PAGE_W - 44, 27, f"Trang {doc.page} / 5")
        canvas.restoreState()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=44, rightMargin=44,
                          topMargin=65, bottomMargin=57, title="LearnStep - Báo cáo tính năng hiện tại",
                          author="LearnStep", subject="MVP hỗ trợ tự học bằng RAG và SLM", pageCompression=1)
    doc.addPageTemplates(PageTemplate(id="report", frames=[Frame(44, 57, WIDTH, PAGE_H - 122, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=page))

    story = []
    # PAGE 1: executive summary and implementation status.
    story += [Spacer(1, 12), p("PHIÊN BẢN MVP 0.1.0 / NGÀY 22.10.2026", "LSLabel"),
              p("BÁO CÁO<br/>TÍNH NĂNG HIỆN TẠI", "LSTitle"),
              p("Website hỗ trợ tự học từ tài liệu cá nhân bằng RAG và mô hình ngôn ngữ nhỏ.", "LSBody"), Rule(), Spacer(1, 12)]
    stats = Table([
        [p("03", "LSStat"), p("PDF / DOCX", "LSStat"), p("35", "LSStat")],
        [p("Môn học được tổ chức", "LSStatLabel"), p("Định dạng đầu vào", "LSStatLabel"), p("Kiểm thử tự động đạt", "LSStatLabel")],
    ], colWidths=[WIDTH * .28, WIDTH * .44, WIDTH * .28])
    stats.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("TOPPADDING", (0, 0), (-1, 0), 12), ("BOTTOMPADDING", (0, 1), (-1, 1), 12)]))
    story += [stats, h2("1. Mục tiêu và đối tượng sử dụng"),
              p("LearnStep hỗ trợ sinh viên học <b>Giải tích, Đại số tuyến tính và Vật lý đại cương</b>. Người dùng mang giáo trình của mình lên hệ thống, đặt câu hỏi và đọc giải thích có nguồn đối chiếu. Quy mô thiết kế ban đầu là demo đồ án cho khoảng 5-10 người thử nghiệm."),
              h2("2. Nhóm tính năng đã triển khai trong mã nguồn"),
              table(["Nhóm", "Khả năng hiện có"], [
                  ["Tài khoản", "Đăng ký, đăng nhập, xác nhận email, đặt lại mật khẩu và đăng xuất."],
                  ["Thư viện tài liệu", "Upload PDF/DOCX riêng tư, gán môn học, chọn tài liệu, theo dõi xử lý, thử lại và xóa."],
                  ["Trợ giảng AI", "Truy xuất RAG, hỏi đáp tiếng Việt, ngữ cảnh hội thoại gần nhất, LaTeX và trích dẫn."],
                  ["Giao diện", "Phong cách Lingo; font Nunito; nút nổi, thẻ bo tròn; bố cục desktop và tab mobile."],
                  ["Vận hành", "Worker cục bộ, hàng đợi bền vững, heartbeat, giới hạn sử dụng và bộ công cụ đánh giá."],
              ], [116, WIDTH - 116]),
              box("Phạm vi xác nhận", "Báo cáo mô tả <b>mã nguồn hiện có</b> và kết quả kiểm tra tại máy. Chưa có cấu hình kết nối cloud trong workspace và chưa xác nhận luồng tích hợp thật với Supabase, Qdrant Cloud, Ollama hoặc URL Vercel. Các tính năng AI cần đủ các dịch vụ này để sử dụng thực tế.", YELLOW), PageBreak()]

    # PAGE 2: account and document features.
    story += [p("01 / TÀI KHOẢN VÀ TÀI LIỆU", "LSLabel"), p("Mang tài liệu vào góc học tập", "LSH1"),
              p("Luồng chính: đăng nhập, tải tài liệu, đợi xử lý thành công rồi chọn tài liệu để hỏi đáp.", "LSMuted"),
              h2("Tài khoản cá nhân"),
              bullet("Đăng ký và xác nhận email.", "Giao diện kết nối Supabase Auth; hỗ trợ callback PKCE và xác nhận bằng token hash."),
              bullet("Khôi phục truy cập.", "Gửi email đặt lại mật khẩu, nhập mật khẩu mới và đăng xuất. Giao diện yêu cầu mật khẩu ít nhất 8 ký tự; cấu hình Auth phải được áp dụng tương ứng."),
              bullet("Không gian riêng.", "Tài liệu, hội thoại, câu trả lời và tác vụ được gắn với tài khoản. Người chưa đăng nhập được chuyển tới trang xác thực."),
              h2("Quản lý tài liệu"),
              table(["Tính năng", "Hành vi và giới hạn"], [
                  ["Tải file", "PDF hoặc DOCX, tối đa <b>20 MB/file</b>; tối đa <b>20 tài liệu/tài khoản</b>. Trình duyệt tải trực tiếp vào bucket private bằng signed upload URL."],
                  ["Kiểm tra đầu vào", "API kiểm tra metadata dung lượng/MIME; worker kiểm tra nội dung thực tế. PDF tối đa <b>200 trang</b>; văn bản trích xuất tối đa <b>1 triệu ký tự</b>. DOCX giải nén tối đa <b>80 MB</b>."],
                  ["Tổ chức và lựa chọn", "Gán một trong ba môn học. Mỗi câu hỏi chọn <b>1-5 tài liệu</b> đã sẵn sàng; giao diện hiển thị tên, môn, dung lượng và trạng thái."],
                  ["Theo dõi / thử lại", "Trạng thái tải lên, chờ, xử lý, sẵn sàng, thất bại và đang xóa. Có thông báo lỗi, xác nhận lại file tải dở và thử lại ingestion bị lỗi."],
                  ["Xóa và dọn dữ liệu", "Loại tài liệu khỏi truy xuất ngay khi bắt đầu xóa. Worker dọn file, vector và chunks; nguồn trong hội thoại cũ báo không còn khả dụng."],
              ], [120, WIDTH - 120]),
              box("Dọn dẹp có thể tiếp tục sau gián đoạn", "Worker tiếp tục tác vụ còn trong queue khi khởi động lại. Upload bỏ dở được đưa vào cleanup sau 24 giờ. Có lượt quét lại tombstone để dọn file nếu signed upload token cũ còn hiệu lực."),
              PageBreak()]

    # PAGE 3: RAG and study interface.
    story += [p("02 / HỎI ĐÁP VÀ TRÍCH DẪN", "LSLabel"), p("Học bằng câu hỏi có ngữ cảnh", "LSH1"),
              p("Trang học tập gồm thư viện, hội thoại và nguồn tham khảo. Trên màn hình nhỏ, các khu vực chuyển thành tab; hỗ trợ chuyển tab bằng phím mũi tên, Home và End.", "LSBody"),
              h2("Pipeline hỏi đáp đã triển khai"),
              table(["Bước", "Xử lý"], [
                  ["1. Trích xuất", "PyMuPDF đọc PDF theo trang; python-docx đọc đoạn, tiêu đề và bảng trong DOCX."],
                  ["2. Tạo chỉ mục", "Chia khoảng <b>500 token/đoạn</b>, chồng lấp <b>80 token</b>, giữ vị trí nguồn; BGE-M3 tạo dense vector 1024 chiều, ghi vào Qdrant."],
                  ["3. Tìm nội dung", "Truy vấn lọc theo người dùng, tài liệu và index version. Lấy tối đa <b>8 ứng viên</b>, loại trùng và chọn tối đa <b>5 đoạn</b> trong ngân sách context."],
                  ["4. Tạo câu trả lời", "Qwen3 4B qua Ollama được hướng dẫn trả lời tiếng Việt, từng bước và có nhãn S1-S5. Dùng tối đa 6 message lịch sử, giới hạn 450 token."],
                  ["5. Hiển thị", "Worker lưu dần nội dung; UI cập nhật khi đọc trạng thái khoảng mỗi 2 giây trong lúc có tác vụ. Đây là polling, không phải streaming trực tiếp từ Vercel."],
              ], [108, WIDTH - 108]),
              h2("Nguồn tham khảo và công thức"),
              bullet("Đối chiếu nguồn.", "Mỗi nguồn có tên tài liệu và trang PDF hoặc mục/đoạn DOCX. Bấm trích dẫn để đọc đoạn gốc; PDF có URL đọc riêng tư, hiệu lực 120 giây và mở đúng trang."),
              bullet("Công thức LaTeX.", "Markdown và KaTeX hiển thị công thức inline hoặc khối. HTML thô không được thực thi; ảnh từ câu trả lời không tự tải về."),
              bullet("Lịch sử phiên học.", "Lưu câu hỏi/câu trả lời theo tài khoản, tạo phiên mới và mở lại hội thoại. API danh sách hiển thị tối đa 100 hội thoại gần nhất."),
              box("Khi chưa đủ bằng chứng", "Hệ thống có nhánh trả lời chưa tìm thấy thông tin phù hợp. Nhãn trích dẫn không thuộc context bị từ chối. Nhãn hợp lệ <b>không tự chứng minh lời giải đúng</b>; chất lượng suy luận và mức độ nguồn hỗ trợ vẫn phải được chấm thủ công.", YELLOW),
              PageBreak()]

    # PAGE 4: architecture, protection and runtime.
    story += [p("03 / KIẾN TRÚC VÀ VẬN HÀNH", "LSLabel"), p("Web trên cloud, AI tại máy cá nhân", "LSH1"),
              table(["Thành phần", "Vai trò hiện có"], [
                  ["Next.js / TypeScript", "Giao diện và API; đã có cấu hình Vercel, region sin1. File đi trực tiếp tới Storage; API không chờ model sinh xong."],
                  ["Supabase", "Auth, PostgreSQL, bucket private và Queues. RPC tạo dữ liệu nghiệp vụ và enqueue trong cùng transaction."],
                  ["Qdrant Cloud", "Collection embedding phiên bản hóa, dense vector cosine, payload index và bộ lọc quyền sở hữu."],
                  ["Python / Ollama", "Worker chủ động lấy việc, gọi parser, embedding, retrieval và SLM. Ollama chỉ ở localhost; không cần public endpoint máy cá nhân."],
              ], [126, WIDTH - 126]),
              h2("Cơ chế bảo vệ dữ liệu trong mã nguồn"),
              bullet("Phân quyền nhiều lớp.", "Cookie Supabase SSR và RLS; RPC lấy chủ sở hữu từ auth.uid(). Client không được ghi trực tiếp messages, jobs, chunks hoặc nhận việc từ queue."),
              bullet("Truy xuất có ràng buộc.", "Qdrant lọc user/document/version; worker đọc lại chunk trong PostgreSQL trước khi đưa vào context. Secret chỉ được cấu hình phía server/worker."),
              bullet("Xóa và job cũ.", "Kiểm tra lại trạng thái/phiên bản tài liệu khi publish. UUID vector ổn định, idempotency key và lease token giúp xử lý việc nhận lại job."),
              h2("Giới hạn và điều phối"),
              table(["Cấu hình", "Giá trị mặc định"], [
                  ["Tài khoản / câu hỏi", "Một câu hỏi đang chờ/chạy mỗi tài khoản; 30 câu hỏi/giờ; nội dung tối đa 2.000 ký tự."],
                  ["Song song / bộ nhớ", "Một consumer AI cho mỗi database bằng session advisory lock; giải phóng model embedding trước SLM và ngược lại."],
                  ["Heartbeat / offline", "Heartbeat 15 giây; không có cập nhật hơn 60 giây thì báo offline và không nhận thêm tác vụ AI mới."],
                  ["Retry / lease", "Tối đa 3 lượt xử lý; lỗi tạm chờ 10 giây; visibility timeout 120 giây và được gia hạn."],
                  ["SLM", "qwen3:4b; thinking tắt; context 4.096 token; đầu ra tối đa 768 token. Cần benchmark trên máy thật."],
              ], [126, WIDTH - 126]),
              PageBreak()]

    # PAGE 5: verified status, limitations, traceability.
    story += [p("04 / KIỂM CHỨNG VÀ GIỚI HẠN", "LSLabel"), p("Mức độ sẵn sàng hiện tại", "LSH1"),
              table(["Hạng mục", "Kết quả tại máy / phạm vi"], [
                  ["Web / API", "<b>9 kiểm thử đạt</b>: validation, Markdown/LaTeX, chặn request không hợp lệ và ranh giới xác thực."],
                  ["Database", "<b>10 kiểm thử đạt</b> trên PostgreSQL nhúng PGlite: RLS, grants, quota, idempotency, rollback enqueue và tombstone nguồn. Auth/Storage/PGMQ có thành phần thay thế tối thiểu."],
                  ["Worker", "<b>16 kiểm thử đạt</b>: parser, chunking, tenant/version filters, trích dẫn, stream gián đoạn, fencing và bộ đánh giá. Vector chạy in-memory; inference có HTTP mock."],
                  ["TypeScript / build", "Typecheck và production build đã thành công. Có GitHub Actions cho web/database và worker."],
                  ["Cloud / model thật", "<b>Chưa xác minh tích hợp đầu-cuối.</b> Chưa có cấu hình cloud tại workspace; chưa công bố URL deploy hoặc số đo chất lượng/tốc độ model thật."],
              ], [114, WIDTH - 114]),
              h2("Công cụ đánh giá đã có"),
              p("Bộ mẫu tự biên soạn gồm <b>6 tài liệu và 60 câu hỏi</b>: 45 câu có bằng chứng, 15 câu thiếu bằng chứng; chia 20 calibration và 40 test. Có lệnh tạo corpus, đánh giá RAG, xuất kết quả chấm và benchmark Ollama. Đây là fixture nhỏ, cần bổ sung giáo trình thật trước khi kết luận chất lượng học thuật."),
              h2("Các giới hạn cần biết"),
              p("Chưa có OCR, đọc PDF scan, nhận dạng công thức/sơ đồ trong ảnh, tạo đề ôn tập, lộ trình cá nhân hoặc LoRA/QLoRA. DOCX không có số trang cố định. Chưa có query rewriting, reranker hay hybrid search. Máy chạy AI phải bật và có Internet; heartbeat chỉ phản ánh worker, không bảo đảm mọi dịch vụ upstream luôn sẵn sàng."),
              box("Các bước tiếp theo để nghiệm thu thực tế", "1. Cấu hình Supabase, Qdrant và Ollama, áp dụng migration.<br/>2. Chạy worker và deploy Next.js lên Vercel.<br/>3. Smoke test bằng hai tài khoản, gồm upload, hỏi đáp, trích dẫn, xóa và khôi phục lỗi.<br/>4. Chạy model thật, chấm bộ test và đo thời gian/VRAM trước khi công bố đạt mục tiêu.", LAVENDER),
              h2("Cơ sở lập báo cáo"),
              p("Đối chiếu mã nguồn và tài liệu trong repository ngày 22/10/2026: apps/web/src/app; apps/web/src/components; services/worker/src/study_worker; supabase/migrations/202610220001_initial.sql; docs/architecture.md; docs/evaluation.md; các bộ kiểm thử web/database/worker. Tên thương hiệu đã thống nhất là LearnStep; namespace kỹ thuật và dữ liệu lưu trữ hiện có được giữ để tránh phá tương thích.", "LSSmall")]

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
