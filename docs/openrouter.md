# Thử nghiệm RAG bằng NVIDIA trên OpenRouter

Nếu muốn **Ollama chính, OpenRouter chỉ dự phòng cho câu trả lời**, dùng
[hướng dẫn chat fallback](chat-fallback.md) và `.env.fallback.example`.
Các bước bên dưới là chế độ API trực tiếp cho toàn bộ RAG.

Nhánh `codex/openrouter-rag` bổ sung `AI_PROVIDER=openrouter`. Web vẫn chạy trên
Vercel; file gốc ở Supabase Storage private, đoạn văn/lịch sử/job ở PostgreSQL,
vector ở Qdrant Cloud. Worker Python đọc queue, trích văn bản và gọi API NVIDIA
qua OpenRouter cho embedding, rerank tùy chọn và sinh câu trả lời.

Worker chạy trên laptop hoặc một dịch vụ CPU chạy liên tục. Không cần Ollama,
GPU hay mở cổng. Chỉ deploy web lên Vercel không khởi chạy worker. Vercel tiếp tục
trả `202` và polling, không giữ một Function chờ toàn bộ ingestion/inference.

## 1. Chuẩn bị Supabase và phiên bản web

Dùng đúng project Supabase mà web trên Vercel đang kết nối. Áp dụng các migration
chưa chạy theo thứ tự:

1. `supabase/migrations/202610220001_initial.sql`
2. `supabase/migrations/202610220002_profiles.sql`
3. `supabase/migrations/202610220003_embedding_profiles.sql`
4. `supabase/migrations/202610220004_chat_fallback.sql`

CLI `supabase db push --dry-run` rồi `supabase db push` theo dõi lịch sử migration.
Nếu dùng SQL Editor, mỗi file chỉ chạy một lần; không chạy lại migration đã áp dụng.
Migration 003 lưu model/collection theo tài liệu và provider của heartbeat, giữ nguyên
RLS và quyền ghi qua RPC/worker. Chạy migration trước khi cập nhật web và worker.

Vercel vẫn dùng ba biến Supabase trong `apps/web/.env.example`. Khi muốn deploy
nhánh thử nghiệm, tạo một Preview deployment từ `codex/openrouter-rag`; cấu hình
Supabase Auth redirect đúng URL đó. Preview nên dùng Supabase/Qdrant thử nghiệm
và worker riêng. Không trộn dữ liệu production vào preview. Với web production,
chỉ chuyển sang bản mới sau khi smoke test đạt yêu cầu.

## 2. Cấu hình worker

Từ thư mục gốc repository, PowerShell:

```powershell
cd services/worker
Copy-Item .env.openrouter.example .env
```

Nếu đã có `.env`, giữ bản cấu hình hiện tại trong nơi riêng và cập nhật có chủ đích.
Điền vào `.env` trên máy chạy worker:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | Chuỗi PostgreSQL direct hoặc Session pooler cổng 5432, SSL; URL-encode mật khẩu |
| `SUPABASE_URL` | URL project của web |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret của cùng Supabase project |
| `QDRANT_URL`, `QDRANT_API_KEY` | Cluster Qdrant thử nghiệm |
| `OPENROUTER_API_KEY` | API key tạo tại OpenRouter Settings → API Keys |
| `AI_PROVIDER` | `openrouter` |
| `CHAT_MODEL` | `nvidia/nemotron-3.5-lightning:free` |
| `EMBED_MODEL` | `nvidia/nemotron-3.5-embed-1b:free` |
| `RERANK_MODEL` | Để trống, hoặc `nvidia/nemotron-3.5-rerank-8b:free` |
| `QDRANT_COLLECTION` | Tiền tố, ví dụ `learnstep`; worker tự thêm mã model và kích thước |

Key OpenRouter chỉ cần trên worker, không đưa vào trình duyệt, không đặt
`NEXT_PUBLIC_OPENROUTER_API_KEY`, không cần đặt key này trên Vercel với kiến trúc này.
Các `.env` thật bị Git bỏ qua; `.env.openrouter.example` chỉ chứa placeholder.

## 3. Chạy thử

```powershell
uv sync --locked
uv run learnstep-worker
```

Worker kiểm tra model đúng loại, endpoint có giá 0 và kích thước vector thực tế
bằng một yêu cầu embedding văn bản mẫu. Sau đó tạo collection cosine và payload
indexes, gửi heartbeat. Lần đầu vẫn cần tải tokenizer nhỏ để chia đoạn trên CPU;
không tải trọng số model inference. Dùng `TOKENIZER_PATH` nếu đã có tokenizer.json.

Trên URL web đã deploy bản mới:

1. Đăng nhập, hoàn tất username nếu cần; kiểm tra trợ giảng báo sẵn sàng.
2. Xác nhận thông báo AI qua OpenRouter/NVIDIA xuất hiện trong trang học tập.
3. Upload PDF/DOCX thử nghiệm, chờ trạng thái Sẵn sàng.
4. Chọn tài liệu, hỏi một câu có đáp án; mở nguồn, đối chiếu trang PDF/đoạn DOCX.
5. Hỏi ngoài tài liệu để kiểm tra từ chối thiếu bằng chứng; mở lại lịch sử.
6. Bật `RERANK_MODEL` trong worker `.env`, khởi động lại và so sánh cùng bộ câu hỏi.
7. Xóa tài liệu; kiểm tra file, đoạn và vector được dọn, lịch sử giữ nguồn không còn khả dụng.

Một worker xử lý tuần tự cho cùng Supabase project, kể cả khi dùng API. Khóa
PostgreSQL ngăn worker Ollama và OpenRouter chạy đồng thời trên cùng hàng đợi.
Worker tắt thì web báo offline sau 60 giây. Muốn AI hoạt động khi laptop tắt,
đặt worker trên máy chủ/container CPU chạy liên tục và giữ secrets tại đó.

## Model và giới hạn

Đã đối chiếu catalog công khai ngày 22/10/2026. Có thể thay `CHAT_MODEL` bằng:

- `nvidia/nemotron-3.5-super-vl:free`
- `nvidia/nemotron-3-super-120b-a12b:free`
- `nvidia/nemotron-3-ultra-550b-a55b:free`

Pipeline hiện chỉ gửi văn bản dù model có thể nhận ảnh/video. Lightning là mặc định
thử nghiệm; chưa có benchmark chất lượng/tốc độ thực tế trong tài khoản người dùng.
Các model có thể ngừng miễn phí hoặc thiếu capacity; worker từ chối cấu hình
không có hậu tố `:free`, sai loại hoặc không còn endpoint giá 0. Mỗi request đặt
giới hạn giá prompt/completion/request bằng 0 và không cấu hình fallback trả phí.

Free tier có hạn mức theo tài khoản/model. Theo tài liệu tại thời điểm kiểm tra:
20 request/phút, thông thường 50 request/ngày nếu chưa mua đủ 10 USD credits;
mua đủ mức đó nâng giới hạn lên 1.000 request/ngày. Kiểm tra lại tại dashboard
và [tài liệu giới hạn](https://openrouter.ai/docs/api/reference/limits).
Embedding được gửi theo batch tối đa 8 đoạn; startup cũng dùng một request.
Một câu hỏi thường cần embedding + chat, thêm một request nếu bật rerank và
có nguồn phù hợp. Không xem số request là số câu hỏi có thể hỏi.

Worker giãn các request tối thiểu 3,2 giây; `OPENROUTER_REQUEST_INTERVAL` có thể
tăng đến 60 giây. Hạn mức của ứng dụng khác dùng chung tài khoản vẫn ảnh hưởng.
HTTP 429 chờ ít nhất 60 giây hoặc `Retry-After` dạng số giây (tối đa một giờ),
thử lại tối đa 3 lượt. Hết quota ngày có thể phải đợi reset rồi gửi lại câu hỏi.
401/402/403/404 hoặc yêu cầu sai cấu hình dừng job với lỗi an toàn, không ghi
key, câu hỏi hay nội dung response upstream vào log.

## Đổi embedding và xóa dữ liệu

NVIDIA Embed 1B hiện công bố vector 2048 chiều; worker đọc kích thước thực từ
response thay vì giả định 1024 của BGE. `input_type=search_document` dùng khi index,
`search_query` khi hỏi; không yêu cầu API đổi chiều vector. Tokenizer Qwen chỉ là
ước lượng để giữ ngân sách prompt nhỏ, không phải phép đếm token chuẩn của Nemotron.

Collection OpenRouter có mã embedding profile và kích thước riêng; không ghi đè
collection BGE cũ. Mỗi tài liệu ghi `embedding_profile` và `vector_collection`.
Nếu chọn tài liệu được index bằng backend/model khác, job báo cần lập chỉ mục lại,
không trả nhầm câu trả lời thiếu nguồn. MVP thực hiện bằng cách xóa và tải lại file
trên web sau khi đổi worker; chưa có nút reindex tài liệu ready tại chỗ.

Migration 003 mặc định metadata tài liệu cũ là `ollama:bge-m3` / `study_bge_m3_v1`.
Nếu trước đây đã dùng tên collection/model khác, quản trị viên phải cập nhật hai
trường này cho các tài liệu cũ theo cấu hình thực tế trước khi đổi worker/xóa.
Không đoán metadata và không xóa collection thủ công khi còn tài liệu đang sử dụng.
Job xóa dùng collection đã lưu và luôn lọc theo user/document, kể cả sau khi đổi model.

Rerank chỉ nhận đoạn đã xác thực lại owner/document/version trong PostgreSQL.
Kết quả rerank chỉ được dùng để sắp xếp các đoạn đó theo index, không được tạo nguồn
mới từ text/ID do provider trả về. Trích dẫn S1–S5 tiếp tục được kiểm tra ở kết quả cuối.

## Dữ liệu được gửi ra ngoài

Ở chế độ API, toàn bộ văn bản trích xuất được gửi theo từng batch để embedding;
câu hỏi dùng cho embedding/rerank, các đoạn được chọn và lịch sử gần đây được gửi
cho chat. File gốc vẫn lưu tại Supabase. NVIDIA free endpoint có điều khoản ghi
nhật ký và sử dụng dữ liệu để cải thiện dịch vụ; chỉ dùng tài liệu thử nghiệm
không chứa thông tin cá nhân/bí mật. Trang học tập hiển thị rõ provider đang dùng.
Xóa dữ liệu LearnStep không phải là yêu cầu xóa nhật ký phía OpenRouter/NVIDIA.
Đọc [điều khoản trên trang model](https://openrouter.ai/nvidia/nemotron-3.5-embed-1b:free).

## Kiểm chứng và đánh giá

```powershell
uv run pytest
uv run ruff check .
uv run learnstep-benchmark
```

Benchmark gọi API thật và tiêu thụ quota; dừng worker trước khi chạy. Lệnh đánh giá
`learnstep-evaluate` dùng backend, query embedding, rerank, prompt và kiểm tra trích
dẫn theo cấu hình hiện tại. Hiệu chỉnh `RETRIEVAL_MIN_SCORE` bằng bộ calibration
riêng cho NVIDIA; điểm tương đồng không phải xác suất câu trả lời đúng.

Unit tests dùng HTTP giả lập để kiểm tra response embedding/SSE/rerank, retry,
quyền và namespace. Chưa xác minh inference hoặc deployment thật khi chưa cấu hình
API key và các kết nối cloud. Chỉ smoke test thành công trên URL Vercel thật mới
xác nhận cấu hình của tài khoản hoạt động từ đầu đến cuối.

Tài liệu API chính thức:
[embedding](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request),
[rerank](https://openrouter.ai/docs/api/api-reference/rerank/create-rerank),
[giới hạn giá](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/).
