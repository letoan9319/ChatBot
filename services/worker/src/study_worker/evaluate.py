"""Offline evaluation through the same retrieval, prompt and citation policy."""

import argparse
import json
import math
import time
from pathlib import Path
from uuid import UUID

from .config import Settings
from .main import connect
from .models import create_models, VectorStore
from .rag import NO_EVIDENCE, build_prompt, validate_citations


def percentile(values, probability):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(probability * len(ordered)) - 1)]


def source_matches(actual, expected):
    return bool(expected) and all(actual.get(key) == value for key, value in expected.items())


def report(rows):
    answered = [row for row in rows if row["answerable"]]
    unanswerable = [row for row in rows if not row["answerable"]]

    def grade(items, field):
        graded = [item[field] for item in items if isinstance(item.get(field), bool)]
        return {"graded": len(graded), "total": len(items), "rate": sum(graded) / len(graded) if graded else None}

    return {
        "questions": len(rows),
        "recall_at_5": sum(
            any(source_matches(source, row["expected_source"]) for source in row.get("retrieved", [])[:5])
            for row in answered
        )
        / len(answered)
        if answered
        else None,
        "answer_correct": grade(answered, "answer_correct"),
        "citation_supported": grade([row for row in answered if row.get("sources")], "citation_supported"),
        "appropriate_abstention": grade(unanswerable, "appropriate_abstention"),
        "generation_seconds": {
            "p50": percentile([row["seconds"] for row in rows], 0.5),
            "p95": percentile([row["seconds"] for row in rows], 0.95),
        },
    }


def run(settings, owner, questions, output):
    with connect(settings) as conn, output.open("w", encoding="utf-8") as file:
        if not conn.execute("select pg_try_advisory_lock(706294811) as ok").fetchone()["ok"]:
            raise RuntimeError("Stop the worker before evaluation to serialize inference access.")
        models = create_models(settings)
        models.prepare()
        vectors = VectorStore(settings, models.dimensions)
        vectors.setup()
        for question in questions:
            start = time.monotonic()
            docs = conn.execute(
                "select * from documents where user_id=%s and name=%s and status='ready'", (owner, question["document"])
            ).fetchall()
            if len(docs) != 1:
                raise ValueError(
                    "Each manifest filename must resolve to exactly one ready document owned by the evaluation user."
                )
            doc = docs[0]
            if doc["embedding_profile"] != settings.embedding_profile or doc["vector_collection"] != vectors.collection:
                raise ValueError("Reindex evaluation documents with the configured embedding model first.")
            vector = models.embed([question["question"]], query=True)[0]
            hits = vectors.search(owner, [str(doc["id"])], {str(doc["id"]): doc["index_version"]}, vector)
            candidates = []
            for hit in hits:
                row = conn.execute(
                    """select c.*, d.name as document_name from document_chunks c join documents d on d.id=c.document_id
                    where c.id=%s and c.user_id=%s and c.document_id=%s and c.index_version=%s and d.status='ready'""",
                    ((hit.payload or {}).get("chunk_id"), owner, doc["id"], doc["index_version"]),
                ).fetchone()
                if row:
                    candidates.append(row)
            candidates = models.rerank(question["question"], candidates)
            prompt, chosen = build_prompt(question["question"], [], candidates, models.count)
            answer, used = validate_citations("".join(models.generate(prompt)), chosen) if chosen else (NO_EVIDENCE, [])
            location_fields = ("document_name", "page", "section", "paragraph")
            row = {
                **question,
                "answer": answer,
                "seconds": round(time.monotonic() - start, 3),
                "retrieved": [{key: item[key] for key in location_fields} for item in chosen],
                "sources": [{key: item[key] for key in (*location_fields, "label")} for item in used],
                "answer_correct": None,
                "citation_supported": None,
                "appropriate_abstention": None,
            }
            file.write(json.dumps(row, ensure_ascii=False) + "\n")
            file.flush()
    models.http.close()
    vectors.client.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--user-id", type=UUID)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--split", choices=["calibration", "test"], default="test")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.report:
        rows = [json.loads(line) for line in args.report.read_text(encoding="utf-8").splitlines() if line]
        print(json.dumps(report(rows), ensure_ascii=False, indent=2))
    elif args.manifest and args.user_id and args.output:
        rows = [json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line]
        run(Settings.load(), args.user_id, [row for row in rows if row["split"] == args.split], args.output)
        print("Evaluation saved. Manually grade the three nullable fields before reporting quality.")
    else:
        parser.error("Provide --report, or --manifest + --user-id + --output.")


if __name__ == "__main__":
    main()
