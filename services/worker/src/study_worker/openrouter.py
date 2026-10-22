"""NVIDIA free-tier inference. Credentials and source text stay out of errors/logs."""

import json
import math
import time

import httpx
from tokenizers import Tokenizer


class ProviderError(RuntimeError):
    def __init__(self, message, *, permanent=False, retry_after=60):
        super().__init__(message)
        self.permanent = permanent
        self.retry_after = retry_after


class OpenRouterModels:
    def __init__(self, settings):
        self.settings = settings
        self.dimensions = None
        self.next_request = 0
        self.http = httpx.Client(
            base_url="https://openrouter.ai/api/v1/",
            headers={"Authorization": f"Bearer {settings.openrouter_key}", "X-OpenRouter-Title": "LearnStep"},
            timeout=httpx.Timeout(180, connect=15),
        )
        # Used only on CPU for bounded chunks/prompts; this is an approximate token budget.
        self.tokenizer = (
            Tokenizer.from_file(settings.tokenizer_path)
            if settings.tokenizer_path
            else Tokenizer.from_pretrained(settings.tokenizer_model)
        )

    def count(self, text):
        return len(self.tokenizer.encode(text, add_special_tokens=False).ids)

    @staticmethod
    def routing():
        return {"allow_fallbacks": False, "max_price": {"prompt": "0", "completion": "0", "request": "0"}}

    def pace(self):
        remaining = self.next_request - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        self.next_request = time.monotonic() + self.settings.api_request_interval

    @staticmethod
    def check(response):
        if response.is_success:
            return
        status = response.status_code
        if status == 429:
            try:
                delay = min(3600, max(60, int(response.headers.get("retry-after", "60"))))
            except ValueError:
                delay = 60
            raise ProviderError("OpenRouter đang hết hạn mức hoặc quá tải. Hãy thử lại sau.", retry_after=delay)
        permanent = status in (400, 401, 402, 403, 404, 422)
        raise ProviderError(
            "OpenRouter từ chối yêu cầu. Kiểm tra API key, model miễn phí và quyền truy cập."
            if permanent else "Kết nối OpenRouter bị gián đoạn. Hệ thống sẽ thử lại.",
            permanent=permanent,
        )

    def post(self, path, body):
        self.pace()
        response = self.http.post(path, json={**body, "provider": self.routing()})
        self.check(response)
        result = response.json()
        if result.get("error"):
            raise ProviderError("OpenRouter trả về lỗi xử lý.")
        return result

    def prepare(self):
        # Reject retired, wrong-modality or paid endpoints before publishing a heartbeat.
        for model, modality in (
            (self.settings.chat_model, "text"),
            (self.settings.embed_model, "embeddings"),
            (self.settings.rerank_model, "rerank"),
        ):
            if not model:
                continue
            if not model.startswith("nvidia/") or not model.endswith(":free"):
                raise ValueError("Only explicit NVIDIA free models are supported.")
            response = self.http.get(f"models/{model}/endpoints")
            self.check(response)
            data = response.json()["data"]
            if modality not in data["architecture"]["output_modalities"]:
                raise ValueError("Configured OpenRouter model has the wrong output modality.")
            endpoints = data.get("endpoints", [])
            if not any(
                all(float(endpoint.get("pricing", {}).get(key, "inf")) == 0 for key in ("prompt", "completion"))
                and float(endpoint.get("pricing", {}).get("request", 0)) == 0
                for endpoint in endpoints
            ):
                raise ValueError("No zero-price endpoint available for the configured model.")
        # Do not assume BGE's 1024 dimensions or request unsupported dimension overrides.
        self.embed(["LearnStep embedding dimension probe."])

    def embed(self, texts, *, query=False):
        result = self.post("embeddings", {
            "model": self.settings.embed_model,
            "input": texts,
            "input_type": "search_query" if query else "search_document",
            "encoding_format": "float",
        })
        items = result.get("data", [])
        if (
            len(items) != len(texts)
            or any(type(item.get("index")) is not int for item in items)
            or sorted(item["index"] for item in items) != list(range(len(texts)))
        ):
            raise ProviderError("Embedding trả về thiếu hoặc trùng chỉ mục.")
        vectors = [item.get("embedding") for item in sorted(items, key=lambda item: item["index"])]
        for vector in vectors:
            if (
                not isinstance(vector, list) or not vector
                or any(type(value) not in (int, float) or not math.isfinite(value) for value in vector)
            ):
                raise ProviderError("Embedding trả về vector không hợp lệ.")
            if self.dimensions is None:
                self.dimensions = len(vector)
            if len(vector) != self.dimensions:
                raise ProviderError("Kích thước embedding thay đổi. Cần lập chỉ mục lại.", permanent=True)
        return vectors

    def rerank(self, query, candidates):
        if not self.settings.rerank_model or not candidates:
            return candidates
        result = self.post("rerank", {
            "model": self.settings.rerank_model,
            "query": query,
            "documents": [item["content"] for item in candidates],
            "top_n": len(candidates),
        })
        results = result.get("results", [])
        indices = [item.get("index") for item in results]
        if (
            len(indices) != len(candidates)
            or any(type(index) is not int for index in indices)
            or sorted(indices) != list(range(len(candidates)))
            or any(
                type(item.get("relevance_score")) not in (int, float)
                or not math.isfinite(item["relevance_score"]) for item in results
            )
        ):
            raise ProviderError("Rerank trả về chỉ mục không hợp lệ.")
        # Provider text/IDs cannot introduce new sources; only reorder canonical DB rows.
        return [candidates[item["index"]] for item in sorted(results, key=lambda item: item["relevance_score"], reverse=True)]

    def generate(self, messages):
        self.pace()
        with self.http.stream("POST", "chat/completions", json={
            "model": self.settings.chat_model,
            "messages": messages,
            "stream": True,
            "temperature": 0.2,
            "max_tokens": 768,
            "reasoning": {"enabled": False, "exclude": True},
            "provider": self.routing(),
        }) as response:
            self.check(response)
            finished = False
            saw_content = False
            data = []
            for line in response.iter_lines():
                if line.startswith("data:"):
                    data.append(line[5:].strip())
                elif not line and data:
                    raw, data = "\n".join(data), []
                    if raw == "[DONE]":
                        if not finished or not saw_content:
                            raise ProviderError("OpenRouter chưa hoàn thành câu trả lời.")
                        return
                    event = json.loads(raw)
                    if event.get("error"):
                        raise ProviderError("OpenRouter gián đoạn khi sinh câu trả lời.")
                    for choice in event.get("choices", []):
                        content = choice.get("delta", {}).get("content")
                        if content:
                            if finished or not isinstance(content, str):
                                raise ProviderError("OpenRouter trả về luồng không hợp lệ.")
                            saw_content = True
                            yield content
                        reason = choice.get("finish_reason")
                        if reason is not None:
                            if reason != "stop":
                                raise ProviderError("Câu trả lời bị ngắt hoặc vượt ngân sách token.")
                            finished = True
            raise ProviderError("OpenRouter stream kết thúc trước khi hoàn tất.")
