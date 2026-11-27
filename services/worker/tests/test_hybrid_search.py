import threading
from types import SimpleNamespace

import httpx
import pytest

from study_worker import main as worker_main
from study_worker import web_search
from study_worker.rag import build_prompt, normalize_citation_marks, review_missing_citations, validate_citations
from study_worker.retrieval import (
    clean_retrieval_query,
    expand_stub_chunks,
    extract_search_terms,
    infer_subject_hint,
    is_meta_document_query,
    rerank_curriculum_candidates,
)


def test_openalex_fallback_and_url_safety(monkeypatch):
    def respond(request):
        if request.url.host == "vi.wikipedia.org":
            raise httpx.ConnectError("vi wiki unreachable")
        if request.url.host == "en.wikipedia.org":
            return httpx.Response(200, json={"query": {"pages": [{
                "index": 1, "pageid": 12, "title": "Derivative",
                "extract": "The derivative measures the instantaneous rate of change of a function.",
            }]}})
        if request.url.host == "api.crossref.org":
            return httpx.Response(200, json={"message": {"items": []}})
        assert request.url.host == "api.openalex.org"
        return httpx.Response(200, json={"results": [
            {
                "id": "https://openalex.org/W1",
                "display_name": "Visualizing derivatives",
                "doi": "https://doi.org/10.1000/calc",
                "publication_year": 2024,
                "abstract_inverted_index": {
                    word: [idx]
                    for idx, word in enumerate((
                        "Visual models help undergraduate students understand tangent slopes and rates of change clearly."
                    ).split())
                },
            },
            {
                "id": "https://openalex.org/W2",
                "display_name": "Unsafe URL work",
                "doi": "javascript:alert(1)",
                "primary_location": {"landing_page_url": "ftp://example.com/paper"},
                "abstract_inverted_index": {
                    word: [idx]
                    for idx, word in enumerate((
                        "This abstract is long enough to pass length check but has unsafe scheme links only."
                    ).split())
                },
            },
        ]})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, notices = web_search.search_web("Derivative", "research")
    assert any(item["provider"] == "Wikipedia" and "en.wikipedia.org" in item["url"] for item in sources)
    assert [item for item in sources if item.get("provider") == "OpenAlex"][0]["url"] == "https://doi.org/10.1000/calc"
    assert all(item["url"].startswith("https://") for item in sources)
    assert "Nguồn web dự phòng từ Wikipedia." in notices


def test_merge_curriculum_and_web_prioritizes_university_library():
    docs = [{"id": f"c{i}", "document_name": f"GiaoTrinh_{i}.pdf", "content": f"chunk {i}"} for i in range(5)]
    web = [{"url": f"https://en.wikipedia.org/?curid={i}", "title": f"Web {i}", "content": f"web {i}"} for i in range(5)]
    merged_search = worker_main.merge_curriculum_and_web(docs, web, "search")
    assert [item.get("id") or item.get("url") for item in merged_search[:5]] == [
        "c0", "c1", "c2", "https://en.wikipedia.org/?curid=0", "https://en.wikipedia.org/?curid=1"
    ]
    assert worker_main.merge_curriculum_and_web(docs, web, "library") == docs
    assert worker_main.merge_curriculum_and_web([], web, "library") == web[:2]


def test_authority_prompt_and_card_citation_relocation():
    candidates = [
        {"id": "1", "document_name": "Giai_tich_BK.pdf", "content": "Định nghĩa đạo hàm theo giáo trình trường."},
        {
            "url": "https://vi.wikipedia.org/?curid=1",
            "kind": "wikipedia",
            "provider": "Wikipedia",
            "title": "Đạo hàm",
            "content": "Mô tả bổ trợ.",
        },
    ]
    messages, chosen = build_prompt("Đạo hàm là gì?", [], candidates, lambda text: len(text.split()), "search")
    system_text = messages[0]["content"]
    assert '"authority": "curriculum"' in system_text
    assert '"authority": "web_supplement"' in system_text
    assert '"source": "Giai_tich_BK.pdf"' in system_text

    dirty = (
        "Giải thích [S1].\n\n"
        "```study-card\n"
        '{"kind":"pipeline","nodes":[{"title":"A [S2]","subtitle":"B"},{"title":"C","subtitle":"D"}]}\n'
        "```"
    )
    cleaned, used = validate_citations(dirty, chosen)
    assert [item["label"] for item in used] == ["S1", "S2"]
    assert '"title":"A"' in cleaned
    assert cleaned.endswith("```\n\n[S2]")


def test_pipeline_chat_search_mode_queries_shared_library_and_saves_provider(monkeypatch):
    executed = []

    class FakeTransaction:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    class FakeConn:
        def transaction(self):
            return FakeTransaction()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "from public.jobs where id=%s for update" in sql:
                return SimpleNamespace(fetchone=lambda: {"lease_token": "lease-1", "status": "running"})
            if "from public.knowledge_documents k" in sql and "vector_collection=%s" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "doc-1", "user_id": "publisher-1", "index_version": 2,
                }])
            if "join public.knowledge_documents k" in sql and "order by d.id for share" in sql:
                return SimpleNamespace(fetchall=lambda: [{"id": "doc-1", "index_version": 2}])
            if "from public.messages" in sql and "sequence <" in sql:
                return SimpleNamespace(fetchall=lambda: [])
            if "from public.document_chunks c" in sql:
                return SimpleNamespace(fetchone=lambda: {
                    "id": "chunk-1",
                    "document_id": "doc-1",
                    "user_id": "publisher-1",
                    "document_name": "Giai_tich_1.pdf",
                    "page": 12,
                    "section": "Chuong 2",
                    "paragraph": 1,
                    "content": "Đạo hàm là giới hạn của tỷ số số gia.",
                })
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.settings = SimpleNamespace(embedding_profile="ollama:bge-m3", ai_provider="ollama", searxng_url="")
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.vectors = SimpleNamespace(
        collection="study_bge_m3_v1",
        search=lambda *_args: [SimpleNamespace(payload={
            "chunk_id": "chunk-1", "document_id": "doc-1", "user_id": "publisher-1",
        })],
    )
    pipeline.models = SimpleNamespace(
        count=lambda text: len(text.split()),
        embed=lambda texts, query=False: [[0.1] * 4 for _ in texts],
        rerank=lambda _q, items: items,
        generate=lambda _prompt, on_reset=None: (x for x in ["Theo giáo trình [S1] và mở rộng [S2]."]),
        last_generation_provider="ollama",
        supports_thinking_progress=False,
        supports_question_vision=False,
    )

    monkeypatch.setattr(
        worker_main,
        "search_web",
        lambda *_args, **_kwargs: ([{
            "url": "https://api.openalex.org/works/1",
            "title": "Derivative intuition",
            "content": "Visual slope interpretation.",
            "kind": "article",
            "provider": "OpenAlex",
        }], []),
    )

    job = {
        "id": "job-1",
        "queue_id": 1,
        "user_id": "student-1",
        "message_id": "msg-1",
        "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1",
            "user_message_id": "user-msg-1",
            "question": "Đạo hàm là gì?",
            "document_ids": [],
            "versions": {},
            "mode": "search",
        },
    }
    pipeline.chat(job)

    web_updates = [params for sql, params in executed if "set web_sources=%s" in sql]
    assert len(web_updates) == 1
    saved_web = web_updates[0][0].obj
    assert saved_web == [{
        "label": "S2",
        "title": "Derivative intuition",
        "url": "https://api.openalex.org/works/1",
        "kind": "article",
        "provider": "OpenAlex",
    }]
    source_inserts = [params for sql, params in executed if "insert into public.message_sources" in sql]
    assert len(source_inserts) == 1
    assert source_inserts[0][4] == "S1"


def test_retrieval_query_cleaning_terms_and_subject_hints():
    cleaned = clean_retrieval_query("Bài tập: > **Đạo hàm** của `hàm ẩn` là gì?")
    assert cleaned == "**Đạo hàm** của hàm ẩn là gì?"
    terms = extract_search_terms("Đạo hàm của hàm ẩn là gì?")
    assert "đạo" in terms and "hàm" in terms and "ẩn" in terms
    poiseuille_q = (
        "Độ chênh lệch áp suất giữa hai đầu của một ống dẫn tròn nằm ngang bán kính R = 1 cm, "
        "dài l = 100 cm là Δp = 200 Pa. Hệ số nhớt của chất lỏng là η = 10^-2 Pa.s. "
        "Tìm lưu lượng chất lỏng chảy qua ống theo định luật Poiseuille."
    )
    assert "poiseuille" in extract_search_terms(poiseuille_q)[:3]
    assert infer_subject_hint("Tính đạo hàm hàm ẩn f(x, y)") == "calculus"
    assert infer_subject_hint("Tìm trị riêng và vectơ riêng của ma trận") == "linear-algebra"
    assert infer_subject_hint("Áp dụng định luật Poiseuille cho chất lưu có độ nhớt") == "physics"
    assert is_meta_document_query("Tóm tắt nội dung chính của tài liệu này") is True
    assert is_meta_document_query("Đạo hàm là gì?") is False


def test_rerank_curriculum_candidates_dedup_stub_noise_and_subject():
    candidates = [
        {
            "id": "c-stub",
            "document_id": "d-1",
            "document_name": "Dao ham - Vi phan (1).pdf",
            "subject": "calculus",
            "content": "## I. Đạo hàm",
            "vector_score": 0.85,
        },
        {
            "id": "c-dup-1",
            "document_id": "d-1",
            "document_name": "Dao ham - Vi phan (1).pdf",
            "subject": "calculus",
            "content": (
                "Định nghĩa đạo hàm: Đạo hàm của hàm số f tại điểm x0 là giới hạn hữu hạn của tỉ số "
                "số gia hàm số và số gia đối số khi delta x tiến tới 0, dùng để đo tốc độ biến thiên tức thời."
            ),
            "vector_score": 0.78,
        },
        {
            "id": "c-dup-2",
            "document_id": "d-2",
            "document_name": "Dao ham - Vi phan (2).pdf",
            "subject": "calculus",
            "content": (
                "Định nghĩa đạo hàm: Đạo hàm của hàm số f tại điểm x0 là giới hạn hữu hạn của tỉ số "
                "số gia hàm số và số gia đối số khi delta x tiến tới 0, dùng để đo tốc độ biến thiên tức thời."
            ),
            "vector_score": 0.79,
        },
        {
            "id": "c-phys",
            "document_id": "d-3",
            "document_name": "Tap1.pdf",
            "subject": "physics",
            "content": "Trong cơ học, vận tốc là đạo hàm theo thời gian của tọa độ chất điểm trên quỹ đạo thẳng.",
            "vector_score": 0.76,
        },
    ]
    ranked = rerank_curriculum_candidates("Đạo hàm là gì?", candidates)
    assert len(ranked) == 3
    assert ranked[0]["document_name"].startswith("Dao ham - Vi phan")
    assert len(ranked[0]["content"]) >= 90
    assert sum(1 for item in ranked if "Định nghĩa đạo hàm:" in item["content"]) == 1

    off_topic = rerank_curriculum_candidates(
        "hôm nay trời bao nhiêu độ",
        [{
            "id": "noise-1",
            "document_id": "d-9",
            "document_name": "Giai tich 1.pdf",
            "subject": "calculus",
            "content": "Không gian mêtric và sự hội tụ của dãy Cauchy trong trường số thực.",
            "vector_score": 0.49,
        }],
    )
    assert off_topic == []

    meta_kept = rerank_curriculum_candidates(
        "Tóm tắt tài liệu này",
        [{
            "id": "meta-1",
            "document_id": "d-9",
            "document_name": "Giai tich 1.pdf",
            "subject": "calculus",
            "content": "Chương 1 giới thiệu giới hạn, đạo hàm và ứng dụng của phép tính vi phân.",
            "vector_score": 0.44,
        }],
    )
    assert len(meta_kept) == 1


def test_expand_stub_chunks_merges_neighbors():
    class StubConn:
        def execute(self, sql, params):
            return SimpleNamespace(fetchall=lambda: [{
                "id": "c-2",
                "document_id": "d-1",
                "user_id": "owner-1",
                "index_version": 1,
                "ordinal": 2,
                "document_name": "Dao ham.pdf",
                "subject": "calculus",
                "section": "1. Định nghĩa",
                "content": "Đạo hàm tại x0 biểu thị hệ số góc tiếp tuyến và tốc độ biến thiên tức thời của hàm số.",
            }])

    expanded = expand_stub_chunks(
        StubConn(),
        [{
            "id": "c-1",
            "document_id": "d-1",
            "user_id": "owner-1",
            "index_version": 1,
            "ordinal": 1,
            "document_name": "Dao ham.pdf",
            "subject": "calculus",
            "content": "## I. Đạo hàm",
        }],
        using_shared_catalog=True,
        user_id="student-1",
        owners={"d-1": "owner-1"},
        versions={"d-1": 1},
    )
    assert len(expanded) == 1
    assert "tiếp tuyến" in expanded[0]["content"]
    assert expanded[0]["section"] == "1. Định nghĩa"


def test_library_prompt_citations_normalize_and_review():
    sources = [{
        "label": "S1",
        "document_name": "Giai tich 1.pdf",
        "content": "Đạo hàm biểu thị tốc độ biến thiên tức thời.",
        "excerpt": "Đạo hàm biểu thị tốc độ biến thiên tức thời.",
        "page": 12,
    }]
    messages, selected = build_prompt("Đạo hàm là gì?", [], sources, lambda text: len(text.split()), mode="library")
    assert "[S1]" in messages[0]["content"]
    assert "[S2]" not in messages[0]["content"]
    assert len(selected) == 1

    two_sources = [*sources, {**sources[0], "label": "S2", "content": "Đạo hàm tại một điểm là hệ số góc tiếp tuyến."}]
    two_messages, two_selected = build_prompt("Đạo hàm là gì?", [], two_sources, lambda text: len(text.split()), mode="library")
    assert "[S1], [S2]" in two_messages[0]["content"]
    assert len(two_selected) == 2

    normalized = normalize_citation_marks("Đoạn này [S1, S2]\n$$\nx [S1, S2]\n$$\n")
    assert normalized == "Đoạn này [S1] [S2]\n$$\nx [S1, S2]\n$$\n"

    valid, used = validate_citations("Kết quả là đạo hàm [S1].\n$$\nf'(x) [S1]\n$$", sources)
    assert "$$\nf'(x)\n$$\n\n[S1]" in valid
    assert len(used) == 1

    fake_models = SimpleNamespace(
        count=lambda text: len(text) // 4,
        generate=lambda messages: (x for x in ['[[1, "S1:0"], [3, "S1:0"]]']),
    )
    draft = (
        "Đạo hàm biểu thị tốc độ biến thiên tức thời.\n"
        "$$\nf'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}\n$$\n"
    )
    reviewed = review_missing_citations("Đạo hàm là gì?", draft, sources, fake_models)
    assert reviewed.splitlines()[0].endswith("[S1]")
    assert "[S1]" not in reviewed.splitlines()[2]


def _make_search_pipeline(monkeypatch, *, history_rows=None, tokens=None, guard_rows=None, web_results=None):
    executed = []
    history_rows = history_rows or []
    tokens = tokens or ["Theo giáo trình [S1]."]
    guard_iter = iter(guard_rows or [])

    class FakeTransaction:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    class FakeConn:
        def transaction(self):
            return FakeTransaction()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "from public.jobs where id=%s for update" in sql:
                row = next(guard_iter, {"lease_token": "lease-1", "status": "running", "error": None})
                return SimpleNamespace(fetchone=lambda r=row: r)
            if "from public.knowledge_documents k" in sql and "vector_collection=%s" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "doc-1", "user_id": "publisher-1", "index_version": 2,
                }])
            if "join public.knowledge_documents k" in sql and "order by d.id for share" in sql:
                return SimpleNamespace(fetchall=lambda: [{"id": "doc-1", "index_version": 2}])
            if "select role,content" in sql:
                return SimpleNamespace(fetchall=lambda: list(reversed(history_rows)))
            if "from public.document_chunks c" in sql:
                return SimpleNamespace(fetchone=lambda: {
                    "id": "chunk-1",
                    "document_id": "doc-1",
                    "user_id": "publisher-1",
                    "document_name": "Tap1.pdf",
                    "subject": "physics",
                    "page": 12,
                    "section": "Chuong 1",
                    "paragraph": 1,
                    "content": "Thứ nguyên biểu thị bản chất vật lý của một đại lượng đo được.",
                })
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.settings = SimpleNamespace(embedding_profile="ollama:bge-m3", ai_provider="ollama", searxng_url="")
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.vectors = SimpleNamespace(
        collection="study_bge_m3_v1",
        search=lambda *_args: [SimpleNamespace(payload={
            "chunk_id": "chunk-1", "document_id": "doc-1", "user_id": "publisher-1",
        })],
    )
    pipeline.models = SimpleNamespace(
        count=lambda text: len(text.split()),
        embed=lambda texts, query=False: [[0.1] * 4 for _ in texts],
        rerank=lambda _q, items: items,
        generate=lambda _prompt, on_reset=None, **_opts: (x for x in tokens),
        last_generation_provider="ollama",
        supports_thinking_progress=False,
        supports_question_vision=False,
    )

    search_calls = []

    def fake_search_web(terms, mode, searxng_url="", image_question=""):
        search_calls.append((terms, mode, image_question))
        items = web_results if web_results is not None else [{
            "url": "https://vi.wikipedia.org/wiki/Thu_nguyen",
            "title": "Thứ nguyên",
            "content": "Khái niệm thứ nguyên trong vật lý.",
            "kind": "wikipedia",
            "provider": "Wikipedia",
        }]
        return items, []

    monkeypatch.setattr(worker_main, "search_web", fake_search_web)
    return pipeline, executed, search_calls


def test_pipeline_chat_search_mode_persists_selected_web_sources_when_only_curriculum_cited(monkeypatch):
    pipeline, executed, _ = _make_search_pipeline(
        monkeypatch,
        tokens=["Theo giáo trình [S1], thứ nguyên thể hiện bản chất vật lý."],
        web_results=[
            {
                "url": "https://vi.wikipedia.org/wiki/Thu_nguyen",
                "title": "Thứ nguyên",
                "content": "Khái niệm thứ nguyên trong vật lý.",
                "kind": "wikipedia",
                "provider": "Wikipedia",
            },
            {
                "url": "https://api.openalex.org/works/2",
                "title": "Dimensional analysis",
                "content": "Overview of physical dimensions.",
                "kind": "article",
                "provider": "OpenAlex",
            },
        ],
    )
    job = {
        "id": "job-1",
        "queue_id": 1,
        "kind": "chat",
        "user_id": "student-1",
        "message_id": "msg-1",
        "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1",
            "user_message_id": "user-msg-1",
            "question": "Thứ nguyên là gì?",
            "document_ids": [],
            "versions": {},
            "mode": "search",
            "subject": "physics",
        },
    }
    pipeline.chat(job)

    web_updates = [params for sql, params in executed if "set web_sources=%s" in sql]
    assert len(web_updates) == 1
    saved_web = web_updates[0][0].obj
    assert [item["url"] for item in saved_web] == [
        "https://vi.wikipedia.org/wiki/Thu_nguyen",
        "https://api.openalex.org/works/2",
    ]
    source_inserts = [params for sql, params in executed if "insert into public.message_sources" in sql]
    assert len(source_inserts) == 1
    assert source_inserts[0][4] == "S1"


def test_pipeline_chat_search_mode_followup_contextualizes_search_web_terms(monkeypatch):
    history_rows = [
        {"id": "u0", "role": "user", "content": "Thứ nguyên trong vật lý là gì?", "status": "completed"},
        {"id": "a0", "role": "assistant", "content": "Thứ nguyên mô tả bản chất vật lý của đại lượng.", "status": "completed"},
    ]
    pipeline, _, search_calls = _make_search_pipeline(
        monkeypatch,
        history_rows=history_rows,
        tokens=["Giải thích thêm về thứ nguyên [S1]."],
    )
    job = {
        "id": "job-2",
        "queue_id": 2,
        "kind": "chat",
        "user_id": "student-1",
        "message_id": "msg-2",
        "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1",
            "user_message_id": "user-msg-2",
            "question": "Giải thích rõ hơn",
            "document_ids": [],
            "versions": {},
            "mode": "search",
            "subject": "physics",
        },
    }
    pipeline.chat(job)

    assert len(search_calls) == 1
    terms, mode, _ = search_calls[0]
    assert mode == "search"
    assert "nguyên" in terms.lower()
    assert "Vật lý đại cương" in terms


def test_pipeline_chat_stopped_flushes_buffered_answer(monkeypatch):
    guard_rows = [
        {"lease_token": "lease-1", "status": "running", "error": None},
        {"lease_token": "lease-1", "status": "running", "error": None},
        {"lease_token": "lease-1", "status": "running", "error": None},
        {"lease_token": "lease-1", "status": "running", "error": "USER_STOPPED"},
    ]
    pipeline, executed, _ = _make_search_pipeline(
        monkeypatch,
        tokens=["Thứ nguyên ", "đang được giải thích"],
        guard_rows=guard_rows,
    )
    ticks = iter([100.0, 100.6, 101.2])
    monkeypatch.setattr(worker_main.time, "monotonic", lambda: next(ticks, 102.0))

    job = {
        "id": "job-3",
        "queue_id": 3,
        "kind": "chat",
        "user_id": "student-1",
        "message_id": "msg-3",
        "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1",
            "user_message_id": "user-msg-3",
            "question": "Thứ nguyên là gì?",
            "document_ids": [],
            "versions": {},
            "mode": "search",
            "subject": "physics",
        },
    }
    with pytest.raises(worker_main.ChatStopped):
        pipeline.chat(job)

    stopped_updates = [
        params for sql, params in executed
        if "update public.messages set content=%s where id=%s and user_id=%s and status=%s" in sql
    ]
    assert stopped_updates == [("Thứ nguyên ", "msg-3", "student-1", "stopped")]


def _make_chat_pipeline(*, has_chunk=True, answer_text="Định nghĩa chuẩn [S1].", history_rows=()):
    executed = []

    class FakeTransaction:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    class FakeConn:
        def transaction(self):
            return FakeTransaction()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "from public.jobs where id=%s for update" in sql:
                return SimpleNamespace(fetchone=lambda: {"lease_token": "lease-1", "status": "running"})
            if "from public.documents d where (user_id=%s" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "doc-1",
                    "user_id": "student-1",
                    "name": "Giai_tich_1.pdf",
                    "file_type": "pdf",
                    "status": "ready",
                    "index_version": 1,
                    "embedding_profile": "ollama:bge-m3",
                    "vector_collection": "study_bge_m3_v1",
                }])
            if "from public.knowledge_documents k" in sql and "vector_collection=%s" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "doc-1", "user_id": "publisher-1", "index_version": 2,
                }])
            if "join public.knowledge_documents k" in sql and "order by d.id for share" in sql:
                return SimpleNamespace(fetchall=lambda: [{"id": "doc-1", "index_version": 2}])
            if "from public.messages" in sql and "sequence <" in sql:
                return SimpleNamespace(fetchall=lambda: list(reversed(history_rows)))
            if "from public.document_chunks c" in sql and has_chunk:
                return SimpleNamespace(fetchone=lambda: {
                    "id": "chunk-1",
                    "document_id": "doc-1",
                    "user_id": "publisher-1",
                    "document_name": "Giai_tich_1.pdf",
                    "page": 12,
                    "section": "Chuong 2",
                    "paragraph": 1,
                    "content": "Đạo hàm là giới hạn của tỷ số số gia hàm số và đối số khi delta x tiến tới 0.",
                })
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.settings = SimpleNamespace(embedding_profile="ollama:bge-m3", ai_provider="ollama", searxng_url="")
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.vectors = SimpleNamespace(
        collection="study_bge_m3_v1",
        search=lambda *_args: (
            [SimpleNamespace(payload={"chunk_id": "chunk-1", "document_id": "doc-1", "user_id": "publisher-1"}, score=0.88)]
            if has_chunk
            else []
        ),
    )
    pipeline.models = SimpleNamespace(
        count=lambda text: len(text.split()),
        embed=lambda texts, query=False: [[0.1] * 4 for _ in texts],
        rerank=lambda _q, items: items,
        generate=lambda _prompt, on_reset=None, **_opts: (x for x in [answer_text]),
        last_generation_provider="ollama",
        supports_thinking_progress=False,
        supports_question_vision=False,
    )
    return pipeline, executed


def test_unified_chat_routing_illustrations_strict_docs_explicit_web_and_research(monkeypatch):
    sample_image = {
        "kind": "image",
        "label": "I1",
        "title": "Derivative_slope",
        "url": "https://commons.wikimedia.org/?curid=77",
        "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Derivative.png/640px-Derivative.png",
        "creator": "Math Author",
        "license_name": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    }
    sample_web = {
        "url": "https://vi.wikipedia.org/?curid=99",
        "title": "Hiệu ứng Doppler",
        "content": "Hiệu ứng Doppler là sự thay đổi tần số sóng khi nguồn và người quan sát chuyển động tương đối.",
        "kind": "wikipedia",
        "provider": "Wikipedia",
    }

    # 1. Library mode with curriculum hit + concept question -> attaches illustrations without calling search_web.
    calls = {"search_web": 0, "search_illustrations": 0}
    monkeypatch.setattr(worker_main, "search_web", lambda *_a, **_k: (calls.__setitem__("search_web", calls["search_web"] + 1) or [], []))
    monkeypatch.setattr(
        worker_main,
        "search_illustrations",
        lambda *_a, **_k: (calls.__setitem__("search_illustrations", calls["search_illustrations"] + 1) or [sample_image]),
    )
    pipeline, executed = _make_chat_pipeline(has_chunk=True, answer_text="Đạo hàm là giới hạn tỷ số số gia [S1].")
    pipeline.chat({
        "id": "job-1", "queue_id": 1, "user_id": "student-1", "message_id": "msg-1", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-1",
            "question": "Đạo hàm là gì?", "document_ids": [], "versions": {}, "mode": "library", "subject": "calculus",
        },
    })
    assert calls["search_web"] == 0
    assert calls["search_illustrations"] == 1
    saved_web = [params[0].obj for sql, params in executed if "set web_sources=%s" in sql]
    assert saved_web == [[sample_image]]

    # 2. Strict document query blocks both search_web and search_illustrations even when no chunks match.
    calls = {"search_web": 0, "search_illustrations": 0}
    pipeline, executed = _make_chat_pipeline(has_chunk=False, answer_text="Tài liệu chưa đề cập đến hiệu ứng Doppler.")
    pipeline.chat({
        "id": "job-2", "queue_id": 2, "user_id": "student-1", "message_id": "msg-2", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-2",
            "question": "Chỉ dựa trên tài liệu này, có trình bày hiệu ứng Doppler không?",
            "document_ids": ["doc-1"], "versions": {"doc-1": 1}, "mode": "documents",
        },
    })
    assert calls["search_web"] == 0
    assert calls["search_illustrations"] == 0

    # 3. Unified documents mode without matches auto-expands to web silently (no offline config notices).
    web_args = []
    monkeypatch.setattr(
        worker_main,
        "search_web",
        lambda *args, **kwargs: (web_args.append((args, kwargs)) or ([sample_web, sample_image], ["Chưa cấu hình tìm kiếm web đa trang."])),
    )
    pipeline, executed = _make_chat_pipeline(has_chunk=False, answer_text="Hiệu ứng Doppler [S1].")
    pipeline.chat({
        "id": "job-3", "queue_id": 3, "user_id": "student-1", "message_id": "msg-3", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-3",
            "question": "Hiệu ứng Doppler là gì?",
            "document_ids": ["doc-1"], "versions": {"doc-1": 1}, "mode": "documents",
        },
    })
    assert len(web_args) == 1
    assert web_args[0][1]["image_question"] == "Hiệu ứng Doppler là gì?"
    completed = [params[0] for sql, params in executed if "update public.messages set content=%s,status='completed'" in sql][0]
    assert "Chưa cấu hình tìm kiếm web đa trang." not in completed
    saved_web = [params[0].obj for sql, params in executed if "set web_sources=%s" in sql][0]
    assert [item["kind"] for item in saved_web] == ["wikipedia", "image"]

    # 4. Explicit web request in library mode merges curriculum ahead of web and preserves notices.
    web_args = []
    pipeline, executed = _make_chat_pipeline(has_chunk=True, answer_text="Theo giáo trình [S1] và Wikipedia [S2].")
    pipeline.chat({
        "id": "job-4", "queue_id": 4, "user_id": "student-1", "message_id": "msg-4", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-4",
            "question": "Tìm trên web về đạo hàm và hiệu ứng Doppler",
            "document_ids": [], "versions": {}, "mode": "library",
        },
    })
    assert len(web_args) == 1
    completed = [params[0] for sql, params in executed if "update public.messages set content=%s,status='completed'" in sql][0]
    assert "Chưa cấu hình tìm kiếm web đa trang." in completed
    source_inserts = [params for sql, params in executed if "insert into public.message_sources" in sql]
    assert source_inserts[0][4] == "S1"
    saved_web = [params[0].obj for sql, params in executed if "set web_sources=%s" in sql][0]
    assert saved_web[0]["label"] == "S2"

    # 5. Hidden research mode remains 100% intact.
    research_calls = []
    monkeypatch.setattr(
        worker_main,
        "search_web",
        lambda *args, **kwargs: (research_calls.append((args, kwargs)) or ([sample_web], ["Nguồn web dự phòng từ Wikipedia."])),
    )
    pipeline, executed = _make_chat_pipeline(has_chunk=True, answer_text="Tổng hợp [S1] và [S2].")
    pipeline.chat({
        "id": "job-5", "queue_id": 5, "user_id": "student-1", "message_id": "msg-5", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-5",
            "question": "Đạo hàm và ứng dụng",
            "document_ids": [], "versions": {}, "mode": "research",
        },
    })
    assert research_calls[0][0][1] == "research"
    assert research_calls[0][1]["image_question"] == ""
    completed = [params[0] for sql, params in executed if "update public.messages set content=%s,status='completed'" in sql][0]
    assert "Nguồn web dự phòng từ Wikipedia." in completed


def test_followup_in_library_mode_contextualizes_web_search_and_suppresses_unrequested_images(monkeypatch):
    history_rows = [
        {"id": "u-0", "role": "user", "content": "Gradient là gì", "status": "completed"},
        {"id": "a-0", "role": "assistant", "content": "Gradient của trường vô hướng là trường vectơ [S1].", "status": "completed"},
    ]
    sample_web = {
        "url": "https://vi.wikipedia.org/?curid=10",
        "title": "Gradient",
        "content": "Trong giải tích vectơ, gradient là một trường vectơ.",
        "kind": "wikipedia",
        "provider": "Wikipedia",
    }
    sample_image = {
        "kind": "image",
        "label": "I1",
        "title": "Gradient2",
        "url": "https://commons.wikimedia.org/?curid=301",
        "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Gradient2.svg/640px-Gradient2.svg.png",
        "creator": "Math Author",
        "license_name": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    }

    web_calls = []
    ill_calls = []
    monkeypatch.setattr(
        worker_main,
        "search_web",
        lambda *args, **kwargs: (
            web_calls.append((args, kwargs))
            or ([sample_web] + ([sample_image] if kwargs.get("image_question") else []), [])
        ),
    )
    monkeypatch.setattr(
        worker_main,
        "search_illustrations",
        lambda *args, **kwargs: ill_calls.append((args, kwargs)) or [sample_image],
    )

    # Case A: "Chi tiết hơn đi" follow-up with no curriculum chunk -> searches web for "Gradient", NO unrequested images.
    pipeline, executed = _make_chat_pipeline(
        has_chunk=False,
        answer_text="Gradient biểu diễn hướng tăng nhanh nhất [S1].",
        history_rows=history_rows,
    )
    pipeline.chat({
        "id": "job-f1", "queue_id": 10, "user_id": "student-1", "message_id": "msg-f1", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-1",
            "question": "Chi tiết hơn đi",
            "document_ids": [], "versions": {}, "mode": "library", "subject": "calculus",
        },
    })
    assert len(web_calls) == 1
    assert "gradient" in web_calls[0][0][0].casefold()
    assert "chi tiết hơn" not in web_calls[0][0][0].casefold()
    assert web_calls[0][1]["image_question"] == ""
    assert ill_calls == []
    saved_web = [params[0].obj for sql, params in executed if "set web_sources=%s" in sql][0]
    assert [item["kind"] for item in saved_web] == ["wikipedia"]

    # Case B: Follow-up WITH curriculum chunk ("Chi tiết hơn đi") -> does NOT call search_illustrations again.
    web_calls.clear()
    ill_calls.clear()
    pipeline_hit, _ = _make_chat_pipeline(
        has_chunk=True,
        answer_text="Theo giáo trình [S1], gradient vuông góc đường mức.",
        history_rows=history_rows,
    )
    pipeline_hit.chat({
        "id": "job-f2", "queue_id": 11, "user_id": "student-1", "message_id": "msg-f2", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-2",
            "question": "Chi tiết hơn đi",
            "document_ids": [], "versions": {}, "mode": "library", "subject": "calculus",
        },
    })
    assert web_calls == []
    assert ill_calls == []

    # Case C: Follow-up EXPLICITLY requesting an illustration -> contextualizes topic to "Gradient"!
    web_calls.clear()
    ill_calls.clear()
    pipeline_ill, executed_ill = _make_chat_pipeline(
        has_chunk=True,
        answer_text="Hình minh họa gradient trên mặt cong [S1].",
        history_rows=history_rows,
    )
    pipeline_ill.chat({
        "id": "job-f3", "queue_id": 12, "user_id": "student-1", "message_id": "msg-f3", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-3",
            "question": "Cho mình xem hình minh họa chi tiết hơn",
            "document_ids": [], "versions": {}, "mode": "library", "subject": "calculus",
        },
    })
    assert len(ill_calls) == 1
    assert "gradient" in ill_calls[0][0][0].casefold()
    saved_ill = [params[0].obj for sql, params in executed_ill if "set web_sources=%s" in sql][0]
    assert [item["title"] for item in saved_ill] == ["Gradient2"]


def test_cross_subject_history_and_authorized_source_carry_over(monkeypatch):
    history_rows = [
        {"id": "u-0", "role": "user", "content": "Cho f(x,y) = x^2 + 3xy, tính gradient.", "status": "completed"},
        {"id": "a-0", "role": "assistant", "content": "Áp dụng công thức đạo hàm riêng [S1].", "status": "completed"},
    ]
    carried_chunk = {
        "id": "chunk-prev",
        "document_id": "doc-1",
        "user_id": "student-1",
        "index_version": 1,
        "document_name": "Giai_tich_1.pdf",
        "subject": "calculus",
        "page": 8,
        "section": "Chuong 3",
        "paragraph": 2,
        "content": "Gradient của hàm hai biến f(x,y) là vectơ (df/dx, df/dy).",
    }
    executed = []
    seen_prompts = []

    class FakeTransaction:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    class FakeConn:
        def transaction(self):
            return FakeTransaction()

        def execute(self, sql, params=()):
            executed.append((sql, params))
            if "from public.jobs where id=%s for update" in sql:
                return SimpleNamespace(fetchone=lambda: {"lease_token": "lease-1", "status": "running"})
            if "from public.documents d where (user_id=%s" in sql:
                return SimpleNamespace(fetchall=lambda: [{
                    "id": "doc-1",
                    "user_id": "student-1",
                    "name": "Giai_tich_1.pdf",
                    "file_type": "pdf",
                    "status": "ready",
                    "index_version": 1,
                    "embedding_profile": "ollama:bge-m3",
                    "vector_collection": "study_bge_m3_v1",
                }, {
                    "id": "doc-2",
                    "user_id": "student-1",
                    "name": "Giai_tich_2.pdf",
                    "file_type": "pdf",
                    "status": "ready",
                    "index_version": 1,
                    "embedding_profile": "ollama:bge-m3",
                    "vector_collection": "study_bge_m3_v1",
                }][:1 if "doc-1" in params[1] else 1])
            if "from public.messages" in sql and "sequence <" in sql:
                # Must NOT filter out messages when subject filter changes mid-conversation.
                assert "subject is not distinct from" not in sql
                return SimpleNamespace(fetchall=lambda: list(reversed(history_rows)))
            if "from public.message_sources ms" in sql:
                return SimpleNamespace(fetchall=lambda: [carried_chunk])
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    monkeypatch.setattr(worker_main, "search_web", lambda *_a, **_k: ([], []))
    monkeypatch.setattr(worker_main, "search_illustrations", lambda *_a, **_k: [])

    pipeline = worker_main.Pipeline.__new__(worker_main.Pipeline)
    pipeline.conn = FakeConn()
    pipeline.settings = SimpleNamespace(embedding_profile="ollama:bge-m3", ai_provider="ollama", searxng_url="")
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.vectors = SimpleNamespace(collection="study_bge_m3_v1", search=lambda *_a: [])
    pipeline.models = SimpleNamespace(
        count=lambda text: len(text.split()),
        embed=lambda texts, query=False: [[0.1] * 4 for _ in texts],
        rerank=lambda _q, items: items,
        generate=lambda prompt, on_reset=None, **_opts: (seen_prompts.append(prompt) or (x for x in ["Đúng rồi, đạo hàm theo x là 2x + 3y [S1]."])),
        last_generation_provider="ollama",
        supports_thinking_progress=False,
        supports_question_vision=False,
    )

    # 1. Student submits intermediate math result ("Mình tính ra 2x + 3y đúng không?") with 0 fresh vector hits ->
    #    carries over authorized [S1] chunk from Turn 1 and preserves conversation history across subject change.
    pipeline.chat({
        "id": "job-co-1", "queue_id": 20, "user_id": "student-1", "message_id": "msg-co-1", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-1",
            "question": "Mình tính đạo hàm theo x ra 2x + 3y đúng không?",
            "document_ids": ["doc-1"], "versions": {"doc-1": 1}, "mode": "documents", "subject": "calculus",
        },
    })
    assert any("df/dx" in seen_prompts[-1][0]["content"] for _ in [0])
    source_inserts = [params for sql, params in executed if "insert into public.message_sources" in sql]
    assert len(source_inserts) == 1
    assert source_inserts[0][1] == "chunk-prev"

    # 2. If user switched selected documents to doc-2 (unchecking doc-1), doc-1 chunk is NOT carried over.
    unauthorized = pipeline.carry_over_chunks(
        {"user_id": "student-1"},
        history_rows,
        ["doc-2"],
        {"doc-2": "student-1"},
        {"doc-2": 1},
        False,
    )
    assert unauthorized == []

    # 3. If doc-1 was re-indexed to version 2, stale version 1 chunk is NOT carried over.
    stale = pipeline.carry_over_chunks(
        {"user_id": "student-1"},
        history_rows,
        ["doc-1"],
        {"doc-1": "student-1"},
        {"doc-1": 2},
        False,
    )
    assert stale == []


def test_curriculum_first_priority_expands_to_web_when_subject_refinement_misses_library_and_blocks_off_scope(monkeypatch):
    from study_worker.rag import OUT_OF_SCOPE_MESSAGE
    from study_worker.retrieval import curriculum_covers_query, detect_explicit_subject, extract_search_terms

    # 1. Stripping generic course modifier prevents false-positive preface hits on "tích" in "gradient trong giải tích".
    assert detect_explicit_subject("gradient trong giải tích") == "calculus"
    assert extract_search_terms("gradient trong giải tích") == ["gradient"]
    preface_chunk = {
        "id": "preface-1",
        "document_id": "calc-1",
        "document_name": "Giải tích 1 Giáo trình (trang 1-45).pdf",
        "subject": "calculus",
        "content": "Lời tựa cuốn sách phân tích một cách toàn cục chương trình năm nhất.",
        "vector_score": 0.42,
    }
    assert curriculum_covers_query("gradient trong giải tích", [preface_chunk]) is False

    # 2. Follow-up "gradient trong giải tích" after Turn 1 Physics hit checks Calculus library first, finds 0 coverage,
    #    and automatically expands to academic web search.
    history_rows = [
        {"id": "u-0", "role": "user", "content": "Gradient là gì", "status": "completed"},
        {"id": "a-0", "role": "assistant", "content": "Trong vật lý, gradient từ trường... [S1].", "status": "completed"},
    ]
    web_calls = []
    sample_web = {
        "url": "https://vi.wikipedia.org/?curid=10",
        "title": "Gradient",
        "content": "Trong giải tích vectơ, gradient của hàm vô hướng f(x,y) là vectơ đạo hàm riêng.",
        "kind": "wikipedia",
        "provider": "Wikipedia",
    }
    monkeypatch.setattr(
        worker_main,
        "search_web",
        lambda *args, **kwargs: web_calls.append((args, kwargs)) or ([sample_web], []),
    )
    monkeypatch.setattr(worker_main, "search_illustrations", lambda *_a, **_k: [])

    pipeline, executed = _make_chat_pipeline(
        has_chunk=False,
        answer_text="Trong giải tích, gradient của f(x,y) là vectơ đạo hàm riêng [S1].",
        history_rows=history_rows,
    )
    pipeline.chat({
        "id": "job-p1", "queue_id": 30, "user_id": "student-1", "message_id": "msg-p1", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-1", "user_message_id": "u-1",
            "question": "gradient trong giải tích",
            "document_ids": [], "versions": {}, "mode": "library", "subject": None,
        },
    })
    # Verified: queried shared library scoped to effective_subject == 'calculus' FIRST, then fell back to web search.
    catalog_queries = [params for sql, params in executed if "from public.knowledge_documents k" in sql and "vector_collection=%s" in sql]
    assert catalog_queries[0][-2:] == ("calculus", "calculus")
    assert len(web_calls) == 1
    assert "gradient" in web_calls[0][0][0].casefold()
    saved_web = [params[0].obj for sql, params in executed if "set web_sources=%s" in sql][0]
    assert saved_web[0]["title"] == "Gradient"

    # 3. Post-generation fallback: if library returned a chunk that looked lexically similar, but LLM could not cite it
    #    (used == []), worker automatically triggers Stage 2 web search and regenerates with citation.
    web_calls.clear()
    responses = iter([
        "Gradient là vectơ chỉ hướng tăng nhanh nhất.",
        "[]",
        "Theo nguồn bổ trợ [S2], gradient là vectơ đạo hàm riêng.",
    ])
    pipeline2, executed2 = _make_chat_pipeline(has_chunk=True, history_rows=[])
    pipeline2.models.generate = lambda _p, on_reset=None, **_o: (x for x in [next(responses)])
    pipeline2.save_partial = lambda *_a, **_k: None
    pipeline2.chat({
        "id": "job-p2", "queue_id": 31, "user_id": "student-1", "message_id": "msg-p2", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-2", "user_message_id": "u-2",
            "question": "Đạo hàm theo hướng và gradient liên hệ thế nào?",
            "document_ids": [], "versions": {}, "mode": "library", "subject": "calculus",
        },
    })
    assert len(web_calls) == 1
    saved_web2 = [params[0].obj for sql, params in executed2 if "set web_sources=%s" in sql][0]
    assert saved_web2[0]["label"] == "S2"

    # 4. Out-of-academic-scope query is refused immediately without embedding or calling search_web.
    web_calls.clear()
    embed_calls = []
    pipeline3, executed3 = _make_chat_pipeline(has_chunk=False, history_rows=[])
    pipeline3.models.embed = lambda texts, query=False: embed_calls.append(texts) or [[0.1] * 4]
    pipeline3.chat({
        "id": "job-oos", "queue_id": 32, "user_id": "student-1", "message_id": "msg-oos", "lease_token": "lease-1",
        "payload": {
            "conversation_id": "conv-3", "user_message_id": "u-3",
            "question": "hôm nay trời bao nhiêu độ",
            "document_ids": [], "versions": {}, "mode": "library", "subject": None,
        },
    })
    assert embed_calls == []
    assert web_calls == []
    completed_oos = [params[0] for sql, params in executed3 if "update public.messages set content=%s,status='completed'" in sql][0]
    assert completed_oos == OUT_OF_SCOPE_MESSAGE

