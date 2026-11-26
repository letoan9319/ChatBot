# Kiểm tra bảo mật, chất lượng mã nguồn và bot tự động

## 1. Security checks (`.github/workflows/security.yml`)

Workflow `Security checks` chạy khi có pull request, push vào `main`, chạy tay
qua Actions, và mỗi thứ Hai khoảng 09:23 giờ Việt Nam (GitHub có thể trễ lịch).

| Check | Phạm vi và điều kiện thất bại |
|---|---|
| Gitleaks | Quét lịch sử Git, thất bại nếu phát hiện secret; nội dung phát hiện được che trong log |
| npm audit | Toàn bộ dependency trong lockfile npm, kể cả dependency phát triển; thất bại từ mức high |
| pip-audit | Dependency worker được xuất từ `uv.lock`, kể cả nhóm dev; thất bại nếu có advisory được công bố hoặc kiểm tra không hoàn tất |
| Bandit | Mã nguồn worker Python; thất bại từ mức medium với confidence medium |
| zizmor | Cấu hình Actions; thất bại từ mức medium, chạy offline không cần token dịch vụ |

`Verify MVP` (`.github/workflows/ci.yml`) tiếp tục kiểm tra test web/database,
TypeScript, build, pytest và Ruff.

## 2. CodeQL SAST (`.github/workflows/codeql.yml`)

Workflow `CodeQL` chạy phân tích tĩnh bảo mật (SAST) cho hai ngôn ngữ
`javascript-typescript` và `python` (chế độ `build-mode: none`, bộ truy vấn
`security-extended`) trên:

- `push` vào nhánh `main`
- `pull_request` hướng vào nhánh `main`
- Lịch hàng tuần (thứ Hai 10:17 giờ Việt Nam) và `workflow_dispatch`

Quyền tối thiểu cấp ở mức job: `actions: read`, `contents: read`,
`security-events: write`. Lưu ý: nếu repository ở chế độ private, việc tải kết
quả SARIF lên tab Security phụ thuộc gói GitHub Code Security.

## 3. Dependency Review (`.github/workflows/dependency-review.yml`)

Workflow `Dependency Review` chạy trên `pull_request` với quyền `contents: read`
để kiểm tra thay đổi dependency trong diff của PR:

- Chặn PR nếu phát sinh lỗ hổng từ mức `high` trở lên (`fail-on-severity: high`).
- Kiểm tra giấy phép và chặn các giấy phép không tương thích
  (`GPL-2.0-only`, `GPL-2.0-or-later`, `GPL-3.0-only`, `GPL-3.0-or-later`, `SSPL-1.0`).
- Hiển thị phiên bản đã vá trong bảng tổng hợp của check run.

## 4. Automated Scan Issue Bot (`.github/workflows/auto-issue-scanner.yml`)

Workflow `Automated Scan Issue Bot` chạy **chỉ trên** `push` vào `main`, lịch
định kỳ hai lần mỗi tuần (thứ Hai và thứ Năm 08:37 giờ Việt Nam), và
`workflow_dispatch`. Workflow không chạy trên `pull_request` để không cấp quyền
`issues: write` cho mã nguồn từ PR fork.

Bot chạy 6 bộ quét không phá hủy (`Gitleaks`, `npm audit`, `pip-audit`,
`Bandit`, `zizmor`, `Ruff`) và gọi `.github/scripts/sync-scan-issues.mjs` để
đồng bộ GitHub Issues:

- Tự đảm bảo các label cần thiết tồn tại: `automated-scan`, `security`,
  `dependencies`, `code-quality`.
- Gắn dấu nhận diện ẩn (`<!-- learnstep-scan-bot:<category> -->`) và
  `fingerprint` kết quả cho từng nhóm scanner để không bao giờ tạo issue trùng lặp.
- Khi có phát hiện: tạo issue mới hoặc cập nhật issue đang mở nếu `fingerprint`
  thay đổi, kèm danh sách phát hiện đã giới hạn độ dài và liên kết trực tiếp tới
  workflow run. Riêng Gitleaks chỉ ghi rule ID, đường dẫn tệp, số dòng và commit
  SHA ngắn, tuyệt đối không ghi giá trị secret thật vào issue.
- Khi lần quét sau sạch lỗi: tự động bình luận xác nhận kèm commit SHA và đóng
  issue tương ứng.

## 5. Dependabot và nguyên tắc cứng hóa Actions

Dependabot (`.github/dependabot.yml`) kiểm tra mỗi thứ Hai từ 09:00 giờ Việt Nam
cho npm workspace, uv worker, GitHub Actions và `.github/security-tools`, tự gắn
label `dependencies` và `automated-scan` (thêm `security` cho Actions và bộ công
cụ bảo mật). Bản cập nhật minor/patch được gom theo nhóm, major thành PR riêng.
Không tự merge hoặc tự deploy.

Nguyên tắc chung cho toàn bộ workflow:

- Tất cả GitHub Actions đều cố định bằng commit SHA 40 ký tự đầy đủ kèm chú
  thích phiên bản.
- Checkout luôn bật `persist-credentials: false`, mọi job có `timeout-minutes`
  và khai báo `permissions` tối thiểu; không dùng `pull_request_target` và không
  nội suy `${{ ... }}` trực tiếp trong khối `run:`.
- Binary Gitleaks luôn kiểm tra SHA-256 trước khi thực thi.
- Không thêm file allowlist hay bỏ qua advisory chỉ để làm check xanh. Khi check
  báo lỗi, đọc vị trí và mã advisory, cập nhật dependency có bản vá rồi chạy lại
  kiểm thử. Scan tìm secret không thay thế việc thu hồi key đã lộ trong lịch sử.

## 6. Chạy kiểm tra tương đương trên máy phát triển

Từ thư mục gốc:

```powershell
npm audit --audit-level=high
uv run --python 3.12 --no-project --with-requirements .github/security-tools/requirements.txt bandit -r services/worker/src --severity-level medium --confidence-level medium
uv run --python 3.12 --no-project --with-requirements .github/security-tools/requirements.txt zizmor --offline --no-progress --format plain --min-severity medium .github/workflows
node --test .github/scripts/sync-scan-issues.test.mjs
```

Để audit worker, dùng `uv export --frozen --all-groups --no-emit-project
--format requirements-txt` trong `services/worker`, lưu kết quả vào một file
tạm, rồi chạy `pip-audit --strict --require-hashes -r <file-tạm>` bằng môi
trường công cụ nêu trên. Không commit file export hoặc báo cáo chứa dữ liệu
riêng tư. Gitleaks trên máy local: `gitleaks git . --redact --no-banner
--log-opts="--all"`.
