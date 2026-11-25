# LearnStep — Context dự án cho agent

Ảnh chụp workspace ngày **23/11/2026**. Repo GitHub là **letoan9319/ChatBot**, tên sản phẩm là **LearnStep**. Đọc [AGENTS.md](AGENTS.md) trước khi sửa code. Kiểm tra lại trạng thái Git, cấu hình và dịch vụ của đúng môi trường khi bắt đầu công việc.

## Sản phẩm

LearnStep hỗ trợ sinh viên Việt Nam học Giải tích, Đại số tuyến tính và Vật lý đại cương.

- **Trợ giảng AI** hỗ trợ hỏi đáp theo kho chung, chọn tài liệu hoặc tìm nguồn Wikipedia. Câu trả lời hiển thị Markdown, LaTeX và trích dẫn có thể mở. Với bài tập, gia sư hướng dẫn phương pháp và giao bước tiếp theo để người học tự tìm kết quả cuối. Với câu hỏi khái niệm, giải thích trực tiếp.
- **Phiên học** có lịch sử, dừng sinh câu trả lời, xóa phiên và chat tạm thời có hạn sử dụng. Xem trạng thái bản vá trí nhớ hội thoại ở mục bàn giao.
- **Kho tài liệu** có tệp cá nhân và kho chung do người quản lý nội dung công bố, tìm kiếm, trình đọc PDF và văn bản OCR. Gộp tài liệu ở UI tạo một đầu mục đọc thống nhất từ nhiều phần. File, chunk và trích dẫn giữ định danh riêng.
- **Các tính năng khác** gồm tài khoản, hồ sơ, tổng quan, kế hoạch học, chuỗi ngày học, nhóm học, thông báo và tùy chọn giao diện. Nhóm học hỗ trợ tin nhắn, ảnh, emoji và phản ứng.

## Bản đồ code

| Phần | Nơi bắt đầu | Vai trò |
| --- | --- | --- |
| Web Next.js/TypeScript | [apps/web](apps/web), [study-workspace.tsx](apps/web/src/components/study-workspace.tsx) | Điều hướng, chat, chọn tài liệu, trạng thái job |
| API web | [route handler](<apps/web/src/app/api/[[...path]]/route.ts>), [validation.ts](apps/web/src/core/validation.ts), [supabase-server.ts](apps/web/src/core/supabase-server.ts) | Xác thực SSR, kiểm tra request, RPC, upload và nguồn tài liệu |
| Danh mục và trình đọc | [document-catalog.ts](apps/web/src/core/document-catalog.ts), [document-reader.tsx](apps/web/src/components/document-reader.tsx), [markdown.tsx](apps/web/src/components/markdown.tsx) | Gộp tập, đọc PDF/OCR, Markdown và KaTeX |
| Nhóm học và kế hoạch | [study-groups.tsx](apps/web/src/components/study-groups.tsx), [learning-plans.tsx](apps/web/src/components/learning-plans.tsx) | Giao diện cộng đồng và kế hoạch học |
| Worker Python | [main.py](services/worker/src/study_worker/main.py), [config.py](services/worker/src/study_worker/config.py), [models.py](services/worker/src/study_worker/models.py), [rag.py](services/worker/src/study_worker/rag.py) | Hàng đợi, lease, model, vector, truy xuất, prompt và trích dẫn |
| Tệp, OCR và đánh giá | [documents.py](services/worker/src/study_worker/documents.py), [mineru_runner.py](services/worker/src/study_worker/mineru_runner.py), [notebooks](notebooks), [evaluation.md](docs/evaluation.md) | Trích xuất, chia chunk, MinerU, OCR theo lô và benchmark |
| Dữ liệu và quyền | [migrations](supabase/migrations), [tests](tests) | Schema, RLS, RPC, Storage, PGMQ và kiểm thử PostgreSQL nhúng |
| Vận hành | [README.md](README.md), [deployment.md](docs/deployment.md), [start-learnstep.ps1](scripts/start-learnstep.ps1) | Khởi động local, kết nối worker cloud và triển khai |

Web dùng npm workspace với Node.js 22 trở lên. Worker dùng Python từ 3.12 đến dưới 3.14, uv và uv.lock. Nếu sửa Next.js, đọc thêm [apps/web/AGENTS.md](apps/web/AGENTS.md) và hướng dẫn đi kèm phiên bản Next trong node_modules.

## Luồng upload, OCR và lập chỉ mục

1. API tạo upload intent qua RPC. Trình duyệt tải tệp trực tiếp vào Supabase Storage private. API và worker kiểm tra tệp trước khi xử lý.
2. Worker nhận job ingest, lấy bản gốc, trích xuất PDF/DOCX, chia đoạn theo trang hoặc đoạn văn, tạo embedding và ghi vector vào Qdrant. PostgreSQL giữ metadata tài liệu, nội dung chunk, trạng thái và trích dẫn.
3. Chỉ dùng tài liệu sẵn sàng, đúng chủ sở hữu, phiên bản chỉ mục, embedding profile và collection. Worker kiểm tra lease và trạng thái một lần nữa trước khi công bố. Giữ idempotency khi retry và cleanup.
4. OCR sai cần sửa đầu ra trích xuất hoặc xử lý lại file gốc. [reindex_shared.py](services/worker/src/study_worker/reindex_shared.py) tạo embedding từ chunk đã lưu. Khi đổi model embedding, xây chỉ mục mới và kiểm tra truy xuất trước khi chuyển.

Ảnh dán vào chat AI được web đóng gói thành PDF cá nhân, xử lý ingest rồi gắn vào lượt hỏi. Worker MinerU đưa OCR vào prompt cho model đọc đề. Khả năng xử lý phụ thuộc vào worker thực sự nhận job. Weights nằm trong vùng lưu trữ của máy chạy model. Dùng ollama list, CHAT_MODEL, MINERU_PYTHON và MINERU_MODEL_PATH để kiểm tra cấu hình. [Notebook OCR Kaggle](notebooks/learnstep_kaggle_ocr.ipynb) và [Final_Docs](Final_Docs) là tài nguyên làm việc cho OCR theo lô.

## Luồng hỏi đáp và quyền truy cập

1. RPC app_send_message kiểm tra quyền phiên, tài liệu và khóa idempotency, rồi ghi tin nhắn user/assistant và job trong transaction. Worker nhận job qua PGMQ. Web đọc trạng thái và kết quả theo phiên.
2. Mode library tự tìm trong kho chung. Mode documents dùng nguồn được chọn. Search và research có thêm nguồn Wikipedia. Truy vấn Wikipedia dùng nội dung công khai của lượt hiện tại. Giữ lịch sử và tài liệu riêng trong đúng phạm vi xử lý.
3. Worker xác thực kết quả Qdrant với PostgreSQL, chọn nguồn vừa ngân sách rồi chỉ chấp nhận nhãn S1–S5 có trong prompt. Nhãn hợp lệ vẫn cần đối chiếu xem đoạn nguồn có hỗ trợ câu trả lời hay không. Prompt có ngân sách đầu vào khoảng 2.900 token. Cấu hình Ollama dùng context 7.168 và đầu ra tối đa 3.584 token.
4. Giữ RLS, auth.uid(), kiểm tra quyền sở hữu, Storage private và xác thực SSR. Worker dùng advisory lock theo session PostgreSQL cùng lease để điều phối consumer và chặn job cũ ghi kết quả. Kiểm tra quyền và phiên bản lại khi lưu để chịu được retry, dừng chat và xóa.

## Chạy, kiểm thử và triển khai

Dùng Windows PowerShell tại repo gốc. Xem [README](README.md) để chuẩn bị Docker Desktop, Node.js, Ollama, uv và file môi trường.

~~~powershell
.\scripts\start-learnstep.ps1
.\scripts\start-learnstep.ps1 -Checkout .\tmp\document-catalog-release
~~~

Lệnh đầu dùng checkout hiện tại. Lệnh sau chọn worktree gần bản phát hành hơn. Local chạy Supabase qua Docker, Qdrant local, Ollama và web tại http://127.0.0.1:3000/study. Log nằm trong tmp/start-learnstep/<mode>/ của checkout đã chọn. Muốn chạy worker kết nối Supabase và Qdrant Cloud, dùng -Mode Production với checkout và file cấu hình cloud đã xác minh.

~~~powershell
npm test
npm run typecheck
npm run build
Push-Location services/worker
uv run --frozen pytest
uv run --frozen ruff check src tests
Pop-Location
~~~

npm test gồm kiểm thử web và PostgreSQL nhúng. Khi kiểm tra model thật, báo rõ đã thử trực tiếp model, worker với DB hay toàn tuyến từ giao diện.

[Web production trên Vercel](https://learnstep-gamma.vercel.app/study) dùng Supabase Cloud và Qdrant Cloud. Cấu hình local từng kiểm tra gồm Ollama qwen3:4b-instruct, BGE-M3 cho embedding và MinerU cho OCR. Render có cấu hình dự phòng dùng NVIDIA Nemotron embedding qua OpenRouter và DeepSeek chat qua Deploy.com. Kiểm tra embedding profile/collection và phạm vi dữ liệu được phép gửi trước khi đổi worker dùng chung hàng đợi. Xem [hướng dẫn triển khai](docs/deployment.md).

Giữ file .env và credentials ngoài Git. Chia sẻ cấu hình qua các file .env.example. Worker cloud cần PostgreSQL hỗ trợ kết nối theo session, thường qua Session pooler cổng 5432. Khi AI báo tạm dừng, kiểm tra process chạy từ checkout nào, heartbeat, lease, schema, Ollama, Qdrant và log. Khi deploy, xác minh commit đã push, CI, deployment Vercel, migrations và phiên bản worker đang chạy.

## Trạng thái bàn giao

| Checkout hoặc tính năng | Bằng chứng tại thời điểm ghi |
| --- | --- |
| Checkout gốc | HEAD **b33c97a7**, có nhiều sửa đổi tracked và untracked. Giữ thay đổi local của người dùng. |
| Mốc phát hành | Remote-tracking ref **origin/main** và worktree **tmp/document-catalog-release** cùng ở **01c6a44b** sau lần phát hành ngày 23/11/2026. Vercel production và worker Ollama đã chuyển sang bản này. Fetch và kiểm tra lại trước lần phát hành tiếp theo. |
| Có ở mốc phát hành | Kho tài liệu gộp theo tập, trình đọc OCR, chat tạm thời/dừng/xóa phiên, phản ứng nhóm, dán ảnh vào nhóm, OCR ảnh gửi cho AI và gợi ý đầu tiên cho đề ảnh. |
| Phát hành ngày 23/11/2026 | Dán LaTeX và hiển thị công thức trong tin nhắn người dùng, cùng bản vá trí nhớ hội thoại. Commit tính năng **0d0e685c**, commit SQL cố định **01c6a44b**. |
| Luồng phát hành riêng | Worktree **tmp/chat-experience**, **tmp/group-composer-icons** và **tmp/group-image-release**. Đối chiếu diff từng nhánh trước khi chuyển thay đổi. Vercel Blob Private cho ảnh nhóm thuộc luồng riêng, cần xác minh trạng thái trước khi dùng. |

**Bản vá gần nhất — trí nhớ hội thoại.** Worker đọc tối đa 24 tin nhắn cùng phiên và chủ sở hữu, gồm tin nhắn đã dừng có nội dung. Dựa vào mẫu hỏi tiếp tiếng Việt để tìm đề độc lập gần nhất. Khi lời giải dài, giữ đề gốc và ưu tiên đoạn đang được hỏi, gỡ nhãn trích dẫn cũ. Với đề ảnh, đối chiếu job gốc, quyền sở hữu và phiên bản OCR. Đã thử local qua worker và PostgreSQL với Ollama bằng bài đạo hàm ẩn, đề ảnh, đề độc lập và phiên mới. Lần kiểm thử gần nhất ghi nhận **80 bài worker qua ở checkout gốc** và **70 bài qua ở worktree phát hành**.

## Cách chẩn đoán thường gặp

- **Sai trích dẫn** — kiểm tra truy vấn, phạm vi tài liệu, embedding profile, chunk PostgreSQL, prompt và bước kiểm tra nhãn.
- **Sai OCR hoặc LaTeX** — đối chiếu PDF gốc, OCR từng trang, chunk đã lưu, dữ liệu clipboard, Markdown và đầu ra KaTeX. Kiểm tra nguồn gốc thư mục tài liệu trước khi đồng bộ hoặc dọn.
- **Khác nhau giữa tài liệu và code** — [architecture.md](docs/architecture.md) mô tả hệ thống, nhưng một số giới hạn lịch sử và model có thể thuộc bản cũ. Dùng code, migration và kết quả chạy của đúng checkout để xác minh hành vi.
