from dataclasses import dataclass, field, replace
import os
from urllib.parse import urlparse

from dotenv import load_dotenv

DEEPSEEK_FLASH = "deepseek/deepseek-v4.1-flash-1017"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    supabase_url: str
    supabase_key: str = field(repr=False)
    qdrant_url: str
    qdrant_key: str = field(repr=False)
    collection: str = "study_bge_m3_v1"
    ollama_url: str = "http://127.0.0.1:11434"
    chat_model: str = "qwen3:4b"
    embed_model: str = "bge-m3"
    tokenizer_model: str = "Qwen/Qwen3-4B"
    tokenizer_path: str = ""
    min_score: float = 0.35
    ai_provider: str = "ollama"
    openrouter_key: str = field(default="", repr=False)
    rerank_model: str = ""
    api_request_interval: float = 3.2
    chat_fallback: str = "none"
    fallback_chat_model: str = "nvidia/nemotron-3.5-lightning:free"
    cloud_embedding_url: str = ""
    cloud_embedding_key: str = field(default="", repr=False)
    cloud_embedding_model: str = "BAAI/bge-m3"

    def fallback_settings(self):
        # Only the chat model is used in fallback mode. Embedding identity is unchanged.
        return replace(self, ai_provider="openrouter", chat_model=self.fallback_chat_model, rerank_model="",
                       chat_fallback="none")

    @property
    def embedding_profile(self):
        if self.cloud_embedding_url:
            return "ollama:bge-m3"
        suffix = ":retrieval-v1" if self.ai_provider == "openrouter" else ""
        return f"{self.ai_provider}:{self.embed_model}{suffix}"

    @classmethod
    def load(cls):
        load_dotenv()
        provider = os.getenv("AI_PROVIDER", "ollama")
        if provider not in ("ollama", "openrouter"):
            raise ValueError("AI_PROVIDER must be ollama or openrouter.")
        remote = provider == "openrouter"
        names = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "QDRANT_URL"]
        if any(not os.getenv(name) for name in names):
            raise ValueError("Missing configuration. Copy .env.example to .env and fill all required values.")
        qdrant_key = os.getenv("QDRANT_API_KEY", "")
        if not qdrant_key and urlparse(os.environ["QDRANT_URL"]).hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("QDRANT_API_KEY is required for remote Qdrant.")
        settings = cls(
            *[os.environ[name] for name in names],
            qdrant_key=qdrant_key,
            collection=os.getenv("QDRANT_COLLECTION", "study_bge_m3_v1"),
            ollama_url=os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"),
            chat_model=os.getenv("CHAT_MODEL", "nvidia/nemotron-3.5-lightning:free" if remote else "qwen3:4b"),
            embed_model=os.getenv("EMBED_MODEL", "nvidia/nemotron-3.5-embed-1b:free" if remote else "bge-m3"),
            tokenizer_model=os.getenv("TOKENIZER_MODEL", "Qwen/Qwen3-4B"),
            tokenizer_path=os.getenv("TOKENIZER_PATH", ""),
            min_score=float(os.getenv("RETRIEVAL_MIN_SCORE", "0.35")),
            ai_provider=provider,
            openrouter_key=os.getenv("OPENROUTER_API_KEY", ""),
            rerank_model=os.getenv("RERANK_MODEL", ""),
            api_request_interval=float(os.getenv("OPENROUTER_REQUEST_INTERVAL", "3.2")),
            chat_fallback=os.getenv("CHAT_FALLBACK_PROVIDER", "none"),
            fallback_chat_model=os.getenv("OPENROUTER_CHAT_MODEL", "nvidia/nemotron-3.5-lightning:free"),
            cloud_embedding_url=os.getenv("BGE_EMBEDDINGS_URL", ""),
            cloud_embedding_key=os.getenv("BGE_EMBEDDINGS_KEY", ""),
            cloud_embedding_model=os.getenv("BGE_EMBEDDINGS_MODEL", "BAAI/bge-m3"),
        )
        if settings.cloud_embedding_url:
            endpoint = urlparse(settings.cloud_embedding_url)
            if not remote or endpoint.scheme != "https" or not endpoint.hostname or not settings.cloud_embedding_key:
                raise ValueError("Cloud embedding requires OpenRouter and an authenticated HTTPS embedding endpoint.")
            if os.getenv("BGE_COMPATIBILITY_VERIFIED") != "1":
                raise ValueError("Verify BGE-M3 embedding parity before sharing the Ollama collection.")
        if not remote and urlparse(settings.ollama_url).hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Ollama must stay on localhost.")
        if not 0 <= settings.min_score <= 1:
            raise ValueError("RETRIEVAL_MIN_SCORE must be between 0 and 1.")
        if settings.chat_fallback not in ("none", "openrouter"):
            raise ValueError("CHAT_FALLBACK_PROVIDER must be none or openrouter.")
        if remote and settings.chat_fallback != "none":
            raise ValueError("Chat fallback requires AI_PROVIDER=ollama.")
        if settings.chat_fallback == "openrouter" and not settings.fallback_chat_model:
            raise ValueError("OPENROUTER_CHAT_MODEL must be an explicit NVIDIA free model ID.")
        if remote or settings.chat_fallback == "openrouter":
            if not settings.openrouter_key:
                raise ValueError("OPENROUTER_API_KEY is required on the worker.")
            selected_models = (
                (settings.chat_model, settings.embed_model if not settings.cloud_embedding_url else "",
                 settings.rerank_model) if remote
                else (settings.fallback_chat_model,)
            )
            for index, model in enumerate(selected_models):
                if index == 0 and model == DEEPSEEK_FLASH and os.getenv("ALLOW_PAID_DEEPSEEK") == "1":
                    continue
                if model and (not model.startswith("nvidia/") or not model.endswith(":free")):
                    raise ValueError("OpenRouter trial only accepts explicit nvidia/...:free model IDs.")
            if not 3.2 <= settings.api_request_interval <= 60:
                raise ValueError("OPENROUTER_REQUEST_INTERVAL must be between 3.2 and 60 seconds.")
        if not remote and settings.rerank_model:
            raise ValueError("RERANK_MODEL currently requires AI_PROVIDER=openrouter.")
        return settings
