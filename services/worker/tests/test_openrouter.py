import json
import threading
from contextlib import nullcontext
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from qdrant_client import QdrantClient, models

from study_worker.config import Settings
from study_worker.main import IndexMismatch, Pipeline
from study_worker.models import VectorStore, create_models
from study_worker.openrouter import OpenRouterModels, ProviderError


def settings(**kwargs):
    return Settings(
        "db", "https://example.supabase.co", "service-placeholder", "https://qdrant.example", "qdrant-placeholder",
        ai_provider="openrouter", openrouter_key="openrouter-placeholder",
        chat_model="nvidia/nemotron-3.5-lightning:free", embed_model="nvidia/nemotron-3.5-embed-1b:free", **kwargs,
    )


def mocked(handler, **kwargs):
    value = OpenRouterModels.__new__(OpenRouterModels)
    value.settings = settings(**kwargs)
    value.dimensions = None
    value.next_request = 0
    value.pace = lambda: None
    value.http = httpx.Client(base_url="https://openrouter.ai/api/v1/", transport=httpx.MockTransport(handler))
    return value


def test_embeddings_preserve_batch_order_use_query_role_and_discover_dimension():
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={"data": [
            {"index": 1, "embedding": [0.0, 1.0, 0.0]}, {"index": 0, "embedding": [1.0, 0.0, 0.0]},
        ]})

    value = mocked(handler)
    assert value.embed(["a", "b"]) == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    assert value.dimensions == 3
    value.embed(["a", "b"], query=True)
    assert [item["input_type"] for item in requests] == ["search_document", "search_query"]
    assert all(item["provider"]["max_price"] == {"prompt": "0", "completion": "0", "request": "0"} for item in requests)
    assert all(item["provider"]["allow_fallbacks"] is False for item in requests)
    assert "dimensions" not in requests[0]


@pytest.mark.parametrize("items", [
    [], [{"index": 1, "embedding": [1]}], [{"index": 0, "embedding": []}],
    [{"index": 0, "embedding": [True]}], [{"index": 0, "embedding": ["private response"]}],
])
def test_malformed_embeddings_fail_without_echoing_source_or_provider_text(items):
    value = mocked(lambda _: httpx.Response(200, json={"data": items}))
    with pytest.raises(ProviderError) as error:
        value.embed(["private question"])
    assert "private" not in str(error.value)


def test_dimension_changes_and_nonfinite_vectors_fail():
    value = mocked(lambda _: httpx.Response(200, content=b'{"data":[{"index":0,"embedding":[NaN]}]}'))
    with pytest.raises(ProviderError):
        value.embed(["a"])
    value.http.close()
    value = mocked(lambda _: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1, 2]}]}))
    value.dimensions = 3
    with pytest.raises(ProviderError) as error:
        value.embed(["a"])
    assert error.value.permanent


def test_rerank_only_reorders_authorized_canonical_rows():
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"results": [
            {"index": 0, "relevance_score": 0.1, "document": {"text": "injected text", "id": "foreign-id"}},
            {"index": 1, "relevance_score": 0.9},
        ]})

    value = mocked(handler, rerank_model="nvidia/nemotron-3.5-rerank-8b:free")
    candidates = [{"id": "own-a", "content": "canonical-a"}, {"id": "own-b", "content": "canonical-b"}]
    result = value.rerank("question", candidates)
    assert result == candidates[::-1]
    assert result[0] is candidates[1]
    assert requests[0]["documents"] == ["canonical-a", "canonical-b"]
    value.settings = replace(value.settings, rerank_model="")
    assert value.rerank("q", candidates) is candidates


@pytest.mark.parametrize("indices", [[0, 0], [0, 2], [0], [0, True]])
def test_rerank_rejects_missing_duplicate_or_foreign_indices(indices):
    value = mocked(lambda _: httpx.Response(200, json={
        "results": [{"index": index, "relevance_score": 1} for index in indices],
    }), rerank_model="nvidia/nemotron-3.5-rerank-8b:free")
    with pytest.raises(ProviderError):
        value.rerank("q", [{"content": "a"}, {"content": "b"}])


def sse(events, done=True):
    return ": keepalive\n\n" + "".join(f"data: {json.dumps(event)}\n\n" for event in events) + (
        "data: [DONE]\n\n" if done else ""
    )


def test_stream_only_publishes_content_and_requires_stop_plus_done():
    requests = []
    events = [
        {"choices": [{"delta": {"reasoning": "hidden chain", "content": "Answer [S1]"}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]

    def handler(request):
        assert request.url.path == "/api/v1/chat/completions"
        requests.append(json.loads(request.content))
        return httpx.Response(200, text=sse(events))

    value = mocked(handler)
    assert "".join(value.generate([])) == "Answer [S1]"
    assert requests[0]["reasoning"] == {"enabled": False, "exclude": True}
    assert requests[0]["max_tokens"] == 768


@pytest.mark.parametrize("events,done", [
    ([{"choices": [{"delta": {"content": "partial"}}]}], True),
    ([{"choices": [{"delta": {"content": "partial"}, "finish_reason": "stop"}]}], False),
    ([{"choices": [{"delta": {"content": "partial"}, "finish_reason": "length"}]}], True),
    ([{"error": {"message": "private document"}}], True),
])
def test_truncated_or_error_stream_is_never_complete(events, done):
    value = mocked(lambda _: httpx.Response(200, text=sse(events, done)))
    with pytest.raises(ProviderError) as error:
        list(value.generate([]))
    assert "private" not in str(error.value)


def test_quota_and_credentials_have_safe_errors_and_bounded_retry_delay():
    response = httpx.Response(429, headers={"retry-after": "120"}, json={"error": "secret content"})
    with pytest.raises(ProviderError) as error:
        OpenRouterModels.check(response)
    assert error.value.retry_after == 120 and not error.value.permanent
    assert "secret" not in str(error.value)
    with pytest.raises(ProviderError) as error:
        OpenRouterModels.check(httpx.Response(401, text="secret API key"))
    assert error.value.permanent and "secret" not in str(error.value)


def test_startup_checks_modality_price_and_embedding_dimension():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.method == "POST":
            return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1, 2]}]})
        modality = "embeddings" if "embed-" in request.url.path else "text"
        return httpx.Response(200, json={"data": {
            "architecture": {"output_modalities": [modality]},
            "endpoints": [{"pricing": {"prompt": "0", "completion": "0"}}],
        }})

    value = mocked(handler)
    value.prepare()
    assert value.dimensions == 2 and len(calls) == 3
    value.settings = replace(value.settings, chat_model="nvidia/paid-model")
    with pytest.raises(ValueError, match="free"):
        value.prepare()


@pytest.mark.parametrize("modality,price", [("embeddings", "0"), ("text", "0.1")])
def test_startup_refuses_wrong_modality_and_paid_endpoints(modality, price):
    value = mocked(lambda _: httpx.Response(200, json={"data": {
        "architecture": {"output_modalities": [modality]},
        "endpoints": [{"pricing": {"prompt": price, "completion": "0"}}],
    }}))
    with pytest.raises(ValueError):
        value.prepare()


def test_collection_namespace_includes_embedding_identity_and_dimension(monkeypatch):
    monkeypatch.setattr("study_worker.models.QdrantClient", lambda **_: None)
    a = VectorStore(settings(), 2048)
    b = VectorStore(replace(settings(), embed_model="nvidia/nemotron-3.5-embed-8b:free"), 2048)
    c = VectorStore(settings(), 1024)
    assert len({a.collection, b.collection, c.collection, "study_bge_m3_v1"}) == 4


def test_old_collection_cleanup_keeps_other_tenants_vectors():
    store = VectorStore.__new__(VectorStore)
    store.collection = "new-model"
    store.client = QdrantClient(":memory:")
    store.client.create_collection("old-model", vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    store.client.upsert("old-model", points=[
        models.PointStruct(id=1, vector=[1., 0.], payload={"user_id": "alice", "document_id": "doc"}),
        models.PointStruct(id=2, vector=[1., 0.], payload={"user_id": "bob", "document_id": "doc"}),
    ])
    store.delete("alice", "doc", "old-model")
    assert store.client.count("old-model").count == 1
    assert store.client.retrieve("old-model", [2])
    store.delete("alice", "doc", "missing-model")


def test_chat_refuses_old_embedding_space_before_any_ai_call():
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.settings = settings()
    pipeline.vectors = SimpleNamespace(collection="new-model")
    rows = [{"id": "d", "status": "ready", "index_version": 1,
             "embedding_profile": "ollama:bge-m3", "vector_collection": "old-model"}]
    pipeline.conn = SimpleNamespace(execute=lambda *_: SimpleNamespace(fetchall=lambda: rows))
    with pytest.raises(IndexMismatch):
        pipeline.chat_documents({"user_id": "u", "payload": {"document_ids": ["d"], "versions": {"d": 1}}})


def test_pipeline_never_sends_unverified_vector_sources_to_rerank_or_chat(monkeypatch):
    canonical = {
        "id": "own-chunk", "document_id": "own-doc", "user_id": "alice", "index_version": 1,
        "content": "Authorized source", "document_name": "source.pdf", "page": 1, "section": None, "paragraph": None,
    }
    forwarded = []

    class Conn:
        def transaction(self):
            return nullcontext()

        def execute(self, sql, params):
            if "select role,content" in sql:
                return SimpleNamespace(fetchall=lambda: [])
            if "select c.*" in sql:
                assert params[1:] == ("alice", "own-doc", "alice", 1)
                return SimpleNamespace(fetchone=lambda: canonical if params[0] == "own-chunk" else None)
            return None

    def rerank(query, candidates):
        forwarded.extend(candidates)
        return candidates

    def generate(prompt, *, on_reset=None):
        assert "Authorized source" in prompt[0]["content"]
        assert "foreign secret" not in str(prompt)
        return iter(["Answer [S1]"])

    pipeline = Pipeline.__new__(Pipeline)
    pipeline.conn = Conn()
    pipeline.settings = settings()
    pipeline.chat_documents = lambda *_, **__: None
    pipeline.models = SimpleNamespace(embed=lambda *_, **__: [[1., 0.]], rerank=rerank,
                                      generate=generate, count=lambda text: len(text.split()))
    hits = [SimpleNamespace(payload={"user_id": owner, "document_id": doc, "chunk_id": chunk}) for owner, doc, chunk in [
        ("bob", "other-doc", "foreign secret"), ("alice", "other-doc", "foreign secret"),
        ("alice", "own-doc", "forged-chunk"), ("alice", "own-doc", "own-chunk"),
    ]]
    pipeline.vectors = SimpleNamespace(search=lambda *args: hits)
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    monkeypatch.setattr("study_worker.main.guard", lambda *_: None)
    monkeypatch.setattr("study_worker.main.finish", lambda *_: None)
    pipeline.chat({"id": "job", "message_id": "assistant", "user_id": "alice", "payload": {
        "document_ids": ["own-doc"], "versions": {"own-doc": 1}, "conversation_id": "conv",
        "user_message_id": "question", "question": "q",
    }})
    assert forwarded == [canonical]


def test_remote_factory_does_not_initialize_ollama(monkeypatch):
    monkeypatch.setattr("study_worker.openrouter.OpenRouterModels", lambda _: "remote")
    monkeypatch.setattr("study_worker.models.LocalModels", lambda _: pytest.fail("Ollama initialized"))
    assert create_models(settings()) == "remote"


def test_settings_reject_paid_models_missing_key_and_unknown_provider(monkeypatch):
    monkeypatch.setattr("study_worker.config.load_dotenv", lambda: None)
    for name in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        monkeypatch.setenv(name, "placeholder")
    for name in ("CHAT_MODEL", "EMBED_MODEL", "RERANK_MODEL", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    with pytest.raises(ValueError, match="API_KEY"):
        Settings.load()
    monkeypatch.setenv("OPENROUTER_API_KEY", "private-placeholder")
    value = Settings.load()
    assert value.embed_model.endswith(":free") and "private-placeholder" not in repr(value)
    monkeypatch.setenv("CHAT_MODEL", "nvidia/paid")
    with pytest.raises(ValueError, match="free"):
        Settings.load()
    monkeypatch.setenv("AI_PROVIDER", "unknown")
    with pytest.raises(ValueError, match="AI_PROVIDER"):
        Settings.load()
