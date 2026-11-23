from types import SimpleNamespace

import pytest
from qdrant_client import QdrantClient

from study_worker.models import VectorStore
from study_worker.rag import NO_EVIDENCE, build_prompt, first_image_hint, follow_up_history, follow_up_query, validate_citations


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
        "Giải thích kỹ hơn", [{"role": "user", "content": "old " * 1200}], candidates, lambda text: len(text.split())
    )
    assert len(selected) <= 5
    assert len({item["content"] for item in selected}) == len(selected)
    assert sum(len(message["content"].split()) for message in messages) <= 2900
    assert not any(message["content"].startswith("old ") for message in messages)
    assert messages[-1]["role"] == "user"


def test_follow_up_preserves_original_question_and_requested_step_after_long_answer():
    formula = r"$\frac{d}{dx}(xy^3)=y^3+3xy^2y'$"
    history = [
        {"role": "user", "content": "Tính giới hạn dãy số."},
        {"role": "assistant", "content": "Một gợi ý về giới hạn."},
        {"role": "user", "content": r"Tìm đạo hàm ẩn $x^3-3(x^2+1)y+xy^3=1$."},
        {"role": "assistant", "content": (
            f"1. Đạo hàm vế phải.\n2. Với xy³, {formula}. [S3]\n3. " + "dài " * 1400
            + "\n\n**Bước tiếp theo:** Gom các hạng tử chứa y'."
        )},
    ]
    question = "Bạn có thể giải thích kỹ hơn bước 2?"
    context = follow_up_history(question, history)
    messages, _ = build_prompt(question, context, [], lambda text: len(text.split()), "library")
    assert messages[1] == history[2]
    assert formula in messages[2]["content"]
    assert "Gom các hạng tử" in messages[2]["content"]
    assert "[S3]" not in messages[2]["content"]
    assert "phép biến đổi cụ thể" in messages[-1]["content"]
    query = follow_up_query(question, context, lambda text: len(text.split()))
    assert query.startswith(history[2]["content"] + "\n" + question)
    assert formula in query
    assert "Tính giới hạn dãy số" not in query
    assert not follow_up_history("Giải hệ phương trình x+y=2, x-y=0", history)


def test_follow_up_can_use_question_image_without_resetting_to_opening_hint():
    history = [
        {"role": "user", "content": "Tính giới hạn trong ảnh."},
        {"role": "assistant", "content": "Hãy thử nhân liên hợp."},
    ]
    question = "Vì sao lại nhân liên hợp?"
    formula = r"$\sqrt{n^2+n}-n$"
    image = {"content": formula, "question_image": True}
    prompt, sources = build_prompt(question, follow_up_history(question, history), [image], len)
    assert sources[0]["label"] == "S1"
    assert formula in prompt[-1]["content"]
    assert "ảnh của lượt trước" in prompt[-1]["content"]
    assert "thao tác đầu tiên" not in prompt[-1]["content"]


def test_general_answer_can_complete_without_sources_but_cannot_invent_citations():
    prompt, sources = build_prompt("1+1 bằng bao nhiêu?", [], [], len, "library")
    assert "hướng dẫn cách làm bài toán tự chứa" in prompt[0]["content"]
    assert "Không tiết lộ giá trị cuối" in prompt[0]["content"]
    answer, used = validate_citations("1 + 1 = 2.", sources, allow_uncited=True)
    assert answer.startswith("1 + 1 = 2.")
    assert "Kiến thức tổng quát" in answer
    assert used == []
    assert validate_citations("1 + 1 = 2 [S1]", sources, allow_uncited=True) == (NO_EVIDENCE, [])


def test_question_image_is_in_the_current_turn_and_keeps_a_source_link():
    formula = r"a_n = \sin^2 \pi(\sqrt{n^2+n}-n)"
    image = {"content": formula, "question_image": True}
    prompt, sources = build_prompt("Tính giới hạn câu này cho tôi", [], [image], len)
    assert formula in prompt[-1]["content"]
    assert formula not in prompt[0]["content"]
    assert "[S1]" in prompt[-1]["content"]
    answer, used = validate_citations("Hãy nhân liên hợp.", sources, allow_uncited=True)
    assert "Ảnh đính kèm dùng cho câu hỏi [S1]" in answer
    assert "Kiến thức tổng quát" not in answer
    assert used == sources
    assert validate_citations("Nguồn sai [S9]", sources, allow_uncited=True) == (NO_EVIDENCE, [])


def test_image_hint_discards_later_steps_even_if_model_emits_a_list():
    draft = (
        "Đề trong ảnh [S1].\n\n**Gợi ý bước tiếp theo:**\n\n"
        "1. Hãy nhân liên hợp. Sau đó thử đoán giới hạn.\n2. Phần trong ngoặc tiến về 0.\n\nKết quả cuối."
    )
    assert first_image_hint(draft) == "Đề trong ảnh [S1].\n\n**Gợi ý:** Hãy nhân liên hợp."


def test_tenant_document_and_version_filters_work_together():
    store = VectorStore.__new__(VectorStore)
    store.settings = SimpleNamespace(collection="test", min_score=0)
    store.collection = "test"
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


def test_thinking_is_selective_for_simple_questions_and_complex_requests():
    from study_worker.rag import should_reason

    assert not should_reason("Chào bạn", "library")
    assert not should_reason("Định luật Newton là gì?", "search")
    assert should_reason("Chứng minh công thức", "library")
    assert not should_reason("Đọc đúng mã số trong ảnh", "documents", has_image=True)
    assert should_reason("Đọc đề trong ảnh và hướng dẫn cách làm", "documents", has_image=True)
    assert should_reason("So sánh thống kê", "research")


def test_valid_visual_json_can_be_closed_without_swallowing_following_text():
    from study_worker.rag import close_visual_block

    fence = chr(96) * 3
    visual = fence + 'learnstep-visual\n{"type":"bar","title":"Kết quả","items":[{"label":"A","value":1}]}'
    expected = visual + "\n" + fence + "\n\nDiễn giải"
    assert close_visual_block(visual + "\n\nDiễn giải") == expected
    assert close_visual_block(expected) == expected
    assert close_visual_block(fence + "learnstep-visual\n{incomplete") == fence + "learnstep-visual\n{incomplete"


def test_plain_json_tag_becomes_visual_only_for_visual_requests():
    from study_worker.rag import close_visual_block

    fence = chr(96) * 3
    response = fence + 'json\n{"type":"flow","title":"A","steps":["B","C"]}\n' + fence
    assert close_visual_block(response, "Trả dữ liệu JSON") == response
    assert close_visual_block(response, "Vẽ sơ đồ").startswith(fence + "learnstep-visual\n")
