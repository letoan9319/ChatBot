"""Keep BGE retrieval local; use NVIDIA chat only when local generation fails."""

import logging

import httpx

from .models import LocalModels
from .openrouter import OpenRouterModels, ProviderError

LOG = logging.getLogger("study_worker")


class ChatFallbackModels:
    def __init__(self, settings):
        self.settings = settings
        self.primary = LocalModels(settings)
        self.remote = None
        self.http = self.primary.http
        self.tokenizer = self.primary.tokenizer
        self.dimensions = self.primary.dimensions
        self.last_generation_provider = None

    def prepare(self):
        # Missing Qwen is allowed; BGE and the Ollama server are still required.
        self.primary.prepare(require_chat=False)

    def count(self, text):
        return self.primary.count(text)

    def embed(self, texts, *, query=False):
        return self.primary.embed(texts, query=query)

    def rerank(self, query, candidates):
        return candidates

    def generate(self, messages, *, on_reset=None):
        self.last_generation_provider = "ollama"
        # Callers that cannot reset their output (evaluation/benchmark) receive
        # local content only after the whole primary attempt succeeds.
        buffered = []
        saw_content = False
        try:
            for token in self.primary.generate(messages):
                if token:
                    saw_content = True
                if on_reset is not None:
                    yield token
                else:
                    buffered.append(token)
            if not saw_content:
                raise RuntimeError("Local generation returned no answer")
        except (httpx.HTTPError, RuntimeError, ValueError, KeyError, TypeError) as exc:
            # Never log exception text: upstream responses can contain prompts.
            LOG.warning("chat_fallback provider=openrouter error_type=%s", type(exc).__name__)
        else:
            if on_reset is None:
                yield from buffered
            return

        self.last_generation_provider = "openrouter"
        if on_reset is not None:
            # The callback rechecks job lease/document ownership before any API call.
            on_reset()
        if self.remote is None:
            candidate = OpenRouterModels(self.settings.fallback_settings(), tokenizer=self.tokenizer)
            try:
                # No embedding probe, rerank call or eager API traffic on startup.
                candidate.prepare(chat_only=True)
            except ValueError:
                candidate.close()
                raise ProviderError("Model dự phòng không khả dụng hoặc không còn miễn phí. Kiểm tra cấu hình.",
                                    permanent=True) from None
            except Exception:
                candidate.close()
                raise
            self.remote = candidate
        yield from self.remote.generate(messages)

    def close(self):
        self.primary.close()
        if self.remote is not None:
            self.remote.close()
