# Triển khai và vận hành LearnStep

## Chuẩn bị hạ tầng

1. Chọn một dự án Supabase và cluster Qdrant cho từng môi trường cần chạy. Với Supabase local, khởi động Docker rồi chạy `npx supabase start` và `npx supabase migration up` từ thư mục gốc.
2. Với Supabase Cloud, đăng nhập CLI, liên kết đúng project rồi kiểm tra danh sách migration trước khi áp dụng. Supabase CLI v3 mặc định nhắm vào local khi thiếu `--remote`. [Thay đổi của Supabase CLI v3](https://supabase.com/changelog/supabase-cli-v3)

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push --remote --dry-run --skip-vault
   npx supabase db push --remote --skip-vault
   ```

   Các file trong [`supabase/migrations`](../supabase/migrations) tạo schema, RLS, RPC, bucket riêng tư `documents` và hàng đợi `study_jobs`. Với cơ sở dữ liệu đã có dữ liệu, kiểm tra lịch sử migration nếu có sai lệch. Trang quản lý kho chung cần `20261112150505_content_management.sql` và [vai trò `content_manager`](document-repository.md#quản-lý-kho-chung).
3. Bật đăng ký bằng email và mật khẩu trong Supabase Auth. Đặt **Site URL** thành địa chỉ production công khai (ví dụ `https://learnstep-gamma.vercel.app`, không dùng URL preview `*-projects.vercel.app` vì Vercel sẽ bật màn hình đăng nhập bảo vệ preview) và cho phép các URL đầy đủ `/auth/callback`, `/auth/confirm` trong **Redirect URLs**. Nếu thử nghiệm từ máy cá nhân vào Supabase Cloud, thêm cả `http://127.0.0.1:3000/auth/callback` và `http://localhost:3000/auth/callback`. Nếu bật xác nhận email cho người dùng ngoài nhóm dự án Supabase, cấu hình [SMTP riêng](https://supabase.com/docs/guides/auth/auth-smtp). Template dùng token hash có thể dẫn tới `/auth/confirm?token_hash={{ .TokenHash }}&type=email` cho xác nhận hoặc `type=recovery` cho đặt lại mật khẩu.
4. Lấy Project URL, publishable/anon key và service-role key cho web. Worker cần thêm chuỗi kết nối PostgreSQL trực tiếp hoặc **Session pooler cổng 5432** với SSL cho Cloud, cùng URL và API key Qdrant. URL-encode mật khẩu trong chuỗi kết nối. Worker cần giữ advisory lock theo session, nên dùng kết nối hỗ trợ session.

## Vercel

1. Import repository từ GitHub, chọn **Next.js** và **Root Directory** là `apps/web`. Bật **Include source files outside of the Root Directory** để build dùng được workspace và lockfile ở gốc. [Hướng dẫn Vercel cho monorepo](https://vercel.com/docs/monorepos/monorepo-faq#can-i-share-source-files-between-projects-are-shared-packages-supported)
2. Dùng Node.js 22 trở lên và Build Command `npm run build`. Region được đặt trong [`vercel.json`](../apps/web/vercel.json).
3. Thêm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` và `SUPABASE_SERVICE_ROLE_KEY` theo [mẫu web](../apps/web/.env.example). Giữ khóa service role ở phía máy chủ và dùng dự án thử nghiệm riêng cho Preview.
4. Áp dụng migration trước khi deploy web. Sau khi có domain, cập nhật Site URL và redirect URL trong Supabase Auth.

Chế độ **Tìm kiếm** và **Nghiên cứu** cần migration `20261112205940_chat_search_modes.sql` và worker từ cùng bản mã nguồn. Worker cần truy cập Wikipedia qua HTTPS. Wikipedia nhận từ khóa trích từ câu hỏi, còn các tài liệu đã chọn vẫn được truy xuất qua RAG. Cả hai chế độ dùng hàng đợi hiện có và cần worker đang chạy.

Tra cứu kho chung tự động cần migration `202611130001_chat_shared_library.sql` và worker cập nhật. Chế độ **Theo tài liệu** dùng kho chung đã công bố khi người học chưa chọn tệp. Các tài liệu chung đã lập chỉ mục bằng cấu hình embedding hiện tại có thể dùng ngay.

## Chạy worker trên máy cá nhân

### Lưu trữ tệp trên Cloudflare R2 (chốt chặn 90% hạn mức miễn phí)

Đặt cùng bộ biến `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` trên Vercel và `services/worker/.env`. Migration `202611280003_r2_storage_quota.sql` khóa cứng ngưỡng 90% của gói miễn phí R2 (9 GB lưu trữ, 900.000 Class A ops/tháng và 9.000.000 Class B ops/tháng theo UTC) để không phát sinh phí vượt mức; thao tác xóa luôn được phép để giải phóng dung lượng. Để chuyển dữ liệu cũ từ Supabase Storage sang R2, chạy từ `services/worker`:

```powershell
uv run python -m study_worker.migrate_to_r2 --dry-run
uv run python -m study_worker.migrate_to_r2 --delete-source
```

### Kiểm thử toàn bộ trên local

Trỏ web và worker vào cùng Supabase local. Dùng URL và khóa local từ `npx supabase status` cho `apps/web/.env.local` và `services/worker/.env.local`. Trong file worker, dùng URL PostgreSQL local, `QDRANT_URL=http://127.0.0.1:6333`, `QDRANT_API_KEY=`, `AI_PROVIDER=ollama` và `CHAT_FALLBACK_PROVIDER=none`. Có thể đặt `TOKENIZER_PATH` đến bản tokenizer đã tải.

```powershell
docker run -d --name learnstep-qdrant-local --restart unless-stopped -p 127.0.0.1:6333:6333 -v learnstep-qdrant-local:/qdrant/storage qdrant/qdrant:v1.20.0
Set-Location services/worker
uv run --env-file .env.local learnstep-worker
```

Nếu container Qdrant đã tồn tại và đang dừng, dùng `docker start learnstep-qdrant-local`. Khi web báo **AI sẵn sàng**, có thể thử tải tài liệu và hỏi đáp qua Storage, hàng đợi và worker local.

### Worker kết nối môi trường cloud

Mở Ollama trên `127.0.0.1:11434`. Tạo file cấu hình worker từ mẫu nếu chưa có, rồi điền thông tin Supabase và Qdrant của môi trường đang chạy.

```powershell
ollama pull qwen3.5:4b-q4_K_M
ollama pull bge-m3
Set-Location services/worker
Copy-Item .env.example .env
# Điền thông tin kết nối vào .env trước khi chạy worker.
uv sync --frozen --python 3.12
uv run learnstep-worker
```

Worker tự tạo collection và chỉ mục Qdrant theo cấu hình. Lần đầu cần tải tokenizer Qwen, hoặc dùng `TOKENIZER_PATH` trỏ tới `tokenizer.json` đã tải. Giữ máy thức trong thời gian sử dụng. [Cấu hình OpenRouter dự phòng](chat-fallback.md) · [Cấu hình pipeline OpenRouter](openrouter.md)

## Kiểm tra sau triển khai

- Đăng ký, xác nhận email, chọn username và đăng nhập từ URL Vercel.
- Kiểm tra trợ giảng báo sẵn sàng. Tải PDF có văn bản, chờ tài liệu sẵn sàng, hỏi một câu có đáp án và mở trích dẫn.
- Dùng tài khoản thứ hai để xác nhận tài liệu cá nhân của tài khoản đầu không xuất hiện. Nếu dùng kho chung, kiểm tra công bố và thu hồi từ trang quản lý.

## Khi gặp lỗi

| Hiện tượng | Kiểm tra |
| --- | --- |
| Trợ giảng báo offline | Kiểm tra worker và log `worker_ready`, cấu hình kết nối, Ollama hoặc OpenRouter. Hệ thống coi heartbeat quá 60 giây là offline. |
| Tệp chưa xử lý hoặc báo lỗi | Kiểm tra trạng thái tài liệu và job. Với PDF chỉ có ảnh hoặc tệp hỏng, đổi sang bản có văn bản. Có thể thử lại khi lỗi tạm thời. |
| Tài liệu ở trạng thái đang xóa | Worker xử lý file, chunk và vector qua hàng đợi. Có thể yêu cầu xóa lại nếu job dọn dẹp đã thất bại. |
| Sai profile embedding | Dùng collection phù hợp với model và số chiều. Khi đổi model embedding, cần index lại tài liệu. |
| Bản web mới có lỗi | Rollback về deployment trước trên Vercel. Với schema đang dùng, điều chỉnh bằng migration tiếp theo. |

[`supabase/metrics.sql`](../supabase/metrics.sql) có truy vấn theo dõi thời gian chờ, xử lý và lỗi của job.

## Tìm kiếm web và nghiên cứu

LearnStep dùng SearXNG tự host để tìm các trang web. Dịch vụ chạy trên Docker và chỉ nghe ở loopback. Chạy từ gốc checkout đã có cấu hình mới.

~~~powershell
$env:SEARXNG_SECRET = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
docker compose -p learnstep-search -f services/search/compose.yaml up -d --no-recreate
~~~

Biến SEARXNG_SECRET là chuỗi ngẫu nhiên cho container, được tạo tại máy. Worker Ollama mặc định gọi http://127.0.0.1:8888. Có thể đặt SEARXNG_URL trong file môi trường của worker rồi khởi động lại. Khi thiếu cấu hình SearXNG hoặc nguồn web gián đoạn, hệ thống sẽ dùng Wikipedia dự phòng và báo rõ trong câu trả lời.

Nghiên cứu tra thêm bài tạp chí có tóm tắt qua [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) và gắn liên kết DOI. Cả hai chế độ chỉ gửi từ khóa từ câu hỏi hiện tại ra ngoài. [Tài liệu SearXNG](https://docs.searxng.org/dev/search_api.html)

Nghiên cứu dành tối đa khoảng 6.200 token đầu vào và 5.000 token sinh câu trả lời. Ollama dành context 12.288 token cho chế độ này. Giới hạn thực tế phụ thuộc model, VRAM và nhà cung cấp.


## Luồng suy luận Ollama

Worker dùng qwen3.5:4b-q4_K_M cho cả chế độ trả lời trực tiếp và suy luận. Suy luận tự bật cho yêu cầu có ảnh, chế độ Nghiên cứu và một số bài cần phân tích nhiều bước. Có thể đặt OLLAMA_THINKING_MODEL rỗng để tắt. Khi chạy Ollama local, Qwen 3.5 đọc trực tiếp ảnh đề bài bằng vision (ảnh gốc chỉ được đính kèm cho Ollama local); MinerU dùng cho PDF scan và làm nhánh OCR dự phòng khi model chat không hỗ trợ vision. Với câu hỏi yêu cầu trực quan, LearnStep hiển thị biểu đồ thanh hoặc sơ đồ quy trình từ dữ liệu JSON đã được kiểm tra. Áp dụng migration 202611240001_chat_thinking_progress.sql trước khi khởi động worker mới. Khi model phát luồng suy luận, tin nhắn lưu thời điểm bắt đầu và thời lượng để hiển thị tiến trình.
