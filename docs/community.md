# Thông báo và nhóm học tập

Áp dụng migration `supabase/migrations/202610290001_community.sql` sau các
migration hiện có. Với Supabase project đã link, dùng `supabase db push`;
với local dùng `supabase migration up --local`. Không cần reset database.
Local của phiên triển khai đã áp dụng migration này; cloud cần áp dụng riêng
trước khi sử dụng API mới. Nếu thiếu migration, API trả lỗi 503 rõ ràng.

## Thông báo

Nút thông báo trên thanh tài khoản hiển thị số chưa đọc, danh sách 50 mục mới
nhất, đánh dấu một mục hoặc tất cả đã đọc và mở hội thoại/nhóm liên quan.
Ứng dụng cập nhật mỗi 15 giây khi tab đang hiển thị, đồng thời khi lấy lại focus.
Đây là thông báo trong ứng dụng, chưa có push trình duyệt hoặc email.

Thông báo được tạo cùng transaction khi tài liệu sẵn sàng/thất bại, job chat
hoàn tất/thất bại, câu trả lời bị gián đoạn hoặc thành viên khác gửi tin nhóm.
Không đưa toàn bộ câu hỏi, đoạn tài liệu hay câu trả lời vào nội dung thông báo.
Event key chống phát trùng khi xử lý job lặp lại. Chỉ chủ tài khoản được đọc và
đánh dấu đã đọc; client không có quyền tự tạo thông báo.

## Nhóm theo môn

Hỗ trợ Giải tích, Đại số tuyến tính và Vật lý đại cương. Người dùng tạo nhóm,
lọc môn, tham gia, rời nhóm và trao đổi Markdown/công thức. Thông tin giới thiệu
nhóm là công khai trong cộng đồng người đã đăng nhập; chỉ thành viên đọc và gửi
tin. Tham gia nhóm không cấp quyền đọc tài liệu, hồ sơ hay hội thoại riêng.

Giới hạn MVP: 5 nhóm sở hữu/tài khoản, 20 nhóm tham gia/tài khoản, 50 thành viên
mỗi nhóm, 30 tin/phút/tài khoản; tên 3–80 ký tự, giới thiệu tối đa 500, nội dung
tin 1–2.000. Chủ nhóm chưa thể rời nhóm vì chưa có chức năng chuyển chủ/xóa nhóm.
Danh mục trả tối đa 100 nhóm, ưu tiên nhóm đã tham gia rồi nhóm mới nhất. UI
hiển thị 50 tin gần nhất; API hỗ trợ cursor thời gian để mở rộng lịch sử sau.

RLS bảo vệ bảng, các RPC có `search_path` rỗng và lấy danh tính từ `auth.uid()`.
Client chỉ có SELECT phù hợp quyền; mọi mutation đi qua RPC hạn chế quyền.
Quota được khóa ở database để tránh đua; tạo nhóm và gửi tin dùng key ổn định
theo nội dung, phát hiện reuse key với payload khác.

## API

- `GET /api/notifications`, `POST /api/notifications/read`.
- `GET/POST /api/groups`, lọc `?subject=calculus|linear-algebra|physics`.
- `POST /api/groups/:id/join`, `POST /api/groups/:id/leave` (JSON `{}`).
- `GET/POST /api/groups/:id/messages`, đọc cũ hơn với `?before=<ISO datetime>`.

Chạy `npm test` để kiểm tra API và hai suite database. Phạm vi an toàn và bằng
chứng local xem [báo cáo bảo mật](security-review.md).
