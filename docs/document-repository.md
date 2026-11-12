# Kho tài liệu

Một mục **Kho tài liệu** trong sidebar, gồm đúng hai tab:

- **Tài liệu chung**: các nguồn RAG đã được quản trị viên công bố sau khi index.
  Mọi tài khoản đã đăng nhập có thể xem, mở tệp và chọn để hỏi đáp.
- **Tài liệu của tôi**: tài liệu người dùng tải lên, trạng thái xử lý, thử lại
  và xóa. Chỉ chủ tài khoản được quản lý. Không tự đưa tài liệu cá nhân vào kho chung.

Hai tab có tìm kiếm tên/môn không phân biệt dấu tiếng Việt, lọc môn và trạng
thái, sắp xếp theo tên hoặc thời gian. Có thể chọn tối đa 5 nguồn cho một câu
hỏi, gồm nguồn chung hoặc nguồn riêng đã sẵn sàng. Lọc danh sách không bỏ các
lựa chọn ở tab còn lại. File gốc không đi qua Vercel Functions.

## Trang tài liệu và trích dẫn

Mỗi tài liệu có URL `/study/documents/<id>`. Trích dẫn trong câu trả lời dẫn
đến URL này kèm `chunk=<id>`; đoạn nguồn được kiểm tra thuộc đúng tài liệu và
phiên bản index hiện tại. PDF mở đúng trang, DOCX hiển thị mục/đoạn thực.
Đoạn cũ không còn ở phiên bản hiện tại được báo không khả dụng, không thay
bằng một đoạn khác. Nút trở lại hội thoại giữ ID phiên qua tham số đã kiểm tra.

File gốc mở qua `/api/documents/<id>/file`, kiểm tra quyền lại rồi chuyển đến
signed URL Supabase có hạn 120 giây. DOCX được tải xuống, PDF mở trong tab mới.
Phản hồi API và redirect dùng `Cache-Control: private, no-store`.

## Quản lý kho chung

Áp dụng các migration theo [hướng dẫn triển khai](deployment.md). Sau khi
áp dụng `20261112150505_content_management.sql`, lấy **User UID** của tài khoản
LearnStep đã đăng ký trong **Supabase → Authentication → Users**. Người vận hành
cấp quyền bằng SQL Editor trên đúng project.

```sql
insert into public.user_roles (user_id, role)
values ('<user-uid>', 'content_manager')
on conflict (user_id, role) do nothing;
```

Đăng nhập LearnStep bằng email và mật khẩu như bình thường, vào góc học tập và
mở menu tài khoản ở góc trên bên phải. Chọn **Quản lý tài liệu chung** để mở
`/admin/knowledge`.

- **Công bố** một tài liệu do chính bạn tải lên và đã xử lý xong. Mở tên tài liệu
  để xem trước, thêm mô tả nếu cần và xác nhận. Mọi tài khoản đã đăng nhập có thể
  đọc và dùng tài liệu đó làm nguồn RAG.
- **Thu hồi** bất kỳ tài liệu đang công bố trong kho chung. Tệp gốc vẫn thuộc về
  người tải lên. Các lần đọc mới từ kho chung và tác vụ RAG dùng nguồn chung
  bị chặn sau khi thu hồi. URL đọc đã cấp vẫn có thể hoạt động tới khi hết hạn.

Thao tác công bố và thu hồi trong LearnStep ghi UID người thực hiện, ID tài
liệu, loại thao tác và thời điểm vào `app_private.knowledge_document_audit`.

Để thu hồi quyền quản lý của một tài khoản, dùng SQL Editor.

```sql
delete from public.user_roles
where user_id = '<user-uid>' and role = 'content_manager';
```

## Quyền dữ liệu và worker

`documents` giữ RLS riêng tư. Người quản lý cập nhật `knowledge_documents`
qua RPC kiểm tra vai trò và quyền sở hữu khi công bố. Tài khoản đăng ký mới
chưa được cấp vai trò nào và client không có quyền ghi trực tiếp vào bảng
vai trò hoặc bảng công bố. RPC đọc kho chung trả metadata cần hiển thị, không trả owner ID,
upload key hay đường dẫn storage trong danh mục/chi tiết.

RLS trên chunks và Storage cho phép chủ sở hữu hoặc người đọc tài liệu đã công
bố và đang `ready`, đúng phiên bản hiện tại. API dùng session, không dùng service
role để ký URL đọc. Phân quyền nhóm học không thay đổi quyền tài liệu.

RPC enqueue lưu ánh xạ document/owner/version vào job. Qdrant tiếp tục giữ tenant
của người đã index, truy vấn từng bộ owner + document + version được phép, không
dùng danh sách owner/document rời nhau. Worker kiểm tra lại publication, quyền,
phiên bản và embedding profile trước truy xuất, trước lưu nội dung và trước khi
hoàn tất. Thu hồi/công bố khóa cùng hàng document với bước enqueue/finalize.
Không cần đổi collection hoặc index lại chỉ vì công bố; vẫn cần index lại khi
đổi embedding model/profile.

Các ca kiểm thử quyền công bố và truy cập nguồn nằm trong
[`tests/community-database.test.mjs`](../tests/community-database.test.mjs).
