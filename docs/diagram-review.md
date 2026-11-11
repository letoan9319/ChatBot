# Rà soát mô hình LearnStep — 30/10/2026

## Phạm vi và kết luận

Bộ sơ đồ cũ có lỗi nội dung và ký pháp, không chỉ thiếu một đường nối. Bản mới
dùng nguồn PlantUML, nền trắng, không header/footer. [Danh mục 24 sơ đồ](diagrams/README.md)
được đối chiếu với API, giao diện, worker và bảy migration trong repository.
Đây là tài liệu về hiện trạng mã nguồn; chưa phải nghiệm thu deployment cloud.

Không có một loại hình duy nhất gọi là sơ đồ chuẩn công nghệ phần mềm. UML
mô tả mục tiêu, cấu trúc và hành vi; ERD mô tả dữ liệu quan hệ; C4 hướng dẫn
tách mức kiến trúc. Chọn một góc nhìn cho mỗi hình và giải thích loại quan hệ
là điều kiện để đọc đúng. Căn cứ chính là [OMG UML 2.5.1](https://www.omg.org/spec/UML/2.5.1),
[C4: container](https://c4model.com/diagrams/container) và
[C4: deployment](https://c4model.com/diagrams/deployment).
Bộ này dùng UML và ERD; không gắn nhãn C4 cho một sơ đồ UML.

## Các lỗi đã sửa

| Hình cũ | Vấn đề | Cách sửa |
|---|---|---|
| Use case | “Quản lý username” gợi ý sửa/quản trị tên, trong khi RPC chỉ thiết lập lần đầu | Biểu diễn mục tiêu “Hoàn tất hồ sơ ban đầu”; username là bước trong kịch bản |
| Use case | Gộp đăng ký với đăng nhập, thông báo với streak, tham gia với trao đổi nhóm | Tách mục tiêu có điều kiện và kết quả khác nhau; thêm bản chi tiết kho tài liệu và cộng đồng |
| Use case | Đưa “Kiểm tra quyền nguồn” thành chức năng người học qua include | Chuyển kiểm tra quyền sang sequence/activity, như ràng buộc thực hiện |
| Use case | Hiển thị quản trị công bố nguồn trong phạm vi web gây hiểu là có UI/API admin | Chuyển sang sequence vận hành SQL đặc quyền; web chưa cung cấp chức năng admin này |
| Use case | Association dùng các đoạn đường gộp thủ công, dễ hở và khó xác định actor | Khai báo từng association giữa actor và use case trong PlantUML |
| Deployment | Trộn Git/CI với môi trường chạy; Storage dùng ký hiệu database; nhãn cloud tùy ý | Tách node, artifact, PostgREST, PostgreSQL/PGMQ và Storage; ghi giao thức cho kết nối. CI được đọc từ workflows, không phải runtime dependency |
| Component | Supabase là một hộp chứa cả DB/Auth/Storage/Queue; lẫn module client và dịch vụ | Tách nhóm Next.js, worker và external services; dependency từ bên sử dụng tới bên được dùng |
| ERD ảnh | Thiếu nhiều bảng/FK, khóa ghép và nullable; ảnh và Mermaid khác nhau | Sinh bốn ERD từ migration, bao phủ 14 bảng public và 24 FK, dùng tên schema thật |
| ERD Mermaid | Nét liền dùng cho hầu hết FK dù không tham gia định danh con | Theo quy ước physical ERD của bộ này: FK thuộc PK con dùng identifying; còn lại non-identifying |
| Upload sequence | Supabase gộp nhiều participant; thiếu phản hồi signed URL từ Storage và tách metadata check | Tách Storage với PostgreSQL/PGMQ, có return, nhánh metadata lỗi và transaction enqueue |
| RAG sequence | Thiếu phản hồi embedding, thiếu nhánh không có nguồn; polling vẽ sau hoàn tất dễ hiểu sai | Thêm return, alt/opt/loop/par; canonical chunks, partial write, finalize và polling độc lập |
| State machine | Thiếu processing→queued khi lỗi tạm, nhiều đường DELETE bị giấu trong chú thích | Vẽ đường chuyển trực tiếp; deleted còn tombstone/sweep nên không kết thúc bằng final node |
| Activity | Hai nhánh đổ trực tiếp vào action không có merge; đọc file dẫn thẳng tới citation | Dùng decision/merge, tách đọc và hỏi đáp, thêm lỗi quyền/version; không tự sinh citation khi chỉ đọc |
| Object | Flowchart hộp mang tên instance nhưng chưa dùng ký pháp InstanceSpecification | Dùng object diagram, gạch chân tên instance:classifier, slots có giá trị và link nét liền |
| Storage | Locator từ PostgreSQL sang Qdrant/Storage có thể bị hiểu như FK hoặc luồng tự đồng bộ | Tách bản đồ lưu trữ; dependency chấm thể hiện locator logic, worker chịu trách nhiệm ghi và xác minh |
| Provider | Chỉ diễn tả local + chat fallback, bỏ chế độ OpenRouter đầy đủ | Thêm activity ba chế độ theo Settings/create_models; rerank chỉ ở OpenRouter có cấu hình |

Việc coi kiểm tra quyền là xử lý nội bộ và chọn mức mục tiêu ở use case tổng
quan là quyết định mô hình hóa dựa trên mã nguồn, không phải quy định UML cấm
mọi use case bảo mật. Trong bộ này không có nhu cầu tách nó thành mục tiêu
riêng nên không thêm include/extend cho đủ ký hiệu.

## Quy tắc ký pháp đã dùng

- **Use case:** actor ở ngoài subject; ellipse chứa mục tiêu; nét liền actor–use
  case là association, không chỉ thứ tự hay luồng dữ liệu. Bản hiện hành dùng
  mũi tên nét liền actor→use case theo yêu cầu trình bày của người dùng; không
  khẳng định UML yêu cầu mọi association phải có mũi tên. Include chèn hành vi
  được tái sử dụng và bắt buộc; extend bổ sung theo điều kiện vào use case cơ sở.
  Không suy ra include chỉ vì hai chức năng thường được dùng liên tiếp.
  [PlantUML use case](https://plantuml.com/use-case-diagram) và
  [OMG: Include](https://www.omg.org/spec/UML/ISO/19505-2/PDF).
- **Deployment/component:** node mô tả nơi chạy, artifact là phần mềm triển
  khai; dependency mô tả bên sử dụng phụ thuộc bên cung cấp, không phải đồng
  nghĩa một chuỗi gọi runtime. Không khẳng định những module hiện tại là các
  microservice triển khai riêng. [C4 deployment](https://c4model.com/diagrams/deployment),
  [PlantUML component](https://plantuml.com/component-diagram).
- **ERD:** cardinality ở mỗi đầu nói mỗi instance có thể liên quan bao nhiêu
  instance đầu kia. NOT NULL và PK/unique quyết định tính bắt buộc và giới hạn
  theo schema. Ký pháp này không biểu diễn RLS. [PlantUML Information Engineering](https://plantuml.com/ie-diagram),
  [Mermaid cardinality/identification](https://mermaid.js.org/syntax/entityRelationshipDiagram.html).
- **Sequence/activity/state:** thời gian đi xuống trong sequence; alt/opt/loop/par
  có guard hoặc phạm vi rõ; activity có decision/merge; state giữ nguyên trạng
  thái trong SQL, transition ghi sự kiện/điều kiện/tác động cần thiết.
  [Sequence](https://plantuml.com/sequence-diagram),
  [Activity](https://plantuml.com/activity-diagram-beta),
  [State](https://plantuml.com/state-diagram).
- **Object:** snapshot gồm instance, slot có giá trị, link giữa instance; không
  phải ERD và không chứng minh có object database. Tên instance:classifier
  gạch chân theo OMG §9.8.4. [OMG UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/PDF),
  [PlantUML object](https://plantuml.com/object-diagram).

## Bằng chứng chức năng trong repository

| Chức năng / ràng buộc | Nguồn kiểm tra |
|---|---|
| Đăng ký, đăng nhập, khôi phục/đặt mật khẩu, đăng xuất | [auth-form.tsx](../apps/web/src/components/auth-form.tsx), [study-workspace.tsx](../apps/web/src/components/study-workspace.tsx) |
| Hồ sơ ban đầu: một username/tài khoản, không thay thế tên đã tồn tại | [app_set_username](../supabase/migrations/202610220002_profiles.sql), [username-setup.tsx](../apps/web/src/components/username-setup.tsx) |
| Upload, complete, retry, delete; signed URL và response 202 | [API route](../apps/web/src/app/api/%5B%5B...path%5D%5D/route.ts), [initial migration](../supabase/migrations/202610220001_initial.sql) |
| Nguồn chung không tự chia sẻ file riêng; đọc file phải có quyền và ready | [document repository migration](../supabase/migrations/202610300001_document_repository.sql) |
| Parse/chunk, vector namespace, SQL canonical chunks, retry/lease/finalize | [main.py](../services/worker/src/study_worker/main.py), [documents.py](../services/worker/src/study_worker/documents.py), [models.py](../services/worker/src/study_worker/models.py) |
| Ngân sách context, thiếu nguồn, kiểm tra nhãn trích dẫn | [rag.py](../services/worker/src/study_worker/rag.py) |
| Provider/fallback/rerank theo cấu hình | [config.py](../services/worker/src/study_worker/config.py), [fallback.py](../services/worker/src/study_worker/fallback.py), [openrouter.py](../services/worker/src/study_worker/openrouter.py) |
| Nhóm, thành viên, tin nhắn và thông báo | [community migration](../supabase/migrations/202610290001_community.sql) |
| Ghi ngày học server-side khi hoàn tất chat có nguồn | [streak migration](../supabase/migrations/202610220005_study_streaks.sql), [bản cập nhật nguồn chung](../supabase/migrations/202610300001_document_repository.sql) |
| Cài đặt trải nghiệm lưu trên thiết bị | [study-preferences.ts](../apps/web/src/core/study-preferences.ts), [study-settings.tsx](../apps/web/src/components/study-settings.tsx) |
| Session pooler, một consumer AI và không mở endpoint inbound cho laptop | [deployment.md](deployment.md), [serve/claim/Heartbeat](../services/worker/src/study_worker/main.py) |

## Những điều ERD không thay thế được

1. FK chỉ kiểm tra tham chiếu; không tự kiểm tra owner hội thoại giống owner
   message. Quyền được thực thi thêm qua RLS, RPC, worker và transaction.
2. message_sources.user_id là chủ hội thoại. Với tài liệu chung, chủ chunk và
   chủ file có thể là người khác. Nguồn đã thu hồi không cấp quyền đọc mới.
3. Tài liệu chọn cho câu hỏi được lưu ở jobs.payload gồm document_ids, owners,
   versions. Chưa có bảng nối job_documents với FK; không vẽ một bảng giả.
4. Các unique ghép: documents(user_id, upload_key), chunks(document_id,
   index_version, ordinal), sources(message_id, label), jobs(user_id, kind,
   request_key), groups(owner_id, create_key), group_messages(user_id, key),
   notifications(user_id, event_key). PK ghép có ở group_members và activity_days.
5. Partial unique index giới hạn một chat job queued/running mỗi user. Quota,
   giới hạn thành viên, trạng thái ready khi công bố và quyền gửi tin nhóm
   còn cần logic RPC/trigger; không suy ra từ cardinality ERD.
6. Vector và object không nằm trong transaction PostgreSQL; cleanup là eventual
   consistency. Idempotency, version và lease tránh publish kết quả stale;
   không có cam kết exactly-once cho toàn bộ side effect.

## Giới hạn và điểm cần xem lại khi mở rộng

Giữ kiến trúc hiện tại để phản ánh mã: một Next.js application và worker Python
dùng queue, không thêm FastAPI, RabbitMQ hay object database. Dùng một consumer
giảm tranh chấp GPU và đơn giản hóa khóa, nhưng giới hạn throughput và phụ thuộc
máy worker. Cloud web vẫn đọc lịch sử được khi worker offline; AI cần worker.

Khi cần nhiều worker, phải thiết kế lại khóa/điều phối tài nguyên trước khi vẽ
scale-out. Khi cần admin web, chuyển chủ nhóm, xóa nhóm hoặc đổi username, cần
đặc tả quyền và triển khai chức năng trước khi thêm vào use case hiện trạng.
Các sequence upload/RAG là kịch bản chính có các nhánh đã nêu, không liệt kê
mọi mã lỗi HTTP hoặc tất cả retry của provider; xem main.fail và policy API.

## Use case được tách theo từng chức năng

Theo yêu cầu mới, hình tổng quan và hai hình gộp được chuyển vào archive.
[Bộ use case hiện hành](diagrams/use-cases.md) gồm 10 hình và 64 mục tiêu/thao
tác có mã định danh. Chín hình mô tả chức năng người dùng; hình còn lại mô tả
vận hành SQL đặc quyền. Các precondition, giới hạn trạng thái và nguồn đối
chiếu được ghi cho từng hình. Actor thành viên/chủ nhóm dùng generalization;
chỉ actor thành viên không phải chủ nhóm liên kết với Rời nhóm. Đã bổ sung
mũi tên cho 64 association actor→use case; giữ nguyên chiều extend và
generalization, không đổi chúng thành cùng một loại mũi tên.

## Kiểm tra bản xuất

- PlantUML 1.2026.9 render thành công 24 nguồn sang SVG; PNG được xuất lại bằng Resvg.
- ERD được kiểm tra bao phủ 14 bảng public và 24 khai báo FK trong migration.
- Đã xem ảnh tổng thể và các ảnh chi tiết để kiểm tra nhãn, đường nối, guard,
  nền trắng, instance gạch chân và không có header/footer.
- Không thay đổi web/worker/schema trong lần rà soát này; không chạy lại các
  suite ứng dụng hoặc suy ra chất lượng nghiệp vụ từ việc render thành công.
