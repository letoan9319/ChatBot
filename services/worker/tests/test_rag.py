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
    assert sum(len(message["content"].split()) for message in messages) <= 4800
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
    assert validate_citations("1 + 1 = 2 [S1].", sources, allow_uncited=True) == (answer, [])
    assert validate_citations("1 + 1 = 2 [S1].", sources) == (NO_EVIDENCE, [])
    available = [{"label": "S2", "content": "Phép cộng"}]
    assert validate_citations("1 + 1 = 2 [S1].", available, allow_uncited=True) == (NO_EVIDENCE, [])


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


def test_concept_explanation_uses_general_visual_flow_without_changing_exercise_prompt():
    from study_worker.rag import concept_request

    for question in (
        "Giải thích giúp mình khái niệm về đạo hàm riêng",
        "Giải thích giúp mình về tích vô hướng",
        "Định luật II Newton được phát biểu thế nào?",
    ):
        assert concept_request(question)
        prompt, _ = build_prompt(question, [], [], lambda text: len(text.split()), mode="library")
        assert "learnstep-visual" in prompt[0]["content"]
        assert "Đây là câu hỏi khái niệm." in prompt[-1]["content"]
        assert "Không tiết lộ giá trị cuối" not in prompt[0]["content"]

    exercise = "Giải thích từng bước cách đạo hàm ẩn hạng tử xy^3"
    assert not concept_request(exercise)
    prompt, _ = build_prompt(exercise, [], [], lambda text: len(text.split()), mode="library")
    assert "learnstep-visual" not in prompt[0]["content"]
    assert "Tuyệt đối không tính ra kết quả cuối" in prompt[-1]["content"]


def test_prompt_respects_selected_subject_for_polysemous_terms():
    question = "Trường là gì?"
    calculus, _ = build_prompt(question, [], [], len, "library", subject="calculus")
    physics, _ = build_prompt(question, [], [], len, "library", subject="physics")
    assert "đã chọn là Giải tích" in calculus[0]["content"]
    assert "đã chọn là Vật lý đại cương" in physics[0]["content"]


def test_explicit_reasoning_requests_use_a_public_approach_summary():
    from study_worker.rag import should_reason

    question = "Suy luận kỹ giúp mình về quy tắc tích."
    assert should_reason(question, "library")
    messages, _ = build_prompt(question, [], [], len, "library", reasoning=True)
    assert "**Cách tiếp cận:**" in messages[-1]["content"]
    assert "không kể lại quá trình suy nghĩ riêng" in messages[-1]["content"]
    assert not should_reason("Công thức quy tắc tích là gì?", "library")


def test_concept_explanations_include_worked_examples_but_mixed_exercises_keep_hints():
    from study_worker.rag import concept_request

    question = "Không gian con là gì? Minh họa bằng sơ đồ khái niệm."
    prompt, _ = build_prompt(question, [], [], len, "library")
    assert "ví dụ minh họa có kết quả đầy đủ" in prompt[0]["content"]
    assert '"type":"concept"' in prompt[0]["content"]
    assert "bắt buộc dùng type concept" in prompt[-1]["content"]
    assert "Không tiết lộ giá trị cuối" not in prompt[0]["content"]
    assert concept_request("Giải thích kỹ hơn", [{"role": "user", "content": question}])
    exercise = "Giải thích khái niệm và tính đạo hàm của hàm số sau"
    assert not concept_request(exercise)
    assert not concept_request("Giải thích kỹ hơn", [{"role": "user", "content": exercise}])
    prompt, _ = build_prompt(exercise, [], [], len, "library")
    assert "Không tiết lộ giá trị cuối" in prompt[0]["content"]


def test_build_prompt_includes_one_shot_citation_rule_and_concise_concept_guidance():
    sources = [{"label": "S1", "document_name": "giai-tich.pdf", "content": "Đạo hàm tại một điểm là hệ số góc."}]
    messages, _ = build_prompt("Đạo hàm là gì?", [], sources, lambda text: len(text.split()), mode="documents")
    system = messages[0]["content"]
    user = messages[-1]["content"]
    assert "[S1]" in system
    assert "dữ kiện hay số liệu do đề bài của người học đưa ra" in system
    assert "câu mời tự làm" in system
    assert "ngắn gọn" in system
    assert "Không tự bịa ví dụ tính toán dài nhiều bước" in user

    no_src_messages, _ = build_prompt("Đạo hàm là gì?", [], [], lambda text: len(text.split()), mode="library")
    assert "dữ kiện hay số liệu do đề bài của người học đưa ra" not in no_src_messages[0]["content"]


def test_follow_up_detects_natural_vietnamese_clarifications_and_deep_dives():
    history = [
        {"role": "user", "content": "Thứ nguyên là gì?", "status": "completed"},
        {"role": "assistant", "content": "Thứ nguyên biểu diễn bản chất vật lý của đại lượng.", "status": "completed"},
    ]
    follow_up_questions = [
        "Mình vẫn chưa hiểu chỗ khác nhau giữa đơn vị và thứ nguyên, nói sâu hơn đi",
        "Phần giải thích ở trên hơi mơ hồ, bạn làm rõ giúp mình",
        "Có thể giải thích dễ hiểu hơn và đơn giản hơn không?",
        "Tóm tắt ngắn gọn hơn, cụ thể hơn và chi tiết hơn đi",
        "Cho thêm ví dụ thực tế hoặc ví dụ khác đi",
        "Đi sâu và phân tích sâu hơn ý này với minh họa thêm",
        "Còn trường hợp đại lượng không thứ nguyên thì sao?",
        "Thế còn đơn vị dẫn xuất vừa nêu thì sao?",
        "Vậy còn đoạn đó và chỗ này hiểu như thế nào?",
        "Giải thích kỹ hơn phần vừa rồi ở bước 2",
    ]
    for q in follow_up_questions:
        assert follow_up_history(q, history) == history, f"Expected follow-up for: {q}"

    standalone_questions = [
        "Giải hệ phương trình x+y=2, x-y=0",
        "Phương trình tiếp tuyến của đồ thị hàm số y = x^2 tại x = 1",
    ]
    for q in standalone_questions:
        assert follow_up_history(q, history) == [], f"Expected standalone for: {q}"


def test_stop_and_continue_history_and_role_alternation():
    from study_worker.rag import concept_request

    partial_history = [
        {"role": "user", "content": "Thứ nguyên là gì?"},
        {
            "role": "assistant",
            "content": "Thứ nguyên mô tả bản chất vật lý của đại lượng. Ví dụ với vận tốc,",
            "status": "stopped",
        },
    ]
    kept = follow_up_history("Tiếp tục đi", partial_history)
    assert kept == partial_history
    assert follow_up_history("Nói thêm về vận tốc", partial_history) == partial_history
    assert follow_up_history("Giải hệ phương trình x+y=2, x-y=0", partial_history) == []
    assert concept_request("Tiếp tục đi", kept)

    prompt, _ = build_prompt("Tiếp tục đi", kept, [], len, "library")
    assert [m["role"] for m in prompt] == ["system", "user", "assistant", "user"]
    assert prompt[2]["content"].endswith("\n\n[Phản hồi này đã bị dừng giữa chừng]")
    assert "nối tiếp mạch giải thích ngay từ chỗ đang dở" in prompt[-1]["content"]
    assert "Không định nghĩa lại từ đầu" in prompt[-1]["content"]
    assert "Ví dụ với vận tốc," in prompt[-1]["content"]
    assert "Đây là câu hỏi khái niệm" not in prompt[-1]["content"]

    empty_stopped_history = [
        {"role": "user", "content": "Đạo hàm là gì?"},
        {"role": "assistant", "content": "   ", "status": "interrupted"},
    ]
    kept_empty = follow_up_history("Trả lời tiếp đi", empty_stopped_history)
    assert kept_empty == empty_stopped_history
    prompt_empty, _ = build_prompt("Trả lời tiếp đi", kept_empty, [], len, "library")
    assert [m["role"] for m in prompt_empty] == ["system", "user", "assistant", "user"]
    assert prompt_empty[2]["content"] == "[Phản hồi trước đã bị dừng khi đang suy nghĩ]"

    user_only_history = [{"role": "user", "content": "Thứ nguyên là gì?"}]
    assert follow_up_history("Ý mình là trong cơ học", user_only_history) == user_only_history
    assert follow_up_history("Tính đạo hàm của x^2", user_only_history) == []

    exercise_stopped_history = [
        {"role": "user", "content": "Giải phương trình x^2 - 5x + 6 = 0"},
        {"role": "assistant", "content": "Ta có thể phân tích đa thức thành nhân tử.", "status": "stopped"},
    ]
    assert not concept_request("Làm tiếp đi", exercise_stopped_history)
    exercise_resume, _ = build_prompt("Làm tiếp đi", exercise_stopped_history, [], len, "library")
    assert "nối tiếp mạch giải thích ngay từ chỗ đang dở" in exercise_resume[-1]["content"]
    assert "không tiết lộ đáp án cuối" in exercise_resume[-1]["content"]
    exercise_clarify, _ = build_prompt("Giải thích kỹ hơn chỗ này", exercise_stopped_history, [], len, "library")
    assert "nối tiếp mạch giải thích ngay từ chỗ đang dở" in exercise_clarify[-1]["content"]
    assert "đào sâu đúng điểm được nhắc tới" in exercise_clarify[-1]["content"]


def test_search_mode_uses_3600_budget_and_hybrid_guidance():
    candidates = [
        {"id": str(i), "document_name": f"Doc_{i}.pdf", "content": f"chunk{i} " * 900}
        for i in range(6)
    ]
    def word_count(text):
        return len(text.split())
    search_messages, search_selected = build_prompt("Đạo hàm là gì?", [], candidates, word_count, "search")
    lib_messages, _ = build_prompt("Đạo hàm là gì?", [], candidates, word_count, "library")
    search_total = sum(word_count(m["content"]) for m in search_messages)
    lib_total = sum(word_count(m["content"]) for m in lib_messages)
    assert 4800 < search_total <= 5400
    assert lib_total <= 4800
    assert len(search_selected) >= 5

    hybrid_candidates = [
        {"id": "1", "document_name": "Vat_ly.pdf", "content": "Thứ nguyên theo giáo trình."},
        {"url": "https://vi.wikipedia.org/wiki/Thu_nguyen", "kind": "wikipedia", "title": "Thứ nguyên", "content": "Bổ sung web."},
    ]
    hybrid_messages, _ = build_prompt("Thứ nguyên là gì?", [], hybrid_candidates, word_count, "search")
    assert "Ở chế độ Tìm kiếm, hãy dùng học liệu trường (curriculum) làm chuẩn cho định nghĩa/ký hiệu" in hybrid_messages[0]["content"]
    assert "web_supplement" in hybrid_messages[0]["content"]

    curriculum_only, _ = build_prompt("Thứ nguyên là gì?", [], [hybrid_candidates[0]], word_count, "search")
    web_only, _ = build_prompt("Thứ nguyên là gì?", [], [hybrid_candidates[1]], word_count, "search")
    assert "Ở chế độ Tìm kiếm, hãy dùng học liệu trường" not in curriculum_only[0]["content"]
    assert "Ở chế độ Tìm kiếm, hãy dùng học liệu trường" not in web_only[0]["content"]


def test_review_missing_citations_parses_simple_and_legacy_formats_and_blocks_overcitation():
    from study_worker.rag import review_missing_citations

    sources = [
        {
            "label": "S1",
            "document_name": "vat-ly-dong-luc-hoc.pdf",
            "content": "Lực ma sát trượt có độ lớn tỉ lệ với phản lực pháp tuyến f = mu * N. Trọng lực có độ lớn P = m*g.",
        },
        {
            "label": "S2",
            "document_name": "vat-ly-nang-luong.docx",
            "content": "Khi chọn mốc thế năng tại h=0, thế năng trọng trường là U = m*g*h.",
        },
    ]
    question = "Một vật khối lượng m = 4 kg trượt trên mặt phẳng ngang có hệ số ma sát trượt mu = 0,25. Tính lực ma sát."
    draft = (
        "**1. Xác định dữ liệu đề bài:**\n"
        "* Hệ số ma sát trượt: $\\mu = 0,25$.\n"
        "* Bề mặt là ngang (nằm ngang).\n"
        "Độ lớn của lực ma sát trượt được tính bằng công thức:\n"
        "$$\n"
        "f = \\mu \\cdot N\n"
        "$$\n"
        "Trong đó:\n"
        "1. Xác định các đại lượng trong đề bài.\n"
        "Bạn có muốn thử tính kết quả và gửi cách làm để mình góp ý không?"
    )

    seen_prompts = []

    def fake_generate(messages):
        seen_prompts.append(messages)
        # Simulate prose containing [S1] before the JSON array plus over-cited lines and a wrong chunk.
        yield 'Theo nguồn [S1], các dòng hỗ trợ là:\n[[1, "S1"], [2, "S1"], [3, "S1"], [4, "S1"], [4, "S2"], [8, "S1"], [9, "S1"], [10, "S1"]]'

    fake_models = SimpleNamespace(count=lambda text: len(text) // 4, generate=fake_generate)
    reviewed = review_missing_citations(question, draft, sources, fake_models)

    assert '[[line_no, "S1"]]' in seen_prompts[0][0]["content"]
    assert "S1:0" not in seen_prompts[0][1]["content"]
    out_lines = reviewed.splitlines()
    # Headings, user-given numbers, zero-overlap lines, generic tutor steps, and practice prompts stay untagged.
    assert "[S1]" not in out_lines[0]
    assert "[S1]" not in out_lines[1]
    assert "[S1]" not in out_lines[2]
    assert "[S1]" not in out_lines[7]
    assert "[S1]" not in out_lines[8]
    assert "[S1]" not in out_lines[9]
    # Valid formula-intro line keeps [S1] and rejects mismatched [S2].
    assert out_lines[3].endswith("[S1]")
    assert "[S2]" not in out_lines[3]

    # Legacy "S1:0" and fenced json block formats remain supported.
    legacy_models = SimpleNamespace(
        count=lambda text: len(text) // 4,
        generate=lambda _m: (x for x in ['```json\n[[4, "S1:0"]]\n```']),
    )
    reviewed_legacy = review_missing_citations(question, draft, sources, legacy_models)
    assert reviewed_legacy.splitlines()[3].endswith("[S1]")


def test_should_reason_avoids_zero_source_and_simple_followup_or_lookup_spikes():
    from study_worker.rag import should_reason

    # Zero sources on non-research, non-image queries disables expensive thinking.
    assert not should_reason("Chứng minh công thức", "documents", has_sources=False)
    assert should_reason("Chứng minh công thức", "documents", has_sources=True)
    assert should_reason("So sánh tài liệu", "research", has_sources=False)
    assert should_reason("Hướng dẫn bài trong ảnh", "documents", has_image=True, has_sources=False)

    # Concept lookup on an advanced topic does not trigger expensive thinking.
    assert not should_reason(
        "Theo tài liệu giai-tich-tich-phan.docx, tiêu chuẩn hội tụ của tích phân suy rộng loại 1 là gì?",
        "documents",
        has_sources=True,
    )
    # Solving an actual improper integral still triggers thinking when sources exist.
    assert should_reason(
        "Tính tích phân suy rộng từ 1 đến vô cùng của 1/x^2",
        "documents",
        has_sources=True,
    )
    # Simple follow-up and incidental 'suy ra' prose do not trigger thinking; explicit derivation does.
    assert not should_reason(
        "Giải thích rõ hơn bước 1, tại sao động năng ban đầu lại bằng 0? Em hãy xác định K1 rồi suy ra K2.",
        "documents",
        has_sources=True,
    )
    assert should_reason("Suy ra công thức nghiệm tổng quát", "documents", has_sources=True)


def test_strict_document_and_explicit_web_linguistic_detectors():
    from study_worker.rag import explicit_web_request, strict_document_query

    assert strict_document_query("Chỉ dựa trên tài liệu này, có trình bày hiệu ứng Doppler không?")
    assert strict_document_query("Theo tài liệu giai-tich.pdf, định lý Rolle là gì?")
    assert strict_document_query("Trong tài liệu đã chọn có định nghĩa tích phân suy rộng không?")
    assert strict_document_query("Trích dẫn nguyên văn định nghĩa trong file")
    assert strict_document_query("Dựa hoàn toàn vào tài liệu để trả lời")
    assert not strict_document_query("Hiệu ứng Doppler là gì?")
    assert not strict_document_query("Vẽ đồ thị hàm số f(x) = x^3 - 3x")

    assert explicit_web_request("Tìm trên web về hiệu ứng Doppler")
    assert explicit_web_request("Tra cứu web công thức định luật Gauss")
    assert explicit_web_request("Tìm trên mạng giải thích về gradient")
    assert explicit_web_request("Tìm kiếm web về chuỗi Fourier")
    assert explicit_web_request("Bổ sung thêm nguồn ngoài về ma trận trực giao")
    assert explicit_web_request("Theo Wikipedia, định luật Faraday phát biểu thế nào?")
    assert explicit_web_request("Tìm bài báo khoa học về phương trình nhiệt")
    assert not explicit_web_request("Đạo hàm là gì?")


def test_plot_and_vector_visual_requests_prompt_and_close_visual_block():
    from study_worker.rag import close_visual_block, wants_visual

    for question in (
        "Vẽ hàm số f(x) = x^3 - 3x trên đoạn [-2, 2]",
        "Đồ thị hàm sin(x) có tính chất gì?",
        "Phân tích lực tác dụng lên vật trên mặt phẳng nghiêng góc 30 độ",
        "Biểu diễn vector tổng hợp của hai lực vuông góc",
        "Biểu diễn vectơ pháp tuyến của mặt phẳng",
    ):
        assert wants_visual(question)

    messages, _ = build_prompt(
        "Vẽ đồ thị hàm số f(x) = x^3 - 3x trên đoạn [-2, 2] và chỉ ra cực trị",
        [],
        [],
        len,
        mode="library",
    )
    system = messages[0]["content"]
    assert '"type":"plot"' in system
    assert '"type":"vector"' in system

    fence = chr(96) * 3
    plot_draft = (
        fence
        + 'learnstep-visual\n{"type":"plot","title":"Đồ thị f(x)","xDomain":[-2,2],'
        + '"functions":[{"expr":"x^3 - 3*x","label":"f(x)"}],'
        + '"points":[{"x":-1,"label":"Cực đại"}]}\n\nNhận xét về cực trị.'
    )
    closed_plot = close_visual_block(plot_draft, "Vẽ đồ thị hàm số f(x) = x^3 - 3x")
    assert closed_plot.endswith("\n" + fence + "\n\nNhận xét về cực trị.")

    vector_json = (
        fence
        + 'json\n{"type":"vector","title":"Phân tích lực","grid":false,"planeAngle":30,'
        + '"bodyLabel":"m","vectors":[{"label":"P","dx":0,"dy":-3,"tone":"warn"}]}\n'
        + fence
    )
    upgraded_vector = close_visual_block(vector_json, "Phân tích lực trên mặt phẳng nghiêng góc 30 độ")
    assert upgraded_vector.startswith(fence + "learnstep-visual\n")

    # Explicit plot and vector prompts mandate the ```learnstep-visual fence and plain-text JSON rules.
    assert "```learnstep-visual" in messages[-1]["content"]
    assert '"type":"plot"' in messages[-1]["content"]
    vector_messages, _ = build_prompt(
        "Minh họa bằng sơ đồ vector các lực tác dụng lên vật trên mặt phẳng nghiêng góc 30 độ",
        [],
        [],
        len,
        mode="library",
    )
    assert "```learnstep-visual" in vector_messages[-1]["content"]
    assert '"type":"vector"' in vector_messages[-1]["content"]

    # Invalid LaTeX backslashes like \circ or \vec inside JSON strings are safely escaped and converted.
    import json as _json

    latex_escaped_vector = (
        fence
        + 'json\n{"type":"vector","title":"Các lực trên mặt phẳng nghiêng $30^\\circ$",'
        + '"grid":false,"planeAngle":30,"bodyLabel":"m",'
        + '"vectors":[{"label":"$\\vec{P}$ (trọng lực)","dx":0,"dy":-3,"tone":"warn"}]}\n'
        + fence
        + "\n\nGiải thích thêm bên ngoài."
    )
    repaired = close_visual_block(
        latex_escaped_vector,
        "Minh họa bằng sơ đồ vector các lực tác dụng lên vật trên mặt phẳng nghiêng góc 30 độ",
    )
    assert repaired.startswith(fence + "learnstep-visual\n")
    assert repaired.endswith("\n\nGiải thích thêm bên ngoài.")
    inner_json = repaired.split("\n", 1)[1].split("\n" + fence, 1)[0]
    parsed = _json.loads(inner_json)
    assert parsed["type"] == "vector"
    assert "\\circ" in parsed["title"]
    assert "\\vec{P}" in parsed["vectors"][0]["label"]

    # Unclosed block with invalid backslash also closes cleanly without swallowing trailing prose.
    unclosed_latex = (
        fence
        + 'json\n{"type":"vector","title":"Góc $30^\\circ$","vectors":[{"label":"P","dx":0,"dy":-3}]}\n\nPhần giải thích.'
    )
    repaired_unclosed = close_visual_block(unclosed_latex, "Phân tích lực mặt phẳng nghiêng")
    assert repaired_unclosed.startswith(fence + "learnstep-visual\n")
    assert repaired_unclosed.endswith("\n" + fence + "\n\nPhần giải thích.")


def test_natural_student_attempts_sliding_query_rewriting_and_conversation_window():
    from study_worker.rag import contextualize_search_question

    base_history = [
        {"id": "u1", "role": "user", "content": "Cho hàm số f(x,y) = x^2 + 3xy. Tính gradient của f."},
        {"id": "a1", "role": "assistant", "content": "Trước hết hãy tính đạo hàm riêng theo x và theo y."},
    ]
    natural_followups = [
        "Mình tính đạo hàm riêng theo x ra 2x + 3y đúng không?",
        "Em làm ra kết quả (2x + 3y, 3x) đúng chưa?",
        "Áp dụng vào mặt cầu bán kính R thế nào?",
        "Nếu thay x = 1 và y = 2 thì sao?",
        "So sánh với đạo hàm theo hướng?",
        "Ý nghĩa hình học của nó là gì?",
    ]
    for q in natural_followups:
        assert follow_up_history(q, base_history) == base_history, f"Expected follow-up for: {q}"

    # 4-turn sliding topic chain shifts retrieval focus to Turn 3 ("mặt phẳng tiếp diện") rather than stuck on Turn 1.
    chain_history = [
        {"id": "u1", "role": "user", "content": "Cho z = x^2 + y^2, đạo hàm riêng là gì?"},
        {"id": "a1", "role": "assistant", "content": "Đạo hàm riêng theo x là 2x, theo y là 2y."},
        {"id": "u2", "role": "user", "content": "Từ đó suy ra gradient thế nào?"},
        {"id": "a2", "role": "assistant", "content": "Gradient là vectơ (2x, 2y)."},
        {"id": "u3", "role": "user", "content": "Thế còn mặt phẳng tiếp diện?"},
        {"id": "a3", "role": "assistant", "content": "Mặt phẳng tiếp diện tại (x0, y0) dùng hai đạo hàm riêng này."},
    ]
    q4 = "Cho mình ví dụ tính tại điểm (1, 2)"
    thread = follow_up_history(q4, chain_history)
    assert thread == chain_history
    rewritten_web = contextualize_search_question(q4, thread)
    assert rewritten_web.lower().startswith("mặt phẳng tiếp diện")
    rewritten_rag = follow_up_query(q4, thread, lambda t: len(t.split()))
    assert rewritten_rag.splitlines()[0] == "Thế còn mặt phẳng tiếp diện?"
    assert "z = x^2 + y^2" in rewritten_rag

    # Separation of conversation_history (LLM memory) vs thread_history (pedagogical mode):
    # Asking a new concept after an exercise keeps prior session turns in prompt without forcing EXERCISE_GUIDANCE.
    new_concept = "Định lý Viète là gì?"
    assert follow_up_history(new_concept, base_history) == []
    messages, _ = build_prompt(
        new_concept,
        [],
        [],
        lambda t: len(t.split()),
        mode="library",
        conversation_history=base_history,
    )
    assert "Không tiết lộ giá trị cuối" not in messages[0]["content"]
    assert any("f(x,y) = x^2 + 3xy" in m["content"] for m in messages[1:-1])
    roles = [m["role"] for m in messages]
    assert roles == ["system", "user", "assistant", "user"]

    # Budget saturation across many turns strictly preserves user/assistant alternation.
    many_turns = []
    for idx in range(10):
        many_turns.append({"id": f"u-{idx}", "role": "user", "content": f"Câu hỏi lượt {idx}: " + ("nội dung " * 80)})
        many_turns.append({"id": f"a-{idx}", "role": "assistant", "content": f"Trả lời lượt {idx}: " + ("giải thích " * 140)})
    packed_msgs, _ = build_prompt(
        "Chi tiết hơn đi",
        many_turns,
        [{"id": "c1", "document_name": "GT1.pdf", "content": "Định lý cơ bản " * 120}],
        lambda t: len(t.split()),
        mode="library",
        conversation_history=many_turns,
    )
    packed_roles = [m["role"] for m in packed_msgs]
    assert packed_roles[0] == "system" and packed_roles[-1] == "user"
    for prev_role, next_role in zip(packed_roles[1:], packed_roles[2:]):
        assert prev_role != next_role


def test_elliptical_visual_followup_preserves_multiturn_gradient_context_and_avoids_cubic_leak():
    from study_worker.rag import ILLUSTRATION_REQUEST, contextualize_search_question, extract_topic_phrase

    assert extract_topic_phrase("Chi tiết hơn kèm minh họa đi") == ""
    assert extract_topic_phrase("Vẽ đồ thị biểu diễn cho tôi") == ""
    assert extract_topic_phrase("Biểu diễn bằng sơ đồ giúp mình") == ""
    assert extract_topic_phrase("Vẽ đồ thị hàm số y = x^2 - 4x + 3") != ""
    assert ILLUSTRATION_REQUEST.search("Chi tiết hơn kèm minh họa đi")

    gradient_history = [
        {"id": "u1", "role": "user", "content": "gradient trong giải tích"},
        {
            "id": "a1",
            "role": "assistant",
            "content": "Gradient của hàm vô hướng cho biết hướng tăng nhanh nhất tại một điểm.",
        },
        {"id": "u2", "role": "user", "content": "Chi tiết hơn kèm minh họa đi"},
        {
            "id": "a2",
            "role": "assistant",
            "content": (
                "Gradient của hàm số $f$ tại $M_0 \\in \\mathbb{R}^n$ là $\\nabla f(M_0)$.\n\n"
                "Ví dụ: với $f(x,y) = x^2 + y^2$, tại $M_0(1,2)$ ta có $\\nabla f(M_0) = (2,4)$; "
                "vectơ này chỉ hướng tăng nhanh nhất."
            ),
        },
    ]

    # Elliptical visual request continues the active Gradient thread, whereas a new explicit equation starts fresh.
    thread = follow_up_history("Vẽ đồ thị biểu diễn cho tôi", gradient_history)
    assert thread == gradient_history
    assert follow_up_history("Vẽ đồ thị hàm số y = x^2 - 4x + 3", gradient_history) == []

    # Topic contextualization stays anchored to Gradient instead of drifting to generic "đồ thị / biểu diễn".
    topic_q = contextualize_search_question("Vẽ đồ thị biểu diễn cho tôi", thread)
    assert "gradient" in topic_q.casefold()
    assert "biểu diễn" not in topic_q.casefold()

    rag_q = follow_up_query("Vẽ đồ thị biểu diễn cho tôi", thread, lambda t: len(t.split()))
    assert "gradient trong giải tích" in rag_q
    assert "x^2 + y^2" in rag_q
    assert "(2,4)" in rag_q

    sources = [
        {
            "id": "d4c1ade2-02d6-579c-9638-5be8c348d903",
            "document_name": "Dao ham - Vi phan (1).pdf",
            "content": "Gradient của hàm số f tại điểm M0 là vectơ có tọa độ là các đạo hàm riêng.",
        }
    ]
    messages, _ = build_prompt(
        "Vẽ đồ thị biểu diễn cho tôi",
        thread,
        sources,
        lambda t: len(t.split()),
        mode="library",
        subject="calculus",
        conversation_history=gradient_history,
    )
    full_prompt_text = "\n".join(m["content"] for m in messages)
    assert "x^3 - 3*x" not in full_prompt_text
    assert "x^3 - 3x" not in full_prompt_text
    assert any("(2,4)" in m["content"] for m in messages[1:-1])
    assert '"type":"vector"' in messages[-1]["content"]
    assert '"grid":true' in messages[-1]["content"]


def test_stream_progress_flusher_coalesces_tokens_without_stalling_producer_and_propagates_stop():
    import threading
    import time
    from types import SimpleNamespace
    import pytest
    from study_worker.main import ChatStopped, _StreamProgressFlusher

    recorded_thinking = []
    recorded_partial = []

    class SlowRemoteStub:
        def __init__(self):
            self.heartbeat = SimpleNamespace(lost=threading.Event())
            self.stop_requested = False

        def _get_stream_conn(self):
            return "stub-conn"

        def close_stream_conn(self):
            pass

        def _save_thinking_on(self, _conn, _job, elapsed, content=None):
            time.sleep(0.06)
            if self.stop_requested:
                raise ChatStopped()
            recorded_thinking.append((elapsed, content))

        def _save_partial_on(self, _conn, _job, content):
            time.sleep(0.06)
            if self.stop_requested:
                raise ChatStopped()
            recorded_partial.append(content)

    stub = SlowRemoteStub()
    job = {"id": "j1", "kind": "chat", "lease_token": "t1"}
    flusher = _StreamProgressFlusher(stub, job, async_enabled=True).start()

    # 200 rapid thinking tokens do not block the producer thread even when DB writes take 60ms each.
    t0 = time.monotonic()
    acc = ""
    for i in range(200):
        acc += f"w{i} "
        flusher.push_thinking(None, acc)
    producer_ms = (time.monotonic() - t0) * 1000
    assert producer_ms < 80, f"Producer stalled for {producer_ms:.1f}ms"

    flusher.push_thinking(1450, acc)
    flusher.push_partial("Final partial answer")
    flusher.drain()

    # Coalesced into a handful of bursts rather than 200 sequential DB writes, preserving final elapsed & text.
    assert 1 <= len(recorded_thinking) < 15
    assert recorded_thinking[-1] == (1450, acc)
    assert recorded_partial[-1] == "Final partial answer"

    # USER_STOPPED detected on the background writer aborts the producer immediately.
    stub.stop_requested = True
    flusher2 = _StreamProgressFlusher(stub, job, async_enabled=True).start()
    flusher2.push_thinking(None, "next thought")
    with pytest.raises(ChatStopped):
        for _ in range(30):
            time.sleep(0.02)
            flusher2.raise_if_failed()
        flusher2.drain()


