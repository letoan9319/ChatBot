# LearnStep

LearnStep hỗ trợ tự học Giải tích, Đại số tuyến tính và Vật lý đại cương. Người học có thể tải PDF/DOCX, hỏi đáp bằng tiếng Việt dựa trên tài liệu đã chọn, mở đoạn trích dẫn và xem lại hội thoại.

- **Kho tài liệu** gồm tài liệu cá nhân và tài liệu chung dùng cho RAG. Tài khoản có quyền `content_manager` quản lý việc công bố và thu hồi nguồn chung.
- **Kế hoạch học** hỗ trợ học theo tiến trình và tự học, với bài mẫu, ghi chú, thẻ ghi nhớ và lịch ôn.
- **Góc học tập** có chuỗi ngày học, nhóm theo môn, thông báo và tùy chỉnh giao diện.

## Kiến trúc

| Thành phần | Vai trò |
| --- | --- |
| [`apps/web`](apps/web) | Giao diện và API Next.js trên Vercel |
| [`supabase`](supabase) | Auth, PostgreSQL, Storage riêng tư và hàng đợi PGMQ |
| [`services/worker`](services/worker) | Worker Python trên máy cá nhân, xử lý tài liệu và câu hỏi |
| Qdrant Cloud | Lưu và tìm kiếm vector |
| Ollama | Embedding BGE-M3 và sinh câu trả lời với Qwen. Có thể cấu hình OpenRouter cho worker. |

Trình duyệt tải tệp trực tiếp lên Supabase Storage. Worker chủ động nhận tác vụ từ Supabase, nên cần chạy worker để xử lý tài liệu mới và trả lời câu hỏi, kể cả khi bật OpenRouter dự phòng. [Kiến trúc và API](docs/architecture.md) · [Bộ sơ đồ](docs/diagrams/README.md)

## Chạy trên máy cá nhân

1. Chuẩn bị Node.js 22 trở lên, Python 3.12 và uv. [Thiết lập Supabase, Qdrant và Auth](docs/deployment.md#chuẩn-bị-hạ-tầng).
2. Từ thư mục gốc, tạo cấu hình web từ mẫu, điền các giá trị của môi trường phát triển rồi chạy Next.js.

   ```powershell
   Copy-Item apps/web/.env.example apps/web/.env.local
   npm ci
   npm run dev
   ```

3. Mở [http://127.0.0.1:3000](http://127.0.0.1:3000), đăng ký, xác nhận email và chọn username. [Khởi động worker và Ollama](docs/deployment.md#chạy-worker-trên-máy-cá-nhân) để tải và hỏi đáp theo tài liệu.

Nếu đã có file cấu hình, cập nhật các giá trị cần thiết trong file hiện có. Chỉ đưa các file `.env.example` lên Git.

## Kiểm thử

```powershell
npm test
npm run typecheck
npm run build

Set-Location services/worker
uv sync --frozen --python 3.12
uv run pytest
uv run ruff check src tests
```

`npm test` chạy kiểm thử web và PostgreSQL nhúng. [Đánh giá chất lượng RAG và benchmark](docs/evaluation.md) mô tả cách chạy với dữ liệu và model thực.

## Tài liệu

- [Triển khai Vercel và vận hành worker](docs/deployment.md)
- [Kho tài liệu, trích dẫn và cấp quyền quản lý](docs/document-repository.md)
- [OpenRouter dự phòng cho câu trả lời](docs/chat-fallback.md) hoặc [OpenRouter cho cả pipeline](docs/openrouter.md)
- [Góc học tập](docs/workspace.md), [kế hoạch](docs/learning-plans.md), [nhóm và thông báo](docs/community.md), [chuỗi ngày học](docs/streaks.md)
- [Kiểm tra bảo mật và dependency](docs/security-checks.md)

Giới hạn hiện tại gồm PDF/DOCX tối đa 20 MB, 20 tài liệu mỗi tài khoản và tối đa 5 nguồn mỗi câu hỏi. PDF cần có văn bản trích xuất được.

[Giấy phép GNU GPL v3](LICENSE)
