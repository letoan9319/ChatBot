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
| 8. Vận hành | Quản lý công bố nguồn chung, hàng đợi, phân quyền, dọn dữ liệu và fallback. |
| 9. Học theo tiến trình | Chọn môn, học lần lượt 8 chương theo đề cương chuẩn. Mỗi bài có mục tiêu, bài giảng đã duyệt kèm trích dẫn và bài kiểm tra chấm ở máy chủ; đạt 70% mở bài tiếp theo. Bài chưa có bài giảng cho phép nhờ trợ giảng giảng rồi tự đánh dấu đã học. |
| 10. Tự học | Có kế hoạch theo chủ đề, mục tiêu, nguồn và lịch. Người học tự viết ghi chú, tóm tắt và thẻ, làm câu hỏi mẫu theo môn và ghi tự đánh giá. Trợ giảng dùng tài liệu đã chọn. |

Mở **Kế hoạch** trong góc học tập, chọn phương thức rồi bấm **Tạo kế hoạch** (hoặc chọn một mẫu bắt đầu nhanh). Trình tạo gồm ba bước: môn và chủ đề, mục tiêu và nhịp học, tài liệu nguồn. Sau khi tạo, chỉnh tiếp và bấm **Lưu kế hoạch** để đồng bộ. Danh sách hiện tiến độ và ngày ôn; kế hoạch quá hạn hoặc đến hạn ôn hôm nay được đưa lên đầu. Có thể xóa kế hoạch đã lưu. Có thể dán liên kết chi tiết hoặc đoạn nguồn từ trích dẫn vào ghi chú. Ngày ôn lưu trong kế hoạch. Nội dung ba bài của mỗi môn và câu hỏi là bộ mẫu cố định. Nhắc lịch tự động và tạo đề theo chủ đề tùy ý là phần mở rộng.

Cần áp dụng migration `202611120001_learning_plans.sql` và `202611270001_learning_plans_delete.sql` vào đúng Supabase project trước khi dùng. RLS giới hạn đọc, ghi và xóa theo tài khoản. Revision giúp phát hiện hai tab ghi đè cùng một kế hoạch.

## Lộ trình theo chương

Tab **Học theo tiến trình** mở lộ trình môn học: chọn môn, xem 8 chương và các bài, bấm **Học tiếp** để vào bài đang dở. Bài sau chỉ mở khi mọi bài trước đã qua. Đề cương (tên chương, bài và mục tiêu) nằm trong [`course.ts`](../apps/web/src/core/course.ts); mã bài có dạng `calculus.c3.l1` và không nên đổi sau khi đã có tiến độ.

Nội dung bài giảng do người có vai trò `content_manager` hoặc `admin` soạn tại `/admin/course` (menu tài khoản, mục **Soạn lộ trình học**):

1. Chọn bài, bấm **Tạo nháp bằng AI**. Trang gửi yêu cầu qua hội thoại tạm ở chế độ kho chung theo môn, nên cần worker đang chạy và giáo trình đã công bố trong kho chung để có trích dẫn.
2. Bản nháp được tách thành bài giảng Markdown và tối đa 10 câu trắc nghiệm. Người soạn sửa nội dung, đáp án và giải thích.
3. **Công bố** để người học thấy; **Gỡ công bố và lưu nháp** để ẩn lại. Nguồn trích dẫn chỉ được trỏ tới tài liệu đã công bố.

Người học không đọc được đáp án: RPC `app_course_lesson` bỏ đáp án, còn `app_submit_lesson_quiz` chấm và ghi tiến độ vào `course_progress` (RLS chỉ cho đọc tiến độ của chính mình, không ghi trực tiếp). Cần áp dụng migration `202611280001_course_lessons.sql`.
