# Chuỗi ngày học (streak)

Một ngày học được ghi nhận khi một job chat hoàn tất cùng câu trả lời assistant
không rỗng và có ít nhất một nguồn đã lưu. Câu trả lời local và OpenRouter đều
được tính như nhau. Đăng nhập, mở trang, upload, gửi câu hỏi còn chờ, câu trả lời
bị lỗi/gián đoạn hoặc thiếu bằng chứng không tự tăng streak.

## Quy tắc

- Tính theo ngày lịch Việt Nam, múi giờ `Asia/Ho_Chi_Minh` (UTC+7).
- Mỗi tài khoản chỉ được tính một lần/ngày, dù học nhiều câu hay nhiều thiết bị.
- Nếu lần học gần nhất là hôm nay hoặc hôm qua, hiển thị số ngày liên tiếp của
  chuỗi gần nhất. Người học có đến hết hôm nay để nối tiếp chuỗi của hôm qua.
- Bỏ trọn một ngày làm chuỗi hiện tại về 0; lần học tiếp theo bắt đầu ở 1.
- Kỷ lục và tổng số ngày đã học vẫn được giữ, kể cả khi chuỗi bị đứt hoặc tài liệu
  bị xóa. Xóa tài khoản xóa các ngày học theo FK cascade.
- Lịch hiển thị hôm nay và 6 ngày trước đó; chữ “Đã học/Chưa” đi kèm trạng thái màu.
- Không có streak freeze, cộng ngày bằng tay, sửa múi giờ theo người dùng hay phần
  thưởng XP trong phiên bản này.

## Dữ liệu và quyền

Migration `supabase/migrations/202610220005_study_streaks.sql` tạo bảng
`study_activity_days` với khóa `(user_id, study_date)`, thời điểm hoàn tất đầu tiên
và RLS chỉ cho chủ tài khoản đọc. Client không có quyền insert/update/delete.

Trigger `record_completed_study_day` chạy sau khi `jobs.status` chuyển sang
`completed` cho job chat. Worker hiện tại đã lưu message và nguồn trước khi finish
job trong cùng transaction. Trigger kiểm tra owner của job, message, conversation,
source và document, rồi ghi ngày bằng giờ database. Rollback job cũng rollback
ngày học. Giao lại job hay hoàn tất nhiều câu cùng ngày không tạo bản ghi trùng.
Không cần thay đổi pipeline Python để ghi streak.

Migration backfill các job completed có nguồn từ lịch sử theo `finished_at` (không
phải `messages.created_at`, vì câu hỏi có thể chờ qua đêm). Không đoán ngày cho
job thiếu thời điểm hoàn tất, không tính timestamp tương lai hay nguồn không hợp lệ.
Nguồn đã xóa còn tombstone vẫn chứng minh một lần học trong quá khứ.

`GET /api/streak` yêu cầu phiên đăng nhập đã xác thực, gọi RPC `app_get_streak()`.
RPC lấy `auth.uid()` và ngày Việt Nam từ PostgreSQL, không nhận user ID/ngày do
client gửi. API trả `Cache-Control: private, no-store`, không dùng service-role key.
Nội dung gồm `current`, `longest`, `total_days`, `today_completed`, `last_study_date`,
`today`, `timezone`, `week`. Đây là API chỉ đọc; không có endpoint cộng streak.

## Giao diện và cập nhật

Thẻ chuỗi ngày học nằm dưới thanh tài khoản trong góc học tập, hiện ở mọi tab trên
mobile, hỗ trợ light/dark mode và giữ quy tắc không dùng icon/emoji.
Streak cập nhật cùng polling: 2 giây khi có job, 15 giây khi nghỉ; mở lại tab hoặc
focus cửa sổ sẽ tải lại để xử lý đổi ngày. Không dùng đồng hồ máy người dùng để
tính chuỗi. Lỗi tải streak được hiển thị trong thẻ và không chặn các chức năng khác.
Đang tải/lỗi không bị hiển thị nhầm thành 0 ngày; dữ liệu cập nhật lỗi không được
trình bày như một chuỗi hiện tại chính xác.

## Triển khai và kiểm thử

1. Áp dụng các migration còn thiếu theo thứ tự đến `202610220005_study_streaks.sql`.
   Dùng `supabase db push` với project đã link, hoặc chạy riêng file 005 trong SQL
   Editor nếu 001–004 đã được áp dụng. Không chạy lại các migration cũ.
2. Deploy web mới từ nhánh GitHub; worker tiếp tục finish job như trước.
3. Đăng nhập, hoàn tất câu hỏi có nguồn và chờ polling. Hôm nay được đánh dấu
   “Đã học”; gửi thêm câu hỏi không làm số ngày tăng thêm.
4. Đổi tài khoản để xác nhận không đọc được streak của người khác. Kiểm tra trên
   màn hình nhỏ và hai chế độ màu.

Kiểm thử PostgreSQL qua PGlite bao gồm backfill qua nửa đêm Việt Nam, chuỗi bị đứt,
ngày nhuận/năm mới, đồng hồ session khác múi giờ, retry/rollback, hoàn tất không đủ
điều kiện, quyền đọc và chống giả mạo. Kiểm thử API và component bao gồm quyền phiên,
trạng thái tải/lỗi và lịch có nhãn dễ đọc. Smoke test thật cần migration được áp
dụng trên Supabase của URL Vercel đang dùng.
