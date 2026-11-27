import json
import logging
import re
import signal
import threading
import time
from contextlib import closing, suppress
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import Settings
from .documents import InvalidDocument, chunk_sections, extract
from .question_image import extract_question_image, is_question_image, ollama_question_image
from .models import create_models, VectorStore
from .openrouter import OutputLimit, ProviderError
from .rag import (
    ILLUSTRATION_REQUEST,
    NO_EVIDENCE,
    SUBJECTS,
    allows_general_knowledge,
    build_prompt,
    close_visual_block,
    concept_request,
    contextualize_search_question,
    explicit_web_request,
    first_image_hint,
    follow_up_history,
    follow_up_query,
    normalize_citation_marks,
    review_missing_citations,
    should_reason,
    strict_document_query,
    validate_citations,
)
from .retrieval import clean_retrieval_query, expand_stub_chunks, extract_search_terms, is_meta_document_query, lexical_search_chunks, rerank_curriculum_candidates
from .web_search import extract_topic_phrase, search_illustrations, search_web

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


class ChatStopped(Exception):
    pass


def guard(conn, job):
    row = conn.execute("select lease_token,status,error from public.jobs where id=%s for update", (job["id"],)).fetchone()
    if job.get("kind") == "chat" and (not row or row.get("error") == "USER_STOPPED"):
        raise ChatStopped()
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


def claim(conn, *, mineru_available=False):
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
        if not mineru_available and job["kind"] == "ingest":
            doc = conn.execute("select name,file_type from public.documents where id=%s", (job["document_id"],)).fetchone()
            if doc and is_question_image(doc):
                # Let the OCR worker take this job when it next holds the queue lock.
                conn.execute("select pgmq.set_vt('study_jobs',%s,15)", (message["msg_id"],))
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
                """update public.messages set content='',status='generating',generation_provider=null,
                   thinking_started_at=clock_timestamp(),thinking_ms=null,thinking_content=null where id=%s and user_id=%s""",
                (job["message_id"], job["user_id"]),
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
        try:
            guard(conn, job)
        except ChatStopped:
            return
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


def merge_curriculum_and_web(candidates, web, mode):
    """Keep university curriculum chunks ahead of external web supplements."""
    image_items = [item for item in candidates if item.get("question_image")]
    doc_items = [item for item in candidates if not item.get("question_image")]
    if mode == "research":
        return image_items + doc_items[:4] + web[:4] + doc_items[4:] + web[4:]
    if mode == "search":
        return image_items + doc_items[:3] + web[:2] + doc_items[3:] + web[2:]
    if not doc_items and not image_items:
        return web[:2]
    return candidates


class Pipeline:
    def __init__(self, settings, conn, models, vectors, heartbeat):
        self.settings, self.conn = settings, conn
        self.models, self.vectors, self.heartbeat = models, vectors, heartbeat
        storage_headers = {"apikey": settings.supabase_key}
        if not settings.supabase_key.startswith("sb_secret_"):
            storage_headers["Authorization"] = f"Bearer {settings.supabase_key}"
        self.storage = httpx.Client(
            base_url=settings.supabase_url.rstrip("/"),
            timeout=60,
            headers=storage_headers,
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
        question_image = is_question_image(doc)
        if question_image:
            local = getattr(self.models, "primary", self.models)
            if self.settings.ai_provider == "ollama":
                if not getattr(self.settings, "question_vision_ocr_available", False):
                    local.unload(self.settings.chat_model)
                local.unload(self.settings.embed_model)
            sections = extract_question_image(bytes(data), self.settings, lambda: self.document(job))
        else:
            sections = extract(bytes(data), doc["file_type"])
        chunks = chunk_sections(sections, self.models.tokenizer, str(doc["id"]), doc["index_version"])
        if not chunks:
            raise InvalidDocument("Không tìm thấy đoạn văn bản có thể sử dụng.")
        if not question_image:
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
        if not question_image:
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
            if not question_image:
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
        if not ids and job["payload"].get("mode") in ("search", "research", "library"):
            if self.heartbeat.lost.is_set():
                raise LostLease()
            return
        if not 1 <= len(ids) <= 5 or len(set(ids)) != len(ids):
            raise Cancelled()
        owners = job["payload"].get("owners") or {str(doc_id): str(job["user_id"]) for doc_id in ids}
        query = (
            "select id,user_id,name,file_type,status,index_version,embedding_profile,vector_collection from public.documents d "
            "where (user_id=%s or exists(select 1 from public.knowledge_documents k where k.document_id=d.id)) "
            "and id=any(%s::uuid[]) order by id" + (" for share" if lock else "")
        )
        rows = self.conn.execute(
            query,
            (job["user_id"], ids),
        ).fetchall()
        if len(rows) != len(ids) or any(
            row["status"] != "ready" or row["index_version"] != job["payload"]["versions"][str(row["id"])]
            or str(row["user_id"]) != owners.get(str(row["id"]))
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

        return [str(row["id"]) for row in rows
                if str(row["user_id"]) == str(job["user_id"]) and is_question_image(row)]

    def save_partial(self, job, content):
        with self.conn.transaction():
            guard(self.conn, job)
            self.chat_documents(job, lock=True)
            self.conn.execute(
                """update public.messages set content=%s,status='generating',
                   thinking_started_at=case when %s then clock_timestamp() else coalesce(thinking_started_at, created_at, clock_timestamp()) end,
                   thinking_ms=case when %s then null
                     else coalesce(thinking_ms, greatest(0, round(extract(epoch from (clock_timestamp() - coalesce(thinking_started_at, created_at, clock_timestamp()))) * 1000))::integer) end,
                   thinking_content=case when %s then null else thinking_content end
                   where id=%s and user_id=%s""",
                (content, not content, not content, not content, job["message_id"], job["user_id"]),
            )

    def save_thinking(self, job, elapsed, content=None):
        clipped = content[:32000] if content else None
        with self.conn.transaction():
            guard(self.conn, job)
            self.chat_documents(job, lock=True)
            if elapsed is None:
                self.conn.execute(
                    """update public.messages
                       set thinking_started_at=coalesce(thinking_started_at, clock_timestamp()),
                           thinking_ms=null,
                           thinking_content=coalesce(%s, thinking_content)
                       where id=%s and user_id=%s and role='assistant' and status='generating'""",
                    (clipped, job["message_id"], job["user_id"]),
                )
            else:
                self.conn.execute(
                    """update public.messages
                       set thinking_ms=%s,
                           thinking_content=coalesce(%s, thinking_content)
                       where id=%s and user_id=%s and role='assistant' and status='generating'
                         and thinking_started_at is not null""",
                    (max(0, elapsed), clipped, job["message_id"], job["user_id"]),
                )

    def follow_up_images(self, job, user_message_id):
        rows = self.conn.execute(
            """select d.id,d.index_version from public.jobs j
            join public.messages a on a.id=j.message_id and a.user_id=j.user_id
            join public.documents d on d.user_id=j.user_id
              and (j.payload->'document_ids') ? d.id::text
            where j.user_id=%s and j.kind='chat' and a.conversation_id=%s
              and j.payload->>'user_message_id'=%s
              and d.status='ready' and d.file_type='pdf' and d.name like 'Ảnh câu hỏi - %%'
              and j.payload->'versions'->>d.id::text=d.index_version::text
            order by d.id for share of d""",
            (job["user_id"], job["payload"]["conversation_id"], str(user_message_id)),
        ).fetchall()
        return {str(row["id"]): row["index_version"] for row in rows}

    def question_vision(self, job, image_versions):
        rows = self.conn.execute(
            """select id,index_version,storage_path from public.documents where id=any(%s::uuid[]) and user_id=%s
               and status='ready' and file_type='pdf' and name like 'Ảnh câu hỏi - %%' order by id""",
            (list(image_versions), job["user_id"]),
        ).fetchall()
        images = []
        for doc in rows[:1]:
            if image_versions.get(str(doc["id"])) != doc["index_version"]:
                continue
            guard(self.conn, job)
            try:
                data = bytearray()
                with self.storage.stream(
                    "GET", f"/storage/v1/object/authenticated/documents/{doc['storage_path']}"
                ) as response:
                    response.raise_for_status()
                    for block in response.iter_bytes(65536):
                        data.extend(block)
                        if len(data) > 3 * 1024 * 1024:
                            raise InvalidDocument("Ảnh câu hỏi quá lớn.")
                images.append(ollama_question_image(bytes(data)))
            except (httpx.HTTPError, InvalidDocument):
                LOG.info("question_vision_used_ocr_fallback job_id=%s", job["id"])
        guard(self.conn, job)
        return images

    def chat(self, job):
        payload = job["payload"]
        mode = payload.get("mode", "documents")
        subject = payload.get("subject")
        guard(self.conn, job)
        image_documents = self.chat_documents(job)
        image_doc_set = set(image_documents or ())
        document_ids = payload["document_ids"]
        versions = payload["versions"]
        owners = payload.get("owners") or {str(doc_id): str(job["user_id"]) for doc_id in document_ids}
        using_shared_catalog = not document_ids and mode in ("library", "search", "research")
        if using_shared_catalog:
            catalog = self.conn.execute(
                """select d.id,d.user_id,d.index_version from public.knowledge_documents k
                join public.documents d on d.id=k.document_id where d.status='ready'
                and d.embedding_profile=%s and d.vector_collection=%s
                and (%s::text is null or d.subject=%s)""",
                (self.settings.embedding_profile, self.vectors.collection, subject, subject),
            ).fetchall()
            document_ids = [str(row["id"]) for row in catalog]
            versions = {str(row["id"]): row["index_version"] for row in catalog}
            owners = {str(row["id"]): str(row["user_id"]) for row in catalog}
        non_image_doc_ids = [doc_id for doc_id in document_ids if str(doc_id) not in image_doc_set]
        non_image_owners = {str(doc_id): owners[str(doc_id)] for doc_id in non_image_doc_ids if str(doc_id) in owners}
        non_image_versions = {str(doc_id): versions[str(doc_id)] for doc_id in non_image_doc_ids if str(doc_id) in versions}
        question = payload["question"]
        if image_documents:
            history = []
        else:
            history = self.conn.execute(
                """select role,content,id,status from public.messages
                where conversation_id=%s and user_id=%s
                and subject is not distinct from %s
                and status in ('completed','stopped','interrupted') and sequence <
                (select sequence from public.messages where id=%s and conversation_id=%s and user_id=%s)
                order by sequence desc limit 24""",
                (payload["conversation_id"], job["user_id"], subject, payload["user_message_id"],
                 payload["conversation_id"], job["user_id"]),
            ).fetchall()[::-1]
            history = follow_up_history(question, history)
        anchor = history[0] if history and history[0]["role"] == "user" else None
        prior_images = self.follow_up_images(job, anchor["id"]) if anchor else {}
        query = follow_up_query(question, history, self.models.count)
        search_query = clean_retrieval_query(query) or query
        candidates = []
        vector_scores = {}
        if non_image_doc_ids:
            vector = self.models.embed([search_query], query=True)[0]
            hits = self.vectors.search(job["user_id"], non_image_doc_ids, non_image_versions, vector, non_image_owners)
            for hit in hits:
                point = hit.payload or {}
                # Verify vector payload against the canonical owner, document and version in Postgres.
                if (
                    point.get("document_id") not in non_image_owners
                    or point.get("user_id") != non_image_owners[point["document_id"]]
                ):
                    continue
                row = self.conn.execute(
                    """select c.*,d.name as document_name,d.subject from public.document_chunks c
                    join public.documents d on d.id=c.document_id where c.id=%s and c.user_id=%s
                    and c.document_id=%s and d.user_id=%s and d.status='ready'
                    and c.index_version=d.index_version and c.index_version=%s
                    and (%s::text is null or d.subject=%s)
                    and ((not %s and d.user_id=%s) or exists(select 1 from public.knowledge_documents k where k.document_id=d.id))""",
                    (
                        point.get("chunk_id"),
                        point.get("user_id"),
                        point.get("document_id"),
                        point.get("user_id"),
                        non_image_versions.get(point.get("document_id")),
                        subject, subject,
                        using_shared_catalog,
                        job["user_id"],
                    ),
                ).fetchone()
                if row:
                    hit_score = getattr(hit, "score", None)
                    key = (str(row.get("document_id") or ""), str(row.get("id") or ""))
                    vector_scores[key] = float(hit_score) if isinstance(hit_score, (int, float)) else 0.65
                    candidates.append(row)
            lexical_hits = lexical_search_chunks(
                self.conn,
                job["user_id"],
                non_image_doc_ids,
                subject,
                using_shared_catalog,
                non_image_owners,
                non_image_versions,
                search_query,
                limit=12,
            )
            candidates.extend(lexical_hits)
            guard(self.conn, job)
            self.chat_documents(job)
            if candidates:
                candidates = expand_stub_chunks(
                    self.conn, candidates, using_shared_catalog, job["user_id"], non_image_owners, non_image_versions
                )
                candidates = rerank_curriculum_candidates(
                    search_query,
                    candidates,
                    subject=subject,
                    min_score=getattr(self.settings, "min_score", 0.35),
                    vector_scores=vector_scores,
                )
                if candidates:
                    candidates = self.models.rerank(search_query, candidates[:12])
                    candidates = rerank_curriculum_candidates(
                        search_query,
                        candidates,
                        subject=subject,
                        min_score=getattr(self.settings, "min_score", 0.35),
                        vector_scores=vector_scores,
                    )
        image_versions = prior_images or {
            doc_id: payload["versions"][doc_id] for doc_id in image_documents or ()
        }
        if image_versions:
            image_chunks = self.conn.execute(
                """select c.*, d.name as document_name from public.documents d
                cross join lateral (
                    select * from public.document_chunks
                    where document_id=d.id and user_id=d.user_id and index_version=d.index_version
                    order by ordinal limit 2
                ) c
                where d.id=any(%s::uuid[]) and d.user_id=%s and d.status='ready'
                order by d.id,c.ordinal limit 5""",
                (list(image_versions), job["user_id"]),
            ).fetchall()
            image_chunks = [
                {**row, "question_image": True} for row in image_chunks
                if row["index_version"] == image_versions.get(str(row["document_id"]))
            ]
            image_ids = {row["id"] for row in image_chunks}
            candidates = image_chunks + [item for item in candidates if item["id"] not in image_ids]
        external_search = mode in ("search", "research")
        notices = []
        illustrations = []
        topic_question = contextualize_search_question(question, history)
        has_topic = bool(extract_topic_phrase(topic_question))
        explicit_illustration = bool(ILLUSTRATION_REQUEST.search(question))
        want_illustrations = has_topic and (
            explicit_illustration
            if history
            else (explicit_illustration or concept_request(question))
        )
        if external_search and has_topic:
            terms = f"{topic_question} {SUBJECTS[subject]}" if subject in SUBJECTS else topic_question
            results, notices = search_web(
                terms,
                mode,
                self.settings.searxng_url,
                image_question=topic_question if (mode == "search" and want_illustrations) else "",
            )
            illustrations = [source for source in results if source["kind"] == "image"]
            web = [source for source in results if source["kind"] != "image"]
            candidates = merge_curriculum_and_web(candidates, web, mode)
        elif mode in ("documents", "library") and has_topic and not image_versions and not strict_document_query(question):
            explicit_web = explicit_web_request(question)
            need_web_text = explicit_web or (
                not candidates
                and not is_meta_document_query(topic_question)
                and bool(extract_search_terms(search_query))
            )
            if need_web_text:
                terms = f"{topic_question} {SUBJECTS[subject]}" if subject in SUBJECTS else topic_question
                results, web_notices = search_web(
                    terms,
                    "search",
                    self.settings.searxng_url,
                    image_question=topic_question if (want_illustrations or (explicit_web and not history)) else "",
                )
                illustrations = [source for source in results if source["kind"] == "image"]
                web = [source for source in results if source["kind"] != "image"]
                if web:
                    candidates = merge_curriculum_and_web(candidates, web, "search" if explicit_web else mode)
                if explicit_web:
                    notices = web_notices
            elif want_illustrations:
                illustrations = search_illustrations(
                    topic_question,
                    self.settings.searxng_url,
                    subject_label=SUBJECTS.get(subject, ""),
                )
        guard(self.conn, job)
        self.chat_documents(job)
        reason = should_reason(question, mode, has_image=bool(image_versions), has_sources=bool(candidates))
        prompt, selected = build_prompt(
            question, history, candidates, self.models.count, mode, subject=subject,
            reasoning=(reason or external_search) and not image_versions,
        )
        answer, used = NO_EVIDENCE, []
        if external_search and not selected:
            answer = "Mình chưa tìm thấy nguồn phù hợp. Hãy thử từ khóa cụ thể hơn."
        allow_uncited = allows_general_knowledge(mode)
        generated = bool(selected) or allow_uncited
        if image_versions and not any(item.get("question_image") for item in selected):
            answer = "Mình chưa nhận được nội dung đọc được từ ảnh đính kèm. Hãy dán lại ảnh rõ hơn."
            generated = False
        if generated:
            answer = ""
            thinking_text = ""
            last_thinking_flush = 0.0
            last_flush = time.monotonic()

            def reset_answer():
                nonlocal answer, thinking_text, last_thinking_flush, last_flush
                answer = ""
                thinking_text = ""
                last_thinking_flush = 0.0
                self.save_partial(job, answer)
                last_flush = time.monotonic()

            options = {"research": True} if mode == "research" else {}
            if reason and getattr(self.models, "supports_thinking_progress", False):
                def on_thinking(elapsed):
                    nonlocal last_thinking_flush
                    self.save_thinking(job, elapsed, thinking_text or None)
                    last_thinking_flush = time.monotonic()

                options["on_thinking"] = on_thinking
                if getattr(self.models, "supports_thinking_stream", False):
                    def on_thinking_token(piece):
                        nonlocal thinking_text, last_thinking_flush
                        if not piece or len(thinking_text) >= 32000:
                            return
                        was_empty = not thinking_text
                        thinking_text = (thinking_text + piece)[:32000]
                        now = time.monotonic()
                        if was_empty or now - last_thinking_flush >= 0.7:
                            if self.heartbeat.lost.is_set():
                                guard(self.conn, job)
                                raise LostLease()
                            self.save_thinking(job, None, thinking_text)
                            last_thinking_flush = now

                    options["on_thinking_token"] = on_thinking_token
            if image_versions and getattr(self.models, "supports_question_vision", False):
                images = self.question_vision(job, image_versions)
                if images:
                    options["question_images"] = images
            try:
                for attempt in range(2 if external_search else 1):
                    truncated = False
                    if attempt:
                        reset_answer()
                        prompt[-1]["content"] += (
                            "\n\nViết lại câu trả lời. Gắn trích dẫn đúng nhãn từ danh sách nguồn ngay sau "
                            "nhận định được hỗ trợ. Dùng nguồn có liên quan và bỏ các nhận định thiếu cơ sở."
                        )
                    try:
                        with closing(self.models.generate(prompt, on_reset=reset_answer, **options)) as tokens:
                            for token in tokens:
                                if self.heartbeat.lost.is_set():
                                    guard(self.conn, job)
                                    raise LostLease()
                                answer += token
                                if time.monotonic() - last_flush >= 0.5:
                                    if token and not image_documents:
                                        self.save_partial(job, answer)
                                    else:
                                        guard(self.conn, job)
                                    last_flush = time.monotonic()
                    except OutputLimit:
                        truncated = True
                        LOG.info("chat_output_limit job_id=%s", job["id"])
                    if image_documents and not concept_request(question, history):
                        answer = first_image_hint(answer)
                    answer = close_visual_block(answer, question)
                    answer = normalize_citation_marks(answer)
                    has_text_sources = any(not item.get("question_image") for item in selected)
                    if answer.strip() and has_text_sources and not re.search(r"\[S\d+\]", answer):
                        last_review_check = time.monotonic()

                        def check_review_active():
                            nonlocal last_review_check
                            now = time.monotonic()
                            if self.heartbeat.lost.is_set() or now - last_review_check >= 1:
                                guard(self.conn, job)
                                last_review_check = now

                        answer = review_missing_citations(
                            question,
                            answer,
                            selected,
                            self.models,
                            check_review_active,
                        )
                    answer, used = validate_citations(answer, selected, allow_uncited=allow_uncited)
                    if answer != NO_EVIDENCE:
                        if truncated:
                            answer += "\n\n*Đã chạm giới hạn độ dài. Bạn có thể hỏi tiếp về phần còn lại.*"
                        break
            except ChatStopped:
                if answer.strip() and not image_documents:
                    with suppress(Exception):
                        self.conn.execute(
                            "update public.messages set content=%s where id=%s and user_id=%s and status=%s",
                            (answer, job["message_id"], job["user_id"], "stopped"),
                        )
                raise
            if external_search and answer == NO_EVIDENCE:
                answer = "Mình tìm thấy nguồn nhưng chưa tổng hợp được câu trả lời có trích dẫn hợp lệ."
                used = [source for source in selected if "url" in source]
                if used:
                    answer += " Bạn có thể mở các nguồn tìm được bên dưới."
        if notices:
            answer += "\n\n*" + " ".join(notices) + "*"
        with self.conn.transaction():
            guard(self.conn, job)
            self.chat_documents(job, lock=True)
            if prior_images and any(item.get("question_image") for item in selected):
                if self.follow_up_images(job, anchor["id"]) != prior_images:
                    raise Cancelled()
            shared_source_ids = {
                str(item["document_id"])
                for item in selected
                if item.get("document_id") and not item.get("question_image")
            }
            if using_shared_catalog and shared_source_ids:
                current = self.conn.execute(
                    """select d.id,d.index_version from public.documents d
                    join public.knowledge_documents k on k.document_id=d.id
                    where d.id=any(%s::uuid[]) and d.status='ready'
                    order by d.id for share of d,k""",
                    (sorted(shared_source_ids),),
                ).fetchall()
                if {str(row["id"]): row["index_version"] for row in current} != {
                    doc_id: versions[doc_id] for doc_id in shared_source_ids
                }:
                    raise Cancelled()
            self.conn.execute(
                "update public.messages set content=%s,status='completed',generation_provider=%s where id=%s",
                (answer, getattr(self.models, "last_generation_provider", self.settings.ai_provider) if generated else None,
                 job["message_id"]),
            )
            used_web = [item for item in used if "url" in item]
            if mode == "search" and generated and answer != NO_EVIDENCE and not used_web:
                used_web = [item for item in selected if "url" in item][:2]
            web_sources = [
                {
                    **{key: item[key] for key in ("label", "title", "url")},
                    "kind": item.get("kind"),
                    **({"provider": item["provider"]} if item.get("provider") else {}),
                }
                for item in used_web
            ]
            if not generated or answer == NO_EVIDENCE:
                illustrations = []
            if web_sources or illustrations or mode in ("search", "research"):
                self.conn.execute(
                    "update public.messages set web_sources=%s where id=%s",
                    (Jsonb(web_sources + illustrations), job["message_id"]),
                )
            for item in used:
                if "url" in item:
                    continue
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


def serve(settings, *, stopped=None, idle_seconds=None, worker_id=None):
    if stopped is None:
        stopped = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stopped.set())
    with connect(settings) as conn:
        if not conn.execute("select pg_try_advisory_lock(%s) as acquired", (LOCK_ID,)).fetchone()["acquired"]:
            raise RuntimeError("Another worker holds the queue lock. Use a session connection, not transaction pooling.")
        conn.execute("select embedding_profile,vector_collection from public.documents limit 0")
        conn.execute("select document_id from public.knowledge_documents limit 0")
        conn.execute("select ai_provider,chat_fallback_enabled from public.worker_heartbeats limit 0")
        conn.execute("select generation_provider,thinking_started_at,thinking_ms,thinking_content from public.messages limit 0")
        models = create_models(settings)
        try:
            models.prepare()
            vectors = VectorStore(settings, models.dimensions)
            try:
                vectors.setup()
            except Exception:
                vectors.client.close()
                raise
        except Exception:
            models.close()
            raise
        ocr_available = (
            getattr(settings, "question_ocr_available", getattr(settings, "mineru_available", False))
            and worker_id is None
        )
        heartbeat = Heartbeat(settings)
        if ocr_available:
            heartbeat.worker_id = "learnstep-mineru"
        if worker_id:
            heartbeat.worker_id = worker_id
        heartbeat.start()
        pipeline = Pipeline(settings, conn, models, vectors, heartbeat)
        maintenance_at = 0
        idle_since = time.monotonic()
        LOG.info("worker_ready")
        try:
            while not stopped.is_set():
                if time.monotonic() - maintenance_at > 60:
                    if settings.ai_provider == "ollama" and maintenance_at:
                        models.prepare()
                    try:
                        cleanup_abandoned(conn)
                        pipeline.sweep_deleted_uploads()
                    except Exception as exc:
                        LOG.warning("maintenance_failed error_type=%s", type(exc).__name__)
                    maintenance_at = time.monotonic()
                job = claim(conn, mineru_available=ocr_available)
                if not job:
                    if idle_seconds is not None and time.monotonic() - idle_since >= idle_seconds:
                        break
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
                except ChatStopped:
                    conn.execute("select pgmq.archive('study_jobs',%s)", (job["queue_id"],))
                    LOG.info("chat_stopped job_id=%s", job["id"])
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
                    idle_since = time.monotonic()
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
