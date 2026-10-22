# Giao diện API và dữ liệu

## Quyền truy cập

API dùng cookie Supabase SSR, xác minh người dùng bằng `getUser()`. Mọi mutation giới hạn trong RPC `security definer` có `search_path` rỗng, lấy chủ sở hữu từ `auth.uid()`. Trình duyệt chỉ có SELECT qua RLS; không thể ghi trực tiếp `messages`, `jobs`, chunks hoặc nhận việc từ queue. Các RPC nội bộ bị revoke quyền PUBLIC/anon/authenticated.

Storage private. API dùng service-role key để cấp upload token sau RPC kiểm tra quota. Upload không cho ghi đè; complete kiểm tra dung lượng/MIME trong Storage, worker kiểm tra chữ ký và nội dung thực tế. Biết tên file hoặc UUID không đủ để lấy nguồn của người khác.

Worker dùng kết nối PostgreSQL đặc quyền để nhận queue; mọi truy vấn tài liệu và Qdrant đều ràng buộc chủ sở hữu. Payload Qdrant là locator, không phải nguồn tin cậy: worker đọc lại chunk và quyền từ PostgreSQL trước khi dùng. Không có Qdrant key ở trình duyệt.

## API

Tất cả các endpoint dưới đây yêu cầu đăng nhập. Body JSON, tối đa 16.000 byte được đọc ở API; file đi trực tiếp lên Storage.

| Method và đường dẫn | Body / kết quả |
|---|---|
| POST `/api/profile` | `{username}` -> username duy nhất của chủ phiên đăng nhập; HTTP 409 nếu trùng |
| GET `/api/status` | `{online, activeChat: {id, conversation_id} \| null}` |
| GET `/api/streak` | Chuỗi hiện tại, kỷ lục, tổng ngày học và lịch 7 ngày của chủ phiên đăng nhập |
| POST `/api/documents/upload-intent` | `{name, size, subject, key}` -> `{document, upload: {path,token,signedUrl} \| null}` |
| POST `/api/documents/:id/complete` | `{key}` -> job, HTTP 202 |
| POST `/api/documents/:id/retry` | `{key}` -> job, HTTP 202 |
| DELETE `/api/documents/:id` | `{key}` -> cleanup job, HTTP 202 |
| GET `/api/documents` | Danh sách tài liệu chưa deleted của người dùng |
| POST `/api/conversations` | `{key}` -> `{id}`; key đồng thời là conversation UUID |
| GET `/api/conversations` | 100 hội thoại mới nhất |
| GET `/api/conversations/:id/messages` | Messages theo sequence, kèm `message_sources` đã hoàn tất |
| POST `/api/conversations/:id/messages` | `{question, documentIds, key}` -> job, HTTP 202 |
| GET `/api/jobs/:id` | Status, attempts, timestamps, error an toàn để hiển thị |
| GET `/api/sources/:id` | `{available,content,url,...metadata}`; PDF URL có hiệu lực 120 giây |

`key` là UUID idempotency: giữ nguyên khi thử lại cùng yêu cầu, đổi khi nội dung thay đổi. API trả `{error: string}` và mã HTTP 400/401/403/404/409/413/429/503 phù hợp. Các lỗi dịch vụ nội bộ trả thông báo chung.

Môn học: `calculus`, `linear-algebra`, `physics`. Hỏi tối đa 2.000 ký tự, chọn 1–5 document UUID riêng biệt. API không nhận user ID từ client.

## Trạng thái và tính nhất quán

[Streak](streaks.md) được ghi trong transaction hoàn tất job chat có nguồn bằng
trigger PostgreSQL; ngày theo `Asia/Ho_Chi_Minh`, khóa duy nhất theo user/ngày.
Client chỉ đọc qua RLS/RPC, không được tự cộng ngày hoặc gửi đồng hồ để tính chuỗi.

- Tài liệu: `uploading -> queued -> processing -> ready`, lỗi sang `failed`; retry tăng `index_version`. Xóa chuyển ngay sang `deleting`, sau cleanup mới `deleted`.
- Job: `queued -> running -> completed/failed`; lỗi tạm thời quay về `queued`, tối đa 3 lượt xử lý. Queue và bản ghi job được tạo trong một transaction.
- Message assistant: `queued -> generating -> completed`; lỗi tạm thời `interrupted`, lỗi kết thúc `failed`. Lượt retry làm trống nội dung cũ, không nối hai câu trả lời.
- Session advisory lock cho phép một consumer AI trên toàn database; token lease ngăn lượt cũ ghi sau khi job được nhận lại. Heartbeat gia hạn lease mỗi 15 giây.
- Vector ID là UUID ổn định theo document/version/ordinal. Upsert và cleanup có thể chạy lại. Partial vectors không được dùng nếu tài liệu chưa ready hoặc không còn đúng index version.
- Khi publish chunk/câu trả lời, worker khóa job và tài liệu trong transaction, kiểm tra lại phiên bản/trạng thái. Xóa không thể bị một job cũ ghi đè thành ready.
- Xóa vật lý file/chunk/vector là eventual consistency; document `deleting` đã bị loại khỏi quyền đọc nguồn và retrieval. URL đọc đã cấp trước đó vẫn có thể dùng đến khi hết hạn hoặc file bị xóa.
- Giữ tombstone tài liệu và metadata trích dẫn để lịch sử báo nguồn đã mất; không giữ nội dung chunk sau cleanup.
- Signed upload URL của Storage có thể sống lâu hơn yêu cầu xóa. API chỉ cấp lại trong giờ đầu; worker quét lại file của tombstone đến hết thời hạn token và thực hiện một lượt dọn cuối sau đó, kể cả khi worker từng offline.

Không coi PGMQ là exactly-once cho toàn bộ side effect. Worker xử lý theo hướng có thể nhận lại, kết hợp idempotency, visibility timeout và kiểm tra trước khi publish.

## RAG

Chia tối đa khoảng 500 token Qwen/tokenizer với overlap 80; giữ biên trang PDF và vị trí đoạn DOCX. Dense embedding BGE-M3 1024 chiều, cosine. Query lấy top 8 với bộ lọc user/document/version; loại trùng, chọn tối đa 5 đoạn trong ngân sách đầu vào 2.900 token, dành chỗ cho chat template và tối đa 768 token đầu ra.

Lịch sử dùng tối đa 6 message hoàn tất, giới hạn 450 token; một phần câu hỏi trước được thêm vào truy vấn embedding cho câu hỏi tiếp nối. Chưa có query rewriting hoặc hybrid search trong MVP.

Backend tùy chọn `AI_PROVIDER=openrouter` gọi NVIDIA free cho cả embedding và chat,
thêm rerank khi có `RERANK_MODEL`. Worker chỉ cần CPU để parse/chia đoạn/điều phối;
vẫn dùng hàng đợi và session lock. Kích thước embedding được phát hiện từ API,
collection tách theo model/chiều và tài liệu lưu embedding profile cùng collection.
Chat từ chối profile cũ; cleanup dùng namespace đã lưu với bộ lọc owner/document.
Rerank diễn ra sau khi xác thực candidate từ PostgreSQL, chỉ sắp xếp canonical rows.
Nguồn trả về bởi provider không được tin cậy. Xem [cấu hình, giới hạn và dữ liệu gửi đi](openrouter.md).

`AI_PROVIDER=ollama` kết hợp `CHAT_FALLBACK_PROVIDER=openrouter` giữ nguyên BGE,
collection và profile embedding. Worker thử local cho từng câu hỏi, chỉ khởi tạo
client OpenRouter khi sinh câu trả lời thất bại; không probe embedding API/rerank.
Nếu luồng local đã có token, callback kiểm tra lại lease/tài liệu và xóa partial
trước khi gọi API. Lưu `messages.generation_provider` khi hoàn tất; reset ở retry.
Mất worker hoặc BGE không thuộc phạm vi chat fallback. Xem [cấu hình fallback](chat-fallback.md).

Các nguồn được đặt nhãn S1–S5. Nguồn bịa hoặc không có trích dẫn hợp lệ sẽ chuyển câu trả lời về thông báo thiếu bằng chứng. Việc nhãn tồn tại không chứng minh suy luận đúng; đánh giá thủ công kiểm tra nội dung và sự hỗ trợ của nguồn.
