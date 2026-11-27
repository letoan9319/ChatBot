import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL functions, grants and RLS; only Supabase-owned service schemas
// and the queue transport are replaced by the same local shims as database.test.
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;
    create schema pgmq;
    create function pgmq.create(text) returns void language sql as $$ select $$;
    create function pgmq.send(text,jsonb) returns bigint language sql as $$ select 1::bigint $$;
  `);
  for (const name of [
    "202610220001_initial.sql", "202610220002_profiles.sql",
    "202610220003_embedding_profiles.sql", "202610220004_chat_fallback.sql",
    "202610220005_study_streaks.sql", "202610290001_community.sql",
    "202610300001_document_repository.sql",
    "202611120001_learning_plans.sql",
    "20261112150505_content_management.sql",
    "20261112205940_chat_search_modes.sql",
    "202611130001_chat_shared_library.sql",
    "202611140001_deploy_generation_provider.sql",
    "20261119071403_group_message_images.sql",
    "20261119155925_group_message_reactions.sql",
    "20261120150841_chat_lifecycle.sql",
    "202611240001_chat_thinking_progress.sql",
    "202611240002_chat_subject.sql",
    "202611240003_group_management.sql",
    "202611250001_group_moderation.sql",
    "202611250002_pixel_packs.sql",
    "202611250003_chat_thinking_stream.sql",
    "202611250004_streak_on_question.sql",
    "202611260001_always_record_thinking_ms.sql",
    "202611260002_admin_rbac.sql",
    "202611270001_learning_plans_delete.sql",
    "202611280001_course_lessons.sql",
    "202611280002_native_question_images.sql",
  ]) {
    const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    await db.exec(sql.replace("create extension if not exists pgmq;", "")
      .split("create extension if not exists pg_cron;")[0]);
  }
});
after(async () => { await db?.close(); });

test("external chat modes allow zero sources and participate in idempotency", async () => {
  const user = await learner();
  await db.query("insert into worker_heartbeats(id) values($1)", [randomUUID()]);
  const conversation = await rpc(user, "app_create_conversation", [randomUUID()]);
  const beforeAsk = await rpc(user, "app_get_streak");
  assert.equal(beforeAsk.today_completed, false);
  assert.equal(beforeAsk.current, 0);
  const args = [conversation, "Định luật Newton là gì?", [], randomUUID()];
  await assert.rejects(rpc(user, "app_send_message", args), /INVALID_QUESTION/);
  await assert.rejects(rpc(user, "app_send_message", [...args, "invalid"]), /INVALID_QUESTION/);
  const job = await rpc(user, "app_send_message", [...args, "research"]);
  assert.equal(job.payload.mode, "research");
  const afterAsk = await rpc(user, "app_get_streak");
  assert.equal(afterAsk.today_completed, true);
  assert.equal(afterAsk.current, 1);
  assert.equal(afterAsk.total_days, 1);
  assert.equal((await rpc(user, "app_send_message", [...args, "research"])).id, job.id);
  assert.equal((await rpc(user, "app_get_streak")).total_days, 1);
  await assert.rejects(rpc(user, "app_send_message", [...args, "library"]), /IDEMPOTENCY_CONFLICT/);
  const other = await learner();
  const otherConversation = await rpc(other, "app_create_conversation", [randomUUID()]);
  const libraryJob = await rpc(other, "app_send_message", [otherConversation, args[1], [], randomUUID(), "library"]);
  assert.equal(libraryJob.payload.mode, "library");
  assert.deepEqual(libraryJob.payload.document_ids, []);
});

test("chat subject is validated, snapshotted with both turns and included in retry identity", async () => {
  const user = await learner();
  await db.query("insert into worker_heartbeats(id) values($1)", [randomUUID()]);
  const own = await repositoryDocument(user);
  const other = await learner();
  const privateDoc = await repositoryDocument(other);
  const conversation = await rpc(user, "app_create_conversation", [randomUUID()]);
  const args = [conversation, "Gradient là gì?", [own.id], randomUUID(), "documents"];
  await assert.rejects(rpc(user, "app_send_message", [...args, "unknown"]), /INVALID_SUBJECT/);
  await assert.rejects(rpc(user, "app_send_message", [...args, "physics"]), /DOCUMENT_SUBJECT_MISMATCH/);
  await assert.rejects(rpc(user, "app_send_message", [conversation, args[1], [privateDoc.id], randomUUID(), "documents", "calculus"]), /INVALID_DOCUMENTS/);
  const job = await rpc(user, "app_send_message", [...args, "calculus"]);
  assert.equal(job.payload.subject, "calculus");
  assert.equal((await rpc(user, "app_send_message", [...args, "calculus"])).id, job.id);
  await assert.rejects(rpc(user, "app_send_message", [...args, "physics"]), /IDEMPOTENCY_CONFLICT/);
  const messages = await asUser(user, () => db.query("select subject from messages where conversation_id=$1 order by sequence", [conversation]));
  assert.deepEqual(messages.rows, [{ subject: "calculus" }, { subject: "calculus" }]);
  const hidden = await asUser(other, () => db.query("select subject from messages where conversation_id=$1", [conversation]));
  assert.deepEqual(hidden.rows, []);
});

async function learner(name) {
  const id = randomUUID();
  await db.query("insert into auth.users values($1)", [id]);
  if (name) await db.query("insert into profiles(id,username) values($1,$2)", [id, name]);
  return id;
}
async function asUser(user, callback) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try { return await callback(); }
  finally { await db.exec("reset role"); }
}
async function rpc(user, name, args = []) {
  return asUser(user, async () => (await db.query(
    `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args,
  )).rows[0].result);
}
const create = (user, overrides = {}) => {
  const g = { name: "Nhóm Giải tích", subject: "calculus", description: "Cùng học mỗi ngày", key: randomUUID(), ...overrides };
  return rpc(user, "app_create_group", [g.name, g.subject, g.description, g.key]);
};
const post = (user, group, content = "Cùng thảo luận bài tập", key = randomUUID()) =>
  rpc(user, "app_post_group_message", [group, content, key]);

test("avatar preferences are account-owned and stickers use the protected group feed", async () => {
  const owner = await learner("pixel_owner");
  const member = await learner("pixel_member");
  const group = await create(owner);
  const send = (user, sticker, key) => rpc(user, "app_post_group_sticker", [group.id, sticker, key]);
  const key = randomUUID();
  await assert.rejects(send(member, "hello", key), /NOT_FOUND/);
  await assert.rejects(rpc(owner, "app_set_avatar", ["invalid"]), /INVALID_AVATAR/);
  assert.equal(await rpc(owner, "app_set_avatar", ["owl"]), "owl");
  assert.deepEqual((await asUser(member, () => db.query("select avatar_id from profiles order by username"))).rows,
    [{ avatar_id: null }]);
  await assert.rejects(asUser(member, () => db.query("update profiles set avatar_id='cat' where id=$1", [owner])), /permission denied/);
  await rpc(member, "app_join_group", [group.id]);
  assert.equal((await rpc(member, "app_group_members", [group.id])).members[0].avatar_id, "owl");
  await assert.rejects(send(owner, "invalid", randomUUID()), /INVALID_GROUP/);
  await assert.rejects(send(owner, null, randomUUID()), /INVALID_GROUP/);
  const message = await send(owner, "hello", key);
  assert.equal(message.content, "");
  assert.equal(message.sticker_id, "hello");
  assert.equal((await send(owner, "hello", key)).id, message.id);
  await assert.rejects(send(owner, "reading", key), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(post(owner, group.id, "Chào nhóm", key), /IDEMPOTENCY_CONFLICT/);
  const postImage = () => rpc(owner, "app_post_group_image_message", [group.id, "", randomUUID(),
    Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64"), "image/png"]);
  assert.equal((await postImage()).has_image, true);
  const readback = (await rpc(member, "app_group_messages", [group.id])).find((item) => item.id === message.id);
  assert.equal(readback.avatar_id, "owl");
  assert.equal(readback.sticker_id, "hello");
  assert.equal(await rpc(owner, "app_set_avatar", [null]), null);
  assert.equal((await rpc(member, "app_group_messages", [group.id])).find((item) => item.id === message.id).avatar_id, null);
});

test("group moderation requires ownership and removes only data in the selected group", async () => {
  const owner = await learner("moderation_owner");
  const member = await learner("moderation_member");
  const group = await create(owner);
  const otherGroup = await create(owner);
  await rpc(member, "app_join_group", [group.id]);
  await rpc(member, "app_join_group", [otherGroup.id]);
  const message = await post(member, group.id);
  const remove = (user, target) => rpc(user, "app_remove_group_member", [group.id, target]);
  const discard = (user) => rpc(user, "app_delete_group", [group.id]);

  await assert.rejects(remove(member, owner), /FORBIDDEN/);
  await assert.rejects(discard(member), /FORBIDDEN/);
  await assert.rejects(remove(owner, owner), /GROUP_OWNER/);
  assert.equal((await remove(owner, member)).member_count, 1);
  await assert.rejects(rpc(member, "app_group_members", [group.id]), /FORBIDDEN/);
  await assert.rejects(post(member, group.id), /NOT_FOUND/);
  assert.ok((await rpc(owner, "app_group_messages", [group.id])).some((item) => item.id === message.id));
  assert.equal((await rpc(member, "app_group_members", [otherGroup.id])).members.length, 2);

  await discard(owner);
  await discard(owner);
  assert.equal((await db.query("select count(*)::int as count from study_group_messages where id=$1", [message.id])).rows[0].count, 0);
  assert.equal((await rpc(member, "app_list_groups", [])).some((item) => item.id === group.id), false);
  assert.equal((await rpc(member, "app_group_members", [otherGroup.id])).members.length, 2);
});

test("only members can see the roster and only the owner can update the group", async () => {
  const owner = await learner("roster_owner");
  const member = await learner("roster_member");
  const group = await create(owner);
  const roster = (viewer) => rpc(viewer, "app_group_members", [group.id]);
  const update = (viewer, name) => rpc(viewer, "app_update_group", [group.id, name, "Ôn bài mỗi tuần"]);

  await assert.rejects(roster(member), /FORBIDDEN/);
  await rpc(member, "app_join_group", [group.id]);
  assert.deepEqual(await roster(member), {
    can_edit: false,
    members: [
      { id: owner, username: "roster_owner", is_owner: true, avatar_id: null },
      { id: member, username: "roster_member", is_owner: false, avatar_id: null },
    ],
  });
  assert.equal((await roster(owner)).can_edit, true);
  await assert.rejects(update(member, "Tên bị đổi"), /FORBIDDEN/);
  await assert.rejects(update(owner, " "), /INVALID_GROUP/);
  const edited = await update(owner, "  Giải tích cuối tuần  ");
  assert.equal(edited.name, "Giải tích cuối tuần");
  assert.equal(edited.description, "Ôn bài mỗi tuần");
  assert.equal((await rpc(member, "app_list_groups", [])).find((item) => item.id === group.id).name, edited.name);
  await rpc(member, "app_leave_group", [group.id]);
  await assert.rejects(roster(member), /FORBIDDEN/);
});

async function repositoryDocument(owner, status = "ready") {
  const id = randomUUID(), chunk = randomUUID(), path = `${owner}/${id}.pdf`;
  await db.query(`insert into documents(id,user_id,name,subject,file_type,size_bytes,storage_path,status,upload_key)
    values($1,$2,'Giáo trình.pdf','calculus','pdf',100,$3,$4,$5)`, [id, owner, path, status, randomUUID()]);
  await db.query(`insert into document_chunks(id,document_id,user_id,index_version,ordinal,content,page)
    values($1,$2,$3,1,0,'Đạo hàm của x bình phương là 2x.',23)`, [chunk, id, owner]);
  await db.query("insert into storage.objects(bucket_id,name) values('documents',$1)", [path]);
  return { id, chunk, path };
}

test("content managers can publish only their ready uploads and audit changes to the shared library", async () => {
  const manager = await learner(), viewer = await learner();
  const own = await repositoryDocument(manager), processing = await repositoryDocument(manager, "processing");
  const foreign = await repositoryDocument(viewer), shared = await repositoryDocument(viewer);
  const change = (user, document, publish, description = "") =>
    rpc(user, "app_set_knowledge_publication", [document.id, publish, description]);
  await db.query("insert into user_roles(user_id,role) values($1,'content_manager')", [manager]);
  await asUser(viewer, async () => {
    assert.equal((await db.query("select role from user_roles")).rows.length, 0);
    await assert.rejects(db.query("insert into user_roles values($1,'content_manager')", [viewer]), /permission denied/);
    await assert.rejects(db.query("select * from app_private.knowledge_document_audit"), /permission denied/);
  });
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select app_set_knowledge_publication($1,true)", [own.id]), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
  await assert.rejects(change(viewer, foreign, true), /FORBIDDEN/);
  await assert.rejects(change(manager, foreign, true), /DOCUMENT_NOT_PUBLISHABLE/);
  await assert.rejects(change(manager, processing, true), /DOCUMENT_NOT_PUBLISHABLE/);
  await assert.rejects(change(manager, own, true, "a".repeat(2001)), /INVALID_INPUT/);
  assert.equal(await change(manager, own, true, " Mô tả chung "), true);
  assert.equal(await change(manager, own, true, "Mô tả khác"), false);
  assert.equal((await rpc(viewer, "app_get_document", [own.id])).description, "Mô tả chung");
  await assert.rejects(change(viewer, own, false), /FORBIDDEN/);
  await db.query("insert into knowledge_documents(document_id) values($1)", [shared.id]);
  assert.equal(await change(manager, shared, false), true);
  await assert.rejects(rpc(manager, "app_get_document", [shared.id]), /NOT_FOUND/);
  assert.equal((await rpc(viewer, "app_get_document", [shared.id])).scope, "personal");
  assert.equal(await change(manager, own, false), true);
  assert.equal(await change(manager, own, false), false);
  await assert.rejects(rpc(viewer, "app_get_document", [own.id]), /NOT_FOUND/);
  await db.query("delete from user_roles where user_id=$1", [manager]);
  await assert.rejects(change(manager, own, true), /FORBIDDEN/);
  const audit = await db.query("select actor_id,document_id,action from app_private.knowledge_document_audit where actor_id=$1 order by id", [manager]);
  assert.deepEqual(audit.rows, [
    { actor_id: manager, document_id: own.id, action: "publish" },
    { actor_id: manager, document_id: shared.id, action: "revoke" },
    { actor_id: manager, document_id: own.id, action: "revoke" },
  ]);
});

test("repository publication exposes safe metadata and authorized source/file access, never private uploads", async () => {
  const owner = await learner(), viewer = await learner();
  const common = await repositoryDocument(owner), personal = await repositoryDocument(owner);
  await assert.rejects(rpc(viewer, "app_get_document", [common.id]), /NOT_FOUND/);
  await assert.rejects(rpc(viewer, "app_document_file", [common.id]), /NOT_FOUND/);
  await db.query("insert into knowledge_documents(document_id,description) values($1,'Nguồn chung cho RAG')", [common.id]);
  const list = await rpc(viewer, "app_list_knowledge_documents");
  const published = list.find((doc) => doc.id === common.id);
  assert.equal(published.scope, "knowledge");
  assert.equal(published.description, "Nguồn chung cho RAG");
  for (const field of ["user_id", "storage_path", "upload_key"]) assert.equal(field in published, false);
  assert.equal(list.some((doc) => doc.id === personal.id), false);
  const detail = await rpc(viewer, "app_get_document", [common.id, common.chunk]);
  assert.equal(detail.excerpt.page, 23);
  assert.equal(detail.requested_chunk_available, true);
  assert.equal((await rpc(viewer, "app_get_document", [common.id, personal.chunk])).excerpt, null);
  assert.equal((await rpc(viewer, "app_document_file", [common.id])).storage_path, common.path);
  await assert.rejects(rpc(viewer, "app_get_document", [personal.id]), /NOT_FOUND/);
  await asUser(viewer, async () => {
    assert.equal((await db.query("select * from documents where id=$1", [common.id])).rows.length, 0);
    assert.equal((await db.query("select * from document_chunks where document_id=$1", [common.id])).rows.length, 1);
    assert.equal((await db.query("select * from storage.objects where name=$1", [common.path])).rows.length, 1);
    assert.equal((await db.query("select * from storage.objects where name=$1", [personal.path])).rows.length, 0);
    await assert.rejects(db.query("insert into knowledge_documents(document_id) values($1)", [personal.id]), /permission denied/);
    await assert.rejects(db.query("delete from knowledge_documents where document_id=$1", [common.id]), /permission denied/);
  });
});

test("revoking publication or deleting hides shared chunks, original files and catalog entries immediately", async () => {
  const owner = await learner(), viewer = await learner();
  const doc = await repositoryDocument(owner);
  await db.query("insert into knowledge_documents(document_id) values($1)", [doc.id]);
  await db.query("delete from knowledge_documents where document_id=$1", [doc.id]);
  await assert.rejects(rpc(viewer, "app_get_document", [doc.id]), /NOT_FOUND/);
  await assert.rejects(rpc(viewer, "app_document_file", [doc.id]), /NOT_FOUND/);
  await asUser(viewer, async () => {
    assert.equal((await db.query("select * from document_chunks where document_id=$1", [doc.id])).rows.length, 0);
    assert.equal((await db.query("select * from storage.objects where name=$1", [doc.path])).rows.length, 0);
  });
  assert.equal((await rpc(owner, "app_get_document", [doc.id])).scope, "personal");
  await db.query("insert into knowledge_documents(document_id) values($1)", [doc.id]);
  await db.query("update documents set status='deleting' where id=$1", [doc.id]);
  assert.equal((await rpc(viewer, "app_list_knowledge_documents")).some((item) => item.id === doc.id), false);
  await assert.rejects(rpc(viewer, "app_get_document", [doc.id]), /NOT_FOUND/);
  const pending = await repositoryDocument(owner, "processing");
  await assert.rejects(db.query("insert into knowledge_documents(document_id) values($1)", [pending.id]), /INVALID_STATE/);
});

test("RAG enqueue snapshots exact owners for shared and personal documents and refuses unrelated private sources", async () => {
  const owner = await learner(), viewer = await learner();
  const common = await repositoryDocument(owner), secret = await repositoryDocument(owner), personal = await repositoryDocument(viewer);
  await db.query("insert into knowledge_documents(document_id) values($1)", [common.id]);
  await db.query("insert into worker_heartbeats(id) values($1)", [randomUUID()]);
  const conversation = await rpc(viewer, "app_create_conversation", [randomUUID()]);
  await assert.rejects(rpc(viewer, "app_send_message", [conversation, "Hỏi", [secret.id], randomUUID()]), /INVALID_DOCUMENTS/);
  await assert.rejects(rpc(viewer, "app_send_message", [conversation, "Hỏi", [common.id, common.id], randomUUID()]), /INVALID_DOCUMENTS/);
  const key = randomUUID();
  const job = await rpc(viewer, "app_send_message", [conversation, "Hỏi", [common.id, personal.id], key]);
  assert.deepEqual(job.payload.owners, { [common.id]: owner, [personal.id]: viewer });
  assert.deepEqual(job.payload.versions, { [common.id]: 1, [personal.id]: 1 });
  assert.equal((await rpc(viewer, "app_send_message", [conversation, "Hỏi", [common.id, personal.id], key])).id, job.id);
  await db.query("update messages set content='Lời giải [S1]',status='completed' where id=$1", [job.message_id]);
  const autoThinking = (await db.query("select thinking_started_at, thinking_ms from messages where id=$1", [job.message_id])).rows[0];
  assert.notEqual(autoThinking.thinking_started_at, null);
  assert.equal(typeof autoThinking.thinking_ms, "number");
  await db.query(`insert into message_sources(message_id,document_id,user_id,chunk_id,label,document_name)
    values($1,$2,$3,$4,'S1','Giáo trình.pdf')`, [job.message_id, common.id, viewer, common.chunk]);
  await db.query("update jobs set status='completed' where id=$1", [job.id]);
  assert.equal((await rpc(viewer, "app_get_streak")).today_completed, true);
  await db.query("delete from knowledge_documents where document_id=$1", [common.id]);
  await assert.rejects(rpc(viewer, "app_send_message", [conversation, "Hỏi tiếp", [common.id], randomUUID()]), /INVALID_DOCUMENTS/);
});

test("repository RPCs remain closed to anonymous access", async () => {
  await db.exec("set role anon");
  try {
    for (const statement of ["select app_list_knowledge_documents()", `select app_get_document('${randomUUID()}')`, `select app_document_file('${randomUUID()}')`]) {
      await assert.rejects(db.query(statement), /permission denied/);
    }
  } finally { await db.exec("reset role"); }
});

test("members without a profile still get a safe display name in group history", async () => {
  const user = await learner();
  const group = await create(user);
  assert.equal((await post(user, group.id)).username, "Bạn học");
  const history = await rpc(user, "app_group_messages", [group.id]);
  assert.equal(history[0].username, "Bạn học");
});

test("groups expose only discoverable metadata until explicit membership and preserve private study data", async () => {
  const alice = await learner("community_alice"), bob = await learner("community_bob");
  const group = await create(alice);
  await db.query("insert into conversations(user_id,title) values($1,'private question')", [alice]);
  await db.query(`insert into documents(user_id,name,subject,file_type,size_bytes,storage_path,upload_key)
    values($1,'private.pdf','calculus','pdf',10,$2,$3)`, [alice, randomUUID(), randomUUID()]);
  const listed = await rpc(bob, "app_list_groups", ["calculus"]);
  const visible = listed.find((g) => g.id === group.id);
  assert.equal(visible.joined, false);
  assert.equal(visible.member_count, 1);
  assert.equal("create_key" in visible, false);
  await asUser(bob, async () => {
    assert.equal((await db.query("select * from study_groups where id=$1", [group.id])).rows.length, 1);
    assert.equal((await db.query("select * from study_group_members where group_id=$1", [group.id])).rows.length, 0);
    assert.equal((await db.query("select * from study_group_messages where group_id=$1", [group.id])).rows.length, 0);
  });
  await assert.rejects(post(bob, group.id), /NOT_FOUND/);
  await assert.rejects(rpc(bob, "app_group_messages", [group.id]), /NOT_FOUND/);
  const joined = await rpc(bob, "app_join_group", [group.id]);
  assert.equal(joined.member_count, 2);
  assert.equal(joined.joined, true);
  assert.equal((await rpc(bob, "app_join_group", [group.id])).member_count, 2);
  await asUser(bob, async () => {
    assert.equal((await db.query("select * from study_group_members where group_id=$1", [group.id])).rows.length, 2);
    for (const table of ["documents", "conversations", "messages", "document_chunks", "message_sources"]) {
      assert.equal((await db.query(`select * from ${table} where user_id=$1`, [alice])).rows.length, 0);
    }
    assert.equal((await db.query("select * from profiles where id=$1", [alice])).rows.length, 0);
  });
  const sent = await post(alice, group.id);
  assert.equal(sent.username, "community_alice");
  assert.equal((await rpc(bob, "app_group_messages", [group.id]))[0].id, sent.id);
  await rpc(bob, "app_leave_group", [group.id]);
  await assert.rejects(rpc(bob, "app_group_messages", [group.id]), /NOT_FOUND/);
  await assert.rejects(post(bob, group.id), /NOT_FOUND/);
  await asUser(bob, async () => {
    assert.equal((await db.query("select * from study_group_messages where group_id=$1", [group.id])).rows.length, 0);
    assert.equal((await db.query("select * from study_group_members where group_id=$1", [group.id])).rows.length, 0);
  });
  await assert.rejects(rpc(alice, "app_leave_group", [group.id]), /GROUP_OWNER/);
});

test("clients cannot forge ownership, memberships, messages, notifications or invoke private helpers", async () => {
  const alice = await learner(), bob = await learner(), group = await create(alice);
  await asUser(bob, async () => {
    for (const [sql, values] of [
      ["insert into study_groups(owner_id,subject,name,create_key) values($1,'physics','Forged',$2)", [alice, randomUUID()]],
      ["update study_groups set owner_id=$1 where id=$2", [bob, group.id]],
      ["insert into study_group_members values($1,$2,now())", [group.id, bob]],
      ["insert into study_group_messages(group_id,user_id,content,key) values($1,$2,'forged',$3)", [group.id, alice, randomUUID()]],
      ["insert into notifications(user_id,kind,title,body,event_key) values($1,'group_message','forged','','x')", [alice]],
      ["update notifications set read_at=now()", []],
      ["delete from study_group_members where group_id=$1", [group.id]],
      ["select app_private.group_json($1)", [group.id]],
      ["select app_private.group_message_json($1)", [randomUUID()]],
      ["select app_private.notify_group_message()", []],
      ["select app_create_group('forged','physics','',$1,$2)", [randomUUID(), alice]],
    ]) await assert.rejects(db.query(sql, values), /permission denied|does not exist/);
  });
  await db.exec("set role anon");
  try {
    for (const table of ["study_groups", "study_group_members", "study_group_messages", "notifications"]) {
      await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    }
    for (const [sql, args] of [
      ["select app_list_groups()", []],
      ["select app_create_group('group','physics','',$1)", [randomUUID()]],
      ["select app_join_group($1)", [group.id]],
      ["select app_leave_group($1)", [group.id]],
      ["select app_group_messages($1)", [group.id]],
      ["select app_post_group_message($1,'message',$2)", [group.id, randomUUID()]],
      ["select app_read_notifications()", []],
    ]) await assert.rejects(db.query(sql, args), /permission denied/);
  } finally { await db.exec("reset role"); }
  for (const [name, args] of [
    ["app_list_groups", []], ["app_create_group", ["group", "physics", "", randomUUID()]],
    ["app_join_group", [group.id]], ["app_leave_group", [group.id]],
    ["app_group_messages", [group.id]], ["app_post_group_message", [group.id, "message", randomUUID()]],
    ["app_read_notifications", []],
  ]) await assert.rejects(rpc("", name, args), /UNAUTHORIZED/);
});

test("group and message keys are retry-safe, owner-scoped, and detect changed payloads", async () => {
  const alice = await learner(), bob = await learner(), key = randomUUID();
  const group = await create(alice, { key });
  assert.equal((await create(alice, { key })).id, group.id);
  assert.notEqual((await create(bob, { key })).id, group.id);
  for (const changed of [{ name: "Changed group" }, { subject: "physics" }, { description: "Changed" }]) {
    await assert.rejects(create(alice, { key, ...changed }), /IDEMPOTENCY_CONFLICT/);
  }
  const messageKey = randomUUID(), sent = await post(alice, group.id, "original", messageKey);
  assert.equal((await post(alice, group.id, "original", messageKey)).id, sent.id);
  await assert.rejects(post(alice, group.id, "changed", messageKey), /IDEMPOTENCY_CONFLICT/);
  const other = await create(alice);
  await assert.rejects(post(alice, other.id, "original", messageKey), /IDEMPOTENCY_CONFLICT/);
  assert.equal((await rpc(alice, "app_group_messages", [group.id])).length, 1);
});

test("group and message validation rejects nulls, unsupported subjects, blanks and oversized text", async () => {
  const user = await learner(), group = await create(user);
  for (const name of [null, "", "  ", "ab", "a".repeat(81)]) {
    await assert.rejects(create(user, { name }), /INVALID_GROUP/);
  }
  await assert.rejects(create(user, { description: "x".repeat(501) }), /INVALID_GROUP/);
  await assert.rejects(create(user, { key: null }), /INVALID_GROUP/);
  for (const subject of [null, "other", ""]) await assert.rejects(create(user, { subject }), /INVALID_SUBJECT/);
  await assert.rejects(rpc(user, "app_list_groups", ["other"]), /INVALID_SUBJECT/);
  for (const content of [null, "", "  ", "a".repeat(2001)]) await assert.rejects(post(user, group.id, content), /INVALID_GROUP/);
  await assert.rejects(post(user, group.id, "message", null), /INVALID_GROUP/);
  await assert.rejects(rpc(user, "app_join_group", [randomUUID()]), /NOT_FOUND/);
  await assert.rejects(rpc(user, "app_leave_group", [randomUUID()]), /NOT_FOUND/);
});

test("RPC quotas enforce five owned groups, twenty memberships, fifty members and thirty posts per minute", async () => {
  const owner = await learner();
  for (let i = 0; i < 5; i++) await create(owner);
  await assert.rejects(create(owner), /GROUP_LIMIT/);
  const full = await create(await learner());
  const users = [];
  for (let i = 0; i < 49; i++) users.push(await learner());
  await db.query("insert into study_group_members(group_id,user_id) select $1,unnest($2::uuid[])", [full.id, users]);
  await assert.rejects(rpc(await learner(), "app_join_group", [full.id]), /GROUP_FULL/);
  assert.equal((await rpc(users[0], "app_join_group", [full.id])).member_count, 50);
  const member = await learner();
  for (let i = 0; i < 20; i++) {
    const g = await create(await learner());
    await rpc(member, "app_join_group", [g.id]);
  }
  await assert.rejects(rpc(member, "app_join_group", [full.id]), /GROUP_LIMIT/);
  await assert.rejects(create(member), /GROUP_LIMIT/);
  const poster = await learner(), group = await create(poster), key = randomUUID();
  const first = await post(poster, group.id, "first", key);
  for (let i = 1; i < 30; i++) await post(poster, group.id);
  await assert.rejects(post(poster, group.id), /RATE_LIMIT/);
  assert.equal((await post(poster, group.id, "first", key)).id, first.id);
});

test("message history is limited to newest fifty in ascending order and supports a timestamp cursor", async () => {
  const user = await learner(), group = await create(user);
  await db.query(`insert into study_group_messages(group_id,user_id,content,key,created_at)
    select $1,$2,n::text,gen_random_uuid(),'2020-01-01'::timestamptz+n*interval '1 second' from generate_series(1,60) n`, [group.id, user]);
  const latest = await rpc(user, "app_group_messages", [group.id]);
  assert.equal(latest.length, 50);
  assert.deepEqual(latest.map((m) => Number(m.content)), Array.from({ length: 50 }, (_, i) => i + 11));
  const previous = await rpc(user, "app_group_messages", [group.id, latest[0].created_at]);
  assert.deepEqual(previous.map((m) => Number(m.content)), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal("key" in latest[0], false);
});

test("group notifications target current other members once and marking read is owner-scoped", async () => {
  const alice = await learner(), bob = await learner(), outsider = await learner(), group = await create(alice);
  await rpc(bob, "app_join_group", [group.id]);
  const key = randomUUID();
  await post(alice, group.id, "private message text", key);
  await post(alice, group.id, "private message text", key);
  const notices = (await db.query("select * from notifications where group_id=$1", [group.id])).rows;
  assert.equal(notices.length, 1);
  const notice = notices[0];
  assert.equal(notice.user_id, bob);
  assert.equal(notice.kind, "group_message");
  assert.equal(notice.body.includes("private message text"), false);
  await asUser(alice, async () => assert.equal((await db.query("select * from notifications where id=$1", [notice.id])).rows.length, 0));
  assert.equal(await rpc(outsider, "app_read_notifications", [notice.id]), 0);
  assert.equal(await rpc(bob, "app_read_notifications", [notice.id]), 1);
  const readAt = (await db.query("select read_at from notifications where id=$1", [notice.id])).rows[0].read_at;
  assert.equal(await rpc(bob, "app_read_notifications", [notice.id]), 0);
  assert.deepEqual((await db.query("select read_at from notifications where id=$1", [notice.id])).rows[0].read_at, readAt);
  await rpc(bob, "app_leave_group", [group.id]);
  await post(alice, group.id);
  assert.equal((await db.query("select * from notifications where group_id=$1", [group.id])).rows.length, 1);
  await rpc(bob, "app_join_group", [group.id]);
  await post(alice, group.id);
  assert.equal(await rpc(bob, "app_read_notifications"), 1);
});

test("document and chat transitions produce compact private notifications and replay cannot duplicate them", async () => {
  const user = await learner(), other = await learner();
  const document = randomUUID(), conversation = randomUUID(), message = randomUUID(), job = randomUUID();
  await db.query(`insert into documents(id,user_id,name,subject,file_type,size_bytes,storage_path,upload_key)
    values($1,$2,'SECRET document name.pdf','calculus','pdf',100,$3,$4)`, [document, user, randomUUID(), randomUUID()]);
  await db.query("update documents set status='processing' where id=$1", [document]);
  assert.equal((await db.query("select * from notifications where user_id=$1", [user])).rows.length, 0);
  for (const status of ["ready", "ready", "processing", "ready", "failed", "failed"]) {
    await db.query("update documents set status=$1 where id=$2", [status, document]);
  }
  await db.query("insert into conversations(id,user_id,title) values($1,$2,'SECRET question')", [conversation, user]);
  await db.query("insert into messages(id,conversation_id,user_id,role,content) values($1,$2,$3,'assistant','SECRET answer')", [message, conversation, user]);
  await db.query("insert into jobs(id,user_id,kind,message_id,request_key) values($1,$2,'chat',$3,$4)", [job, user, message, randomUUID()]);
  for (const status of ["completed", "completed", "running", "completed", "failed", "failed"]) {
    await db.query("update jobs set status=$1 where id=$2", [status, job]);
  }
  for (const status of ["interrupted", "interrupted", "generating", "interrupted"]) {
    await db.query("update messages set status=$1 where id=$2", [status, message]);
  }
  const notices = (await db.query("select * from notifications where user_id=$1", [user])).rows;
  assert.deepEqual(notices.map((n) => n.kind).sort(), ["chat_completed", "chat_failed", "chat_interrupted", "document_failed", "document_ready"]);
  assert.ok(notices.every((n) => !(n.body + n.title).includes("SECRET")));
  assert.ok(notices.filter((n) => n.kind.startsWith("chat_")).every((n) => n.conversation_id === conversation));
  await asUser(other, async () => assert.equal((await db.query("select * from notifications where user_id=$1", [user])).rows.length, 0));
  // A worker record with forged owner must not link someone else's conversation.
  const forged = randomUUID();
  await db.query("insert into jobs(id,user_id,kind,message_id,request_key) values($1,$2,'chat',$3,$4)", [forged, other, message, randomUUID()]);
  await db.query("update jobs set status='completed' where id=$1", [forged]);
  assert.equal((await db.query("select * from notifications where user_id=$1", [other])).rows.length, 0);
});

test("notifications and group writes roll back atomically with their originating transaction", async () => {
  const alice = await learner(), bob = await learner(), group = await create(alice);
  await rpc(bob, "app_join_group", [group.id]);
  await db.exec("begin");
  await post(alice, group.id);
  await db.exec("rollback");
  assert.equal((await rpc(alice, "app_group_messages", [group.id])).length, 0);
  assert.equal((await db.query("select * from notifications where group_id=$1", [group.id])).rows.length, 0);
});

test("group discovery caps at one hundred and preserves joined groups before newest subject matches", async () => {
  const user = await learner();
  // Independent owners keep the large-directory fixture within per-user limits.
  const owners = (await db.query("insert into auth.users select gen_random_uuid() from generate_series(1,110) returning id")).rows.map((row) => row.id);
  const groups = (await db.query(`insert into study_groups(owner_id,subject,name,description,create_key,created_at)
    select owner_id,'linear-algebra','Directory group '||ordinal,'',gen_random_uuid(),
      '2020-01-01'::timestamptz+ordinal*interval '1 second'
    from unnest($1::uuid[]) with ordinality as owners(owner_id,ordinal)
    returning id,owner_id,created_at`, [owners])).rows;
  await db.query("insert into study_group_members(group_id,user_id) select id,owner_id from study_groups where owner_id=any($1::uuid[])", [owners]);
  await rpc(user, "app_join_group", [groups[0].id]);
  await rpc(user, "app_join_group", [groups[1].id]);
  // A newer group from another subject must not displace a subject match.
  const physics = await create(user, { subject: "physics" });
  const listed = await rpc(user, "app_list_groups", ["linear-algebra"]);
  assert.equal(listed.length, 100);
  assert.ok(listed.every((group) => group.subject === "linear-algebra"));
  assert.deepEqual(listed.slice(0, 2).map((group) => group.id), [groups[1].id, groups[0].id]);
  assert.ok(listed.slice(0, 2).every((group) => group.joined));
  assert.ok(listed.slice(2).every((group) => !group.joined));
  assert.deepEqual(listed.slice(2).map((group) => group.id), groups.slice(12).reverse().map((group) => group.id));
  assert.equal(listed.some((group) => group.id === physics.id), false);
  assert.deepEqual((await rpc(user, "app_list_groups", ["linear-algebra"])).map((group) => group.id), listed.map((group) => group.id));
  const all = await rpc(user, "app_list_groups");
  assert.equal(all.length, 100);
  assert.deepEqual(all.slice(0, 3).map((group) => group.id), [physics.id, groups[1].id, groups[0].id]);
});

test("learning plans isolate owners and reject ownership changes", async () => {
  const owner = await learner();
  const stranger = await learner();
  const id = randomUUID();
  await asUser(owner, async () => {
    await db.query("insert into learning_plans(id,mode,content) values($1,'self','{}')", [id]);
    assert.equal((await db.query("update learning_plans set revision=1 where id=$1 and revision=0 returning revision", [id])).rows[0].revision, 1);
    assert.equal((await db.query("update learning_plans set revision=1 where id=$1 and revision=0 returning revision", [id])).rows.length, 0);
    await assert.rejects(db.query("update learning_plans set user_id=$1 where id=$2", [stranger,id]), /permission denied/);
  });
  await asUser(stranger, async () => {
    assert.equal((await db.query("select id from learning_plans where id=$1", [id])).rows.length, 0);
    assert.equal((await db.query("update learning_plans set revision=2 where id=$1 returning id", [id])).rows.length, 0);
    await assert.rejects(db.query("insert into learning_plans(id,user_id,mode,content) values($1,$2,'guided','{}')", [randomUUID(),owner]), /row-level security/);
    assert.equal((await db.query("delete from learning_plans where id=$1 returning id", [id])).rows.length, 0);
  });
  await asUser(owner, async () => {
    assert.equal((await db.query("delete from learning_plans where id=$1 returning id", [id])).rows.length, 1);
    assert.equal((await db.query("select id from learning_plans where id=$1", [id])).rows.length, 0);
  });
});

test("course lessons are curated by managers, hide answers and grade progress on the server", async () => {
  const manager = await learner(), student = await learner(), other = await learner();
  await db.query("insert into user_roles(user_id,role) values($1,'content_manager')", [manager]);
  const lesson = "calculus.c2.l1";
  const quiz = [
    { question: "Đạo hàm của x^2?", options: ["x", "2x", "x^2"], correct: 1, explanation: "Quy tắc lũy thừa." },
    { question: "Đạo hàm của hằng số?", options: ["0", "1"], correct: 0 },
  ];
  const save = (user, body, items, sources, publish, id = lesson) =>
    rpc(user, "app_save_course_lesson", [id, body, JSON.stringify(items), JSON.stringify(sources), publish]);

  await assert.rejects(save(student, "Bài giảng", quiz, [], true), /FORBIDDEN/);
  await assert.rejects(save(manager, "Bài giảng", quiz, [], true, "calculus.bad"), /INVALID_INPUT/);
  await assert.rejects(save(manager, "Bài giảng", [{ ...quiz[0], correct: 3 }], [], true), /INVALID_INPUT/);
  await assert.rejects(save(manager, "  ", quiz, [], true), /EMPTY_LESSON/);
  const privateDoc = await repositoryDocument(manager);
  const citation = { label: "S1", document_id: privateDoc.id, document_name: "Giáo trình", page: 12, chunk_id: null };
  await assert.rejects(save(manager, "Bài giảng [S1]", quiz, [citation], true), /INVALID_SOURCES/);
  await db.query("insert into knowledge_documents(document_id) values($1)", [privateDoc.id]);

  assert.equal((await save(manager, "Bản nháp", quiz, [citation], false)).status, "draft");
  assert.equal(await rpc(student, "app_course_lesson", [lesson]), null);
  assert.deepEqual((await rpc(student, "app_course_overview", ["calculus"])).published, []);
  await asUser(student, async () => {
    await assert.rejects(db.query("select * from course_lessons"), /permission denied/);
    await assert.rejects(db.query("insert into course_progress(lesson_id,passed_at) values($1,now())", [lesson]), /permission denied/);
  });
  await assert.rejects(rpc(student, "app_manage_course_lessons", ["calculus"]), /FORBIDDEN/);
  assert.equal((await rpc(manager, "app_manage_course_lessons", ["calculus"]))[0].quiz[0].correct, 1);

  assert.equal((await save(manager, "Bài giảng [S1]", quiz, [citation], true)).status, "published");
  const shown = await rpc(student, "app_course_lesson", [lesson]);
  assert.equal(shown.body, "Bài giảng [S1]");
  assert.deepEqual(shown.quiz[0], { question: quiz[0].question, options: quiz[0].options });
  assert.equal(shown.sources[0].page, 12);
  assert.deepEqual((await rpc(student, "app_course_overview", ["calculus"])).published, [{ lesson_id: lesson, questions: 2 }]);

  await assert.rejects(rpc(student, "app_complete_lesson", [lesson]), /QUIZ_REQUIRED/);
  await assert.rejects(rpc(student, "app_submit_lesson_quiz", [lesson, [1]]), /INVALID_INPUT/);
  const failed = await rpc(student, "app_submit_lesson_quiz", [lesson, [0, 0]]);
  assert.equal(failed.score, 50);
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.results[0], { correct: false, answer: 1, explanation: "Quy tắc lũy thừa." });
  const passed = await rpc(student, "app_submit_lesson_quiz", [lesson, [1, 0]]);
  assert.equal(passed.score, 100);
  assert.equal(passed.passed, true);
  await rpc(student, "app_submit_lesson_quiz", [lesson, [0, 1]]);
  const progress = (await rpc(student, "app_course_overview", ["calculus"])).progress[0];
  assert.equal(progress.best_score, 100);
  assert.equal(progress.attempts, 3);
  assert.ok(progress.passed_at);
  assert.deepEqual((await rpc(other, "app_course_overview", ["calculus"])).progress, []);
  assert.equal((await asUser(other, () => db.query("select * from course_progress"))).rows.length, 0);

  assert.equal(await rpc(student, "app_complete_lesson", ["calculus.c1.l1"]), true);
  assert.equal((await rpc(student, "app_course_overview", ["calculus"])).progress.length, 2);
  await assert.rejects(rpc(student, "app_complete_lesson", ["unknown.c1.l1"]), /INVALID_INPUT/);

  assert.equal((await save(manager, "Bản sửa", quiz, [], false)).published_at, null);
  assert.equal(await rpc(student, "app_course_lesson", [lesson]), null);
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select app_course_overview('calculus')"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

test("chat lifecycle protects ownership, retains partial answers, and expires temporary chat", async () => {
  const owner = await learner();
  const outsider = await learner();
  const permanent = await rpc(owner, "app_create_conversation", [randomUUID()]);
  const temporary = await rpc(owner, "app_create_temporary_conversation", [randomUUID()]);
  const queued = await rpc(owner, "app_send_message", [permanent, "Câu đầu", [], randomUUID(), "library"]);
  await assert.rejects(rpc(outsider, "app_stop_chat", [queued.id]), /NOT_FOUND/);
  assert.equal(await rpc(owner, "app_stop_chat", [queued.id]), "stopped");
  assert.equal(await rpc(owner, "app_stop_chat", [queued.id]), "stopped");

  const running = await rpc(owner, "app_send_message", [temporary, "Câu tạm", [], randomUUID(), "library"]);
  assert.equal(running.payload.temporary, true);
  await db.query("update jobs set status='running',lease_token=$2 where id=$1", [running.id, randomUUID()]);
  await db.query(
    "update messages set status='generating',content='Một phần',thinking_started_at=now(),thinking_ms=4100,thinking_content='Bước 1: phân tích đề' where id=$1",
    [running.message_id],
  );
  const readThinking = () => db.query("select thinking_ms, thinking_content from messages where id=$1", [running.message_id]);
  assert.deepEqual((await asUser(owner, readThinking)).rows, [{
    thinking_ms: 4100,
    thinking_content: "Bước 1: phân tích đề",
  }]);
  assert.deepEqual((await asUser(outsider, readThinking)).rows, []);
  await asUser(owner, () => assert.rejects(
    db.query("update messages set thinking_ms=0 where id=$1", [running.message_id]), /permission denied/,
  ));
  await asUser(owner, () => assert.rejects(
    db.query("update messages set thinking_content='forged' where id=$1", [running.message_id]), /permission denied/,
  ));
  assert.equal(await rpc(owner, "app_stop_chat", [running.id]), "stopped");
  assert.deepEqual((await db.query("select content,status from messages where id=$1", [running.message_id])).rows,
    [{ content: "Một phần", status: "stopped" }]);
  assert.equal((await db.query("select lease_token from jobs where id=$1", [running.id])).rows[0].lease_token, null);

  const completed = await rpc(owner, "app_send_message", [temporary, "Câu sau", [], randomUUID(), "library"]);
  await db.query("update jobs set status='completed' where id=$1", [completed.id]);
  assert.equal(await rpc(owner, "app_stop_chat", [completed.id]), "completed");
  assert.equal((await db.query("select id from notifications where user_id=$1", [owner])).rows.length, 0);
  assert.equal(await rpc(outsider, "app_delete_chat", [permanent]), 0);
  assert.equal(await rpc(owner, "app_delete_chat", [null]), 1);
  assert.equal((await db.query("select id from conversations where user_id=$1", [owner])).rows[0].id, temporary);

  await db.query("update conversations set temporary_until=now()-interval '1 minute' where id=$1", [temporary]);
  await assert.rejects(rpc(owner, "app_send_message", [temporary, "Quá hạn", [], randomUUID(), "library"]), /NOT_FOUND/);
  await db.exec("select app_private.purge_expired_chats()");
  for (const table of ["conversations", "messages", "jobs"]) {
    assert.equal((await db.query(`select id from ${table} where user_id=$1`, [owner])).rows.length, 0);
  }
  assert.equal((await db.query("select job_id from app_private.chat_request_log where user_id=$1", [owner])).rows.length, 3);
});

test("RBAC enforces admin vs content_manager vs regular user permissions, last-admin guard, and audit logging", async () => {
  const admin = await learner("rbac_admin");
  const secondAdmin = await learner("rbac_admin_two");
  const manager = await learner("rbac_manager");
  const regular = await learner("rbac_learner");
  const groupOwner = await learner("rbac_group_owner");

  // Clear any roles from prior tests so last-admin count is exact and deterministic.
  await db.query("delete from user_roles");
  await db.query("insert into user_roles(user_id,role) values($1,'admin'),($2,'content_manager')", [admin, manager]);

  // Verify role check constraint rejects unsupported role values.
  await assert.rejects(
    db.query("insert into user_roles(user_id,role) values($1,'superadmin')", [regular]),
    /user_roles_role_check/,
  );

  // Verify internal role helpers return expected values for each role tier.
  const helperRow = (await db.query(
    `select
      app_private.has_role($1,'admin') as admin_has_admin,
      app_private.is_admin($1) as admin_is_admin,
      app_private.can_manage_knowledge($1) as admin_can_manage,
      app_private.is_admin($2) as manager_is_admin,
      app_private.can_manage_knowledge($2) as manager_can_manage,
      app_private.is_admin($3) as regular_is_admin,
      app_private.can_manage_knowledge($3) as regular_can_manage,
      app_private.has_role(null,'admin') as null_has_role`,
    [admin, manager, regular],
  )).rows[0];
  assert.deepEqual(helperRow, {
    admin_has_admin: true,
    admin_is_admin: true,
    admin_can_manage: true,
    manager_is_admin: false,
    manager_can_manage: true,
    regular_is_admin: false,
    regular_can_manage: false,
    null_has_role: false,
  });

  const adminDoc = await repositoryDocument(admin);
  const managerDoc = await repositoryDocument(manager);
  const regularDoc = await repositoryDocument(regular);
  const group = await create(groupOwner, { name: "Nhom kiem duyet", subject: "physics" });
  await rpc(regular, "app_join_group", [group.id]);
  const groupMsg = await post(groupOwner, group.id, "Tin nhan trong nhom");

  // user_roles RLS: authenticated users read only their own roles and cannot mutate or probe private helpers.
  await asUser(regular, async () => {
    assert.deepEqual((await db.query("select role from user_roles")).rows, []);
    await assert.rejects(db.query("insert into user_roles(user_id,role) values($1,'admin')", [regular]), /permission denied/);
    await assert.rejects(db.query("delete from user_roles where user_id=$1", [admin]), /permission denied/);
    await assert.rejects(db.query("select * from app_private.admin_audit_log"), /permission denied/);
    await assert.rejects(db.query("select app_private.is_admin($1)", [admin]), /permission denied/);
    await assert.rejects(db.query("select app_private.has_role($1,'admin')", [admin]), /permission denied/);
    await assert.rejects(db.query("select app_private.can_manage_knowledge($1)", [admin]), /permission denied/);
  });
  await asUser(manager, async () => {
    assert.deepEqual((await db.query("select user_id,role from user_roles")).rows, [{ user_id: manager, role: "content_manager" }]);
  });

  // Regular user denied on every admin RPC and knowledge publication RPC.
  for (const [fn, args] of [
    ["app_admin_overview", []],
    ["app_admin_list_users", ["", 20]],
    ["app_admin_set_user_role", [regular, "content_manager", true]],
    ["app_admin_list_groups", [20]],
    ["app_admin_delete_group", [group.id]],
    ["app_set_knowledge_publication", [regularDoc.id, true, ""]],
  ]) {
    await assert.rejects(rpc(regular, fn, args), /FORBIDDEN/);
  }

  // Content manager allowed on knowledge publication, denied on all admin RPCs.
  assert.equal(await rpc(manager, "app_set_knowledge_publication", [managerDoc.id, true, "Tai lieu chung"]), true);
  for (const [fn, args] of [
    ["app_admin_overview", []],
    ["app_admin_list_users", ["", 20]],
    ["app_admin_set_user_role", [regular, "content_manager", true]],
    ["app_admin_list_groups", [20]],
    ["app_admin_delete_group", [group.id]],
  ]) {
    await assert.rejects(rpc(manager, fn, args), /FORBIDDEN/);
  }

  // Admin can publish own ready doc, cannot publish another user's private doc, and can revoke any shared doc.
  assert.equal(await rpc(admin, "app_set_knowledge_publication", [adminDoc.id, true, "Tai lieu admin"]), true);
  await assert.rejects(rpc(admin, "app_set_knowledge_publication", [regularDoc.id, true, ""]), /DOCUMENT_NOT_PUBLISHABLE/);
  assert.equal(await rpc(admin, "app_set_knowledge_publication", [managerDoc.id, false, ""]), true);
  assert.equal(await rpc(admin, "app_set_knowledge_publication", [managerDoc.id, false, ""]), false);

  // Admin user listing and search validation.
  await assert.rejects(rpc(admin, "app_admin_list_users", ["", 0]), /INVALID_INPUT/);
  await assert.rejects(rpc(admin, "app_admin_list_users", ["", 101]), /INVALID_INPUT/);
  const searched = await rpc(admin, "app_admin_list_users", ["rbac_admin", 20]);
  assert.ok(searched.some((u) => u.user_id === admin && u.username === "rbac_admin" && u.roles.includes("admin")));
  assert.equal(searched.some((u) => u.user_id === regular), false);
  // Wildcard characters in search must be treated literally.
  assert.deepEqual(await rpc(admin, "app_admin_list_users", ["%", 20]), []);

  // Admin role management + LAST_ADMIN protection + audit log.
  await assert.rejects(rpc(admin, "app_admin_set_user_role", [admin, "admin", false]), /LAST_ADMIN/);
  await assert.rejects(rpc(admin, "app_admin_set_user_role", [regular, "superadmin", true]), /INVALID_INPUT/);
  await assert.rejects(rpc(admin, "app_admin_set_user_role", [randomUUID(), "content_manager", true]), /NOT_FOUND/);

  const grantedCm = await rpc(admin, "app_admin_set_user_role", [regular, "content_manager", true]);
  assert.deepEqual(grantedCm, { user_id: regular, username: "rbac_learner", roles: ["content_manager"], changed: true });
  const grantedCmRepeat = await rpc(admin, "app_admin_set_user_role", [regular, "content_manager", true]);
  assert.equal(grantedCmRepeat.changed, false);

  const grantedSecondAdmin = await rpc(admin, "app_admin_set_user_role", [secondAdmin, "admin", true]);
  assert.deepEqual(grantedSecondAdmin, { user_id: secondAdmin, username: "rbac_admin_two", roles: ["admin"], changed: true });

  // Now with two admins, revoking one admin succeeds; revoking the remaining one fails with LAST_ADMIN.
  const revokedFirst = await rpc(secondAdmin, "app_admin_set_user_role", [admin, "admin", false]);
  assert.deepEqual(revokedFirst, { user_id: admin, username: "rbac_admin", roles: [], changed: true });
  await assert.rejects(rpc(secondAdmin, "app_admin_set_user_role", [secondAdmin, "admin", false]), /LAST_ADMIN/);
  // Revoked admin immediately loses admin access.
  await assert.rejects(rpc(admin, "app_admin_overview", []), /FORBIDDEN/);
  // Re-grant admin back to first admin for remaining assertions.
  await rpc(secondAdmin, "app_admin_set_user_role", [admin, "admin", true]);

  // Admin group moderation: list and delete violating group safely, while regular user still cannot delete foreign group.
  await assert.rejects(rpc(regular, "app_delete_group", [group.id]), /FORBIDDEN/);
  await assert.rejects(rpc(admin, "app_admin_list_groups", [0]), /INVALID_INPUT/);
  const adminGroups = await rpc(admin, "app_admin_list_groups", [50]);
  const listedGroup = adminGroups.find((g) => g.id === group.id);
  assert.ok(listedGroup);
  assert.equal(listedGroup.owner_username, "rbac_group_owner");
  assert.equal(listedGroup.member_count, 2);
  assert.equal(listedGroup.message_count, 1);

  assert.equal(await rpc(admin, "app_admin_delete_group", [group.id]), true);
  assert.equal(await rpc(admin, "app_admin_delete_group", [group.id]), false);
  assert.equal((await db.query("select count(*)::int as n from study_group_messages where id=$1", [groupMsg.id])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from notifications where group_id=$1 and kind='group_message'", [group.id])).rows[0].n, 0);

  // Admin overview reflects counts and recent audit entries.
  const overview = await rpc(admin, "app_admin_overview", []);
  assert.equal(overview.counts.admins, 2);
  assert.equal(overview.counts.content_managers, 2);
  assert.ok(overview.counts.users >= 5);
  assert.ok(overview.counts.profiles >= 5);
  assert.ok(overview.counts.ready_documents >= 3);
  assert.ok(overview.counts.published_documents >= 1);
  assert.equal(typeof overview.counts.study_groups, "number");
  assert.equal(typeof overview.counts.active_jobs, "number");
  assert.ok(overview.recent_audit.length >= 5);
  assert.equal(overview.recent_audit[0].action, "delete_group");
  assert.equal(overview.recent_audit[0].actor_username, "rbac_admin");
  assert.equal(overview.recent_audit[0].target_id, group.id);

  // Anonymous and unauthenticated access blocked on every admin RPC.
  await db.exec("set role anon");
  try {
    for (const statement of [
      "select * from user_roles",
      "select app_admin_overview()",
      "select app_admin_list_users()",
      `select app_admin_set_user_role('${regular}','content_manager',true)`,
      "select app_admin_list_groups()",
      `select app_admin_delete_group('${randomUUID()}')`,
    ]) {
      await assert.rejects(db.query(statement), /permission denied/);
    }
  } finally {
    await db.exec("reset role");
  }
  for (const [fn, args] of [
    ["app_admin_overview", []],
    ["app_admin_list_users", []],
    ["app_admin_set_user_role", [regular, "content_manager", true]],
    ["app_admin_list_groups", []],
    ["app_admin_delete_group", [randomUUID()]],
  ]) {
    await assert.rejects(rpc("", fn, args), /UNAUTHORIZED/);
  }
});

test("native question images stay in original format with 3 MB cap and subject exemption", async () => {
  const user = await learner();
  const bucket = (await db.query("select allowed_mime_types from storage.buckets where id='documents'")).rows[0];
  assert.ok(bucket.allowed_mime_types.includes("image/png"));
  assert.ok(bucket.allowed_mime_types.includes("image/jpeg"));
  assert.ok(bucket.allowed_mime_types.includes("image/webp"));

  const pngDoc = await rpc(user, "app_upload_intent", ["Ảnh câu hỏi - bai1.png", 120000, "calculus", randomUUID()]);
  assert.equal(pngDoc.file_type, "png");
  assert.ok(pngDoc.storage_path.endsWith(".png"));

  const webpDoc = await rpc(user, "app_upload_intent", ["Ảnh câu hỏi - bai2.webp", 90000, "calculus", randomUUID()]);
  assert.equal(webpDoc.file_type, "webp");
  assert.ok(webpDoc.storage_path.endsWith(".webp"));

  await assert.rejects(
    rpc(user, "app_upload_intent", ["photo.png", 10000, "calculus", randomUUID()]),
    /INVALID_FILE/,
  );
  await assert.rejects(
    rpc(user, "app_upload_intent", ["Ảnh câu hỏi - huge.jpg", 3 * 1024 * 1024 + 1, "calculus", randomUUID()]),
    /INVALID_FILE/,
  );

  await db.query("update documents set status='ready' where id=$1", [pngDoc.id]);
  const conv = await rpc(user, "app_create_conversation", [randomUUID()]);
  const job = await rpc(user, "app_send_message", [conv, "Giải giúp bài này", [pngDoc.id], randomUUID(), "documents", "physics"]);
  assert.equal(job.kind, "chat");
});
