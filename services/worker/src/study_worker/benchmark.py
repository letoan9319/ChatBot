import json
import time

from .config import Settings
from .main import connect
from .models import create_models


def main():
    settings = Settings.load()
    with connect(settings) as conn:
        if not conn.execute("select pg_try_advisory_lock(706294811) as ok").fetchone()["ok"]:
            raise RuntimeError("Stop the worker before benchmarking inference.")
        models = create_models(settings)
        models.prepare()
        started = time.monotonic()
        models.embed(["Đạo hàm biểu diễn tốc độ thay đổi tức thời của một hàm số."])
        embedded = time.monotonic()
        first = None
        answer = ""
        for text in models.generate(
            [
                {"role": "system", "content": "Trả lời ngắn bằng tiếng Việt trong 3 câu."},
                {"role": "user", "content": "Giải thích đạo hàm của x bình phương."},
            ]
        ):
            if text and first is None:
                first = time.monotonic()
            answer += text
        ended = time.monotonic()
        resident_models = None
        if settings.ai_provider == "ollama":
            response = models.http.get("/api/ps")
            response.raise_for_status()
            resident_models = response.json()
        print(
            json.dumps(
                {
                    "provider": settings.ai_provider,
                    "chat_model": settings.chat_model,
                    "embed_model": settings.embed_model,
                    "embedding_dimensions": models.dimensions,
                    "embedding_seconds": round(embedded - started, 2),
                    "first_token_seconds_including_model_load": round(first - embedded, 2) if first else None,
                    "generation_seconds": round(ended - embedded, 2),
                    "output_tokens": models.count(answer),
                    "resident_models": resident_models,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        models.http.close()


if __name__ == "__main__":
    main()
