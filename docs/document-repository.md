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

## Cài đặt

1. Áp dụng `202610300001_document_repository.sql` sau các migration hiện có.
   Local dùng `npx supabase migration up --local`; cloud đã link dùng
   `npx supabase db push --dry-run` rồi `npx supabase db push`.
2. Cập nhật và khởi động lại worker cùng phiên bản, sau đó deploy web. Worker
   cũ chỉ hỗ trợ tài liệu riêng nên không xử lý được nguồn chung.
3. Tải một tài liệu qua **Tài liệu của tôi**, chờ worker xử lý thành `ready`.
   Chỉ công bố nội dung phù hợp để chia sẻ cho mọi người dùng đã đăng nhập.
4. Quản trị viên dùng SQL Editor của Supabase để xem ID và công bố rõ ràng:

```sql
-- Chỉ thực hiện trong phiên quản trị database.
select id, name, subject, status from public.documents
where status='ready' order by created_at desc;

insert into public.knowledge_documents(document_id, description)
values ('<document-uuid>', 'Mô tả nguồn kiến thức dùng cho RAG')
on conflict (document_id) do update set description=excluded.description;
```

Không cho client tự công bố qua API hoặc sửa bảng registry. Kho chung khởi
đầu trống cho đến khi có nguồn được công bố; migration không chia sẻ tài liệu
cá nhân hiện có. Không seed bản ghi `ready` khi chưa thực sự xử lý file.

Ngừng công bố bằng SQL quản trị:

```sql
delete from public.knowledge_documents where document_id='<document-uuid>';
```

Các lần đọc, ký URL mới và tác vụ RAG tiếp theo bị chặn sau khi thu hồi.
Signed URL đã cấp trước đó có thể còn dùng được đến hết hạn 120 giây.
Ngừng công bố không xóa tệp gốc của chủ sở hữu hoặc lịch sử hội thoại.

## Quyền dữ liệu và worker

`documents` giữ RLS riêng tư. Registry `knowledge_documents` chỉ được ghi bởi
quản trị viên/service role. RPC trả metadata cần hiển thị, không trả owner ID,
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

## Bằng chứng kiểm tra ngày 2026-10-30

- Web: 62 test pass; database/RLS: 37 test pass; TypeScript và production build pass.
- Worker: 62 test pass, Ruff pass, gồm Qdrant in-memory kiểm tra bộ lọc nhiều
  chủ sở hữu và hủy job khi nguồn bị thu hồi/sai phiên bản.
- Migration đã áp dụng Supabase local, giữ dữ liệu hiện có. HTTP/API local với
  hai tài khoản và PDF tạm xác nhận tách hai kho, mở đoạn trích dẫn, ký file chung,
  chặn file cá nhân khác và thu hồi quyền. Dữ liệu thử đã tự dọn.
- Chưa deploy/migrate production, chưa chạy inference AI/GPU hoặc kiểm tra
  trực quan bằng browser automation trong phiên này.
