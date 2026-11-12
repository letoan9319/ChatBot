import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { learningPlanSchema } from "@/core/learning-plan";
import { sessionClient, storageAdmin } from "@/core/supabase-server";
import { profileSchema, USERNAME_HELP } from "@/core/profile";
import { checkMutationRequest, readJsonBody, RequestError } from "@/core/request-security";
import {
  keySchema,
  messageSchema,
  uploadSchema,
  uuid,
} from "@/core/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const failures: Record<string, [number, string]> = {
  UNAUTHORIZED: [401, "Vui lòng đăng nhập."],
  NOT_FOUND: [404, "Không tìm thấy dữ liệu."],
  WORKER_OFFLINE: [503, "AI đang offline. Vui lòng chờ máy xử lý kết nối lại."],
  DOCUMENT_LIMIT: [409, "Bạn đã đạt giới hạn 20 tài liệu."],
  INVALID_FILE: [400, "Tệp không hợp lệ hoặc vượt quá 20 MB."],
  INVALID_SUBJECT: [400, "Môn học không hợp lệ."],
  INVALID_STATE: [
    409,
    "Trạng thái tài liệu đã thay đổi. Hãy tải lại danh sách.",
  ],
  INVALID_DOCUMENTS: [400, "Hãy chọn 1–5 tài liệu của bạn đã sẵn sàng."],
  INVALID_QUESTION: [400, "Câu hỏi phải có từ 1 đến 2.000 ký tự."],
  CHAT_BUSY: [409, "Bạn đang có một câu hỏi chờ xử lý."],
  RATE_LIMIT: [429, "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau."],
  IDEMPOTENCY_CONFLICT: [409, "Mã yêu cầu đã được dùng cho nội dung khác."],
  INVALID_USERNAME: [400, USERNAME_HELP],
  USERNAME_TAKEN: [409, "Username này đã được sử dụng. Hãy chọn tên khác."],
  INVALID_GROUP: [400, "Tên hoặc nội dung nhóm học không hợp lệ."],
  GROUP_LIMIT: [409, "Bạn đã đạt giới hạn nhóm học."],
  GROUP_FULL: [409, "Nhóm học đã đủ thành viên."],
  GROUP_OWNER: [409, "Chủ nhóm không thể rời nhóm học."],
};

const subjectSchema = z.enum(["calculus", "linear-algebra", "physics"]);
const createGroupSchema = z.object({
  name: z.string().trim().min(3).max(80),
  subject: subjectSchema,
  description: z.string().trim().max(500).default(""),
  key: uuid,
}).strict();
const groupMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  key: uuid,
}).strict();
const readNotificationsSchema = z.object({ id: uuid.optional() }).strict();
const emptyBodySchema = z.object({}).strict();

function checkCommunity(error: { code?: string; message: string } | null) {
  if (error && ["PGRST202", "PGRST205", "42P01", "42883", "42703"].includes(error.code || "")) {
    throw new ApiError(503, "Thông báo và nhóm học chưa sẵn sàng. Vui lòng liên hệ quản trị viên.");
  }
  check(error);
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
function check(error: { message: string } | null) {
  if (!error) return;
  const code = Object.keys(failures).find((key) => error.message.includes(key));
  if (code) throw new ApiError(failures[code][0], failures[code][1], code);
  // Do not leak database details, SQL, credentials, or storage paths.
  throw new ApiError(500, "Không thể hoàn thành yêu cầu. Vui lòng thử lại.");
}
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

async function handle(request: NextRequest) {
  try {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      throw new ApiError(
        503,
        "Hệ thống chưa được cấu hình Supabase. Xem hướng dẫn cài đặt.",
      );
    }
    if (request.method !== "GET") checkMutationRequest(request);
    const db = await sessionClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new ApiError(401, "Vui lòng đăng nhập.", "UNAUTHORIZED");
    const parts = request.nextUrl.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    const [resource, rawId, action] = parts;
    const method = request.method;
    const body = () => readJsonBody(request);
    if (resource === "learning-plans" && parts.length === 1) {
      const columns = "id,mode,content,revision";
      if (method === "GET") {
        const { data, error } = await db.from("learning_plans").select(columns)
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
        check(error);
        return json(data ?? []);
      }
      if (method === "POST") {
        const { id, mode, content, revision } = learningPlanSchema.parse(await body());
        const table = db.from("learning_plans");
        const result = revision === null
          ? await table.upsert({ id, mode, content, user_id: user.id }, { onConflict: "id", ignoreDuplicates: true })
            .select(columns).maybeSingle()
          : await table.update({ content, revision: revision + 1 })
            .eq("id", id).eq("user_id", user.id).eq("mode", mode).eq("revision", revision)
            .select(columns).maybeSingle();
        check(result.error);
        if (!result.data) throw new ApiError(409, "Kế hoạch đã thay đổi. Hãy tải lại trước khi lưu.");
        return json(result.data, revision === null ? 201 : 200);
      }
    }
    if (resource === "notifications") {
      if (method === "GET" && parts.length === 1) {
        const { data, error } = await db.from("notifications")
          .select("id,kind,title,body,conversation_id,group_id,created_at,read_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(50);
        checkCommunity(error);
        const { count, error: countError } = await db.from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .is("read_at", null);
        checkCommunity(countError);
        return json({ items: data ?? [], unread: count ?? 0 });
      }
      if (method === "POST" && rawId === "read" && parts.length === 2) {
        const value = readNotificationsSchema.parse(await body());
        const { error } = await db.rpc("app_read_notifications", { p_id: value.id ?? null });
        checkCommunity(error);
        return json({ ok: true });
      }
    }
    if (resource === "groups") {
      if (method === "GET" && parts.length === 1) {
        const subject = request.nextUrl.searchParams.get("subject");
        const { data, error } = await db.rpc("app_list_groups", {
          p_subject: subject === null ? null : subjectSchema.parse(subject),
        });
        checkCommunity(error);
        return json(data ?? []);
      }
      if (method === "POST" && parts.length === 1) {
        const value = createGroupSchema.parse(await body());
        const { data, error } = await db.rpc("app_create_group", {
          p_name: value.name, p_subject: value.subject,
          p_description: value.description, p_key: value.key,
        });
        checkCommunity(error);
        return json(data, 201);
      }
      if (parts.length === 3 && ["join", "leave", "messages"].includes(action)) {
        const id = uuid.parse(rawId);
        if (method === "POST" && ["join", "leave"].includes(action)) {
          emptyBodySchema.parse(await body());
          const { data, error } = await db.rpc(action === "join" ? "app_join_group" : "app_leave_group", { p_group: id });
          checkCommunity(error);
          return json(action === "leave" ? { ok: true } : data);
        }
        if (action === "messages" && method === "GET") {
          const before = request.nextUrl.searchParams.get("before");
          const { data, error } = await db.rpc("app_group_messages", {
            p_group: id, p_before: before === null ? null : z.iso.datetime({ offset: true }).parse(before),
          });
          checkCommunity(error);
          return json(data ?? []);
        }
        if (action === "messages" && method === "POST") {
          const value = groupMessageSchema.parse(await body());
          const { data, error } = await db.rpc("app_post_group_message", {
            p_group: id, p_content: value.content, p_key: value.key,
          });
          checkCommunity(error);
          return json(data, 201);
        }
      }
    }
    if (resource === "profile" && method === "POST" && parts.length === 1) {
      const parsed = profileSchema.safeParse(await body());
      if (!parsed.success) throw new ApiError(400, USERNAME_HELP);
      const { data, error } = await db.rpc("app_set_username", { p_username: parsed.data.username });
      if (error && ["PGRST202", "PGRST205", "42P01"].includes(error.code)) {
        throw new ApiError(503, "Dịch vụ hồ sơ tài khoản chưa sẵn sàng. Vui lòng liên hệ quản trị viên.");
      }
      check(error);
      return json({ username: data });
    }
    if (resource === "streak" && method === "GET" && parts.length === 1) {
      const { data, error } = await db.rpc("app_get_streak");
      if (error && ["PGRST202", "PGRST205", "42P01"].includes(error.code)) {
        throw new ApiError(503, "Chuỗi ngày học chưa sẵn sàng. Vui lòng liên hệ quản trị viên.");
      }
      check(error);
      return json(data);
    }
    if (resource === "status" && method === "GET" && parts.length === 1) {
      const { data, error } = await db.rpc("app_worker_online");
      check(error);
      const { data: provider, error: providerError } = await db.rpc("app_ai_provider");
      if (providerError && ["PGRST202", "42P01", "42703"].includes(providerError.code)) {
        throw new ApiError(503, "Cấu hình AI chưa được cập nhật. Vui lòng áp dụng migration embedding_profiles.");
      }
      check(providerError);
      const { data: active, error: activeError } = await db
        .from("jobs")
        .select("id,payload")
        .eq("kind", "chat")
        .in("status", ["queued", "running"])
        .limit(1)
        .maybeSingle();
      check(activeError);
      return json({
        online: Boolean(data),
        provider: ["openrouter", "ollama", "ollama_with_openrouter_fallback"].includes(provider) ? provider : null,
        activeChat: active
          ? { id: active.id, conversation_id: active.payload.conversation_id }
          : null,
      });
    }
    if (resource === "documents") {
      if (method === "GET" && rawId && parts.length <= 3 && (!action || action === "file")) {
        const id = uuid.parse(rawId);
        if (action === "file") {
          const { data: doc, error } = await db.rpc("app_document_file", { p_id: id });
          checkRepository(error);
          if (!doc) throw new ApiError(404, "Không tìm thấy tài liệu.");
          const { data: signed, error: signError } = await db.storage.from("documents").createSignedUrl(
            doc.storage_path, 120, doc.file_type === "docx" ? { download: doc.name } : undefined,
          );
          check(signError);
          if (!signed?.signedUrl) throw new ApiError(404, "Tệp tài liệu không còn khả dụng.");
          const page = request.nextUrl.searchParams.get("page");
          const suffix = doc.file_type === "pdf" && page ? `#page=${z.coerce.number().int().min(1).max(200).parse(page)}` : "";
          const response = NextResponse.redirect(`${signed.signedUrl}${suffix}`, 307);
          response.headers.set("Cache-Control", "private, no-store");
          return response;
        }
        const chunk = request.nextUrl.searchParams.get("chunk");
        const { data, error } = await db.rpc("app_get_document", { p_id: id, p_chunk: chunk ? uuid.parse(chunk) : null });
        checkRepository(error);
        if (!data) throw new ApiError(404, "Không tìm thấy tài liệu.");
        return json(data);
      }
      if (method === "GET" && parts.length === 1) {
        const { data, error } = await db
          .from("documents")
          .select(
            "id,name,subject,file_type,size_bytes,status,error,created_at",
          )
          .neq("status", "deleted")
          .order("created_at", { ascending: false });
        check(error);
        return json(data);
      }
      if (
        rawId === "upload-intent" &&
        method === "POST" &&
        parts.length === 2
      ) {
        const value = uploadSchema.parse(await body());
        requireStorageConfiguration();
        const { data: doc, error } = await db.rpc("app_upload_intent", {
          p_name: value.name,
          p_size: value.size,
          p_subject: value.subject,
          p_key: value.key,
        });
        check(error);
        if (doc.status !== "uploading")
          return json({ document: doc, upload: null });
        // Storage upload tokens last two hours. Bound re-signing so the worker
        // can perform a final cleanup after every issued token has expired.
        if (Date.now() - Date.parse(doc.created_at) > 3600000)
          throw new ApiError(
            409,
            "Phiên tải lên đã hết hạn. Xác nhận file đã tải hoặc xóa bản tải dở và thử lại.",
          );
        const { data: upload, error: uploadError } =
          await storageAdmin().createSignedUploadUrl(doc.storage_path, {
            upsert: false,
          });
        check(uploadError);
        return json({ document: doc, upload }, 201);
      }
      if (
        rawId &&
        ((method === "POST" && ["complete", "retry"].includes(action)) ||
          method === "DELETE")
      ) {
        if (parts.length !== (method === "DELETE" ? 2 : 3))
          throw new ApiError(404, "Không tìm thấy API.");
        const id = uuid.parse(rawId);
        const { key } = keySchema.parse(await body());
        const { data: doc, error: docError } = await db
          .from("documents")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        check(docError);
        if (!doc) throw new ApiError(404, "Không tìm thấy tài liệu.");
        if (action === "complete" && doc.status === "uploading") {
          requireStorageConfiguration();
          const { data: info, error: infoError } = await storageAdmin().info(
            doc.storage_path,
          );
          if (infoError || !info)
            throw new ApiError(400, "File chưa được tải lên thành công.");
          const expectedType =
            doc.file_type === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          if (
            Number(info.size) !== Number(doc.size_bytes) ||
            info.contentType !== expectedType
          )
            throw new ApiError(
              400,
              "Dung lượng hoặc định dạng file không khớp.",
            );
        }
        const { data, error } = await db.rpc("app_enqueue_document", {
          p_id: id,
          p_action: method === "DELETE" ? "delete" : action,
          p_key: key,
        });
        check(error);
        return json(data, 202);
      }
    }
    if (resource === "knowledge" && method === "GET" && parts.length === 1) {
      const { data, error } = await db.rpc("app_list_knowledge_documents");
      checkRepository(error);
      return json(data ?? []);
    }
    if (resource === "conversations") {
      if (method === "GET" && parts.length === 1) {
        const { data, error } = await db
          .from("conversations")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        check(error);
        return json(data);
      }
      if (method === "POST" && parts.length === 1) {
        const { key } = keySchema.parse(await body());
        const { data, error } = await db.rpc("app_create_conversation", {
          p_key: key,
        });
        check(error);
        return json({ id: data }, 201);
      }
      if (action === "messages" && parts.length === 3) {
        const id = uuid.parse(rawId);
        if (method === "GET") {
          const { data: conversation, error: convError } = await db
            .from("conversations")
            .select("id")
            .eq("id", id)
            .maybeSingle();
          check(convError);
          if (!conversation)
            throw new ApiError(404, "Không tìm thấy hội thoại.");
          const { data, error } = await db
            .from("messages")
            .select("*,message_sources(*)")
            .eq("conversation_id", id)
            .order("sequence");
          check(error);
          return json(data);
        }
        if (method === "POST") {
          const value = messageSchema.parse(await body());
          const { data, error } = await db.rpc("app_send_message", {
            p_conversation: id,
            p_question: value.question,
            p_documents: value.documentIds,
            p_key: value.key,
            ...(!value.documentIds.length && (!value.mode || value.mode === "documents")
              ? { p_mode: "library" }
              : value.mode && value.mode !== "documents" ? { p_mode: value.mode } : {}),
          });
          check(error);
          return json(data, 202);
        }
      }
    }
    if (resource === "jobs" && method === "GET" && parts.length === 2) {
      const { data, error } = await db
        .from("jobs")
        .select(
          "id,kind,status,attempts,error,created_at,started_at,finished_at",
        )
        .eq("id", uuid.parse(rawId))
        .maybeSingle();
      check(error);
      if (!data) throw new ApiError(404, "Không tìm thấy tác vụ.");
      return json(data);
    }
    if (resource === "sources" && method === "GET" && parts.length === 2) {
      const { data: source, error } = await db
        .from("message_sources")
        .select("*")
        .eq("id", uuid.parse(rawId))
        .maybeSingle();
      check(error);
      if (!source) throw new ApiError(404, "Không tìm thấy nguồn.");
      const { data: chunk, error: chunkError } = await db
        .from("document_chunks")
        .select("content")
        .eq("id", source.chunk_id || "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      check(chunkError);
      const { data: doc, error: docError } = await db.rpc("app_get_document", { p_id: source.document_id, p_chunk: null });
      if (docError?.message.includes("NOT_FOUND")) return json({ ...source, available: false });
      checkRepository(docError);
      if (!chunk || doc?.status !== "ready")
        return json({ ...source, available: false });
      let url: string | null = null;
      if (doc.file_type === "pdf") {
        url = `/api/documents/${source.document_id}/file?page=${source.page || 1}`;
      }
      return json({ ...source, available: true, content: chunk.content, url });
    }
    throw new ApiError(404, "Không tìm thấy API.");
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error:
            "Dữ liệu không hợp lệ. Kiểm tra định dạng, dung lượng và số tài liệu đã chọn.",
        },
        400,
      );
    if (error instanceof ApiError || error instanceof RequestError)
      return json({ error: error.message, ...(error instanceof ApiError && error.code ? { code: error.code } : {}) }, error.status);
    return json(
      { error: "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại." },
      500,
    );
  }
}

function checkRepository(error: { code?: string; message: string } | null) {
  if (error && ["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code || "")) {
    throw new ApiError(503, "Kho tài liệu chưa được cấu hình. Vui lòng áp dụng migration document_repository.");
  }
  check(error);
}

function requireStorageConfiguration() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(503, "Dịch vụ tải tài liệu chưa được cấu hình. Vui lòng liên hệ quản trị viên.");
  }
}
export { handle as GET, handle as POST, handle as DELETE };
