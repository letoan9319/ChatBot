# Bố cục góc học tập

Dashboard mặc định mở trang Tổng quan học tập, gồm bốn thẻ dùng dữ liệu thật:
chuỗi ngày học, tổng ngày học, số tài liệu sẵn sàng và số phiên đã lưu. Có tìm
kiếm tài liệu/phiên theo tên, lọc tài liệu theo môn học và mở phiên gần đây.
Thẻ không tự tạo XP, độ chính xác hay dữ liệu tiến độ ngoài các số liệu đã có.

Menu bên trái có Tổng quan, Học tập, Tài liệu, Lịch sử và Nhóm học; có nút tạo
cuộc trò chuyện mới, tìm tên phiên và mở nhanh các hội thoại gần đây. Cài đặt
ở cuối menu. Trên điện thoại, Lịch sử mở qua Thư viện, năm mục còn lại nằm ở
thanh dưới cùng. Thanh trên chứa tiêu đề trang, trạng thái AI, chuỗi ngày học,
thông báo, chuyển sáng/tối và tài khoản ở góc trên bên phải. Chi tiết trạng thái, cấu hình
OpenRouter, lịch streak và đăng xuất mở từ các nút tương ứng; Escape hoặc bấm
ra ngoài đóng phần chi tiết.

Hội thoại dùng một cột nội dung ở giữa, lời nhắn người dùng nằm bên phải, lời
giải có trích dẫn và nút sao chép. Ô nhập bo tròn nằm cuối khung, có nút chọn
tài liệu và gửi câu hỏi. Không hiển thị sidebar tài liệu rỗng cạnh mọi phiên;
thư viện mở khi người dùng yêu cầu. Nút “Phiên mới” luôn khởi tạo hội thoại mới.

Mục Kho tài liệu có hai tab: Tài liệu chung dùng cho RAG và Tài liệu của tôi cho
file cá nhân. Tìm theo tên/môn không phân biệt dấu, lọc môn/trạng thái, sắp xếp
và mở tệp gốc. Upload, thử lại và xóa nằm trong tab cá nhân. Lịch sử mở riêng từ
sidebar hoặc nút Lịch sử trong kho trên mobile. Giới hạn file và chọn tối đa
5 tài liệu giữ nguyên. [Chi tiết kho và quyền truy cập](document-repository.md).

Trích dẫn dẫn đến trang chi tiết trong kho, hiển thị đúng đoạn nguồn và nút mở
PDF tại trang tương ứng. Nút Nguồn vẫn mở phần đối chiếu cạnh chat. Trên màn hình rộng
hơn 1100 px, nguồn nằm cạnh hội thoại; từ 761–1100 px, nguồn dùng vùng nội dung
chính và có nút Đóng để trở lại hội thoại. Từ 760 px trở xuống, mục Học tập chỉ
hiện hội thoại hoặc nguồn; tài liệu và lịch sử có khu vực riêng từ menu chính.

Khung ứng dụng dùng chiều cao viewport và các phần chứa có `min-height: 0`.
Chỉ danh sách dài và nội dung hội thoại/nguồn có vùng cuộn. Ô nhập nằm ngoài
vùng cuộn của hội thoại, tự tăng chiều cao tối đa 104 px. Trang Tổng quan dùng
một vùng cuộn chung cho thống kê và nội dung gần đây. Enter gửi câu hỏi,
Shift + Enter xuống dòng; thao tác gõ bằng bộ nhập tiếng Việt không bị gửi sớm.
Khi người dùng cuộn lên đọc, câu trả lời đang sinh không kéo họ về cuối trang.

Các mốc nên kiểm tra trực quan khi đổi bố cục: 1366×768, 1024×768, 390×844,
và màn hình thấp hoặc bàn phím di động đang mở. Kiểm tra cả hai theme, tên file
dài, 20 tài liệu, nhiều phiên học, câu trả lời dài và nguồn đã bị xóa.

Bộ chọn môn học dùng chung `SelectField` cho bộ lọc tổng quan và tải tài liệu.
Menu dùng màu của theme và được đưa ra ngoài vùng cuộn để không bị cắt. Có hỗ
trợ mũi tên, Home/End, gõ chữ tìm nhanh, Enter/Space, Tab và Escape; focus luôn
ở nút chọn khi di chuyển giữa các mục, mục được chọn có trạng thái ARIA riêng.

Chữ tĩnh dùng con trỏ chuột thông thường; nhãn điều hướng, thống kê và lịch streak
không cho chọn chữ bằng CSS. Không xóa hoặc thay đổi `Selection` của trình duyệt
trong trình xử lý nhấp chuột. Lời giải, đoạn nguồn và ô nhập vẫn cho chọn/sao chép
nội dung. Các ô ngày trong lịch streak chỉ hiển thị trạng thái, không chọn ngày
hoặc gửi yêu cầu tới server khi nhấp.

## Cài đặt

- Giao diện: sáng, tối hoặc tự thay đổi theo thiết bị; đồng bộ với nút sáng/tối trên thanh trên.
- Cỡ chữ lời giải: tiêu chuẩn hoặc lớn hơn, áp dụng cho hội thoại và đoạn nguồn.
- Phím gửi: Enter để gửi và Shift + Enter xuống dòng; khi tắt, dùng Ctrl/Command + Enter để gửi.
- Tự cuộn: theo phần trả lời mới khi đang ở cuối hội thoại. Luôn giữ vị trí khi người dùng cuộn lên đọc.
- Khôi phục mặc định: giao diện theo thiết bị, cỡ chữ tiêu chuẩn, bật gửi bằng Enter và tự cuộn.

Cài đặt học tập lưu bằng `learnstep-study-preferences-v1` trong localStorage;
theme giữ khóa `learnstep-theme`. Chỉ chấp nhận các enum/boolean hỗ trợ khi đọc
dữ liệu đã lưu. Dữ liệu hỏng trở về mặc định; nếu không ghi được localStorage,
cài đặt vẫn áp dụng ở tab hiện tại và giao diện thông báo đúng trạng thái này.
Thay đổi đồng bộ giữa các tab cùng trình duyệt, không có thay đổi schema hoặc
quyền truy cập dữ liệu người dùng.
