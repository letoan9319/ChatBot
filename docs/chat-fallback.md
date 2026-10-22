# Ollama chính, OpenRouter dự phòng cho câu trả lời

Chế độ này giữ BGE-M3 trên Ollama để index tài liệu và truy vấn Qdrant. Chỉ khi
Qwen không có, không nạp được, lỗi kết nối, timeout, trả nội dung rỗng hoặc luồng
bị ngắt, worker mới gọi model chat NVIDIA miễn phí qua OpenRouter.

Không gọi NVIDIA embedding hoặc rerank trong chế độ này. Không gọi API OpenRouter
khi model chính trả lời thành công, kể cả lúc worker khởi động. Không tự chuyển
sang API vì thiếu bằng chứng hoặc vì câu trả lời không đạt kiểm tra trích dẫn.

## Cài đặt

1. Áp dụng các migration còn thiếu theo thứ tự từ 001 đến
   `supabase/migrations/202610220004_chat_fallback.sql`. Migration 004 bổ sung cờ
   cấu hình fallback vào heartbeat và provider thực tế vào mỗi câu trả lời,
   giữ nguyên RLS và quyền chỉ ghi qua worker.
2. Trên máy chạy worker, dùng mẫu `services/worker/.env.fallback.example` để tạo
   `.env` riêng. Nếu đã có `.env`, cập nhật các trường tương ứng, giữ credentials
   và tên collection BGE đang dùng. Không ghi đè file cấu hình đã điền.
3. Cấu hình chính:

   ```dotenv
   AI_PROVIDER=ollama
   CHAT_MODEL=qwen3:4b
   EMBED_MODEL=bge-m3
   CHAT_FALLBACK_PROVIDER=openrouter
   OPENROUTER_CHAT_MODEL=nvidia/nemotron-3.5-lightning:free
   OPENROUTER_API_KEY=your-openrouter-api-key
   RERANK_MODEL=
   ```

4. Ollama phải hoạt động và có `bge-m3`. Nên cài cả Qwen để dùng làm model chính:

   ```powershell
   ollama pull bge-m3
   ollama pull qwen3:4b
   cd services/worker
   uv sync --locked
   uv run learnstep-worker
   ```

5. Deploy web bản mới. Không cần đưa key OpenRouter lên Vercel khi worker chạy
   riêng; chỉ cần các biến Supabase hiện tại. Trang học tập thông báo rõ có API
   dự phòng. Câu trả lời hoàn tất qua API có nhãn “Trả lời qua OpenRouter”.

Tắt fallback bằng `CHAT_FALLBACK_PROVIDER=none`. Muốn đổi model dự phòng, thay
`OPENROUTER_CHAT_MODEL` bằng model chat `nvidia/...:free` khác rồi restart worker.
Đây là tên model riêng, không đổi `CHAT_MODEL` chính thành model NVIDIA.
`AI_PROVIDER=openrouter` là chế độ API trực tiếp cũ; không dùng đồng thời với
`CHAT_FALLBACK_PROVIDER=openrouter`.

## Khi lỗi và khi phục hồi

- Mỗi câu hỏi thử model chính trước; sau một lỗi sinh câu trả lời sẽ chuyển sang
  OpenRouter cho cùng prompt và nguồn đã xác thực. Câu hỏi sau lại thử model chính.
- Lỗi trước token đầu hoặc giữa luồng đều có thể fallback. Worker kiểm tra lại
  lease và trạng thái tài liệu, xóa nội dung dở trong database/UI trước khi gọi API.
  Câu trả lời của hai model không bị nối thành một nội dung.
- CLI đánh giá/benchmark giữ phần local trong bộ đệm đến khi thành công để tránh
  trộn đầu ra. Đánh giá dùng cùng kiểm tra nguồn/trích dẫn như bình thường.
- Chỉ trả trích dẫn đã xác thực trong kết quả cuối. Retry xóa nhãn provider và
  nguồn của lượt trước. Lịch sử ghi provider thực sự hoàn tất câu trả lời.
- API 429 dùng `Retry-After` và tối đa 3 lượt theo cơ chế job hiện có. Không có
  fallback trả phí; vẫn giới hạn model NVIDIA `:free` và giá request bằng 0.
- Ollama/BGE hoặc Qdrant không hoạt động thì truy xuất thất bại; không chuyển vector
  sang NVIDIA. Fallback này không thay thế worker khi cả máy bị tắt.

Tài liệu đã index bằng BGE trong cùng collection không phải upload lại khi bật/tắt
chat fallback. Tài liệu được index bằng NVIDIA ở chế độ API trực tiếp vẫn cần
xóa/tải lại với BGE trước khi dùng chế độ này; không trộn hai không gian vector.

## Kiểm tra thực tế

1. Dùng tên model Qwen đã cài, hỏi một câu có nguồn: trả lời local, không có request
   chat mới trên dashboard OpenRouter.
2. Tạm đặt `CHAT_MODEL=learnstep-missing-chat-model` rồi restart worker; giữ
   `EMBED_MODEL=bge-m3`. Hỏi lại: retrieval vẫn qua BGE, trả lời có nhãn OpenRouter.
3. Đổi lại model thật, restart và hỏi tiếp: worker ưu tiên Ollama trở lại.
4. Với key sai/hết quota, job báo lỗi an toàn; không ghi nguyên response/key vào log.
5. Kiểm tra mạng ngắt giữa luồng và xóa tài liệu khi đang trả lời: không công bố
   câu trả lời trộn model hoặc nguồn đã xóa.

Để mô phỏng thiếu Qwen, không tắt cả Ollama vì BGE vẫn cần dùng. Chạy thực tế cần
API key hợp lệ và quota; unit tests dùng HTTP giả lập không chứng minh tài khoản
cloud đã sẵn sàng. Đọc [hạn mức và điều khoản dữ liệu](openrouter.md) trước khi thử.
