"""Prepare Nemotron vectors from published documents without touching the live index."""

import argparse
from itertools import batched

from .config import Settings
from .main import LOCK_ID, connect
from .models import VectorStore
from .openrouter import OpenRouterModels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    if args.limit is not None and (args.limit < 1 or args.activate):
        parser.error("--limit must be positive and cannot be combined with --activate")
    settings = Settings.load()
    if settings.ai_provider != "openrouter" or settings.cloud_embedding_url:
        parser.error("Configure native OpenRouter embeddings first")
    models = OpenRouterModels(settings)
    try:
        models.prepare(embeddings_only=True)
        vectors = VectorStore(settings, models.dimensions)
        try:
            vectors.setup()
            with connect(settings) as conn:
                if args.activate and not conn.execute(
                    "select pg_try_advisory_lock(%s) as acquired", (LOCK_ID,),
                ).fetchone()["acquired"]:
                    parser.error("Stop the current queue consumer before activating")
                docs = conn.execute(
                    """select d.id,d.user_id,d.index_version from public.documents d
                    join public.knowledge_documents k on k.document_id=d.id
                    where d.status='ready' order by d.id limit %s""", (args.limit,),
                ).fetchall()
                for doc in docs:
                    with conn.transaction():
                        current = conn.execute(
                            """select d.id from public.documents d
                            join public.knowledge_documents k on k.document_id=d.id
                            where d.id=%s and d.status='ready' and d.index_version=%s for share of d,k""",
                            (doc["id"], doc["index_version"]),
                        ).fetchone()
                        if not current:
                            raise RuntimeError("Shared catalog changed during reindex; rerun")
                        rows = conn.execute(
                            """select id,content from public.document_chunks
                            where document_id=%s and user_id=%s and index_version=%s order by ordinal""",
                            (doc["id"], doc["user_id"], doc["index_version"]),
                        ).fetchall()
                        if not rows:
                            raise RuntimeError("Published document has no indexed chunks")
                        for batch in batched(rows, 8):
                            ids = [str(row["id"]) for row in batch]
                            existing = {str(point.id) for point in vectors.client.retrieve(
                                vectors.collection, ids=ids, with_payload=False, with_vectors=False,
                            )}
                            missing = [{**row, "id": str(row["id"])} for row in batch if str(row["id"]) not in existing]
                            if missing:
                                embeddings = models.embed([row["content"] for row in missing])
                                vectors.upsert(doc["user_id"], doc["id"], doc["index_version"], missing, embeddings)
                    print(f"Indexed shared document {doc['id']}: {len(rows)} chunks", flush=True)
                if args.activate:
                    with conn.transaction():
                        catalog = conn.execute(
                            """select d.id,d.user_id,d.index_version from public.documents d
                            join public.knowledge_documents k on k.document_id=d.id
                            where d.status='ready' order by d.id for update of d""",
                        ).fetchall()
                        if not docs or catalog != docs:
                            raise RuntimeError("Shared catalog is empty or changed during reindex; rerun")
                        for doc in docs:
                            result = conn.execute(
                                """update public.documents d set embedding_profile=%s,vector_collection=%s
                                where d.id=%s and d.status='ready' and d.index_version=%s
                                and exists(select 1 from public.knowledge_documents k where k.document_id=d.id)""",
                                (settings.embedding_profile, vectors.collection, doc["id"], doc["index_version"]),
                            )
                            if result.rowcount != 1:
                                raise RuntimeError("Shared catalog changed during reindex; rerun")
                print(f"{len(docs)} documents prepared in {vectors.collection}")
        finally:
            vectors.client.close()
    finally:
        models.close()


if __name__ == "__main__":
    main()
