from dataclasses import dataclass
import os
from urllib.parse import urlparse

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database_url: str
    supabase_url: str
    supabase_key: str
    qdrant_url: str
    qdrant_key: str
    collection: str = "study_bge_m3_v1"
    ollama_url: str = "http://127.0.0.1:11434"
    chat_model: str = "qwen3:4b"
    embed_model: str = "bge-m3"
    tokenizer_model: str = "Qwen/Qwen3-4B"
    tokenizer_path: str = ""
    min_score: float = 0.35

    @classmethod
    def load(cls):
        load_dotenv()
        names = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "QDRANT_URL", "QDRANT_API_KEY"]
        if any(not os.getenv(name) for name in names):
            raise ValueError("Missing configuration. Copy .env.example to .env and fill all required values.")
        settings = cls(
            *[os.environ[name] for name in names],
            collection=os.getenv("QDRANT_COLLECTION", "study_bge_m3_v1"),
            ollama_url=os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"),
            chat_model=os.getenv("CHAT_MODEL", "qwen3:4b"),
            embed_model=os.getenv("EMBED_MODEL", "bge-m3"),
            tokenizer_model=os.getenv("TOKENIZER_MODEL", "Qwen/Qwen3-4B"),
            tokenizer_path=os.getenv("TOKENIZER_PATH", ""),
            min_score=float(os.getenv("RETRIEVAL_MIN_SCORE", "0.35")),
        )
        if urlparse(settings.ollama_url).hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Ollama must stay on localhost.")
        if not 0 <= settings.min_score <= 1:
            raise ValueError("RETRIEVAL_MIN_SCORE must be between 0 and 1.")
        return settings
