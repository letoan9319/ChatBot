# Kiểm tra bảo mật và dependency

Workflow `Security checks` chạy khi có pull request, push vào `main`, chạy tay
qua Actions, và mỗi thứ Hai khoảng 09:23 giờ Việt Nam (GitHub có thể trễ lịch).

| Check | Phạm vi và điều kiện thất bại |
|---|---|
| Gitleaks | Quét lịch sử Git, thất bại nếu phát hiện secret; nội dung phát hiện được che trong log |
| npm audit | Toàn bộ dependency trong lockfile npm, kể cả dependency phát triển; thất bại từ mức high |
| pip-audit | Dependency worker được xuất từ `uv.lock`, kể cả nhóm dev; thất bại nếu có advisory được công bố hoặc kiểm tra không hoàn tất |
| Bandit | Mã nguồn worker Python; thất bại từ mức medium với confidence medium |
| zizmor | Cấu hình Actions; thất bại từ mức medium, chạy offline không cần token dịch vụ |

`Verify MVP` tiếp tục kiểm tra test web/database, TypeScript, build, pytest
và Ruff. Workflow chỉ có quyền đọc repository; checkout không lưu Git token,
không dùng `pull_request_target`, không nhận secret Supabase/Qdrant/Ollama.
Actions được cố định bằng commit SHA. Binary Gitleaks được kiểm tra SHA-256
trước khi chạy.

Dependabot kiểm tra mỗi thứ Hai từ 09:00 giờ Việt Nam cho npm workspace, uv
worker, GitHub Actions và chính các công cụ bảo mật. Bản cập nhật minor/patch
được gom theo nhóm, major thành PR riêng. Không tự merge hoặc tự deploy.

Không thêm file allowlist hay bỏ qua advisory chỉ để làm check xanh. Khi check
báo lỗi, đọc vị trí và mã advisory, cập nhật dependency có bản vá rồi chạy lại
kiểm thử. Scan tìm secret không thay thế việc thu hồi key đã lộ trong lịch sử.

Repo private dùng các scanner CLI trực tiếp. CodeQL không nằm trong bộ check
này vì khả năng dùng cho repository private phụ thuộc gói GitHub Code Security.

## Chạy tương đương trên máy phát triển

Từ thư mục gốc:

```powershell
npm audit --audit-level=high
uv run --python 3.12 --no-project --with-requirements .github/security-tools/requirements.txt bandit -r services/worker/src --severity-level medium --confidence-level medium
uv run --python 3.12 --no-project --with-requirements .github/security-tools/requirements.txt zizmor --offline --no-progress --format plain --min-severity medium .github/workflows
```

Để audit worker, dùng `uv export --frozen --all-groups --no-emit-project
--format requirements-txt` trong `services/worker`, lưu kết quả vào một file
tạm, rồi chạy `pip-audit --strict --require-hashes -r <file-tạm>` bằng môi
trường công cụ nêu trên. Không commit file export hoặc báo cáo chứa dữ liệu
riêng tư. Gitleaks trên máy local: `gitleaks git . --redact --no-banner
--log-opts="--all"`.
