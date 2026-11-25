import threading
from types import SimpleNamespace

import httpx

from study_worker import main as worker_main
from study_worker import web_search
from study_worker.rag import build_prompt, validate_citations


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
