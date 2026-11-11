import threading
from types import SimpleNamespace

import pytest
from qdrant_client import QdrantClient, models

from study_worker.main import Cancelled, Pipeline
from study_worker.models import VectorStore


def test_shared_retrieval_keeps_owner_document_version_tuples_and_rejects_cross_products():
    store = VectorStore.__new__(VectorStore)
    store.collection = "test-library"
    store.settings = SimpleNamespace(min_score=0)
    store.client = QdrantClient(":memory:")
    store.client.create_collection(store.collection, vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    payloads = [
        ("alice", "personal", 1), ("publisher", "common", 2),
        ("publisher", "personal", 1), ("alice", "common", 2),
        ("bob", "common", 2), ("publisher", "common", 1), ("publisher", "not-selected", 2),
    ]
    store.client.upsert(store.collection, points=[
        models.PointStruct(id=i, vector=[1., 0.], payload={"user_id": owner, "document_id": doc, "index_version": version})
        for i, (owner, doc, version) in enumerate(payloads, 1)
    ])
    hits = store.search("alice", ["personal", "common"], {"personal": 1, "common": 2}, [1., 0.],
                        {"personal": "alice", "common": "publisher"})
    assert {hit.id for hit in hits} == {1, 2}
    with pytest.raises(ValueError):
        store.filters("alice", [], {}, {})
    store.client.close()


def pipeline_with_documents(rows):
    value = Pipeline.__new__(Pipeline)
    value.settings = SimpleNamespace(embedding_profile="ollama:bge-m3")
    value.vectors = SimpleNamespace(collection="study_bge_m3_v1")
    value.heartbeat = SimpleNamespace(lost=threading.Event())

    def execute(sql, params):
        assert "exists(select 1 from public.knowledge_documents" in sql
        assert params == ("viewer", ["common"])
        return SimpleNamespace(fetchall=lambda: rows)

    value.conn = SimpleNamespace(execute=execute)
    return value


def test_worker_reauthorizes_shared_documents_before_writing_and_cancels_revoked_or_forged_jobs():
    row = {"id": "common", "user_id": "publisher", "status": "ready", "index_version": 2,
           "embedding_profile": "ollama:bge-m3", "vector_collection": "study_bge_m3_v1"}
    job = {"user_id": "viewer", "payload": {"document_ids": ["common"], "versions": {"common": 2}, "owners": {"common": "publisher"}}}
    pipeline_with_documents([row]).chat_documents(job, lock=True)
    for rows in [[], [{**row, "status": "deleting"}], [{**row, "index_version": 3}], [{**row, "user_id": "other"}]]:
        with pytest.raises(Cancelled):
            pipeline_with_documents(rows).chat_documents(job, lock=True)
    # A legacy private job must not gain access merely because a document became shared.
    legacy = {"user_id": "viewer", "payload": {"document_ids": ["common"], "versions": {"common": 2}}}
    with pytest.raises(Cancelled):
        pipeline_with_documents([row]).chat_documents(legacy)


@pytest.mark.parametrize("ids", [[], ["same", "same"], list("abcdef")])
def test_invalid_document_sets_never_reach_vector_search(ids):
    value = Pipeline.__new__(Pipeline)
    with pytest.raises(Cancelled):
        value.chat_documents({"payload": {"document_ids": ids}})
