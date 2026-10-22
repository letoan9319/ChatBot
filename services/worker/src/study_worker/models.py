import json
import hashlib

import httpx
from qdrant_client import QdrantClient, models
from tokenizers import Tokenizer

from .config import Settings


class LocalModels:
    dimensions = 1024

    def __init__(self, settings: Settings):
        self.settings = settings
        self.http = httpx.Client(base_url=settings.ollama_url, timeout=httpx.Timeout(180, connect=10))
        self.tokenizer = (
            Tokenizer.from_file(settings.tokenizer_path)
            if settings.tokenizer_path
            else Tokenizer.from_pretrained(settings.tokenizer_model)
        )

    def count(self, text):
        return len(self.tokenizer.encode(text, add_special_tokens=False).ids)

    def unload(self, model):
        response = self.http.post("/api/generate", json={"model": model, "keep_alive": 0})
        if response.status_code == 404:
            # A missing chat model consumes no VRAM and must not block BGE embedding.
            return
        response.raise_for_status()

    def close(self):
        self.http.close()

    def prepare(self, *, require_chat=True):
        installed = self.http.get("/api/tags")
        installed.raise_for_status()
        tags = {item["name"] for item in installed.json()["models"]}
        required = (self.settings.chat_model, self.settings.embed_model) if require_chat else (self.settings.embed_model,)
        if any(
            model not in tags and f"{model}:latest" not in tags
            for model in required
        ):
            raise ValueError("Pull CHAT_MODEL and EMBED_MODEL in Ollama before starting the worker.")

    def rerank(self, query, candidates):
        return candidates

    def embed(self, texts: list[str], *, query=False):
        self.unload(self.settings.chat_model)
        response = self.http.post(
            "/api/embed",
            json={"model": self.settings.embed_model, "input": texts, "truncate": False, "keep_alive": "5m"},
        )
        response.raise_for_status()
        vectors = response.json()["embeddings"]
        if len(vectors) != len(texts) or any(len(vector) != 1024 for vector in vectors):
            raise ValueError("Expected BGE-M3 dense embeddings of dimension 1024")
        return vectors

    def generate(self, messages, *, on_reset=None):
        self.unload(self.settings.embed_model)
        with self.http.stream(
            "POST",
            "/api/chat",
            json={
                "model": self.settings.chat_model,
                "messages": messages,
                "think": False,
                "stream": True,
                "keep_alive": "5m",
                "options": {"num_ctx": 4096, "num_predict": 768, "temperature": 0.2},
            },
        ) as response:
            response.raise_for_status()
            completed = False
            for line in response.iter_lines():
                if not line:
                    continue
                event = json.loads(line)
                if event.get("error"):
                    raise RuntimeError("Ollama generation failed")
                yield event.get("message", {}).get("content", "")
                if event.get("done"):
                    if event.get("done_reason") == "length":
                        raise RuntimeError("Answer exceeded the output token budget")
                    completed = True
            if not completed:
                raise RuntimeError("Ollama stream ended before completion")


def create_models(settings):
    if settings.ai_provider == "openrouter":
        from .openrouter import OpenRouterModels
        return OpenRouterModels(settings)
    if settings.chat_fallback == "openrouter":
        from .fallback import ChatFallbackModels
        return ChatFallbackModels(settings)
    return LocalModels(settings)


class VectorStore:
    def __init__(self, settings: Settings, dimensions=1024):
        self.settings = settings
        self.dimensions = dimensions
        self.collection = settings.collection
        if settings.ai_provider == "openrouter":
            # Even equal-dimensional models must never share an embedding space.
            fingerprint = hashlib.sha256(settings.embedding_profile.encode()).hexdigest()[:16]
            self.collection = f"{settings.collection}_or_{fingerprint}_{dimensions}"
        self.client = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_key, timeout=30)

    def setup(self):
        name = self.collection
        if not self.client.collection_exists(name):
            self.client.create_collection(
                name, vectors_config=models.VectorParams(size=self.dimensions, distance=models.Distance.COSINE)
            )
        config = self.client.get_collection(name).config.params.vectors
        if (
            not isinstance(config, models.VectorParams)
            or config.size != self.dimensions
            or config.distance != models.Distance.COSINE
        ):
            raise ValueError("Collection schema does not match the configured embedding dimensions")
        for field in ("user_id", "document_id", "chunk_id"):
            schema = (
                models.KeywordIndexParams(type="keyword", is_tenant=True)
                if field == "user_id"
                else models.PayloadSchemaType.KEYWORD
            )
            self.client.create_payload_index(name, field, field_schema=schema, wait=True)
        self.client.create_payload_index(
            name, "index_version", field_schema=models.PayloadSchemaType.INTEGER, wait=True
        )

    @staticmethod
    def filters(user_id, document_ids, versions=None):
        conditions = [models.FieldCondition(key="user_id", match=models.MatchValue(value=str(user_id)))]
        if versions:
            alternatives = [
                models.Filter(
                    must=[
                        models.FieldCondition(key="document_id", match=models.MatchValue(value=str(doc_id))),
                        models.FieldCondition(
                            key="index_version", match=models.MatchValue(value=int(versions[str(doc_id)]))
                        ),
                    ]
                )
                for doc_id in document_ids
            ]
            conditions.append(models.Filter(should=alternatives))
        else:
            conditions.append(
                models.FieldCondition(
                    key="document_id", match=models.MatchAny(any=[str(value) for value in document_ids])
                )
            )
        return models.Filter(must=conditions)

    def upsert(self, user_id, document_id, version, chunks, embeddings):
        self.client.upsert(
            self.collection,
            points=[
                models.PointStruct(
                    id=chunk["id"],
                    vector=vector,
                    payload={
                        "user_id": str(user_id),
                        "document_id": str(document_id),
                        "chunk_id": chunk["id"],
                        "index_version": version,
                    },
                )
                for chunk, vector in zip(chunks, embeddings, strict=True)
            ],
            wait=True,
        )

    def delete(self, user_id, document_id, collection=None):
        name = collection or self.collection
        if not self.client.collection_exists(name):
            return
        self.client.delete(
            name,
            points_selector=models.FilterSelector(filter=self.filters(user_id, [document_id])),
            wait=True,
        )

    def search(self, user_id, document_ids, versions, vector):
        return self.client.query_points(
            self.collection,
            query=vector,
            query_filter=self.filters(user_id, document_ids, versions),
            limit=8,
            score_threshold=self.settings.min_score,
            with_payload=True,
        ).points
