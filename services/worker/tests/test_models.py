import json
from types import SimpleNamespace

import httpx
import pytest

from study_worker.models import LocalModels


def mocked(handler):
    value = LocalModels.__new__(LocalModels)
    value.settings = SimpleNamespace(chat_model="qwen3:4b", embed_model="bge-m3", thinking_model="")
    value.http = httpx.Client(base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))
    return value


def test_embedding_unloads_chat_and_requires_correct_dimension():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={"embeddings": [[0.0] * 1024]} if request.url.path.endswith("embed") else {})

    value = mocked(handler)
    assert len(value.embed(["question"])[0]) == 1024
    assert calls == ["/api/generate", "/api/embed"]
    value.http.close()


def test_interrupted_generation_is_not_silently_marked_complete():
    def handler(request):
        return httpx.Response(200, content=b'{"message":{"content":"partial"}}\n')

    value = mocked(handler)
    with pytest.raises(RuntimeError, match="before completion"):
        list(value.generate([{"role": "user", "content": "question"}]))
    value.http.close()


def test_output_limit_is_distinct_from_dimension_mismatch():
    from study_worker.openrouter import OutputLimit
    def handler(request):
        if request.url.path.endswith("embed"):
            return httpx.Response(200, json={"embeddings": [[1.0, 2.0]]})
        return httpx.Response(200, content=b'{"message":{"content":"partial"},"done":true,"done_reason":"length"}\n')

    value = mocked(handler)
    with pytest.raises(ValueError, match="dimension"):
        value.embed(["question"])
    with pytest.raises(OutputLimit):
        list(value.generate([{"role": "user", "content": "question"}]))
    value.http.close()


def test_thinking_tokens_emit_progress_and_stay_out_of_answer():
    def handler(request):
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        payload = json.loads(request.content)
        assert payload["model"] == "thinking-model"
        assert payload["think"] is True
        return httpx.Response(200, content=(
            b'{"message":{"thinking":"private draft"}}\n'
            b'{"message":{"content":"visible hint"}}\n'
            b'{"done":true,"done_reason":"stop"}\n'
        ))

    value = mocked(handler)
    value.settings.thinking_model = "thinking-model"
    moments = []
    assert "".join(value.generate([], on_thinking=moments.append)) == "visible hint"
    assert moments[0] is None
    assert len(moments) == 2 and moments[1] >= 0
    value.http.close()


def test_thinking_that_exhausts_its_budget_falls_back_to_standard_model():
    def handler(request):
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        payload = json.loads(request.content)
        if payload["think"]:
            return httpx.Response(200, content=b'{"message":{"thinking":"draft"},"done":true,"done_reason":"length"}\n')
        return httpx.Response(200, content=b'{"message":{"content":"retry hint"},"done":true,"done_reason":"stop"}\n')

    value = mocked(handler)
    value.settings.thinking_model = "thinking-model"
    assert "".join(value.generate([], on_thinking=lambda _: None)) == "retry hint"
    value.http.close()


def test_qwen_vision_attaches_image_only_to_the_local_request():
    def handler(request):
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        payload = json.loads(request.content)
        assert payload["think"] is False
        assert payload["messages"] == [{"role": "user", "content": "Describe", "images": ["image-data"]}]
        return httpx.Response(200, content=b'{"message":{"content":"description"},"done":true,"done_reason":"stop"}\n')

    value = mocked(handler)
    value.settings.chat_model = "qwen3.5:4b-q4_K_M"
    messages = [{"role": "user", "content": "Describe"}]
    assert value.supports_question_vision
    assert list(value.generate(messages, question_images=["image-data"])) == ["description"]
    assert "images" not in messages[0]
    value.http.close()


def test_thinking_tokens_stream_via_callback_and_reset_on_budget_fallback():
    def handler(request):
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        payload = json.loads(request.content)
        if payload["think"]:
            return httpx.Response(200, content=(
                b'{"message":{"thinking":"Buoc 1: "}}\n'
                b'{"message":{"thinking":"phan tich de."},"done":true,"done_reason":"length"}\n'
            ))
        return httpx.Response(200, content=b'{"message":{"content":"ket qua cuoi"},"done":true,"done_reason":"stop"}\n')

    value = mocked(handler)
    value.settings.thinking_model = "thinking-model"
    tokens = []
    resets = []
    answer = "".join(
        value.generate([], on_reset=lambda: resets.append(True), on_thinking=lambda _: None, on_thinking_token=tokens.append)
    )
    assert tokens == ["Buoc 1: ", "phan tich de."]
    assert resets == [True]
    assert answer == "ket qua cuoi"
    value.http.close()


def test_consecutive_generates_unload_embed_model_only_once():
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        calls.append((request.url.path, payload.get("model")))
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        return httpx.Response(200, content=b'{"message":{"content":"ok"},"done":true,"done_reason":"stop"}\n')

    value = mocked(handler)
    assert list(value.generate([{"role": "user", "content": "turn 1"}])) == ["ok"]
    assert list(value.generate([{"role": "user", "content": "turn 2"}])) == ["ok"]
    assert calls == [
        ("/api/generate", "bge-m3"),
        ("/api/chat", "qwen3:4b"),
        ("/api/chat", "qwen3:4b"),
    ]
    value.http.close()


def test_consecutive_embeds_unload_chat_model_only_once():
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        calls.append((request.url.path, payload.get("model")))
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"embeddings": [[0.0] * 1024]})

    value = mocked(handler)
    assert len(value.embed(["chunk 1"])) == 1
    assert len(value.embed(["chunk 2"])) == 1
    assert calls == [
        ("/api/generate", "qwen3:4b"),
        ("/api/embed", "bge-m3"),
        ("/api/embed", "bge-m3"),
    ]
    value.http.close()


def test_unload_embed_before_vision_ocr_keeps_chat_warm_and_still_unloads_chat_for_later_embed():
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        calls.append((request.url.path, payload.get("model")))
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        if request.url.path == "/api/embed":
            return httpx.Response(200, json={"embeddings": [[0.0] * 1024]})
        return httpx.Response(200, content=b'{"message":{"content":"ok"},"done":true,"done_reason":"stop"}\n')

    value = mocked(handler)
    value.settings.chat_model = "qwen3.5:4b-q4_K_M"
    # Regular document ingest loads bge-m3 and unloads chat_model.
    value.embed(["doc chunk"])
    # Question-image vision OCR unloads embed_model, then direct vision OCR loads chat_model.
    value.unload("bge-m3")
    # Immediate question-image chat skips redundant embed_model unload.
    assert list(value.generate([{"role": "user", "content": "solve"}])) == ["ok"]
    # Later regular embed must still unload chat_model before loading bge-m3.
    value.embed(["another doc chunk"])
    assert calls == [
        ("/api/generate", "qwen3.5:4b-q4_K_M"),
        ("/api/embed", "bge-m3"),
        ("/api/generate", "bge-m3"),
        ("/api/chat", "qwen3.5:4b-q4_K_M"),
        ("/api/generate", "qwen3.5:4b-q4_K_M"),
        ("/api/embed", "bge-m3"),
    ]
    value.http.close()


def test_failed_unload_does_not_skip_retry():
    attempts = 0

    def handler(request):
        nonlocal attempts
        if request.url.path == "/api/generate":
            attempts += 1
            if attempts == 1:
                return httpx.Response(500, json={"error": "temporary"})
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"embeddings": [[0.0] * 1024]})

    value = mocked(handler)
    with pytest.raises(httpx.HTTPStatusError):
        value.embed(["chunk"])
    assert len(value.embed(["chunk"])) == 1
    assert attempts == 2
    value.http.close()


def test_thinking_uses_tighter_token_budget_than_research():
    from study_worker.config import RESEARCH_CONTEXT_TOKENS, RESEARCH_OUTPUT_TOKENS
    from study_worker.models import THINKING_CONTEXT_TOKENS, THINKING_OUTPUT_TOKENS

    seen_options = []

    def handler(request):
        if request.url.path == "/api/generate":
            return httpx.Response(200, json={})
        payload = json.loads(request.content)
        seen_options.append((payload["think"], payload["options"]))
        return httpx.Response(200, content=b'{"message":{"content":"ok"},"done":true,"done_reason":"stop"}\n')

    value = mocked(handler)
    value.settings.thinking_model = "qwen3.5:4b-q4_K_M"
    # Non-research thinking uses tighter context and output cap.
    assert "".join(value.generate([{"role": "user", "content": "q"}], on_thinking=lambda _: None)) == "ok"
    # Research thinking preserves full research budgets.
    assert "".join(value.generate([{"role": "user", "content": "q"}], research=True, on_thinking=lambda _: None)) == "ok"
    # Standard non-thinking preserves default chat budgets.
    assert "".join(value.generate([{"role": "user", "content": "q"}])) == "ok"

    assert seen_options[0][0] is True
    assert seen_options[0][1]["num_ctx"] == THINKING_CONTEXT_TOKENS == 8192
    assert seen_options[0][1]["num_predict"] == THINKING_OUTPUT_TOKENS == 4096

    assert seen_options[1][0] is True
    assert seen_options[1][1]["num_ctx"] == RESEARCH_CONTEXT_TOKENS
    assert seen_options[1][1]["num_predict"] == RESEARCH_OUTPUT_TOKENS

    assert seen_options[2][0] is False
    assert seen_options[2][1]["num_ctx"] == 7168
    assert seen_options[2][1]["num_predict"] == 3584
    value.http.close()


def test_finetuned_qwen35_model_name_supports_vision_and_relative_paths(monkeypatch):
    from study_worker.config import REPO_ROOT, is_qwen35_model, resolve_local_path

    assert is_qwen35_model("qwen3.5:4b-q4_K_M") is True
    assert is_qwen35_model("qwen3.5:4b-learnstep") is True
    assert is_qwen35_model("learnstep-qwen3.5:4b") is True
    assert is_qwen35_model("qwen3:4b") is False

    value = mocked(lambda _: httpx.Response(200, json={}))
    value.settings.chat_model = "learnstep-qwen3.5:4b"
    assert value.supports_question_vision is True
    value.http.close()

    # Relative path inside repo root resolves even when CWD is services/worker.
    monkeypatch.chdir(REPO_ROOT / "services" / "worker")
    resolved = resolve_local_path("models/README.md")
    assert resolved == str(REPO_ROOT / "models" / "README.md")
