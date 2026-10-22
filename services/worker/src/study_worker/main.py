import json
import logging
import signal
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import Settings
from .documents import InvalidDocument, chunk_sections, extract
from .models import create_models, VectorStore
from .openrouter import ProviderError
from .rag import NO_EVIDENCE, build_prompt, validate_citations

LOG = logging.getLogger("study_worker")
LOCK_ID = 706294811
LEASE_SECONDS = 120


class Cancelled(Exception):
    pass


class LostLease(Exception):
    pass


class IndexMismatch(Exception):
    pass


def connect(settings):
    return psycopg.connect(settings.database_url, autocommit=True, row_factory=dict_row, connect_timeout=15)


def guard(conn, job):
    row = conn.execute("select lease_token,status from public.jobs where id=%s for update", (job["id"],)).fetchone()
    if not row or row["lease_token"] != job["lease_token"] or row["status"] != "running":
        raise LostLease()


class Heartbeat(threading.Thread):
    def __init__(self, settings):
        super().__init__(daemon=True)
        self.settings = settings
        self.stopped = threading.Event()
        self.lost = threading.Event()
        self.lock = threading.Lock()
        self.active = None
        self.worker_id = "learnstep-worker"

    def set_active(self, job):
        with self.lock:
            self.active = job
            self.lost.clear()

    def run(self):
        conn = None
        while not self.stopped.is_set():
            try:
                if conn is None or conn.closed:
                    conn = connect(self.settings)
                with self.lock:
                    job = self.active
                    with conn.transaction():
                        conn.execute(
                            """insert into public.worker_heartbeats(id,last_seen,ai_provider,chat_fallback_enabled)
                            values(%s,now(),%s,%s) on conflict(id) do update set
                            last_seen=excluded.last_seen,ai_provider=excluded.ai_provider,
                            chat_fallback_enabled=excluded.chat_fallback_enabled""",
                            (self.worker_id, self.settings.ai_provider, self.settings.chat_fallback == "openrouter"),
                        )
                        if job:
                            current = conn.execute(
                                "select id from public.jobs where id=%s and lease_token=%s and status='running' for update",
                                (job["id"], job["lease_token"]),
                            ).fetchone()
                            if current:
                                conn.execute("select pgmq.set_vt('study_jobs',%s,%s)", (job["queue_id"], LEASE_SECONDS))
                            else:
                                self.lost.set()
            except Exception:
                self.lost.set()
                if conn:
                    conn.close()
                conn = None
                LOG.warning("heartbeat_failed")
            self.stopped.wait(15)
        if conn:
            try:
                conn.execute("delete from public.worker_heartbeats where id=%s", (self.worker_id,))
            except Exception:
                pass
            conn.close()


def claim(conn):
    with conn.transaction():
        message = conn.execute("select * from pgmq.read('study_jobs',%s,1)", (LEASE_SECONDS,)).fetchone()
        if not message:
            return None
        job = conn.execute(
            "select * from public.jobs where id=%s for update", (message["message"]["job_id"],)
        ).fetchone()
        if not job or job["status"] in ("completed", "failed"):
            conn.execute("select pgmq.archive('study_jobs',%s)", (message["msg_id"],))
            return None
        exhausted = job["attempts"] >= 3
        token = uuid4()
        job = conn.execute(
            """update public.jobs set status='running', attempts=least(attempts+1,3),lease_token=%s,
            started_at=coalesce(started_at,now()),error=null where id=%s returning *""",
            (token, job["id"]),
        ).fetchone()
        if job["message_id"] and not exhausted:
            conn.execute("delete from public.message_sources where message_id=%s", (job["message_id"],))
            conn.execute(
                "update public.messages set content='',status='generating',generation_provider=null where id=%s",
                (job["message_id"],),
            )
        job["queue_id"] = message["msg_id"]
        job["exhausted"] = exhausted
        return job


def finish(conn, job):
    with conn.transaction():
        guard(conn, job)
        conn.execute(
            "update public.jobs set status='completed',finished_at=now(),lease_token=null where id=%s", (job["id"],)
        )
        conn.execute("select pgmq.archive('study_jobs',%s)", (job["queue_id"],))


def fail(conn, job, message, permanent=False, retry_seconds=10):
    terminal = permanent or job["attempts"] >= 3
    with conn.transaction():
        guard(conn, job)
        conn.execute(
            "update public.jobs set status=%s,error=%s,finished_at=%s,lease_token=null where id=%s",
            ("failed" if terminal else "queued", message, datetime.now(timezone.utc) if terminal else None, job["id"]),
        )
        if job["message_id"]:
            conn.execute(
                "update public.messages set status=%s where id=%s",
                ("failed" if terminal else "interrupted", job["message_id"]),
            )
        if job["kind"] == "ingest":
            conn.execute(
                """update public.documents set status=%s,error=%s where id=%s
                and status not in ('deleting','deleted') and index_version=%s""",
                ("failed" if terminal else "queued", message, job["document_id"], job["payload"]["index_version"]),
            )
        if job["kind"] == "delete":
            conn.execute(
                "update public.documents set error=%s where id=%s and status='deleting'", (message, job["document_id"])
            )
        if terminal:
            conn.execute("select pgmq.archive('study_jobs',%s)", (job["queue_id"],))
        else:
            conn.execute("select pgmq.set_vt('study_jobs',%s,%s)", (job["queue_id"], retry_seconds))


class Pipeline:
    def __init__(self, settings, conn, models, vectors, heartbeat):
        self.settings, self.conn = settings, conn
        self.models, self.vectors, self.heartbeat = models, vectors, heartbeat
        self.storage = httpx.Client(
            base_url=settings.supabase_url.rstrip("/"),
            timeout=60,
            headers={
                "apikey": settings.supabase_key,
                "Authorization": f"Bearer {settings.supabase_key}",
            },
        )

    def document(self, job):
        if self.heartbeat.lost.is_set():
            raise LostLease()
        doc = self.conn.execute(
            "select * from public.documents where id=%s and user_id=%s", (job["document_id"], job["user_id"])
        ).fetchone()
        if (
            not doc
            or doc["status"] in ("deleting", "deleted")
            or doc["index_version"] != job["payload"]["index_version"]
        ):
            raise Cancelled()
        return doc

    def ingest(self, job):
        doc = self.document(job)
        with self.conn.transaction():
            guard(self.conn, job)
            self.conn.execute(
                "update public.documents set status='processing',error=null where id=%s and status in ('queued','processing')",
                (doc["id"],),
            )
        with self.storage.stream(
            "GET", f"/storage/v1/object/authenticated/documents/{doc['storage_path']}"
        ) as response:
            response.raise_for_status()
            data = bytearray()
            for block in response.iter_bytes(65536):
                data.extend(block)
                if len(data) > 20 * 1024 * 1024:
                    raise InvalidDocument("File vượt quá 20 MB.")
        if len(data) != doc["size_bytes"]:
            raise InvalidDocument("Dung lượng file không khớp với thông tin đã đăng ký.")
        chunks = chunk_sections(
            extract(bytes(data), doc["file_type"]), self.models.tokenizer, str(doc["id"]), doc["index_version"]
        )
        if not chunks:
            raise InvalidDocument("Không tìm thấy đoạn văn bản có thể sử dụng.")
        # Remove the old namespace before recording a new one, including failed attempts.
        self.vectors.delete(job["user_id"], doc["id"], doc["vector_collection"])
        with self.conn.transaction():
            guard(self.conn, job)
            self.conn.execute("select id from public.documents where id=%s for update", (doc["id"],))
            self.document(job)
            self.conn.execute(
                "update public.documents set vector_collection=%s,embedding_profile=%s where id=%s and user_id=%s",
                (self.vectors.collection, self.settings.embedding_profile, doc["id"], job["user_id"]),
            )
        # Rebuild deterministically; cleans up vectors from a previous failed version.
        self.vectors.delete(job["user_id"], doc["id"])
        for start in range(0, len(chunks), 8):
            self.document(job)
            batch = chunks[start : start + 8]
            embeddings = self.models.embed([chunk["content"] for chunk in batch])
            self.document(job)
            self.vectors.upsert(job["user_id"], doc["id"], doc["index_version"], batch, embeddings)
        try:
            with self.conn.transaction():
                guard(self.conn, job)
                self.conn.execute("select id from public.documents where id=%s for update", (doc["id"],))
                self.document(job)
                self.conn.execute("delete from public.document_chunks where document_id=%s", (doc["id"],))
                for chunk in chunks:
                    self.conn.execute(
                        """insert into public.document_chunks(id,document_id,user_id,index_version,ordinal,content,page,section,paragraph)
                        values(%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (
                            chunk["id"],
                            doc["id"],
                            job["user_id"],
                            doc["index_version"],
                            chunk["ordinal"],
                            chunk["content"],
                            chunk["page"],
                            chunk["section"],
                            chunk["paragraph"],
                        ),
                    )
                self.conn.execute("update public.documents set status='ready',error=null where id=%s", (doc["id"],))
                finish(self.conn, job)
        except Cancelled:
            self.vectors.delete(job["user_id"], doc["id"])
            raise

    def delete(self, job):
        doc = self.conn.execute(
            "select * from public.documents where id=%s and user_id=%s", (job["document_id"], job["user_id"])
        ).fetchone()
        if not doc:
            finish(self.conn, job)
            return
        self.vectors.delete(job["user_id"], doc["id"], doc["vector_collection"])
        response = self.storage.request(
            "DELETE", "/storage/v1/object/documents", json={"prefixes": [doc["storage_path"]]}
        )
        if response.status_code != 404:
            response.raise_for_status()
        with self.conn.transaction():
            guard(self.conn, job)
            self.conn.execute("select id from public.documents where id=%s for update", (doc["id"],))
            self.conn.execute("delete from public.document_chunks where document_id=%s", (doc["id"],))
            self.conn.execute("update public.documents set status='deleted',error=null where id=%s", (doc["id"],))
            finish(self.conn, job)

    def sweep_deleted_uploads(self):
        # A signed upload URL can outlive deletion and recreate an object.
        # Re-sweep tombstones until the last possible upload token has expired,
        # then do one final durable cleanup even after a long worker outage.
        rows = self.conn.execute(
            "select id,storage_path,upload_cleanup_after from public.documents where status='deleted' and not upload_cleanup_done limit 100"
        ).fetchall()
        for row in rows:
            response = self.storage.request(
                "DELETE", "/storage/v1/object/documents", json={"prefixes": [row["storage_path"]]}
            )
            if response.status_code != 404:
                response.raise_for_status()
            self.conn.execute(
                "update public.documents set upload_cleanup_done=true where id=%s and status='deleted' and upload_cleanup_after<now()",
                (row["id"],),
            )

    def chat_documents(self, job, lock=False):
        ids = job["payload"]["document_ids"]
        query = (
            "select id,status,index_version,embedding_profile,vector_collection from public.documents "
            "where user_id=%s and id=any(%s::uuid[]) order by id for share"
            if lock else
            "select id,status,index_version,embedding_profile,vector_collection from public.documents "
            "where user_id=%s and id=any(%s::uuid[]) order by id"
        )
        rows = self.conn.execute(
            query,
            (job["user_id"], ids),
        ).fetchall()
        if len(rows) != len(ids) or any(
            row["status"] != "ready" or row["index_version"] != job["payload"]["versions"][str(row["id"])]
            for row in rows
        ):
            raise Cancelled()
        if any(
            row["embedding_profile"] != self.settings.embedding_profile
            or row["vector_collection"] != self.vectors.collection for row in rows
        ):
            raise IndexMismatch()
        if self.heartbeat.lost.is_set():
            raise LostLease()

    def save_partial(self, job, content):
        with self.conn.transaction():
            guard(self.conn, job)
            self.chat_documents(job, lock=True)
            self.conn.execute(
                "update public.messages set content=%s,status='generating' where id=%s and user_id=%s",
                (content, job["message_id"], job["user_id"]),
            )

    def chat(self, job):
        payload = job["payload"]
        self.chat_documents(job)
        history = self.conn.execute(
            """select role,content from public.messages
            where conversation_id=%s and user_id=%s and status='completed' and sequence <
            (select sequence from public.messages where id=%s) order by sequence desc limit 6""",
            (payload["conversation_id"], job["user_id"], payload["user_message_id"]),
        ).fetchall()[::-1]
        previous_question = next((item["content"] for item in reversed(history) if item["role"] == "user"), "")
        query = (previous_question[:500] + "\n" + payload["question"]).strip()
        vector = self.models.embed([query], query=True)[0]
        hits = self.vectors.search(job["user_id"], payload["document_ids"], payload["versions"], vector)
        candidates = []
        for hit in hits:
            point = hit.payload or {}
            # Verify vector payload against the canonical owner, document and version in Postgres.
            if point.get("user_id") != str(job["user_id"]) or point.get("document_id") not in payload["document_ids"]:
                continue
            row = self.conn.execute(
                """select c.*,d.name as document_name from public.document_chunks c
                join public.documents d on d.id=c.document_id where c.id=%s and c.user_id=%s
                and c.document_id=%s and d.user_id=%s and d.status='ready'
                and c.index_version=d.index_version and c.index_version=%s""",
                (
                    point.get("chunk_id"),
                    job["user_id"],
                    point.get("document_id"),
                    job["user_id"],
                    payload["versions"].get(point.get("document_id")),
                ),
            ).fetchone()
            if row:
                candidates.append(row)
        self.chat_documents(job)
        candidates = self.models.rerank(query, candidates)
        self.chat_documents(job)
        prompt, selected = build_prompt(payload["question"], history, candidates, self.models.count)
        answer, used = NO_EVIDENCE, []
        if selected:
            answer = ""
            last_flush = time.monotonic()

            def reset_answer():
                nonlocal answer, last_flush
                answer = ""
                self.save_partial(job, answer)
                last_flush = time.monotonic()

            for token in self.models.generate(prompt, on_reset=reset_answer):
                if self.heartbeat.lost.is_set():
                    raise LostLease()
                answer += token
                if time.monotonic() - last_flush >= 1:
                    self.save_partial(job, answer)
                    last_flush = time.monotonic()
            answer, used = validate_citations(answer, selected)
        with self.conn.transaction():
            guard(self.conn, job)
            self.chat_documents(job, lock=True)
            self.conn.execute(
                "update public.messages set content=%s,status='completed',generation_provider=%s where id=%s",
                (answer, getattr(self.models, "last_generation_provider", self.settings.ai_provider) if selected else None,
                 job["message_id"]),
            )
            for item in used:
                self.conn.execute(
                    """insert into public.message_sources(message_id,chunk_id,document_id,user_id,label,document_name,page,section,paragraph)
                    values(%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict(message_id,label) do nothing""",
                    (
                        job["message_id"],
                        item["id"],
                        item["document_id"],
                        job["user_id"],
                        item["label"],
                        item["document_name"],
                        item["page"],
                        item["section"],
                        item["paragraph"],
                    ),
                )
            finish(self.conn, job)


def cleanup_abandoned(conn):
    with conn.transaction():
        rows = conn.execute("""update public.documents set status='deleting' where status='uploading'
            and created_at<now()-interval '24 hours' returning id,user_id""").fetchall()
        for doc in rows:
            job = conn.execute(
                "insert into public.jobs(user_id,kind,document_id,request_key) values(%s,'delete',%s,%s) returning id",
                (doc["user_id"], doc["id"], uuid4()),
            ).fetchone()
            conn.execute("select pgmq.send('study_jobs',%s)", (Jsonb({"job_id": str(job["id"])}),))


def serve(settings):
    stopped = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    with connect(settings) as conn:
        if not conn.execute("select pg_try_advisory_lock(%s) as acquired", (LOCK_ID,)).fetchone()["acquired"]:
            raise RuntimeError("Another worker holds the queue lock. Use a session connection, not transaction pooling.")
        conn.execute("select embedding_profile,vector_collection from public.documents limit 0")
        conn.execute("select ai_provider,chat_fallback_enabled from public.worker_heartbeats limit 0")
        conn.execute("select generation_provider from public.messages limit 0")
        models = create_models(settings)
        models.prepare()
        vectors = VectorStore(settings, models.dimensions)
        vectors.setup()
        heartbeat = Heartbeat(settings)
        heartbeat.start()
        pipeline = Pipeline(settings, conn, models, vectors, heartbeat)
        maintenance_at = 0
        LOG.info("worker_ready")
        try:
            while not stopped.is_set():
                if time.monotonic() - maintenance_at > 60:
                    try:
                        cleanup_abandoned(conn)
                        pipeline.sweep_deleted_uploads()
                    except Exception as exc:
                        LOG.warning("maintenance_failed error_type=%s", type(exc).__name__)
                    maintenance_at = time.monotonic()
                job = claim(conn)
                if not job:
                    stopped.wait(2)
                    continue
                heartbeat.set_active(job)
                started = time.monotonic()
                try:
                    if job["exhausted"]:
                        fail(conn, job, "Công việc đã gián đoạn quá nhiều lần. Vui lòng thử lại.", permanent=True)
                    else:
                        getattr(pipeline, job["kind"])(job)
                    LOG.info(
                        json.dumps(
                            {
                                "job_id": str(job["id"]),
                                "event": "job_finished",
                                "kind": job["kind"],
                                "seconds": round(time.monotonic() - started, 2),
                            }
                        )
                    )
                except Cancelled:
                    fail(conn, job, "Tài liệu đã bị xóa hoặc thay đổi. Hãy chọn lại tài liệu.", permanent=True)
                except InvalidDocument as exc:
                    fail(conn, job, str(exc), permanent=True)
                except IndexMismatch:
                    fail(conn, job, "Tài liệu dùng model embedding cũ. Hãy xóa và tải lại để lập chỉ mục.", permanent=True)
                except ProviderError as exc:
                    LOG.warning("provider_failed job_id=%s permanent=%s", str(job["id"]), exc.permanent)
                    fail(conn, job, str(exc), permanent=exc.permanent, retry_seconds=exc.retry_after)
                except LostLease:
                    # Stop instead of letting a stale attempt publish results.
                    LOG.warning("lease_lost")
                    raise
                except Exception as exc:
                    LOG.warning(
                        json.dumps({"job_id": str(job["id"]), "event": "job_failed", "error_type": type(exc).__name__})
                    )
                    fail(conn, job, "Kết nối xử lý bị gián đoạn. Hệ thống tự thử lại tối đa 3 lần.")
                finally:
                    heartbeat.set_active(None)
        finally:
            heartbeat.stopped.set()
            heartbeat.join(timeout=20)
            pipeline.storage.close()
            models.close()
            vectors.client.close()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # Suppress HTTP library logs: request URLs can carry private object paths.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    try:
        serve(Settings.load())
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        LOG.error(
            "worker_stopped error_type=%s; verify local configuration and service availability", type(exc).__name__
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
