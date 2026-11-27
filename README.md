# LearnStep

LearnStep là trợ giảng tiếng Việt cho Giải tích, Đại số tuyến tính và Vật lý đại cương. Bạn có thể hỏi về một khái niệm, dán ảnh đề bài, tra giáo trình và mở trích dẫn để đối chiếu lời giải. [Mở LearnStep](https://learnstep-gamma.vercel.app)

![Minh họa pixel một người học cùng robot trợ giảng LearnStep](docs/images/learnstep-tutor.webp)

## Góc học tập

- **Hỏi đáp** theo tài liệu hoặc tìm trên web. Có thể dừng phản hồi, mở lại phiên học, hoặc dùng **Chat tạm thời**.
- **Kho tài liệu** có kho chung và tài liệu cá nhân. Có thể tìm tài liệu theo môn, xem bản gốc và chọn nguồn cụ thể cho câu hỏi.
- **Kế hoạch và nhóm học** có bài tự kiểm tra, ghi chú, thẻ ghi nhớ, lịch ôn và chat nhóm với ảnh, sticker và cảm xúc.
- **Hướng dẫn trong app** gồm ba thẻ giới thiệu cho tài khoản mới và bảy chủ đề có hình minh họa. Mở **Hướng dẫn** cạnh chuông **Thông báo** để xem lại.

![Minh họa pixel nhóm bạn học cùng nhau và trao đổi tài liệu](docs/images/learnstep-study-group.webp)

## Kiến trúc

| Thành phần | Vai trò |
| --- | --- |
| [`apps/web`](apps/web) | Giao diện và API Next.js trên Vercel |
| [`supabase`](supabase) | Auth, PostgreSQL và hàng đợi PGMQ |
| Cloudflare R2 | Lưu tệp tài liệu riêng tư với chốt chặn cứng 90% hạn mức miễn phí (9 GB, 900k Class A, 9M Class B) |
| [`services/worker`](services/worker) | Worker Python trên máy cá nhân, xử lý tài liệu và câu hỏi |
| Qdrant | Lưu và tìm kiếm vector. Chạy bằng Docker ở local hoặc dùng Qdrant Cloud cho production. |
| Ollama local | Qwen 3.5 4B sinh câu trả lời và BGE-M3 tạo embedding theo mặc định. |

Trình duyệt tải tệp trực tiếp lên Cloudflare R2 (hoặc Supabase Storage ở chế độ local) bằng URL ký tạm thời. Worker nhận việc từ hàng đợi Supabase. [Kiến trúc và API](docs/architecture.md) · [Bộ sơ đồ](docs/diagrams/README.md)

## Khởi động nhanh toàn hệ thống

Chạy từ thư mục gốc repo trong PowerShell:

| Nhu cầu | Lệnh | Địa chỉ truy cập |
| --- | --- | --- |
| Bật worker cục bộ kết nối Production (Vercel + Supabase/Qdrant Cloud + Ollama) | `.\scripts\start-learnstep.ps1 -Mode Production -Checkout .\tmp\document-catalog-release` | [LearnStep production](https://learnstep-gamma.vercel.app/study) |
| Bật toàn bộ hệ thống Local (Docker Supabase + Qdrant + Ollama + Worker + Web) | `.\scripts\start-learnstep.ps1 -Mode Local -Checkout .\tmp\document-catalog-release` | [LearnStep local](http://127.0.0.1:3000/study) |

Nếu tiến trình worker cũ bị treo khiến web báo **AI tạm dừng**, tắt worker cũ rồi khởi động lại:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in @('uv.exe','learnstep-worker.exe','python.exe') -and $_.CommandLine -match 'study_worker|learnstep-worker' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

.\scripts\start-learnstep.ps1 -Mode Production -Checkout .\tmp\document-catalog-release
```

## 1. Chạy toàn bộ trên máy cá nhân

Cài Docker Desktop, Ollama, Node.js 22 trở lên và uv. Từ gốc repo, chạy một lệnh trong PowerShell:

```powershell
.\scripts\start-learnstep.ps1
```

Lệnh khởi động Docker Desktop khi cần, chạy Supabase local và áp dụng các migration local, chạy Qdrant, bật Ollama, tải model cấu hình còn thiếu, rồi khởi động web và worker. Cấu hình kết nối local được lấy từ Supabase CLI. Bạn có thể đổi model hoặc tokenizer trong `.env` gốc. Model được nạp khi có việc, nên VRAM được dành cho tác vụ đang chạy.

Khi lệnh báo sẵn sàng, mở [LearnStep local](http://127.0.0.1:3000/study). Có thể chạy lại lệnh để dùng các dịch vụ đang chạy. Dùng `-Port 3001` nếu cần đổi cổng web. Log nằm trong `tmp/start-learnstep/local/`.

Nếu Docker báo có cụm Supabase cũ nhưng PostgreSQL local chưa mở cổng, chạy lại với `-RestartLocalDatabase`. Tùy chọn này dựng lại các container Supabase local và giữ dữ liệu trong volume.

Nếu đang dùng một worktree khác làm bản chạy, truyền đường dẫn bằng `-Checkout`. Ví dụ với worktree phát hành hiện có trên máy:

```powershell
.\scripts\start-learnstep.ps1 -Checkout .\tmp\document-catalog-release
```

Nếu log báo `MigrationMissingLocalError` hoặc báo có phiên bản migration không tìm thấy, dùng checkout có đủ migration mà Supabase local đã áp dụng. Lệnh trên dùng lại cơ sở dữ liệu và hàng đợi trên máy. Supabase Studio ở [cổng 54323](http://127.0.0.1:54323), còn thư xác nhận tài khoản local có thể xem tại [hộp thư cổng 54324](http://127.0.0.1:54324).

## 2. Bật worker trên máy cá nhân cho production

Vercel, Supabase Cloud và Qdrant Cloud là các dịch vụ đã được triển khai. Lệnh production khởi động Ollama và worker trên máy cá nhân, sau đó worker kết nối tới hàng đợi và chỉ mục cloud. Lệnh dùng `services/worker/.env` và hỗ trợ `-EnvFile` nếu cấu hình cloud ở tệp khác.

```powershell
.\scripts\start-learnstep.ps1 -Mode Production
```

Nếu bản chạy production nằm ở worktree phát hành:

```powershell
.\scripts\start-learnstep.ps1 -Mode Production -Checkout .\tmp\document-catalog-release
```

Chuẩn bị cấu hình cloud từ [mẫu worker](services/worker/.env.example) nếu đây là lần chạy đầu. Điền Project URL, khóa máy chủ, chuỗi **Session pooler cổng 5432**, URL/khóa Qdrant và cấu hình Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Với MinerU, đặt `MINERU_PYTHON` và `MINERU_MODEL_PATH` theo bản cài trên máy. Khi lệnh hoàn tất, mở [LearnStep production](https://learnstep-gamma.vercel.app/study). Log nằm trong `tmp/start-learnstep/production/`. [Cấu hình Vercel, Supabase Cloud, Cloudflare R2 và migration](docs/deployment.md#vercel)

### Nếu AI báo tạm dừng

- **Local online, production offline.** Kiểm tra worker đã nạp đúng file môi trường. `../../.env` là cấu hình local. `.env` trong `services/worker` là cấu hình cloud cho worker chạy trên máy bạn.
- **Chạy worker lần hai gặp `RuntimeError`.** Kiểm tra phiên đang chạy và log `worker_ready`. Nếu cùng hàng đợi đã có worker giữ khóa thì tiếp tục dùng phiên đó.

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

Kho cá nhân hỗ trợ PDF/DOCX tối đa 20 MB và 20 tài liệu mỗi tài khoản. Mỗi câu hỏi có thể chỉ định tối đa 5 tài liệu. Nếu bỏ trống, chế độ **Theo tài liệu** tự tra trong kho chung. Với PDF scan, khả năng trích xuất phụ thuộc vào cấu hình OCR của worker đang xử lý.

[Giấy phép GNU GPL v3](LICENSE)
