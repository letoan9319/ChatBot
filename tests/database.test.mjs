import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL/PLpgSQL + RLS in WASM. Only Supabase-owned schemas and
// pgmq.send/create are substituted; live PGMQ lifecycle tests are separate.
let db;
const alice = randomUUID();
const bob = randomUUID();
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
    create table pgmq.test_queue(id bigint generated always as identity, message jsonb);
    create function pgmq.create(text) returns void language sql as $$ select $$;
    create function pgmq.send(text,jsonb) returns bigint language sql as
    $$ insert into pgmq.test_queue(message) values($2) returning id $$;
  `);
  const migration = await readFile(
    new URL("../supabase/migrations/202610220001_initial.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration.replace("create extension if not exists pgmq;", ""));
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("insert into public.worker_heartbeats(id) values('test')");
});
after(async () => {
  await db?.close();
});

async function asUser(user, callback) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}
async function intent(user = alice, options = {}) {
  const values = {
    name: "Giai-tich.pdf",
    size: 100,
    subject: "calculus",
    key: randomUUID(),
    ...options,
  };
  return asUser(
    user,
    async () =>
      (
        await db.query("select app_upload_intent($1,$2,$3,$4) as doc", [
          values.name,
          values.size,
          values.subject,
          values.key,
        ])
      ).rows[0].doc,
  );
}
async function readyDocument(user = alice) {
  const doc = await intent(user);
  await db.query("update documents set status='ready' where id=$1", [doc.id]);
  return doc;
}
async function conversation(user = alice) {
  return asUser(
    user,
    async () =>
      (
        await db.query("select app_create_conversation($1) as id", [
          randomUUID(),
        ])
      ).rows[0].id,
  );
}
async function send(
  user,
  conv,
  docs,
  key = randomUUID(),
  question = "Dao ham la gi?",
) {
  return asUser(
    user,
    async () =>
      (
        await db.query("select app_send_message($1,$2,$3::uuid[],$4) as job", [
          conv,
          question,
          docs,
          key,
        ])
      ).rows[0].job,
  );
}

test("RLS isolates all reads and blocks direct client mutations", async () => {
  const doc = await readyDocument();
  await asUser(bob, async () => {
    assert.equal(
      (await db.query("select * from documents where id=$1", [doc.id])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("update documents set status='ready' where id=$1", [doc.id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into messages(conversation_id,user_id,role) values($1,$2,'assistant')",
        [randomUUID(), bob],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from pgmq.test_queue"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select app_require_online()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select app_enqueue_document($1,'delete',$2)", [
        doc.id,
        randomUUID(),
      ]),
      /NOT_FOUND/,
    );
  });
});

test("upload intents validate format, null input and stable idempotency", async () => {
  const key = randomUUID();
  const doc = await intent(alice, { key });
  assert.equal((await intent(alice, { key })).id, doc.id);
  await assert.rejects(
    intent(alice, { key, name: "Other.pdf" }),
    /IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(intent(alice, { name: "bad.exe" }), /INVALID_FILE/);
  await assert.rejects(intent(alice, { size: 20971521 }), /INVALID_FILE/);
  await assert.rejects(intent(alice, { size: null }), /INVALID_FILE/);
});

test("enqueue creates one durable job even with a different retry key", async () => {
  const doc = await intent();
  const enqueue = (key) =>
    asUser(
      alice,
      async () =>
        (
          await db.query(
            "select app_enqueue_document($1,'complete',$2) as job",
            [doc.id, key],
          )
        ).rows[0].job,
    );
  const a = await enqueue(randomUUID());
  const b = await enqueue(randomUUID());
  assert.equal(a.id, b.id);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from pgmq.test_queue where message->>'job_id'=$1",
        [a.id],
      )
    ).rows[0].n,
    1,
  );
});

test("chat enforces ownership, ready state, document count and one active job", async () => {
  const doc = await readyDocument();
  const foreign = await readyDocument(bob);
  const conv = await conversation();
  await assert.rejects(send(alice, conv, [foreign.id]), /INVALID_DOCUMENTS/);
  await assert.rejects(send(alice, conv, []), /INVALID_QUESTION/);
  await assert.rejects(send(alice, conv, null), /INVALID_QUESTION/);
  await assert.rejects(
    send(alice, conv, [doc.id, doc.id]),
    /INVALID_DOCUMENTS/,
  );
  await assert.rejects(send(bob, conv, [foreign.id]), /NOT_FOUND/);
  const key = randomUUID();
  const job = await send(alice, conv, [doc.id], key);
  assert.equal((await send(alice, conv, [doc.id], key)).id, job.id);
  await assert.rejects(
    send(alice, conv, [doc.id], key, "different"),
    /IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(send(alice, conv, [doc.id]), /CHAT_BUSY/);
  await db.query("update jobs set status='completed' where id=$1", [job.id]);
});

test("deleting blocks new questions and hides canonical chunks/storage immediately", async () => {
  const doc = await readyDocument();
  const conv = await conversation();
  const chunk = randomUUID();
  await db.query(
    "insert into document_chunks(id,document_id,user_id,index_version,ordinal,content) values($1,$2,$3,1,0,'secret')",
    [chunk, doc.id, alice],
  );
  await db.query(
    "insert into storage.objects(bucket_id,name) values('documents',$1)",
    [doc.storage_path],
  );
  assert.equal(
    await asUser(
      alice,
      async () =>
        (await db.query("select * from document_chunks where id=$1", [chunk]))
          .rows.length,
    ),
    1,
  );
  await asUser(alice, () =>
    db.query("select app_enqueue_document($1,'delete',$2)", [
      doc.id,
      randomUUID(),
    ]),
  );
  assert.equal(
    await asUser(
      alice,
      async () =>
        (await db.query("select * from document_chunks where id=$1", [chunk]))
          .rows.length,
    ),
    0,
  );
  assert.equal(
    await asUser(
      alice,
      async () =>
        (
          await db.query("select * from storage.objects where name=$1", [
            doc.storage_path,
          ])
        ).rows.length,
    ),
    0,
  );
  await assert.rejects(send(alice, conv, [doc.id]), /INVALID_DOCUMENTS/);
});

test("offline refuses new AI tasks but allows cleanup", async () => {
  const doc = await readyDocument();
  const conv = await conversation();
  await db.exec(
    "update worker_heartbeats set last_seen=now()-interval '2 minutes'",
  );
  await assert.rejects(intent(), /WORKER_OFFLINE/);
  await assert.rejects(send(alice, conv, [doc.id]), /WORKER_OFFLINE/);
  await asUser(alice, () =>
    db.query("select app_enqueue_document($1,'delete',$2)", [
      doc.id,
      randomUUID(),
    ]),
  );
  await db.exec("update worker_heartbeats set last_seen=now()");
});

test("quota checks are enforced in RPCs, not just the UI", async () => {
  const user = randomUUID();
  await db.query("insert into auth.users values($1)", [user]);
  for (let i = 0; i < 20; i++) await intent(user);
  await assert.rejects(intent(user), /DOCUMENT_LIMIT/);
  const doc = (
    await db.query(
      "update documents set status='ready' where user_id=$1 returning id",
      [user],
    )
  ).rows[0];
  const conv = await conversation(user);
  for (let i = 0; i < 30; i++) {
    const job = await send(user, conv, [doc.id]);
    await db.query("update jobs set status='completed' where id=$1", [job.id]);
  }
  await assert.rejects(send(user, conv, [doc.id]), /RATE_LIMIT/);
});

test("anonymous users cannot call mutations or read user tables", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(
      db.query("select * from documents"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select app_create_conversation($1)", [randomUUID()]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select app_worker_online()"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("enqueue rolls back the document and job if queue send fails", async () => {
  const doc = await intent();
  await db.exec(`create or replace function pgmq.send(text,jsonb) returns bigint language plpgsql as
    $$ begin raise exception 'SIMULATED_QUEUE_FAILURE'; end $$`);
  try {
    await assert.rejects(
      asUser(alice, () =>
        db.query("select app_enqueue_document($1,'complete',$2)", [
          doc.id,
          randomUUID(),
        ]),
      ),
      /SIMULATED_QUEUE_FAILURE/,
    );
    assert.equal(
      (await db.query("select status from documents where id=$1", [doc.id]))
        .rows[0].status,
      "uploading",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from jobs where document_id=$1",
          [doc.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.exec(`create or replace function pgmq.send(text,jsonb) returns bigint language sql as
      $$ insert into pgmq.test_queue(message) values($2) returning id $$`);
  }
});

test("child records and jobs are private; deleting chunks preserves source tombstones", async () => {
  const doc = await readyDocument();
  const conv = await conversation();
  const job = await send(alice, conv, [doc.id]);
  const chunk = randomUUID();
  const source = randomUUID();
  await db.query("update jobs set status='completed' where id=$1", [job.id]);
  await db.query(
    "update messages set status='completed',content='answer' where id=$1",
    [job.message_id],
  );
  await db.query(
    "insert into document_chunks(id,document_id,user_id,index_version,ordinal,content) values($1,$2,$3,1,0,'private source')",
    [chunk, doc.id, alice],
  );
  await db.query(
    "insert into message_sources(id,message_id,chunk_id,document_id,user_id,label,document_name) values($1,$2,$3,$4,$5,'S1','private.pdf')",
    [source, job.message_id, chunk, doc.id, alice],
  );
  await asUser(bob, async () => {
    for (const [table, id] of [
      ["messages", job.message_id],
      ["jobs", job.id],
      ["document_chunks", chunk],
      ["message_sources", source],
    ]) {
      assert.equal(
        (await db.query(`select * from ${table} where id=$1`, [id])).rows
          .length,
        0,
      );
    }
  });
  await db.query("delete from document_chunks where id=$1", [chunk]);
  const row = await asUser(
    alice,
    async () =>
      (await db.query("select * from message_sources where id=$1", [source]))
        .rows[0],
  );
  assert.equal(row.chunk_id, null);
  assert.equal(row.document_name, "private.pdf");
});
