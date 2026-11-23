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
