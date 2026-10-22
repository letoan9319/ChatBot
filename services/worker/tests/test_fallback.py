from dataclasses import replace
from contextlib import nullcontext
import threading
from types import SimpleNamespace

import httpx
import pytest

from study_worker.config import Settings
from study_worker.fallback import ChatFallbackModels
from study_worker.main import LostLease, Pipeline
from study_worker.models import LocalModels, create_models
from study_worker.openrouter import OpenRouterModels, ProviderError


def settings(**kwargs):
    return Settings("db", "https://example.supabase.co", "service-placeholder", "https://qdrant.example",
                    "qdrant-placeholder", chat_fallback="openrouter", openrouter_key="key-placeholder", **kwargs)


def models(primary):
    value = ChatFallbackModels.__new__(ChatFallbackModels)
    value.settings = settings()
    value.primary = SimpleNamespace(generate=primary)
    value.remote = None
    value.tokenizer = object()
    value.last_generation_provider = None
    return value


def test_healthy_primary_does_not_initialize_or_call_openrouter(monkeypatch):
    monkeypatch.setattr("study_worker.fallback.OpenRouterModels", lambda *_args, **_kwargs: pytest.fail("API initialized"))
    value = models(lambda _: iter(["local ", "answer"]))
    assert "".join(value.generate([])) == "local answer"
    assert value.last_generation_provider == "ollama"


def test_missing_primary_falls_back_to_chat_without_embedding_or_rerank(monkeypatch, caplog):
    calls = []

    def primary(_):
        raise httpx.ConnectError("private upstream text")
        yield

    class Remote:
        def __init__(self, config, *, tokenizer):
            calls.append("initialize")
            assert config.chat_model == settings().fallback_chat_model
            assert config.rerank_model == ""

        def prepare(self, *, chat_only):
            assert chat_only
            calls.append("prepare-chat")

        def generate(self, prompt):
            calls.append("generate-chat")
            yield "remote answer"

    monkeypatch.setattr("study_worker.fallback.OpenRouterModels", Remote)
    value = models(primary)
    assert "".join(value.generate([], on_reset=lambda: calls.append("reset-and-authorize"))) == "remote answer"
    assert calls == ["reset-and-authorize", "initialize", "prepare-chat", "generate-chat"]
    assert value.last_generation_provider == "openrouter"
    assert "private upstream text" not in caplog.text


@pytest.mark.parametrize("streaming", [False, True])
def test_partial_primary_answer_is_never_mixed_with_fallback(streaming):
    def primary(_):
        yield "incomplete local answer"
        raise RuntimeError("stream disconnected")

    value = models(primary)
    value.remote = SimpleNamespace(generate=lambda _: iter(["complete ", "remote answer"]))
    displayed = []
    reset = (lambda: displayed.clear()) if streaming else None
    for token in value.generate([], on_reset=reset):
        displayed.append(token)
    assert "".join(displayed) == "complete remote answer"


def test_primary_is_preferred_again_after_recovery():
    attempts, remote_calls = [], []

    def primary(_):
        attempts.append(True)
        if len(attempts) == 1:
            raise RuntimeError("model unavailable")
        yield "recovered local"

    def remote(_):
        remote_calls.append(True)
        yield "fallback"

    value = models(primary)
    value.remote = SimpleNamespace(generate=remote)
    assert "".join(value.generate([])) == "fallback"
    assert "".join(value.generate([])) == "recovered local"
    assert len(remote_calls) == 1 and value.last_generation_provider == "ollama"


def test_cancelled_or_lost_lease_aborts_before_remote_initialization(monkeypatch):
    def primary(_):
        raise RuntimeError("model unavailable")
        yield

    def reset():
        raise LostLease()

    monkeypatch.setattr("study_worker.fallback.OpenRouterModels", lambda *_args, **_kwargs: pytest.fail("API initialized"))
    with pytest.raises(LostLease):
        list(models(primary).generate([], on_reset=reset))


def test_fallback_error_keeps_existing_job_retry_policy():
    def primary(_):
        raise RuntimeError("model unavailable")
        yield

    def remote(_):
        raise ProviderError("Rate limited", retry_after=120)
        yield

    value = models(primary)
    value.remote = SimpleNamespace(generate=remote)
    with pytest.raises(ProviderError) as error:
        list(value.generate([]))
    assert error.value.retry_after == 120


def test_embedding_failure_never_triggers_any_remote_call(monkeypatch):
    value = models(None)

    def embed(*args, **kwargs):
        raise httpx.ConnectError("BGE unavailable")

    value.primary.embed = embed
    monkeypatch.setattr("study_worker.fallback.OpenRouterModels", lambda *_args, **_kwargs: pytest.fail("API initialized"))
    with pytest.raises(httpx.ConnectError):
        value.embed(["question"], query=True)
    candidates = [{"content": "source"}]
    assert value.rerank("query", candidates) is candidates


def test_missing_chat_model_allows_startup_and_embedding_but_missing_bge_does_not():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "bge-m3:latest"}]})
        if request.url.path == "/api/generate":
            return httpx.Response(404, json={"error": "chat model not found"})
        return httpx.Response(200, json={"embeddings": [[1.0] * 1024]})

    primary = LocalModels.__new__(LocalModels)
    primary.settings = settings()
    primary.http = httpx.Client(base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))
    value = models(None)
    value.primary = primary
    value.prepare()
    assert len(value.embed(["question"], query=True)[0]) == 1024
    assert calls == ["/api/tags", "/api/generate", "/api/embed"]
    primary.settings = replace(primary.settings, embed_model="missing-bge")
    with pytest.raises(ValueError):
        value.prepare()
    primary.close()


def test_chat_only_preflight_does_not_probe_embedding_or_validate_reranker():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        assert request.method == "GET" and "lightning" in request.url.path
        return httpx.Response(200, json={"data": {
            "architecture": {"output_modalities": ["text"]},
            "endpoints": [{"pricing": {"prompt": "0", "completion": "0"}}],
        }})

    remote = OpenRouterModels.__new__(OpenRouterModels)
    remote.settings = settings().fallback_settings()
    remote.http = httpx.Client(base_url="https://openrouter.ai/api/v1/", transport=httpx.MockTransport(handler))
    remote.prepare(chat_only=True)
    assert len(calls) == 1
    remote.close()


def test_enabling_chat_fallback_keeps_bge_profile_and_collection(monkeypatch):
    monkeypatch.setattr("study_worker.config.load_dotenv", lambda: None)
    for name in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        monkeypatch.setenv(name, "placeholder")
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("CHAT_FALLBACK_PROVIDER", "openrouter")
    for name in ("CHAT_MODEL", "EMBED_MODEL", "OPENROUTER_API_KEY", "RERANK_MODEL", "OPENROUTER_CHAT_MODEL"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError, match="API_KEY"):
        Settings.load()
    monkeypatch.setenv("OPENROUTER_API_KEY", "key-placeholder")
    value = Settings.load()
    assert value.embedding_profile == "ollama:bge-m3" and value.collection == "study_bge_m3_v1"
    monkeypatch.setenv("OPENROUTER_CHAT_MODEL", "nvidia/paid-model")
    with pytest.raises(ValueError, match="free"):
        Settings.load()
    monkeypatch.setenv("CHAT_FALLBACK_PROVIDER", "unknown")
    with pytest.raises(ValueError, match="CHAT_FALLBACK"):
        Settings.load()


def test_factory_builds_local_first_adapter(monkeypatch):
    monkeypatch.setattr("study_worker.fallback.ChatFallbackModels", lambda _: "local-first")
    assert create_models(settings()) == "local-first"


def test_pipeline_clears_partial_and_records_only_the_fallback_answer(monkeypatch):
    source = {"id": "chunk", "document_id": "doc", "content": "Source text", "document_name": "doc.pdf",
              "page": 1, "section": None, "paragraph": None}
    writes, cleared = [], []

    class Conn:
        def transaction(self):
            return nullcontext()

        def execute(self, sql, params):
            if "select role,content" in sql:
                return SimpleNamespace(fetchall=lambda: [])
            if "select c.*" in sql:
                return SimpleNamespace(fetchone=lambda: source)
            if "update public.messages" in sql:
                writes.append(params)

    def primary(_):
        yield "Broken local sentence "
        raise RuntimeError("interrupted")

    model = models(primary)
    model.primary.embed = lambda *_, **__: [[1., 0.]]
    model.primary.count = lambda text: len(text.split())
    model.remote = SimpleNamespace(generate=lambda _: iter(["Complete remote answer [S1]"]))
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.settings, pipeline.models, pipeline.conn = settings(), model, Conn()
    pipeline.chat_documents = lambda *_, **__: None
    pipeline.save_partial = lambda _, text: cleared.append(text)
    pipeline.heartbeat = SimpleNamespace(lost=threading.Event())
    pipeline.vectors = SimpleNamespace(search=lambda *_: [SimpleNamespace(payload={
        "user_id": "alice", "document_id": "doc", "chunk_id": "chunk",
    })])
    monkeypatch.setattr("study_worker.main.guard", lambda *_: None)
    monkeypatch.setattr("study_worker.main.finish", lambda *_: None)
    pipeline.chat({"id": "job", "user_id": "alice", "message_id": "answer", "payload": {
        "question": "q", "document_ids": ["doc"], "versions": {"doc": 1},
        "conversation_id": "conv", "user_message_id": "question",
    }})
    assert cleared == [""]
    assert writes == [("Complete remote answer [S1]", "openrouter", "answer")]
