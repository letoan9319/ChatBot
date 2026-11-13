from dataclasses import replace

import httpx
import pytest

from study_worker.config import DEEPSEEK_FLASH, Settings
from study_worker.deploy_chat import CHAT_URL
from study_worker.openrouter import OpenRouterModels, OutputLimit


def test_deepseek_uses_deploy_credentials_and_retains_truncated_content(monkeypatch):
    def post(url, *, headers, json, timeout):
        assert url == CHAT_URL
        assert headers == {"Authorization": "Bearer deploy-test-key"}
        assert json == {
            "model": DEEPSEEK_FLASH, "messages": prompt, "stream": False,
            "max_completion_tokens": 2048, "reasoning_effort": "none", "temperature": 0.2,
        }
        return httpx.Response(200, json={"choices": [{
            "message": {"content": "Phần trả lời [S1]", "reasoning_content": "hidden"},
            "finish_reason": "length",
        }]})

    prompt = [{"role": "user", "content": "Đạo hàm là gì?"}]
    monkeypatch.setattr("study_worker.deploy_chat.httpx.post", post)
    model = OpenRouterModels.__new__(OpenRouterModels)
    model.settings = replace(Settings("db", "storage", "key", "vectors", "key"),
                             chat_model=DEEPSEEK_FLASH, deploy_api_key="deploy-test-key",
                             openrouter_key="embedding-test-key")
    stream = model.generate(prompt)
    assert next(stream) == "Phần trả lời [S1]"
    with pytest.raises(OutputLimit):
        next(stream)
    assert model.last_generation_provider == "deploy"
