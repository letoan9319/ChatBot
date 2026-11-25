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
    assert "[S1], [S2]" in messages[0]["content"]
    assert len(selected) == 1

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
        generate=lambda _prompt, on_reset=None: (x for x in tokens),
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


