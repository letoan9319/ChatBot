# Đánh giá và nghiệm thu

## Bộ fixture có sẵn

Repository cung cấp **6 tài liệu tự biên soạn** ở ba môn trong `study_worker.corpus`, cùng 60 câu hỏi có đáp án tham chiếu và vị trí nguồn. Gồm 3 PDF và 3 DOCX, 45 câu có bằng chứng và 15 câu ngoài phạm vi. Chia cố định 20 calibration (có cả câu thiếu bằng chứng) và 40 test, không trùng ID.

Đây là bộ kiểm tra kỹ thuật nhỏ, không đại diện cho giáo trình thật hoặc độ khó bài toán đại học. Để báo cáo đồ án, bổ sung giáo trình có quyền sử dụng, công thức và bài tập thực tế, giữ nguyên cách chia tập và chấm nguồn. Không dùng bộ test để chọn ngưỡng sau khi đã xem kết quả.

Tạo file mẫu từ thư mục `services/worker`:

```powershell
uv run python -m study_worker.corpus
```

Kết quả ở `.evaluation/corpus` (được ignore khỏi Git). Trên Linux cần font Unicode như DejaVuSans, hoặc truyền `--font <path-to-font.ttf>`. Upload sáu file vào một tài khoản thử nghiệm, chọn đúng môn theo manifest, chờ ready. Không upload cùng tên nhiều lần cho tài khoản đánh giá.

## Chạy đánh giá thực

Dừng worker trước khi chạy để evaluator sử dụng cùng khóa GPU. Lấy UUID tài khoản thử nghiệm trong Supabase Authentication; không lấy service-role key từ trình duyệt.

```powershell
uv run learnstep-evaluate --manifest ../../.evaluation/corpus/questions.jsonl --user-id <UUID> --split calibration --output ../../.evaluation/calibration.jsonl
# Chọn RETRIEVAL_MIN_SCORE bằng tập calibration, mặc định khởi đầu 0.35.
uv run learnstep-evaluate --manifest ../../.evaluation/corpus/questions.jsonl --user-id <UUID> --split test --output ../../.evaluation/test.jsonl
uv run learnstep-evaluate --report ../../.evaluation/test.jsonl
```

Evaluator dùng cùng bộ lọc, prompt, model và kiểm tra nhãn trích dẫn. Mỗi câu sử dụng tài liệu đích trong manifest để tái lập. Đánh giá thêm truy xuất chéo nhiều tài liệu và câu hỏi tiếp nối bằng kịch bản UI; fixture một tài liệu không đo được hết hai tình huống này.

File kết quả chứa câu trả lời và vị trí nguồn để người đánh giá đọc, có ba trường mặc định `null`:

- `answer_correct`: câu có đáp án được giải thích đúng ý chính, điều kiện và phép tính.
- `citation_supported`: tất cả nguồn được trích thực sự hỗ trợ các nhận định tương ứng. Không chấm chỉ dựa trên nhãn tồn tại.
- `appropriate_abstention`: câu ngoài phạm vi được từ chối phù hợp, không bịa lời giải hay nguồn.

Điền true/false thủ công và chạy lại report. Report thể hiện số đã chấm/tổng số; `null` không được coi là đúng hoặc sai. Citation support là tỷ lệ câu trả lời có toàn bộ trích dẫn đạt yêu cầu, thay vì đếm từng nguồn riêng lẻ.

Recall@5 đối chiếu vị trí nguồn chuẩn trong tối đa 5 đoạn được đưa vào prompt. Các trường không có trong nguồn chuẩn không ảnh hưởng so khớp. Thời gian trong evaluator là tổng embedding + retrieval + generation; thời gian hàng đợi và indexing lấy từ bảng jobs.

## Benchmark máy thật

```powershell
uv run learnstep-benchmark
nvidia-smi
```

Benchmark chạy embedding rồi SLM tuần tự, ghi thời gian load/first token, tổng sinh và kích thước model đang resident từ Ollama. Dùng `nvidia-smi` đo VRAM thực khi đang xử lý. Không chạy evaluator/benchmark đồng thời với worker.

## Checklist nghiệm thu

- Upload PDF tiếng Việt nhiều trang, DOCX tiêu đề/bảng; đối chiếu trang và đoạn thật.
- Kiểm tra PDF scan/khóa mật khẩu, file sai đuôi/nội dung, vượt 20 MB, hơn 200 trang và DOCX quá giới hạn giải nén.
- Chọn tối đa 5 tài liệu; hỏi có nguồn, câu tiếp nối và câu không có đáp án; mở nguồn PDF; xem LaTeX và lịch sử.
- Với hai tài khoản, thử truy cập chéo document, conversation, message, job, source và Storage; phải bị chặn ngay cả khi biết ID.
- Đóng worker trong khi index/chat, chờ lease hết rồi khởi động lại; không có chunk hoặc message trùng, không nối câu trả lời dang dở.
- Giả lập mất mạng Qdrant/Ollama/Supabase; theo dõi retry, trạng thái failed và thử lại.
- Xóa tài liệu khi đang index/chat; sau cleanup không còn file/vector/chunk và nguồn cũ báo không khả dụng.
- Cho 5 tài khoản gửi câu hỏi; một consumer AI xử lý tuần tự, không chạy đồng thời trên GPU.
- Thực hiện lại các luồng từ URL Vercel production trước khi bàn giao.

Mục tiêu: Recall@5 ít nhất 80%, đúng nội dung chính ít nhất 80%, câu trả lời có nguồn hỗ trợ đầy đủ ít nhất 90%, từ chối phù hợp ít nhất 90%, không truy cập chéo trong bộ kiểm thử. Chỉ công bố đạt khi đã chạy model thật và chấm đủ bộ test.

## Phạm vi kiểm chứng tự động hiện có

`npm test` kiểm tra validation, LaTeX/Markdown, RLS và các RPC trên PostgreSQL nhúng. `uv run pytest` kiểm tra parser, chunk IDs/overlap, bộ lọc Qdrant in-memory, nhãn nguồn, ngắt stream, fencing token và cấu trúc bộ đánh giá. Các kiểm thử này không thay thế smoke test với Auth, Storage, PGMQ, Qdrant Cloud, Ollama và Vercel thật.
