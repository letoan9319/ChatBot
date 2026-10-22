from study_worker.corpus import manifest
from study_worker.evaluate import percentile, report


def test_manifest_is_balanced_and_has_no_split_overlap():
    rows = manifest()
    assert len(rows) == 60
    assert len({row["id"] for row in rows}) == 60
    assert len({row["document"] for row in rows}) == 6
    assert sum(row["answerable"] for row in rows) == 45
    assert sum(row["split"] == "calibration" for row in rows) == 20
    assert sum(row["split"] == "test" for row in rows) == 40
    assert any(not row["answerable"] for row in rows if row["split"] == "calibration")


def test_report_separates_ungraded_quality_from_automatic_recall():
    rows = [
        {
            "answerable": True,
            "expected_source": {"document_name": "doc", "page": 2},
            "retrieved": [{"document_name": "doc", "page": 2}],
            "sources": [{}],
            "seconds": 3,
        },
        {"answerable": False, "expected_source": None, "retrieved": [], "sources": [], "seconds": 9},
    ]
    value = report(rows)
    assert value["recall_at_5"] == 1
    assert value["answer_correct"]["rate"] is None
    assert value["appropriate_abstention"]["graded"] == 0
    assert percentile([3, 9], 0.95) == 9
