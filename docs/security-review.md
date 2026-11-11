# Rà soát bảo mật ứng dụng học tập

Ngày kiểm tra: 2026-10-29. Phạm vi là mã nguồn và dependency cục bộ, API web,
luồng đăng nhập/chuyển hướng, header trình duyệt, cấu hình CI và ranh giới
phiên người dùng với Supabase. Đây không phải báo cáo pentest dịch vụ đã triển
khai. Không gửi thao tác thay đổi dữ liệu của tài khoản thật lên Supabase.

Cập nhật ngày 2026-10-30: bổ sung kho tài liệu chung/cá nhân và quyền truy cập
nguồn RAG; xem [chi tiết và kiểm thử kho](document-repository.md). Kết quả npm
audit bên dưới là snapshot ngày 2026-10-29, dependency không đổi trong lần cập nhật này.

## Các điểm đã sửa

| Điểm kiểm tra | Thay đổi và tác dụng |
|---|---|
| Giới hạn request | Trước đây `request.text()` đọc toàn bộ body rồi mới kiểm tra số ký tự. Nay đọc stream tối đa 16.000 byte UTF-8, hủy stream vượt hạn, từ chối JSON/UTF-8 lỗi. Kiểm tra cả `Content-Length` và dung lượng thực nên không dựa vào header do client khai báo. |
| Giả mạo request dùng cookie | Mutation yêu cầu `application/json`; Origin khác miền, Origin `null`, Fetch Metadata `cross-site`/`same-site` bị từ chối. Khi không có Origin nhưng có Referer, Referer phải cùng origin. Browser form với MIME đơn giản bị từ chối. |
| Ranh giới khóa dịch vụ | API dùng session client với khóa public và `auth.getUser()`. Chỉ nhánh tạo/kiểm tra upload đã được cấp quyền mới cần `storageAdmin()` và khóa dịch vụ; đọc thông báo/nhóm không đòi quyền dịch vụ. |
| API nhóm học | UUID, môn học, độ dài nội dung và request key được kiểm tra. Body mới là strict, từ chối user/owner ID do trình duyệt gửi; RPC xác định người dùng từ phiên và kiểm tra membership/quyền sở hữu. |
| API thông báo | SELECT lọc theo user đã xác thực, giới hạn 50 thông báo mới nhất, đếm riêng toàn bộ chưa đọc. RPC chỉ đánh dấu thông báo của người dùng hiện tại. |
| Header trình duyệt | CSP bắt buộc `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`, bổ sung cho `nosniff`, `X-Frame-Options: DENY`, Referrer Policy và Permissions Policy sẵn có. |
| Bộ đệm Proxy | `proxyClientMaxBodySize: '16kb'` giới hạn phần body được Next Proxy sao chép. Đây là giới hạn bộ đệm, không thay thế kiểm tra 16.000 byte ở handler. Upload tệp vẫn đi trực tiếp đến signed storage. |
| Thông báo lỗi | Lỗi RPC được ánh xạ sang thông báo an toàn, kèm code nghiệp vụ nếu có. Migration community thiếu trả 503; không trả lỗi SQL, đường dẫn lưu trữ hoặc exception nội bộ. |

Client JSON ngoài trình duyệt không có Origin/Fetch Metadata vẫn được hỗ trợ,
nhưng phải có phiên hợp lệ. API không bật CORS cho origin bên ngoài; JavaScript
khác origin không thể gửi JSON kèm cookie mà không qua preflight. Các kiểm tra
này bảo vệ browser cookie flow, không thay thế xác thực/RLS hoặc kiểm tra quyền
trong RPC. Signed upload đi thẳng tới Supabase và không đi qua parser JSON này.

## Các kiểm tra đã có và được rà soát

- API lấy người dùng bằng `getUser()` trước khi đọc/ghi dữ liệu; bảng riêng và
  RPC tiếp tục sử dụng RLS/quyền database. Không đổi policy storage/worker.
- Callback đăng nhập chỉ cho phép `/onboarding` hoặc đúng
  `/auth?mode=reset`. Confirm OTP chọn đường dẫn cố định theo loại token;
  query `next` tùy ý không tạo redirect ra miền ngoài. Luồng recovery được giữ.
- JSON thành công và lỗi của API trả `Cache-Control: private, no-store`.
- Các workflow hiện có dùng quyền repository chỉ đọc, checkout không giữ
  credentials, Actions ghim theo SHA và Gitleaks che finding trong log.
- Kiểm tra tên file đang được Git theo dõi chỉ thấy các `.env.example` trong
  nhóm tên credential thông dụng; tìm mẫu private key/token đặc trưng trong
  nội dung tracked không có kết quả. Đây là kiểm tra mẫu hẹp, không phải quét
  secret toàn bộ lịch sử.

## Bằng chứng chạy cục bộ

| Lệnh | Kết quả |
|---|---|
| `npm test` | 62 test web và 37 test database pass, gồm kiểm tra RLS/ownership, quota, idempotency, Markdown/LaTeX, request boundary và nguồn RAG chung/cá nhân. |
| `npm run typecheck` | Sinh route types và TypeScript pass. |
| `npm run build` | Production build pass với Webpack. Turbopack trên máy này lỗi khi khởi tạo tiến trình PostCSS cả trong và ngoài sandbox, nên script build dùng tùy chọn `--webpack` do Next hỗ trợ. |
| `uv run --no-sync pytest`, `uv run --no-sync ruff check .` | 62 test worker pass, Ruff pass; dùng UV cache trong workspace để tránh giới hạn quyền ghi cache ngoài sandbox. Bao gồm bộ lọc Qdrant theo owner/document/version và xác thực lại nguồn chung. |
| `npm run test --workspace apps/web -- src/app/api/route.test.ts src/core/request-security.test.ts src/app/auth/flow.test.ts` | 30 test pass: API community/auth, giả mạo chủ sở hữu, lỗi/RPC, phân trang, JSON/MIME/Origin, UTF-8 quá hạn, header và redirect recovery. |
| `npm audit --audit-level=high --json` | Registry npm trả thành công: 0 advisory ở mọi mức, 293 dependency trong báo cáo. Lần chạy đầu trong sandbox lỗi DNS; lần chạy lại chỉ đọc có quyền mạng hoàn tất. |
| `git diff --check` | Không có lỗi whitespace; Git có cảnh báo chuẩn hóa LF/CRLF. |
| Gitleaks cục bộ (`.cache/security/gitleaks.exe stdin --redact`) | Không phát hiện secret trong diff và nội dung các file untracked không bị Git ignore. Không quét file `.env` cục bộ hoặc toàn bộ lịch sử ở bước này. |
| API thật trên Supabase local, hai tài khoản tạm | Tạo nhóm + retry cùng key, chặn người ngoài nhóm đọc/gửi, cho phép sau khi join, thông báo riêng tư và đọc đúng chủ sở hữu, leave thu hồi quyền đọc, chặn forged owner và Origin ngoài. Đã kiểm tra header thực và tài khoản/nhóm thử đã được tự xóa. |
| Kho tài liệu local, hai tài khoản và PDF tạm | Danh mục chung tách khỏi file cá nhân, đoạn trích đúng tài liệu, RLS cho phép ký PDF chung nhưng chặn file riêng khác tài khoản, ngừng công bố chặn lần đọc/ký mới. Migration và route HTTP đã chạy thực; dữ liệu thử tự dọn. |

Kiểm thử API dùng mock session/RPC để kiểm tra hợp đồng và các tham số được
chuyển xuống database. Quyền SQL cần được kiểm tra riêng bằng suite database;
mock API không chứng minh migration đã được áp dụng vào dịch vụ thật.
Migration `202610290001_community.sql` đã được áp dụng vào Supabase local của
phiên triển khai này, không đặt lại dữ liệu hiện có. Kiểm thử PostgreSQL/RLS
thực bằng PGlite bao gồm giới hạn nhóm, quota, idempotency, người chưa có hồ sơ,
thông báo, transaction rollback và quyền đọc sau khi rời nhóm.

Kiểm thử local phát hiện Next có thể chuẩn hóa URL nội bộ thành localhost dù
browser dùng 127.0.0.1. Boundary so Origin với HTTP Host thực tế (đã kiểm tra
cú pháp), cùng protocol của request; không nhận giá trị từ X-Forwarded-Host do
client gửi. Kiểm thử hồi quy giữ chặn Origin ngoài và Host sai định dạng.

## Giới hạn và kiểm tra tiếp theo

- CSP hiện chỉ siết plugin, base URL, framing và form action. Chưa có
  `script-src`/nonce nghiêm ngặt; do đó không được coi CSP này là bằng chứng đã
  chặn mọi XSS. Thêm nonce cần đồng bộ theme script trong layout, dynamic
  rendering và các script Next theo tài liệu cài kèm của Next 16.4.2.
- Chưa chạy pentest/DAST trên deployment, thử tải lớn, kiểm tra TLS/HSTS tại
  reverse proxy/CDN, thử hai tài khoản trên production hoặc xác nhận cấu hình
  Supabase Auth (redirect allowlist, email, MFA, rate limit).
- Đã smoke test HTTP/API local, chưa kiểm tra trực quan giao diện qua browser
  automation trong phiên này; các mốc màn hình cần xem ở `docs/workspace.md`.
- `npm audit` là snapshot advisory tại thời điểm chạy, không chứng minh không
  có lỗ hổng chưa công bố. Gitleaks, Bandit, pip-audit và zizmor có cấu hình CI
  trong repo; phiên rà soát web này không xác nhận chúng đã chạy thành công
  trên GitHub. Gitleaks cục bộ đã quét phần thay đổi nhưng chưa quét lại toàn bộ lịch sử.
- API community yêu cầu áp dụng migration nhóm học/thông báo trước khi sử dụng.
  RLS và RPC là ranh giới bảo vệ dữ liệu; không cấp service role cho trình duyệt.

Tài liệu Next đã đối chiếu từ gói đang cài:
`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`,
`01-app/02-guides/content-security-policy.md` và
`01-app/03-api-reference/05-config/01-next-config-js/{headers,proxyClientMaxBodySize}.md`.
