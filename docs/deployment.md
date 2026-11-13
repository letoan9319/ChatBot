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
3. Bật đăng ký bằng email và mật khẩu trong Supabase Auth. Đặt **Site URL** thành địa chỉ web thực tế và cho phép hai URL đầy đủ `/auth/callback` và `/auth/confirm`. Dùng đúng hostname cho môi trường local, ví dụ `http://127.0.0.1:3000`. Nếu bật xác nhận email cho người dùng ngoài nhóm dự án Supabase, cấu hình [SMTP riêng](https://supabase.com/docs/guides/auth/auth-smtp). Template dùng token hash có thể dẫn tới `/auth/confirm?token_hash={{ .TokenHash }}&type=email` cho xác nhận hoặc `type=recovery` cho đặt lại mật khẩu.
4. Lấy Project URL, publishable/anon key và service-role key cho web. Worker cần thêm chuỗi kết nối PostgreSQL trực tiếp hoặc **Session pooler cổng 5432** với SSL cho Cloud, cùng URL và API key Qdrant. URL-encode mật khẩu trong chuỗi kết nối. Worker cần giữ advisory lock theo session, nên dùng kết nối hỗ trợ session.

## Vercel

1. Import repository từ GitHub, chọn **Next.js** và **Root Directory** là `apps/web`. Bật **Include source files outside of the Root Directory** để build dùng được workspace và lockfile ở gốc. [Hướng dẫn Vercel cho monorepo](https://vercel.com/docs/monorepos/monorepo-faq#can-i-share-source-files-between-projects-are-shared-packages-supported)
2. Dùng Node.js 22 trở lên và Build Command `npm run build`. Region được đặt trong [`vercel.json`](../apps/web/vercel.json).
3. Thêm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` và `SUPABASE_SERVICE_ROLE_KEY` theo [mẫu web](../apps/web/.env.example). Giữ khóa service role ở phía máy chủ và dùng dự án thử nghiệm riêng cho Preview.
4. Áp dụng migration trước khi deploy web. Sau khi có domain, cập nhật Site URL và redirect URL trong Supabase Auth.

Chế độ **Tìm kiếm** và **Nghiên cứu** cần migration `20261112205940_chat_search_modes.sql` và worker từ cùng bản mã nguồn. Worker cần truy cập Wikipedia qua HTTPS. Wikipedia nhận từ khóa trích từ câu hỏi, còn các tài liệu đã chọn vẫn được truy xuất qua RAG. Cả hai chế độ dùng hàng đợi hiện có và cần worker đang chạy.

Tra cứu kho chung tự động cần migration `202611130001_chat_shared_library.sql` và worker cập nhật. Chế độ **Theo tài liệu** dùng kho chung đã công bố khi người học chưa chọn tệp. Các tài liệu chung đã lập chỉ mục bằng cấu hình embedding hiện tại có thể dùng ngay.

## Chạy worker trên máy cá nhân

### Worker dự phòng trên Render Free

Tạo **Web Service** với **Language** là Python, **Root Directory** là `services/worker`, **Build Command** là `uv sync --frozen --no-dev --python 3.12` và **Start Command** là `uv run --frozen --no-dev python -m study_worker.render_service`. Đặt **Health Check Path** thành `/healthz`.

Điền các biến phía Render theo [mẫu worker](../services/worker/.env.render.example). Dùng Supabase Session pooler. Cấu hình mẫu gọi Nemotron 3 Embed 1B qua OpenRouter và dùng collection riêng theo model embedding. DeepSeek trên OpenRouter tính phí theo API. Chỉ dùng endpoint NVIDIA Free với câu hỏi và tài liệu được phép gửi ra ngoài, không chứa thông tin cá nhân hay thông tin mật.

Để chuyển kho chung, dùng cùng cấu hình OpenRouter và Qdrant với worker Render, sau đó chạy từ `services/worker`:

```powershell
uv run --env-file .env.render python -m study_worker.reindex_shared --limit 5
uv run --env-file .env.render python -m study_worker.reindex_shared
```

Lệnh lấy văn bản từ các đoạn đã lưu trong Supabase và tiếp tục từ các vector đã tạo. Kiểm tra chất lượng truy xuất trên câu hỏi tiếng Việt có nguồn chuẩn. Khi sẵn sàng chuyển, dừng worker hiện tại rồi chạy lại với `--activate` để cập nhật metadata kho chung. Giữ cùng cấu hình embedding cho mọi worker đọc chung hàng đợi. Các tệp riêng dùng BGE-M3 cần kế hoạch chuyển riêng trước khi đổi worker production. Lệnh chuyển kho chung giữ lại vector BGE-M3 cũ.

Nếu đã điền `EMBED_MODEL` ở Render hoặc trong file môi trường riêng, cập nhật thành `nvidia/nemotron-3-embed-1b:free`. Tên collection thực tế bao gồm dấu vân tay của model và số chiều. Có thể tạo chỉ mục mới song song với chỉ mục cũ.

Sau khi Render báo dịch vụ hoạt động, đặt `CLOUD_WORKER_URL` và `WORKER_WAKE_SECRET` trên Vercel. Cả hai bên dùng cùng một secret ngẫu nhiên tối thiểu 32 byte. Vercel chỉ gọi Render khi Supabase báo worker offline. Worker đang giữ khóa hàng đợi tiếp tục xử lý đến khi nhả khóa. Render tự dừng vòng lặp sau 150 giây không có việc. Tệp gốc vẫn đi qua Supabase Storage, văn bản được gửi đến endpoint embedding và các đoạn truy xuất được gửi sang OpenRouter khi cần trả lời.

Thử với worker local đã tắt. Gửi một câu hỏi không chọn tệp, mở nguồn, rồi tải một PDF/DOCX và kiểm tra tệp chuyển sang **Sẵn sàng**. Gói Free có thể mất khoảng một phút để khởi động lại. [Render Free](https://render.com/docs/free)

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
ollama pull qwen3:4b
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
