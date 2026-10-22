from types import SimpleNamespace

import pytest
from qdrant_client import QdrantClient

from study_worker.models import VectorStore
from study_worker.rag import NO_EVIDENCE, build_prompt, validate_citations


def test_citations_require_actual_retrieved_labels():
    sources = [{"label": "S1", "content": "a derivative is a rate of change"}]
    assert validate_citations("Rate of change [S1]", sources)[1] == sources
    assert validate_citations("An invented source [S9]", sources) == (NO_EVIDENCE, [])
    assert validate_citations("No reference at all", sources) == (NO_EVIDENCE, [])


def test_prompt_bounds_history_sources_and_repeated_chunks():
    candidates = [{"content": "text " * 400}, {"content": "text " * 400}] + [
        {"content": f"source {i} " * 100} for i in range(8)
    ]
    messages, selected = build_prompt(
        "Question", [{"role": "user", "content": "old " * 1000}], candidates, lambda text: len(text.split())
    )
    assert len(selected) <= 5
    assert len({item["content"] for item in selected}) == len(selected)
    assert sum(len(message["content"].split()) for message in messages) <= 2900
    assert not any(message["content"].startswith("old ") for message in messages)
    assert messages[-1]["role"] == "user"


def test_tenant_document_and_version_filters_work_together():
    store = VectorStore.__new__(VectorStore)
    store.settings = SimpleNamespace(collection="test", min_score=0)
    store.client = QdrantClient(":memory:")
    from qdrant_client import models

    store.client.create_collection(
        "test", vectors_config=models.VectorParams(size=1024, distance=models.Distance.COSINE)
    )
    vector = [1.0] + [0.0] * 1023
    ids = [
        "0b19a3b3-251d-49d1-91c3-5d0cb748a51b",
        "ba35481c-9650-49c0-9e8f-0588038d981e",
        "953fb2b1-fab2-4937-97d1-af77179cf61c",
    ]
    for chunk_id, owner, doc, version in [
        (ids[0], "alice", "doc-a", 1),
        (ids[1], "bob", "doc-b", 1),
        (ids[2], "alice", "doc-a", 2),
    ]:
        store.upsert(owner, doc, version, [{"id": chunk_id}], [vector])
    hits = store.search("alice", ["doc-a"], {"doc-a": 1}, vector)
    assert [str(hit.id) for hit in hits] == [ids[0]]
    assert not store.search("bob", ["doc-a"], {"doc-a": 1}, vector)
    store.delete("alice", "doc-a")
    assert not store.search("alice", ["doc-a"], {"doc-a": 1}, vector)
    assert len(store.search("bob", ["doc-b"], {"doc-b": 1}, vector)) == 1


def test_deleted_or_reindexed_document_cancels_chat():
    from study_worker.main import Cancelled, Pipeline

    class Conn:
        def execute(self, *_):
            return SimpleNamespace(fetchall=lambda: [{"id": "d", "status": "deleting", "index_version": 1}])

    pipeline = Pipeline.__new__(Pipeline)
    pipeline.conn = Conn()
    job = {"user_id": "u", "payload": {"document_ids": ["d"], "versions": {"d": 1}}}
    with pytest.raises(Cancelled):
        pipeline.chat_documents(job)


def test_old_worker_cannot_publish_after_lease_changes():
    from study_worker.main import LostLease, guard

    class Conn:
        def execute(self, *_):
            return SimpleNamespace(fetchone=lambda: {"status": "running", "lease_token": "new-lease"})

    with pytest.raises(LostLease):
        guard(Conn(), {"id": "job", "lease_token": "old-lease"})
