# Triển khai và vận hành demo

## Deploy trên Vercel

Trước khi deploy web, cần áp dụng migration lên đúng Supabase project. File
`supabase/config.toml` cấu hình môi trường local; import repository vào Vercel
không tự tạo bảng hay thiết lập Auth trên Supabase Cloud.

Với project mới chưa có bảng, dùng Supabase CLI theo thứ tự:

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Migration `supabase/migrations/202610220001_initial.sql` tạo 7 bảng nghiệp vụ,
RLS, RPC, bucket private `documents` và queue `study_jobs`. Không chạy lại toàn
bộ migration trong SQL Editor nếu đã tạo một phần schema; kiểm tra lịch sử
migration và lỗi trước khi tiếp tục.

Migration tiếp theo `202610220002_profiles.sql` tạo bảng `profiles`, RLS đọc
hồ sơ của chính mình và RPC `app_set_username` chỉ cho tài khoản đã đăng nhập.
Áp dụng migration này trước khi deploy phiên bản có bước tạo username. Nếu
dùng CLI, `db push` sẽ áp dụng các migration còn thiếu theo thứ tự. Nếu dùng SQL
Editor, chỉ chạy các file chưa áp dụng trên project đó. Username
không được dùng làm quyền truy cập: mọi kiểm tra vẫn dựa trên `auth.uid()`.

Migration `202610220003_embedding_profiles.sql` lưu model/collection của tài liệu,
provider của heartbeat và RPC đọc provider. Cả web và worker bản này cần migration
đó kể cả khi vẫn dùng Ollama. [Cấu hình NVIDIA trên OpenRouter](openrouter.md) cho
phép chạy worker CPU, không cần Ollama/GPU; key OpenRouter chỉ đặt trên worker.

Migration `202610220004_chat_fallback.sql` bổ sung metadata cho chế độ
[Ollama chính, OpenRouter dự phòng](chat-fallback.md). Chế độ đó vẫn cần Ollama/BGE;
key chỉ ở worker và không có request API khi model chat chính hoạt động bình thường.

Tài khoản được Supabase quản lý trong schema `auth`, không phải `public`.
Schema `public` trống cho biết ứng dụng chưa có bảng nghiệp vụ, nhưng không
tự chứng minh nguyên nhân đăng ký thất bại. Trong Supabase Dashboard cần bật
email/password và cho phép đăng ký mới, cấu hình Site URL và các redirect URL
theo domain Vercel thực tế. Nếu bật xác nhận email, cần SMTP riêng để gửi cho
người ngoài team của project; SMTP mặc định chỉ gửi cho thành viên tổ chức và
có hạn mức thấp. Tham khảo [SMTP của Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

1. Push repository lên GitHub của bạn và import vào Vercel.
2. Chọn framework Next.js, **Root Directory `apps/web`**. Cho phép build sử dụng các file ngoài root directory để npm đọc workspace và lockfile ở gốc.
3. Dùng Node.js 22 hoặc 24; giữ Install Command mặc định npm và Build Command `npm run build`. `apps/web/vercel.json` đặt region `sin1`, thời gian tối đa API 30 giây.
4. Thêm ba biến môi trường từ `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Không thêm `NEXT_PUBLIC_` cho secret.
5. Production dùng project Supabase và collection Qdrant riêng. Preview dùng project Supabase thử nghiệm với worker riêng tại thời điểm cần kiểm thử; nếu chưa cấu hình preview, giữ trang hướng dẫn setup. Không copy production keys sang preview.
6. Deploy, lấy URL thực và cập nhật Supabase Authentication Site URL cùng các redirect `/auth/callback`, `/auth/confirm`. Cấu hình SMTP phù hợp nếu dùng nhiều tài khoản; hạn mức email mặc định không phù hợp gửi hàng loạt.
7. Chuẩn bị hai tài khoản đã xác minh email, upload tài liệu, hỏi một câu có đáp án và một câu ngoài tài liệu từ URL Vercel thật.

Không cần public endpoint cho máy cá nhân. Web dùng Supabase làm đầu mối. Chi phí và quota Vercel, Supabase, Qdrant phải kiểm tra theo tài khoản tại thời điểm deploy.

## Quy trình trước buổi demo

1. Kiểm tra Internet, dung lượng Storage và Qdrant, các project cloud chưa bị pause.
2. Với Ollama, xác nhận `ollama list` có hai model. Với OpenRouter, kiểm tra API key/quota và cấu hình model free.
3. Mở worker, chờ log `worker_ready`; trang học tập phải báo online trong khoảng 15 giây.
4. Upload một PDF có văn bản, đợi `Sẵn sàng`; hỏi, mở trích dẫn và trang PDF gốc.
5. Dùng tài khoản thứ hai kiểm tra không thấy tài liệu của tài khoản đầu.
6. Giữ laptop cắm nguồn và không sleep trong thời gian demo.

## Khôi phục lỗi

| Trường hợp | Hành vi / xử lý |
|---|---|
| Worker tắt | Sau 60 giây UI báo offline và từ chối job AI mới; vẫn cho đọc lịch sử và enqueue xóa |
| Worker khởi động lại | Queue giao lại job sau visibility timeout 120 giây; bắt đầu lại cùng ID, tăng attempts |
| Lỗi mạng tạm thời | Thử lại sau 10 giây, tối đa 3 lượt; câu trả lời tạm có trạng thái gián đoạn |
| Parser từ chối file | Báo lỗi ngay, không tự thử lại dữ liệu hỏng; người dùng xóa hoặc thay file |
| Ingestion thất bại | Nút Thử lại tạo index version mới và dọn vector cũ trước khi ghi |
| Cleanup thất bại | Giữ trạng thái deleting; có thể gửi DELETE lại để tạo job mới sau khi job cũ kết thúc |
| Upload bỏ dở | Có thể xác nhận lại hoặc xóa từ UI; worker tự enqueue cleanup sau 24 giờ |
| GPU hết VRAM | Kiểm tra ứng dụng đang chiếm GPU bằng `nvidia-smi`, đóng ứng dụng không cần thiết, khởi động lại worker |
| Collection sai chiều | Tạo collection phiên bản mới; không đổi embedding trên collection đang dùng |

Ollama chỉ bind localhost. Secrets chỉ ở Vercel/server và `.env` của worker. Log ứng dụng chỉ chứa job ID, loại lỗi và thời gian; không đưa văn bản giáo trình vào log.

## Theo dõi và rollback

- Xem `jobs` để biết thời gian chờ, thời gian xử lý và tỉ lệ thất bại; SQL mẫu trong `supabase/metrics.sql`.
- Heartbeat chỉ báo sức sống của worker, không đảm bảo dịch vụ upstream chưa bị lỗi sau lần kiểm tra đầu.
- Dùng dashboard Supabase/Qdrant kiểm tra quota, dung lượng và lỗi kết nối. Không cấu hình theo dõi lặp hay thông báo bên ngoài trong repository này.
- Rollback web bằng phiên deploy trước trong Vercel. Migration đầu tiên chỉ áp dụng cho project mới; các thay đổi tiếp theo cần migration mới, ưu tiên tương thích bản web/worker đang chạy.
- Khi đổi model embedding: tạo collection mới, tăng index version và chạy index lại; chỉ chuyển cấu hình sau khi đánh giá xong. Đổi SLM không cần index lại nhưng cần chạy lại bộ kiểm tra chất lượng.
