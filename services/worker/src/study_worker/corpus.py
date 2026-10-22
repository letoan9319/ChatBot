"""Original, small educational fixtures. Not a substitute for textbook evaluation."""

import argparse
import json
import os
from pathlib import Path

import pymupdf
from docx import Document

# Each fact pairs an explicit question with its answer/source paragraph.
CORPUS = [
    (
        "giai-tich-dao-ham.pdf",
        "calculus",
        "Đạo hàm",
        [
            (
                "Đạo hàm tại một điểm được định nghĩa thế nào?",
                "Đạo hàm của f tại x là giới hạn của (f(x+h)-f(x))/h khi h tiến về 0, nếu giới hạn tồn tại.",
            ),
            (
                "Ý nghĩa hình học của đạo hàm là gì?",
                "Đạo hàm tại một điểm là hệ số góc của tiếp tuyến với đồ thị tại điểm đó.",
            ),
            ("Đạo hàm của x mũ n là gì?", "Với n là số nguyên dương, đạo hàm của x^n là n*x^(n-1)."),
            ("Quy tắc đạo hàm của tổng là gì?", "Nếu f và g khả vi thì (f+g)' = f' + g'."),
            ("Quy tắc đạo hàm của tích hai hàm là gì?", "Nếu u và v khả vi thì (uv)' = u'v + uv'."),
            ("Quy tắc đạo hàm hàm hợp là gì?", "Nếu hàm hợp khả vi, đạo hàm của f(g(x)) là f'(g(x))*g'(x)."),
            ("Đạo hàm của sin x là gì?", "Khi góc đo bằng radian, đạo hàm của sin(x) bằng cos(x)."),
            (
                "Đạo hàm dương trên một khoảng cho biết điều gì?",
                "Nếu f khả vi và f'(x)>0 trên một khoảng thì f tăng nghiêm ngặt trên khoảng đó.",
            ),
        ],
        ["Chứng minh đầy đủ định lý Stokes từ tài liệu này.", "Tính đạo hàm phân số Caputo theo tài liệu này."],
    ),
    (
        "giai-tich-tich-phan.docx",
        "calculus",
        "Tích phân",
        [
            ("Nguyên hàm là gì?", "F là nguyên hàm của f trên một khoảng nếu F'(x)=f(x) tại mọi điểm trong khoảng đó."),
            (
                "Hai nguyên hàm của cùng một hàm liên hệ thế nào?",
                "Trên cùng một khoảng, hai nguyên hàm của một hàm liên tục khác nhau một hằng số.",
            ),
            (
                "Nguyên hàm của x mũ n với n khác âm một là gì?",
                "Với n khác -1 và trên miền xác định thích hợp, nguyên hàm của x^n là x^(n+1)/(n+1)+C.",
            ),
            (
                "Tính tích phân xác định bằng nguyên hàm thế nào?",
                "Nếu f liên tục trên [a,b] và F'=f thì tích phân từ a đến b của f(x)dx bằng F(b)-F(a).",
            ),
            (
                "Công thức tích phân từng phần là gì?",
                "Công thức tích phân từng phần: tích phân u dv bằng uv trừ tích phân v du.",
            ),
            ("Nguyên hàm của cos x là gì?", "Nguyên hàm của cos(x) là sin(x)+C khi x được đo bằng radian."),
            ("Tích phân từ a đến a bằng bao nhiêu?", "Tích phân xác định có hai cận bằng nhau bằng 0."),
            (
                "Đổi thứ tự hai cận tích phân có tác dụng gì?",
                "Đổi thứ tự hai cận của tích phân xác định làm đổi dấu giá trị tích phân.",
            ),
        ],
        ["Giải thích tích phân Itô theo tài liệu này.", "Nêu định nghĩa độ đo Lebesgue từ tài liệu."],
    ),
    (
        "dai-so-ma-tran.pdf",
        "linear-algebra",
        "Ma trận",
        [
            ("Ma trận m nhân n là gì?", "Ma trận m x n là bảng gồm m hàng và n cột các phần tử."),
            ("Điều kiện để nhân hai ma trận là gì?", "Tích AB xác định khi số cột của A bằng số hàng của B."),
            (
                "Phần tử của tích hai ma trận được tính thế nào?",
                "Phần tử (i,j) của AB bằng tổng theo k của A(i,k)*B(k,j).",
            ),
            (
                "Ma trận đơn vị là gì?",
                "Ma trận đơn vị I là ma trận vuông có phần tử đường chéo bằng 1 và các phần tử khác bằng 0.",
            ),
            ("Định thức của ma trận hai nhân hai là gì?", "Định thức của ma trận [[a,b],[c,d]] bằng ad-bc."),
            ("Khi nào ma trận vuông khả nghịch?", "Ma trận vuông A khả nghịch khi và chỉ khi det(A) khác 0."),
            (
                "Ma trận chuyển vị được tạo thế nào?",
                "Ma trận chuyển vị A^T được tạo bằng cách đổi hàng và cột: A^T(i,j)=A(j,i).",
            ),
            (
                "Hạng của ma trận có ý nghĩa gì?",
                "Hạng của ma trận là số cột độc lập tuyến tính tối đa, cũng bằng số hàng độc lập tuyến tính tối đa.",
            ),
        ],
        ["Chứng minh phân rã Jordan từ tài liệu này.", "Mô tả thuật toán Strassen và độ phức tạp từ tài liệu."],
    ),
    (
        "dai-so-khong-gian-vector.docx",
        "linear-algebra",
        "Không gian vector",
        [
            (
                "Tổ hợp tuyến tính là gì?",
                "Tổ hợp tuyến tính của các vector v1,...,vn là tổng a1*v1+...+an*vn với các hệ số vô hướng ai.",
            ),
            (
                "Độc lập tuyến tính được định nghĩa thế nào?",
                "Các vector độc lập tuyến tính nếu tổ hợp tuyến tính bằng vector 0 chỉ khi mọi hệ số đều bằng 0.",
            ),
            (
                "Một cơ sở của không gian vector là gì?",
                "Một cơ sở là một hệ vector vừa độc lập tuyến tính vừa sinh ra toàn bộ không gian.",
            ),
            (
                "Số chiều của không gian được xác định thế nào?",
                "Số chiều của không gian vector hữu hạn chiều bằng số vector trong một cơ sở bất kỳ.",
            ),
            (
                "Tọa độ của vector theo một cơ sở là gì?",
                "Tọa độ của vector theo một cơ sở là các hệ số duy nhất trong biểu diễn vector thành tổ hợp tuyến tính của cơ sở.",
            ),
            (
                "Không gian con phải thỏa điều kiện gì?",
                "Một tập con không rỗng là không gian con nếu đóng đối với cộng vector và nhân với vô hướng.",
            ),
            (
                "Tích vô hướng Euclid trong Rn là gì?",
                "Trong R^n, tích vô hướng Euclid của x và y là tổng x_i*y_i; hai vector trực giao nếu tích này bằng 0.",
            ),
        ],
        [
            "Chứng minh định lý phổ cho toán tử compact từ tài liệu.",
            "Mô tả không gian Banach trong tài liệu.",
            "Nêu thuật toán PCA đầy đủ từ tài liệu.",
        ],
    ),
    (
        "vat-ly-dong-luc-hoc.pdf",
        "physics",
        "Động lực học",
        [
            (
                "Vận tốc trung bình được tính thế nào?",
                "Vận tốc trung bình bằng độ dời chia cho khoảng thời gian thực hiện độ dời đó.",
            ),
            (
                "Gia tốc trung bình được tính thế nào?",
                "Gia tốc trung bình bằng độ biến thiên vector vận tốc chia cho khoảng thời gian tương ứng.",
            ),
            (
                "Định luật II Newton phát biểu thế nào?",
                "Trong hệ quy chiếu quán tính và với khối lượng không đổi, tổng lực tác dụng bằng khối lượng nhân gia tốc: F = m*a.",
            ),
            (
                "Trọng lực gần mặt đất được tính thế nào?",
                "Gần mặt đất, trọng lực có độ lớn P=m*g, hướng về phía tâm Trái Đất; g xấp xỉ 9,81 m/s^2.",
            ),
            (
                "Lực ma sát trượt có độ lớn bao nhiêu?",
                "Mô hình ma sát trượt có độ lớn f=mu*N, trong đó mu là hệ số ma sát trượt và N là phản lực pháp tuyến.",
            ),
            (
                "Gia tốc hướng tâm được tính thế nào?",
                "Chuyển động tròn đều có gia tốc hướng tâm với độ lớn a=v^2/r, hướng về tâm quỹ đạo.",
            ),
            (
                "Định luật III Newton nói gì về cặp lực tương tác?",
                "Hai vật tương tác tác dụng lên nhau hai lực cùng độ lớn, ngược hướng, đặt lên hai vật khác nhau.",
            ),
        ],
        [
            "Giải thích phương trình Schrödinger trong tài liệu.",
            "Nêu các phương trình Maxwell từ tài liệu.",
            "Tính hệ số Lorentz theo tài liệu.",
        ],
    ),
    (
        "vat-ly-nang-luong.docx",
        "physics",
        "Công và năng lượng",
        [
            (
                "Công của lực không đổi được tính thế nào?",
                "Công của lực không đổi là W=F*s*cos(theta), với theta là góc giữa lực và độ dời.",
            ),
            (
                "Động năng của chất điểm là gì?",
                "Trong cơ học cổ điển, động năng của chất điểm khối lượng m, tốc độ v là K=m*v^2/2.",
            ),
            (
                "Định lý động năng phát biểu thế nào?",
                "Độ biến thiên động năng bằng tổng công của các lực tác dụng lên vật.",
            ),
            (
                "Thế năng trọng trường gần mặt đất là gì?",
                "Khi chọn mốc thế năng tại h=0 và coi g không đổi, thế năng trọng trường là U=m*g*h.",
            ),
            (
                "Khi nào cơ năng được bảo toàn?",
                "Khi chỉ các lực thế sinh công, tổng động năng và thế năng của hệ được bảo toàn.",
            ),
            (
                "Công suất trung bình được tính thế nào?",
                "Công suất trung bình bằng công thực hiện chia cho thời gian thực hiện công đó.",
            ),
            (
                "Động lượng của chất điểm là gì?",
                "Động lượng của chất điểm là vector p=m*v; trong hệ cô lập, tổng động lượng được bảo toàn.",
            ),
        ],
        [
            "Nêu chu trình Carnot và hiệu suất từ tài liệu.",
            "Giải thích năng lượng liên kết hạt nhân trong tài liệu.",
            "Suy ra định luật Planck từ tài liệu.",
        ],
    ),
]


def manifest():
    rows = []
    for index, (name, subject, heading, facts, missing) in enumerate(CORPUS):
        for number, (question, expected) in enumerate(facts + [(text, None) for text in missing]):
            calibration = number < 2 or (index < 4 and number == 2) or (index < 4 and number == len(facts))
            rows.append(
                {
                    "id": f"{index + 1:02}-{number + 1:02}",
                    "split": "calibration" if calibration else "test",
                    "document": name,
                    "subject": subject,
                    "question": question,
                    "answerable": expected is not None,
                    "reference_answer": expected,
                    "expected_source": (
                        {"document_name": name, "page": 1}
                        if name.endswith(".pdf")
                        else {"document_name": name, "section": heading, "paragraph": number + 2}
                    )
                    if expected
                    else None,
                }
            )
    return rows


def generate(output: Path, font: str | None = None):
    output.mkdir(parents=True, exist_ok=True)
    fonts = [
        font,
        os.getenv("EVALUATION_FONT"),
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    font_path = next((item for item in fonts if item and Path(item).exists()), None)
    if not font_path:
        raise ValueError("Pass --font with a Unicode .ttf file supporting Vietnamese.")
    for name, _, title, facts, _ in CORPUS:
        if name.endswith(".pdf"):
            with pymupdf.open() as pdf:
                page = pdf.new_page()
                page.insert_font(fontname="study", fontfile=font_path)
                text = title + "\n\n" + "\n\n".join(f"{i + 1}. {answer}" for i, (_, answer) in enumerate(facts))
                remaining = page.insert_textbox(pymupdf.Rect(45, 45, 550, 795), text, fontname="study", fontsize=11)
                if remaining < 0:
                    raise ValueError("Fixture overflowed its expected PDF page")
                pdf.save(output / name)
        else:
            doc = Document()
            doc.add_heading(title, 1)
            for _, answer in facts:
                doc.add_paragraph(answer)
            doc.save(output / name)
    (output / "questions.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in manifest()) + "\n", encoding="utf-8"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("../../.evaluation/corpus"))
    parser.add_argument("--font")
    args = parser.parse_args()
    generate(args.output, args.font)
    print("Generated 6 original documents and 60 questions (20 calibration / 40 test).")


if __name__ == "__main__":
    main()
