# Hướng dẫn dự án

- Không sử dụng các icon/emoji khi code.
- Web ở `apps/web`, worker ở `services/worker`, SQL ở `supabase/migrations`.
- Không commit credentials hoặc file `.env`; dùng các `.env.example`.
- Thay đổi dữ liệu người dùng phải giữ RLS và kiểm tra quyền sở hữu trong RPC/worker.
- Kiểm tra web bằng `npm test`, `npm run typecheck`, `npm run build`.
- Kiểm tra worker bằng `uv run pytest` trong `services/worker`.
