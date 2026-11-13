"""DeepSeek chat on Deploy.com, with credentials separate from embeddings."""

import httpx

from .config import DEEPSEEK_FLASH
from .openrouter import OutputLimit, ProviderError

CHAT_URL = "https://api-cdn.deploy.com/api/v1/chat/completions"


def generate(api_key, messages):
    if not api_key:
        raise ProviderError("Worker chưa được cấu hình DEPLOY_API_KEY.", permanent=True)
    response = httpx.post(
        CHAT_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": DEEPSEEK_FLASH, "messages": messages, "stream": False,
            "max_completion_tokens": 2048, "reasoning_effort": "none", "temperature": 0.2,
        },
        timeout=httpx.Timeout(150, connect=15),
    )
    if not response.is_success:
        raise ProviderError(
            f"Deploy.com từ chối yêu cầu sinh câu trả lời (HTTP {response.status_code}).",
            permanent=response.status_code in (400, 401, 402, 403, 404, 422),
        )
    try:
        choice = response.json()["choices"][0]
        content = choice["message"]["content"]
        reason = choice["finish_reason"]
    except (KeyError, ValueError, IndexError, TypeError):
        raise ProviderError("Deploy.com trả về phản hồi không hợp lệ.") from None
    if not isinstance(content, str) or not content.strip() or reason not in ("stop", "length"):
        raise ProviderError("Deploy.com chưa hoàn thành câu trả lời.")
    yield content
    if reason == "length":
        raise OutputLimit()
