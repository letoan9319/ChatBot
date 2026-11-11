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
const historicalLearner = randomUUID();
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
  await db.exec(await readFile(
    new URL("../supabase/migrations/202610220002_profiles.sql", import.meta.url), "utf8",
  ));
  await db.exec(await readFile(
    new URL("../supabase/migrations/202610220003_embedding_profiles.sql", import.meta.url), "utf8",
  ));
  await db.exec(await readFile(
    new URL("../supabase/migrations/202610220004_chat_fallback.sql", import.meta.url), "utf8",
  ));
  await db.query("insert into auth.users values($1),($2),($3)", [alice, bob, historicalLearner]);
  // Pre-migration history crosses midnight in Vietnam, not in UTC.
  await streakJob(historicalLearner, { finishedAt: "2020-01-01T16:59:59Z", complete: true });
  await streakJob(historicalLearner, { finishedAt: "2020-01-01T17:00:00Z", complete: true });
  await streakJob(historicalLearner, { finishedAt: "2020-01-01T20:00:00Z", complete: true });
  await streakJob(historicalLearner, { finishedAt: "2020-01-02T17:00:00Z", complete: true, cited: false });
  await streakJob(historicalLearner, { finishedAt: "2020-01-03T17:00:00Z", complete: false });
  await db.exec(await readFile(
    new URL("../supabase/migrations/202610220005_study_streaks.sql", import.meta.url), "utf8",
  ));
  await db.exec("insert into public.worker_heartbeats(id) values('test')");
  await db.exec(await readFile(
    new URL("../supabase/migrations/202610300001_document_repository.sql", import.meta.url), "utf8",
  ));
});
after(async () => {
  await db?.close();
});

test("username claims are normalized, unique and idempotent for each owner", async () => {
  const claim = (owner, name) => asUser(owner, async () =>
    (await db.query("select app_set_username($1) as username", [name])).rows[0].username,
  );
  assert.equal(await claim(alice, "  Alice_01  "), "alice_01");
  assert.equal(await claim(alice, "another_name"), "alice_01");
  await assert.rejects(claim(bob, "ALICE_01"), /USERNAME_TAKEN/);
  for (const invalid of [null, "", "ab", "12alice", "a-b", "tên", "a".repeat(25)]) {
    await assert.rejects(claim(bob, invalid), /INVALID_USERNAME/);
  }
  assert.equal(await claim(bob, "bob_02"), "bob_02");
});

test("profiles isolate reads and reject direct writes, anonymous access and forged owners", async () => {
  await asUser(bob, async () => {
    assert.equal((await db.query("select * from profiles where id=$1", [alice])).rows.length, 0);
    assert.equal((await db.query("select username from profiles where id=$1", [bob])).rows[0].username, "bob_02");
    await assert.rejects(db.query("insert into profiles(id,username) values($1,'forged')", [alice]), /permission denied/);
    await assert.rejects(db.query("update profiles set username='changed' where id=$1", [bob]), /permission denied/);
  });
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select * from profiles"), /permission denied/);
    await assert.rejects(db.query("select app_set_username('anonymous')"), /permission denied/);
  } finally { await db.exec("reset role"); }
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

async function streakJob(owner, { finishedAt = null, complete = false, cited = true, role = "assistant" } = {}) {
  const conversationId = randomUUID(), documentId = randomUUID(), messageId = randomUUID(), jobId = randomUUID();
  await db.query("insert into conversations(id,user_id) values($1,$2)", [conversationId, owner]);
  await db.query(`insert into documents(id,user_id,name,subject,file_type,size_bytes,storage_path,status,upload_key)
    values($1,$2,'study.pdf','calculus','pdf',100,$3,'ready',$4)`,
    [documentId, owner, `${owner}/${documentId}.pdf`, randomUUID()]);
  await db.query(`insert into messages(id,conversation_id,user_id,role,content,status)
    values($1,$2,$3,$4,'A cited learning answer [S1]','completed')`, [messageId, conversationId, owner, role]);
  if (cited) await db.query(`insert into message_sources(message_id,document_id,user_id,label,document_name)
    values($1,$2,$3,'S1','study.pdf')`, [messageId, documentId, owner]);
  await db.query(`insert into jobs(id,user_id,kind,message_id,request_key,status,finished_at)
    values($1,$2,'chat',$3,$4,$5,$6)`,
    [jobId, owner, messageId, randomUUID(), complete ? "completed" : "failed", finishedAt]);
  return { jobId, messageId, documentId };
}

async function learner() {
  const id = randomUUID();
  await db.query("insert into auth.users values($1)", [id]);
  return id;
}
async function streak(owner) {
  return asUser(owner, async () => (await db.query("select app_get_streak() as streak")).rows[0].streak);
}
async function addStudyDays(owner, offsets) {
  await db.query(`insert into study_activity_days(user_id,study_date,first_completed_at)
    select $1,(statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date+offset_days,now()
    from unnest($2::integer[]) as offsets(offset_days)`, [owner, offsets]);
}

test("streak backfill uses cited job completion time and Vietnam midnight", async () => {
  const result = await streak(historicalLearner);
  assert.equal(result.total_days, 2);
  assert.equal(result.longest, 2);
  assert.equal(result.current, 0);
  assert.equal(result.last_study_date, "2020-01-02");
  const rows = (await db.query(`select study_date::text as day,(first_completed_at at time zone 'UTC')::text as completed
    from study_activity_days where user_id=$1 order by study_date`, [historicalLearner])).rows;
  assert.deepEqual(rows.map((row) => row.day), ["2020-01-01", "2020-01-02"]);
  assert.match(rows[1].completed, /17:00:00/);
});

test("new learners get zero streak and a seven-day calendar without awarding a visit", async () => {
  const owner = await learner();
  const result = await streak(owner);
  assert.equal(result.current, 0);
  assert.equal(result.longest, 0);
  assert.equal(result.total_days, 0);
  assert.equal(result.today_completed, false);
  assert.equal(result.last_study_date, null);
  assert.equal(result.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(result.week.length, 7);
  assert.equal(result.week.at(-1).date, result.today);
  assert.ok(result.week.every((day) => day.completed === false));
  assert.equal((await streak(owner)).total_days, 0);
});

test("a streak stays active through today, extends once, and preserves the longest run", async () => {
  const owner = await learner();
  await addStudyDays(owner, [-9, -8, -7, -6, -3, -2, -1]);
  const pending = await streak(owner);
  assert.equal(pending.current, 3);
  assert.equal(pending.longest, 4);
  assert.equal(pending.total_days, 7);
  assert.equal(pending.today_completed, false);
  assert.equal(pending.week.filter((day) => day.completed).length, 4);
  await addStudyDays(owner, [0]);
  const done = await streak(owner);
  assert.equal(done.current, 4);
  assert.equal(done.longest, 4);
  assert.equal(done.total_days, 8);
  assert.equal(done.today_completed, true);
});

test("missing a full day resets the current streak without losing the record", async () => {
  const owner = await learner();
  await addStudyDays(owner, [-6, -5, -4, -2]);
  assert.equal((await streak(owner)).current, 0);
  await addStudyDays(owner, [0]);
  const result = await streak(owner);
  assert.equal(result.current, 1);
  assert.equal(result.longest, 3);
  assert.equal(result.total_days, 5);
});

test("calendar streaks cross leap days and year boundaries", async () => {
  const owner = await learner();
  await db.query(`insert into study_activity_days(user_id,study_date,first_completed_at)
    select $1,day,now() from unnest($2::date[]) as dates(day)`,
    [owner, ["2024-02-28", "2024-02-29", "2024-03-01", "2024-12-31", "2025-01-01"]]);
  assert.equal((await streak(owner)).longest, 3);
});

test("only committed, cited assistant completions award a day, and retries cannot duplicate it", async () => {
  const owner = await learner();
  const job = await streakJob(owner);
  assert.equal((await streak(owner)).total_days, 0);
  await db.exec("begin");
  await db.query("update jobs set status='completed',finished_at=now() where id=$1", [job.jobId]);
  await db.exec("rollback");
  assert.equal((await streak(owner)).total_days, 0);
  await db.query("update jobs set status='completed',finished_at=now() where id=$1", [job.jobId]);
  await db.query("update jobs set status='completed',finished_at=now() where id=$1", [job.jobId]);
  const second = await streakJob(owner);
  await db.query("update jobs set status='completed',finished_at=now() where id=$1", [second.jobId]);
  const result = await streak(owner);
  assert.equal(result.current, 1);
  assert.equal(result.longest, 1);
  assert.equal(result.total_days, 1);
  // Removing a document does not erase a day of actual past study.
  await db.query("update documents set status='deleted' where id=$1", [job.documentId]);
  assert.equal((await streak(owner)).total_days, 1);
});

test("failed, uncited, empty, wrong-owner and non-chat results do not earn streaks", async () => {
  const owner = await learner();
  const uncited = await streakJob(owner, { cited: false });
  const userMessage = await streakJob(owner, { role: "user" });
  const empty = await streakJob(owner);
  await db.query("update messages set content='   ' where id=$1", [empty.messageId]);
  const ingest = await streakJob(owner);
  await db.query("update jobs set kind='ingest' where id=$1", [ingest.jobId]);
  const foreign = await streakJob(await learner());
  await db.query("update jobs set user_id=$1 where id=$2", [owner, foreign.jobId]);
  for (const job of [uncited, userMessage, empty, ingest, foreign]) {
    await db.query("update jobs set status='completed',finished_at=now() where id=$1", [job.jobId]);
  }
  assert.equal((await streak(owner)).total_days, 0);
});

test("streak dates ignore connection timezone and forged completion timestamps", async () => {
  const owner = await learner();
  const job = await streakJob(owner);
  try {
    await db.exec("set timezone='Pacific/Honolulu'");
    await db.query("update jobs set status='completed',finished_at='2020-01-01' where id=$1", [job.jobId]);
    const result = await streak(owner);
    const expected = (await db.query("select (statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text as day")).rows[0].day;
    assert.equal(result.today, expected);
    assert.equal(result.last_study_date, expected);
    assert.equal(result.today_completed, true);
  } finally { await db.exec("set timezone='UTC'"); }
});

test("streak data is private and clients cannot forge a learning day or trigger it", async () => {
  const owner = await learner(), other = await learner();
  await addStudyDays(owner, [0]);
  assert.equal((await streak(other)).total_days, 0);
  await asUser(other, async () => {
    assert.equal((await db.query("select * from study_activity_days where user_id=$1", [owner])).rows.length, 0);
    await assert.rejects(db.query("insert into study_activity_days values($1,current_date,now())", [other]), /permission denied/);
    await assert.rejects(db.query("update study_activity_days set study_date=current_date"), /permission denied/);
    await assert.rejects(db.query("delete from study_activity_days"), /permission denied/);
    await assert.rejects(db.query("select app_record_study_day()"), /permission denied/);
    await assert.rejects(db.query("select app_get_streak($1)", [owner]), /does not exist/);
  });
  await db.exec("set role anon");
  try { await assert.rejects(db.query("select app_get_streak()"), /permission denied/); }
  finally { await db.exec("reset role"); }
  await asUser("", async () => {
    await assert.rejects(db.query("select app_get_streak()"), /UNAUTHORIZED/);
  });
});
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

test("embedding metadata stays owner-private and provider heartbeat is read-only and fresh", async () => {
  const doc = await readyDocument();
  const row = (await db.query("select embedding_profile,vector_collection from documents where id=$1", [doc.id])).rows[0];
  assert.equal(row.embedding_profile, "ollama:bge-m3");
  assert.equal(row.vector_collection, "study_bge_m3_v1");
  await asUser(bob, async () => {
    assert.equal((await db.query("select vector_collection from documents where id=$1", [doc.id])).rows.length, 0);
    await assert.rejects(db.query("update documents set embedding_profile='forged' where id=$1", [doc.id]), /permission denied/);
    await assert.rejects(db.query("update worker_heartbeats set ai_provider='openrouter'"), /permission denied/);
  });
  try {
    await db.exec("update worker_heartbeats set ai_provider='openrouter',last_seen=now()");
    await asUser(alice, async () => {
      assert.equal((await db.query("select app_ai_provider() as provider")).rows[0].provider, "openrouter");
    });
    await db.exec("update worker_heartbeats set ai_provider='ollama',chat_fallback_enabled=true");
    await asUser(alice, async () => {
      assert.equal((await db.query("select app_ai_provider() as provider")).rows[0].provider, "ollama_with_openrouter_fallback");
    });
    await db.exec("update worker_heartbeats set last_seen=now()-interval '61 seconds'");
    await asUser(alice, async () => {
      assert.equal((await db.query("select app_ai_provider() as provider")).rows[0].provider, null);
    });
    await db.exec("set role anon");
    await assert.rejects(db.query("select app_ai_provider()"), /permission denied/);
  } finally {
    await db.exec("reset role; update worker_heartbeats set ai_provider='ollama',chat_fallback_enabled=false,last_seen=now()");
  }
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
    "update messages set status='completed',content='answer',generation_provider='openrouter' where id=$1",
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
  await asUser(alice, async () => {
    const message = (await db.query("select generation_provider from messages where id=$1", [job.message_id])).rows[0];
    assert.equal(message.generation_provider, "openrouter");
    await assert.rejects(db.query("update messages set generation_provider='ollama' where id=$1", [job.message_id]), /permission denied/);
  });
});
