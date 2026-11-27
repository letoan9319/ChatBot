from contextlib import nullcontext
import re
import threading
from types import SimpleNamespace

import pytest

from study_worker import main as worker_main
from study_worker.documents import Section


class FakeStreamResponse:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def raise_for_status(self):
        return None

    def iter_bytes(self, _chunk_size):
        yield self.payload


class FakeTokenizer:
    def encode(self, text, add_special_tokens=False):
        matches = list(re.finditer(r"\S+", text))
        return SimpleNamespace(
            ids=list(range(len(matches))),
            offsets=[(m.start(), m.end()) for m in matches],
        )


def test_serve_advertises_ocr_and_claims_question_image_for_qwen_vision_without_mineru(monkeypatch):
    def run_serve_with(settings_obj, *, worker_id=None):
        seen = {}
        stop_event = threading.Event()

        class FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def execute(self, sql, params=()):
                if "pg_try_advisory_lock" in sql:
                    return SimpleNamespace(fetchone=lambda: {"acquired": True})
                return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

        class FakeHeartbeat:
            def __init__(self, _settings):
                self.worker_id = "learnstep-worker"
                self.stopped = threading.Event()
                self.lost = threading.Event()

            def start(self):
                seen["worker_id"] = self.worker_id

            def set_active(self, _job):
                pass

            def join(self, timeout=None):
                pass

        class FakeModels:
            dimensions = 1024

            def prepare(self):
                pass

            def close(self):
                pass

        class FakeVectors:
            def __init__(self, _settings, _dims):
                self.client = SimpleNamespace(close=lambda: None)

            def setup(self):
                pass

        def fake_claim(_conn, *, mineru_available=False):
            seen["mineru_available"] = mineru_available
            stop_event.set()
            return None

        monkeypatch.setattr(worker_main, "connect", lambda _s: FakeConn())
        monkeypatch.setattr(worker_main, "create_models", lambda _s: FakeModels())
        monkeypatch.setattr(worker_main, "VectorStore", FakeVectors)
        monkeypatch.setattr(worker_main, "Heartbeat", FakeHeartbeat)
        monkeypatch.setattr(worker_main, "cleanup_abandoned", lambda _c: None)
        monkeypatch.setattr(worker_main.Pipeline, "sweep_deleted_uploads", lambda _self: None)
        monkeypatch.setattr(worker_main, "claim", fake_claim)

        worker_main.serve(settings_obj, stopped=stop_event, worker_id=worker_id)
        return seen

    base = dict(
        supabase_url="https://example.supabase.co",
        supabase_key="service-placeholder",
        ai_provider="ollama",
        mineru_available=False,
    )

    qwen_vision = run_serve_with(SimpleNamespace(**base, question_ocr_available=True))
    assert qwen_vision == {"worker_id": "learnstep-mineru", "mineru_available": True}

    no_ocr = run_serve_with(SimpleNamespace(**base, question_ocr_available=False))
    assert no_ocr == {"worker_id": "learnstep-worker", "mineru_available": False}

    custom = run_serve_with(SimpleNamespace(**base, question_ocr_available=True), worker_id="custom-worker")
    assert custom == {"worker_id": "custom-worker", "mineru_available": False}


def test_claim_accepts_or_defers_question_image_based_on_ocr_flag():
    def run_claim(*, mineru_available):
        executed = []

        class FakeConn:
            def transaction(self):
                return nullcontext()

            def execute(self, sql, params=()):
                executed.append((sql, params))
                if "pgmq.read" in sql:
                    return SimpleNamespace(fetchone=lambda: {"msg_id": 7, "message": {"job_id": "job-1"}})
                if "from public.jobs where id=%s for update" in sql:
                    return SimpleNamespace(fetchone=lambda: {
                        "id": "job-1",
                        "kind": "ingest",
                        "status": "queued",
                        "attempts": 0,
                        "document_id": "doc-img",
                        "message_id": None,
                        "user_id": "student-1",
                    })
                if "from public.documents where id=%s" in sql:
                    return SimpleNamespace(fetchone=lambda: {
                        "name": "Ảnh câu hỏi - bai1.pdf",
                        "file_type": "pdf",
                    })
                if "update public.jobs set status='running'" in sql:
                    return SimpleNamespace(fetchone=lambda: {
                        "id": "job-1",
                        "kind": "ingest",
                        "status": "running",
                        "attempts": 1,
                        "document_id": "doc-img",
                        "message_id": None,
                        "user_id": "student-1",
                    })
                return SimpleNamespace(fetchone=lambda: None)

        return worker_main.claim(FakeConn(), mineru_available=mineru_available), executed

    deferred, deferred_sql = run_claim(mineru_available=False)
    assert deferred is None
    assert any("pgmq.set_vt('study_jobs',%s,15)" in sql for sql, _ in deferred_sql)

    claimed, _ = run_claim(mineru_available=True)
    assert claimed is not None
    assert claimed["id"] == "job-1"
    assert claimed["queue_id"] == 7


@pytest.mark.parametrize("vision_ocr_available", [True, False])
def test_question_image_ingest_unload_policy_and_skips_bge_embedding(monkeypatch, vision_ocr_available):
    payload = b"%PDF-1.4\nquestion-image-bytes"
    doc = {
        "id": "img-doc-1",
        "user_id": "student-1",
        "name": "Ảnh câu hỏi - bai1.pdf",
        "file_type": "pdf",
        "status": "queued",
        "index_version": 1,
        "storage_path": "student-1/img-doc-1.pdf",
        "size_bytes": len(payload),
        "vector_collection": "study_bge_m3_v1",
    }
    executed = []
    unloaded = []
    finished = []

    class FakeConn:
        def transaction(self):
            return nullcontext()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "from public.documents where id=%s and user_id=%s" in sql:
                return SimpleNamespace(fetchone=lambda: doc)
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.storage = SimpleNamespace(stream=lambda _method, _url: FakeStreamResponse(payload))
    pipeline.settings = SimpleNamespace(
        ai_provider="ollama",
        chat_model="qwen3.5:4b-q4_K_M",
        embed_model="bge-m3",
        embedding_profile="ollama:bge-m3",
        question_vision_ocr_available=vision_ocr_available,
    )
    pipeline.models = SimpleNamespace(
        tokenizer=FakeTokenizer(),
        unload=lambda model: unloaded.append(model),
        embed=lambda *_args, **_kwargs: pytest.fail("bge-m3 embed must not run for question images"),
    )
    pipeline.vectors = SimpleNamespace(
        collection="study_bge_m3_v1",
        delete=lambda *_args, **_kwargs: pytest.fail("Qdrant delete must not run for question image ingest"),
        upsert=lambda *_args, **_kwargs: pytest.fail("Qdrant upsert must not run for question image ingest"),
    )

    monkeypatch.setattr(worker_main, "guard", lambda *_args: None)
    monkeypatch.setattr(worker_main, "finish", lambda _conn, job: finished.append(job["id"]))
    monkeypatch.setattr(
        worker_main,
        "extract_question_image",
        lambda data, _settings, check: (check(), [Section("Tính đạo hàm của $f(x)=x^2$.", page=1)])[1],
    )

    job = {
        "id": "job-ingest-img",
        "queue_id": 10,
        "user_id": "student-1",
        "document_id": "img-doc-1",
        "lease_token": "lease-1",
        "payload": {"index_version": 1},
    }
    pipeline.ingest(job)

    if vision_ocr_available:
        assert unloaded == ["bge-m3"]
    else:
        assert unloaded == ["qwen3.5:4b-q4_K_M", "bge-m3"]

    assert finished == ["job-ingest-img"]
    assert any("set vector_collection=%s,embedding_profile=%s" in sql for sql, _ in executed)
    chunk_inserts = [params for sql, params in executed if "insert into public.document_chunks" in sql]
    assert len(chunk_inserts) == 1
    assert "f(x)=x^2" in chunk_inserts[0][5]
    assert any("set status='ready',error=null" in sql for sql, _ in executed)


def test_regular_document_ingest_still_embeds_and_upserts_vectors(monkeypatch):
    payload = b"regular-pdf-bytes"
    doc = {
        "id": "reg-doc-1",
        "user_id": "student-1",
        "name": "Giai_tich_1.pdf",
        "file_type": "pdf",
        "status": "queued",
        "index_version": 1,
        "storage_path": "student-1/reg-doc-1.pdf",
        "size_bytes": len(payload),
        "vector_collection": "study_bge_m3_v1",
    }
    embedded_batches = []
    upserts = []
    deletes = []

    class FakeConn:
        def transaction(self):
            return nullcontext()

        def execute(self, sql, _params=()):
            if "from public.documents where id=%s and user_id=%s" in sql:
                return SimpleNamespace(fetchone=lambda: doc)
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.storage = SimpleNamespace(stream=lambda _method, _url: FakeStreamResponse(payload))
    pipeline.settings = SimpleNamespace(
        ai_provider="ollama",
        chat_model="qwen3.5:4b-q4_K_M",
        embed_model="bge-m3",
        embedding_profile="ollama:bge-m3",
        question_vision_ocr_available=True,
    )
    pipeline.models = SimpleNamespace(
        tokenizer=FakeTokenizer(),
        embed=lambda texts: (embedded_batches.append(texts), [[0.1] * 4 for _ in texts])[1],
    )
    pipeline.vectors = SimpleNamespace(
        collection="study_bge_m3_v1",
        delete=lambda *args: deletes.append(args),
        upsert=lambda *args: upserts.append(args),
    )

    monkeypatch.setattr(worker_main, "guard", lambda *_args: None)
    monkeypatch.setattr(worker_main, "finish", lambda *_args: None)
    monkeypatch.setattr(worker_main, "extract", lambda _data, _ft: [Section("Định nghĩa đạo hàm.", page=1)])

    pipeline.ingest({
        "id": "job-ingest-reg",
        "queue_id": 11,
        "user_id": "student-1",
        "document_id": "reg-doc-1",
        "lease_token": "lease-1",
        "payload": {"index_version": 1},
    })

    assert len(deletes) == 2
    assert len(embedded_batches) == 1
    assert len(upserts) == 1


def test_question_image_only_chat_skips_embed_and_vector_search_and_attaches_vision(monkeypatch):
    executed = []
    generate_calls = []

    class FakeConn:
        def transaction(self):
            return nullcontext()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "cross join lateral" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "img-chunk-1",
                    "document_id": "img-1",
                    "user_id": "student-1",
                    "index_version": 1,
                    "ordinal": 0,
                    "document_name": "Ảnh câu hỏi - bai1.pdf",
                    "page": 1,
                    "section": None,
                    "paragraph": 1,
                    "content": "Tính giới hạn $\\lim_{n \\to \\infty} (\\sqrt{n^2+n} - n)$.",
                }])
            if "from public.documents d" in sql and "id=any(%s::uuid[])" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "img-1",
                    "user_id": "student-1",
                    "name": "Ảnh câu hỏi - bai1.pdf",
                    "file_type": "pdf",
                    "status": "ready",
                    "index_version": 1,
                    "embedding_profile": "ollama:bge-m3",
                    "vector_collection": "study_bge_m3_v1",
                }])
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.settings = SimpleNamespace(
        embedding_profile="ollama:bge-m3",
        ai_provider="ollama",
        searxng_url="",
        min_score=0.35,
    )
    pipeline.vectors = SimpleNamespace(
        collection="study_bge_m3_v1",
        search=lambda *_args, **_kwargs: pytest.fail("vectors.search must be skipped for image-only chat"),
    )

    def fake_generate(prompt, on_reset=None, **options):
        generate_calls.append((prompt, options))
        yield "Đề yêu cầu tính giới hạn [S1].\n\n**Gợi ý:** Hãy nhân biểu thức liên hợp."

    pipeline.models = SimpleNamespace(
        count=lambda text: len(text.split()),
        embed=lambda *_args, **_kwargs: pytest.fail("embed must be skipped for image-only chat"),
        rerank=lambda _q, items: items,
        generate=fake_generate,
        last_generation_provider="ollama",
        supports_thinking_progress=False,
        supports_question_vision=True,
    )
    pipeline.question_vision = lambda _job, image_versions: (
        ["base64-image-data"] if image_versions == {"img-1": 1} else []
    )

    monkeypatch.setattr(worker_main, "guard", lambda *_args: None)
    monkeypatch.setattr(worker_main, "finish", lambda *_args: None)
    monkeypatch.setattr(
        worker_main,
        "lexical_search_chunks",
        lambda *_args, **_kwargs: pytest.fail("lexical_search_chunks must be skipped for image-only chat"),
    )

    pipeline.chat({
        "id": "job-chat-img",
        "queue_id": 20,
        "user_id": "student-1",
        "message_id": "msg-img",
        "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1",
            "user_message_id": "u-msg-1",
            "question": "Hướng dẫn mình làm bài trong ảnh này.",
            "document_ids": ["img-1"],
            "versions": {"img-1": 1},
            "owners": {"img-1": "student-1"},
            "mode": "documents",
        },
    })

    assert len(generate_calls) == 1
    prompt, options = generate_calls[0]
    assert options.get("question_images") == ["base64-image-data"]
    assert "NỘI DUNG ẢNH" in prompt[-1]["content"]
    assert "\\sqrt{n^2+n}" in prompt[-1]["content"]
    assert not any("select role,content,id from public.messages" in sql for sql, _ in executed)
    source_inserts = [params for sql, params in executed if "insert into public.message_sources" in sql]
    assert len(source_inserts) == 1
    assert source_inserts[0][1] == "img-chunk-1"
    assert source_inserts[0][2] == "img-1"


def test_mixed_chat_retrieves_only_regular_documents_and_attaches_question_image(monkeypatch):
    executed = []
    embed_calls = []
    vector_search_calls = []
    lexical_calls = []
    generate_calls = []

    class FakeConn:
        def transaction(self):
            return nullcontext()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "cross join lateral" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "img-chunk-1",
                    "document_id": "img-1",
                    "user_id": "student-1",
                    "index_version": 1,
                    "ordinal": 0,
                    "document_name": "Ảnh câu hỏi - bai2.pdf",
                    "page": 1,
                    "section": None,
                    "paragraph": 1,
                    "content": "Tính giới hạn $\\lim_{n \\to \\infty} (\\sqrt{n^2+n} - n)$.",
                }])
            if "from public.documents d" in sql and "id=any(%s::uuid[])" in sql:
                return SimpleNamespace(fetchall=lambda: [
                    {
                        "id": "img-1",
                        "user_id": "student-1",
                        "name": "Ảnh câu hỏi - bai2.pdf",
                        "file_type": "pdf",
                        "status": "ready",
                        "index_version": 1,
                        "embedding_profile": "ollama:bge-m3",
                        "vector_collection": "study_bge_m3_v1",
                    },
                    {
                        "id": "doc-1",
                        "user_id": "publisher-1",
                        "name": "Giai_tich_1.pdf",
                        "file_type": "pdf",
                        "status": "ready",
                        "index_version": 2,
                        "embedding_profile": "ollama:bge-m3",
                        "vector_collection": "study_bge_m3_v1",
                    },
                ])
            if "from public.document_chunks c" in sql:
                return SimpleNamespace(fetchone=lambda: {
                    "id": "doc-chunk-1",
                    "document_id": "doc-1",
                    "user_id": "publisher-1",
                    "index_version": 2,
                    "ordinal": 3,
                    "document_name": "Giai_tich_1.pdf",
                    "subject": "calculus",
                    "page": 14,
                    "section": "Giới hạn dãy số",
                    "paragraph": 2,
                    "content": (
                        "Khi tính giới hạn dạng vô định căn thức, phương pháp nhân và chia cho "
                        "biểu thức liên hợp giúp khử dạng vô cùng trừ vô cùng."
                    ),
                })
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.settings = SimpleNamespace(
        embedding_profile="ollama:bge-m3",
        ai_provider="ollama",
        searxng_url="",
        min_score=0.35,
    )

    def fake_vector_search(user_id, doc_ids, versions, vector, owners):
        vector_search_calls.append((user_id, list(doc_ids), dict(versions), dict(owners)))
        return [SimpleNamespace(
            score=0.82,
            payload={"chunk_id": "doc-chunk-1", "document_id": "doc-1", "user_id": "publisher-1"},
        )]

    pipeline.vectors = SimpleNamespace(collection="study_bge_m3_v1", search=fake_vector_search)

    def fake_generate(prompt, on_reset=None, **options):
        generate_calls.append((prompt, options))
        yield "Theo đề trong ảnh [S1] và phương pháp nhân liên hợp trong giáo trình [S2], hãy bắt đầu bằng nhân liên hợp."

    pipeline.models = SimpleNamespace(
        count=lambda text: len(text.split()),
        embed=lambda texts, query=False: (embed_calls.append((texts, query)), [[0.2] * 4 for _ in texts])[1],
        rerank=lambda _q, items: items,
        generate=fake_generate,
        last_generation_provider="ollama",
        supports_thinking_progress=False,
        supports_question_vision=True,
    )
    pipeline.question_vision = lambda _job, image_versions: (
        ["base64-mixed-image"] if image_versions == {"img-1": 1} else []
    )

    def fake_lexical(_conn, _user_id, doc_ids, _subject, _shared, owners, versions, _query, limit=12):
        lexical_calls.append((list(doc_ids), dict(owners), dict(versions)))
        return []

    monkeypatch.setattr(worker_main, "guard", lambda *_args: None)
    monkeypatch.setattr(worker_main, "finish", lambda *_args: None)
    monkeypatch.setattr(worker_main, "lexical_search_chunks", fake_lexical)

    pipeline.chat({
        "id": "job-chat-mixed",
        "queue_id": 21,
        "user_id": "student-1",
        "message_id": "msg-mixed",
        "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1",
            "user_message_id": "u-msg-2",
            "question": "Áp dụng phương pháp liên hợp trong giáo trình để gợi ý bài giới hạn này.",
            "document_ids": ["img-1", "doc-1"],
            "versions": {"img-1": 1, "doc-1": 2},
            "owners": {"img-1": "student-1", "doc-1": "publisher-1"},
            "mode": "documents",
        },
    })

    assert len(embed_calls) == 1
    assert vector_search_calls == [("student-1", ["doc-1"], {"doc-1": 2}, {"doc-1": "publisher-1"})]
    assert lexical_calls == [(["doc-1"], {"doc-1": "publisher-1"}, {"doc-1": 2})]
    assert len(generate_calls) == 1
    prompt, options = generate_calls[0]
    assert options.get("question_images") == ["base64-mixed-image"]
    assert "NỘI DUNG ẢNH" in prompt[-1]["content"]
    assert "Giai_tich_1.pdf" in prompt[0]["content"]
    source_inserts = [params for sql, params in executed if "insert into public.message_sources" in sql]
    assert {(params[2], params[4]) for params in source_inserts} == {("img-1", "S1"), ("doc-1", "S2")}
