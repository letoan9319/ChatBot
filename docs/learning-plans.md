# Đối chiếu sơ đồ chức năng LearnStep

| Nhóm | Hiện trạng trong mã |
|---|---|
| 1. Tài khoản | Đăng ký, xác nhận email, đăng nhập, đặt lại mật khẩu và tạo username đã có. |
| 2. Kho tài liệu | Kho riêng/chung, upload, index, retry, đọc và xóa đã có. |
| 3. Hỏi đáp | Chọn nguồn, RAG, trích dẫn, lịch sử và sao chép đã có. |
| 4. Nhóm học | Tìm, tạo, tham gia, rời nhóm và nhắn tin đã có. |
| 5. Hoạt động | Tổng quan, streak, lịch, số tài liệu và số phiên đã có. |
| 6. Thông báo | Đọc, đánh dấu đã đọc và mở nhóm/hội thoại liên quan đã có. |
| 7. Tùy chỉnh | Giao diện, cỡ chữ, phím gửi, tự cuộn và khôi phục mặc định đã có. |
| 8. Vận hành | Công bố nguồn bằng SQL, hàng đợi, phân quyền, cleanup và fallback đã có. |
| 9. Học theo tiến trình | Có kế hoạch riêng theo tài khoản, tự khai kiến thức ban đầu và nhịp học. Mỗi môn có ba bài mẫu theo thứ tự. Trả lời đúng mở bài tiếp theo. Có lịch sử kiểm tra và ghi phần cần củng cố. |
| 10. Tự học | Có kế hoạch theo chủ đề, mục tiêu, nguồn và lịch. Người học tự viết ghi chú, tóm tắt và thẻ, làm câu hỏi mẫu theo môn và ghi tự đánh giá. Trợ giảng dùng tài liệu đã chọn. |

Mở **Kế hoạch** trong góc học tập, chọn phương thức, tạo kế hoạch và bấm **Lưu kế hoạch** để đồng bộ. Có thể dán liên kết chi tiết hoặc đoạn nguồn từ trích dẫn vào ghi chú. Ngày ôn lưu trong kế hoạch. Nội dung ba bài của mỗi môn và câu hỏi là bộ mẫu cố định. Nhắc lịch tự động và tạo đề theo chủ đề tùy ý là phần mở rộng.

Cần áp dụng migration `202611120001_learning_plans.sql` vào đúng Supabase project trước khi dùng. RLS giới hạn đọc và ghi theo tài khoản. Revision giúp phát hiện hai tab ghi đè cùng một kế hoạch.
