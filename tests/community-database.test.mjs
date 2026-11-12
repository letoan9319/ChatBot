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
  ]) {
    const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    await db.exec(sql.replace("create extension if not exists pgmq;", ""));
  }
});
after(async () => { await db?.close(); });

test("external chat modes allow zero sources and participate in idempotency", async () => {
  const user = await learner();
  await db.query("insert into worker_heartbeats(id) values($1)", [randomUUID()]);
  const conversation = await rpc(user, "app_create_conversation", [randomUUID()]);
  const args = [conversation, "Định luật Newton là gì?", [], randomUUID()];
  await assert.rejects(rpc(user, "app_send_message", args), /INVALID_QUESTION/);
  await assert.rejects(rpc(user, "app_send_message", [...args, "invalid"]), /INVALID_QUESTION/);
  const job = await rpc(user, "app_send_message", [...args, "research"]);
  assert.equal(job.payload.mode, "research");
  assert.equal((await rpc(user, "app_send_message", [...args, "research"])).id, job.id);
  await assert.rejects(rpc(user, "app_send_message", [...args, "library"]), /IDEMPOTENCY_CONFLICT/);
  const other = await learner();
  const otherConversation = await rpc(other, "app_create_conversation", [randomUUID()]);
  const libraryJob = await rpc(other, "app_send_message", [otherConversation, args[1], [], randomUUID(), "library"]);
  assert.equal(libraryJob.payload.mode, "library");
  assert.deepEqual(libraryJob.payload.document_ids, []);
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
  });
});
