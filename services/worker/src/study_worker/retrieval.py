"""Curriculum retrieval normalization, lexical matching, stub expansion, and reranking."""

from __future__ import annotations

import re
import unicodedata

DEFAULT_MIN_SCORE = 0.35

STOPWORDS = {
    "la", "gi", "nhu", "the", "nao", "cua", "trong", "cho", "voi", "tu", "den",
    "mot", "cac", "nhung", "nay", "do", "khi", "ma", "de", "va", "hay", "hoac",
    "duoc", "bi", "se", "da", "dang", "ve", "tai", "sao", "vi", "neu", "thi",
    "co", "khong", "phai", "can", "tim", "tinh", "giai", "hay", "cho", "biet",
    "theo", "bai", "tap", "cau", "hoi", "muc", "phan", "chuong", "sach", "giao",
    "trinh", "hoc", "phan", "noi", "dung", "tom", "tat", "giai", "thich", "neu",
    "vi", "du", "minh", "hoa", "sau", "day", "tren", "duoi", "bang", "nhieu",
    "bao", "the", "is", "are", "was", "were", "what", "which", "who", "how",
    "why", "when", "where", "and", "or", "for", "with", "from", "that", "this",
    "into", "about", "using", "find", "solve", "explain", "define", "example",
    "hom", "nay", "troi",
    "giua", "hai", "dau", "nam", "ngang", "dai", "rong", "cao", "qua",
    "xac", "dinh", "biet", "rang",
}

SUBJECT_HINTS = {
    "calculus": (
        "dao ham", "vi phan", "tich phan", "nguyen ham", "gioi han", "lien tuc",
        "ham so", "ham an", "cuc tri", "khai trien taylor", "maclaurin", "chuoi so",
        "chuoi luy thua", "tiem can", "l'hospital", "lopitan", "roll", "lagrange",
        "cauchy", "leibniz", "darboux", "riemann", "giai tich",
    ),
    "linear-algebra": (
        "ma tran", "dinh thuc", "hang cua ma tran", "khong gian vecto",
        "khong gian con", "doc lap tuyen tinh", "phu thuoc tuyen tinh",
        "co so va so chieu", "anh xa tuyen tinh", "tri rieng", "vecto rieng",
        "vector rieng", "gia tri rieng", "cheo hoa", "truc giao", "gram schmidt",
        "dang toan phuong", "he phuong trinh tuyen tinh", "cramer", "gauss",
        "dai so tuyen tinh", "khong gian euclid",
    ),
    "physics": (
        "poiseuille", "do nhot", "chat luu", "thuy tinh", "thuy dong",
        "dong luc hoc", "dong hoc", "nhiet dong", "entropy", "enthalpy",
        "dien truong", "tu truong", "cam ung dien tu", "maxwell", "gauss",
        "ampere", "faraday", "dao dong", "song co", "giao thoa", "nhieu xa",
        "quang hoc", "momen quan tinh", "momen dong luong", "van toc goc",
        "gia toc huong tam", "ap suat", "bernoulli", "reynolds", "vat ly",
    ),
}

META_DOCUMENT_PATTERNS = (
    r"\btom\s+tat\b",
    r"\bmuc\s+luc\b",
    r"\bnoi\s+dung\s+chinh\b",
    r"\btai\s+lieu\s+nay\s+noi\s+ve\b",
    r"\bdanh\s+sach\s+tai\s+lieu\b",
    r"\bco\s+nhung\s+tai\s+lieu\s+nao\b",
    r"\bgiao\s+trinh\s+gom\b",
    r"\bchuong\s+nao\b",
    r"\bchuong\s+may\b",
)

_COPY_SUFFIX_RE = re.compile(r"(?:\s*\(\d+\)|\s*-\s*copy)+(?=\.[^.]+$|$)", re.IGNORECASE)
_META_BOILERPLATE_RE = re.compile(
    r"^(?:b[aà]i\s*t[aậ]p|c[aâ]u\s*h[oỏ]i|đ[eề]\s*b[aà]i|y[eê]u\s*c[aầ]u|t[aà]i\s*li[eệ]u\s*hi[eệ]n\s*c[oó])\s*:\s*",
    re.IGNORECASE,
)


def _strip_accents(text: str) -> str:
    """Fold Vietnamese/Latin accents to ASCII lowercase for robust matching."""
    normalized = unicodedata.normalize("NFD", text or "")
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "D").lower()


def _normalize_doc_key(name: str) -> str:
    """Collapse duplicate copy suffixes such as '(1)', '(2)' in document names."""
    cleaned = _COPY_SUFFIX_RE.sub("", (name or "").strip())
    return re.sub(r"\s+", " ", cleaned).lower()


def clean_retrieval_query(query: str) -> str:
    """Normalize user queries before embedding and lexical matching."""
    text = (query or "").strip()
    if not text:
        return ""
    text = _META_BOILERPLATE_RE.sub("", text)
    line_prefix_re = re.compile(r"^\s*(?:>+|#+|[*-](?=\s))\s*")
    lines = []
    for raw_line in text.splitlines():
        line = line_prefix_re.sub("", raw_line).strip()
        if line:
            lines.append(line)
    text = " ".join(lines)
    text = _META_BOILERPLATE_RE.sub("", text)
    text = line_prefix_re.sub("", text)
    text = text.replace("`", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_meta_document_query(query: str) -> bool:
    """Return True when the user asks about the document collection or overview."""
    folded = _strip_accents(clean_retrieval_query(query))
    return any(re.search(pattern, folded) for pattern in META_DOCUMENT_PATTERNS)


def extract_search_terms(query: str) -> list[str]:
    """Extract distinctive keywords preserving Vietnamese diacritics, ranking longer terms first."""
    cleaned = clean_retrieval_query(query)
    if not cleaned:
        return []
    raw_tokens = re.findall(r"[0-9A-Za-zÀ-ỹ]+", cleaned)
    collected: list[tuple[int, int, str]] = []
    seen_folded: set[str] = set()
    for idx, token in enumerate(raw_tokens):
        lower = token.lower()
        folded = _strip_accents(lower)
        if len(folded) < 2 or folded.isdigit() or folded in STOPWORDS:
            continue
        if folded not in seen_folded:
            seen_folded.add(folded)
            weight = 3 if len(folded) >= 6 else (2 if len(folded) >= 4 else 1)
            collected.append((-weight, idx, lower))
    collected.sort()
    return [term for _, _, term in collected[:18]]


def infer_subject_hint(query: str) -> str | None:
    """Infer likely course subject from domain keywords when subject filter is unset."""
    folded = _strip_accents(clean_retrieval_query(query))
    if not folded:
        return None
    scores: dict[str, int] = {}
    for subject, keywords in SUBJECT_HINTS.items():
        hits = sum(1 for kw in keywords if kw in folded)
        if hits:
            scores[subject] = hits
    if not scores:
        return None
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return None
    return ranked[0][0]


def lexical_search_chunks(
    conn,
    user_id: str,
    document_ids: list[str],
    subject: str | None,
    using_shared_catalog: bool,
    owners: dict[str, str],
    versions: dict[str, int],
    query: str,
    *,
    limit: int = 12,
) -> list[dict]:
    """Find matching chunks via case-insensitive lexical filters while enforcing catalog auth."""
    if not document_ids:
        return []
    terms = extract_search_terms(query)
    if not terms:
        return []

    like_clauses = []
    score_terms = []
    score_params: list = []
    params: list = [document_ids, subject, subject, using_shared_catalog, user_id]
    query_terms = terms[:10]
    for term in query_terms:
        pattern = f"%{term}%"
        folded = _strip_accents(term)
        weight = 3 if len(folded) >= 6 else 1
        like_clauses.append("(c.content ilike %s or d.name ilike %s)")
        params.extend([pattern, pattern])
        score_terms.append(f"(case when c.content ilike %s or d.name ilike %s then {weight} else 0 end)")
        score_params.extend([pattern, pattern])
        if folded != term:
            folded_pattern = f"%{folded}%"
            like_clauses.append("d.name ilike %s")
            params.append(folded_pattern)

    where_match = " or ".join(like_clauses)
    score_expr = " + ".join(score_terms)
    sql = f"""
        select c.*, d.name as document_name, d.subject
        from public.document_chunks c
        join public.documents d on d.id = c.document_id
        where c.document_id = any(%s)
          and d.status = 'ready'
          and c.user_id = d.user_id
          and c.index_version = d.index_version
          and (%s::text is null or d.subject = %s)
          and ((not %s and d.user_id = %s) or exists(select 1 from public.knowledge_documents k where k.document_id = d.id))
          and ({where_match})
        order by ({score_expr}) desc, length(c.content) desc, c.ordinal asc
        limit %s
    """
    params.extend(score_params)
    params.append(max(limit * 3, 24))
    cursor = conn.execute(sql, tuple(params))
    if cursor is None or not hasattr(cursor, "fetchall"):
        return []
    rows = cursor.fetchall()

    results: list[dict] = []
    for row in rows:
        doc_id = str(row.get("document_id") or "")
        if doc_id not in owners or str(row.get("user_id") or "") != str(owners[doc_id]):
            continue
        if row.get("index_version") != versions.get(doc_id):
            continue
        results.append(dict(row))
        if len(results) >= limit:
            break
    return results


def expand_stub_chunks(
    conn,
    candidates: list[dict],
    using_shared_catalog: bool,
    user_id: str,
    owners: dict[str, str],
    versions: dict[str, int],
) -> list[dict]:
    """Expand short heading/slide-title stubs (<90 chars) with adjacent chunks in the same doc."""
    if not candidates:
        return []
    expanded: list[dict] = []
    for item in candidates:
        row = dict(item)
        content = (row.get("content") or "").strip()
        doc_id = str(row.get("document_id") or "")
        ordinal = row.get("ordinal")
        if (
            len(content) < 90
            and doc_id in owners
            and doc_id in versions
            and isinstance(ordinal, int)
        ):
            cursor = conn.execute(
                """
                select c.*, d.name as document_name, d.subject
                from public.document_chunks c
                join public.documents d on d.id = c.document_id
                where c.document_id = %s
                  and c.user_id = %s
                  and d.user_id = %s
                  and d.status = 'ready'
                  and c.index_version = d.index_version
                  and c.index_version = %s
                  and c.ordinal > %s
                  and c.ordinal <= %s
                  and ((not %s and d.user_id = %s) or exists(select 1 from public.knowledge_documents k where k.document_id = d.id))
                order by c.ordinal asc
                """,
                (
                    doc_id,
                    owners[doc_id],
                    owners[doc_id],
                    versions[doc_id],
                    ordinal,
                    ordinal + 3,
                    using_shared_catalog,
                    user_id,
                ),
            )
            neighbors = cursor.fetchall() if cursor is not None and hasattr(cursor, "fetchall") else []
            extra_parts = [
                (n.get("content") or "").strip()
                for n in neighbors
                if str(n.get("user_id") or "") == str(owners[doc_id])
                and n.get("index_version") == versions[doc_id]
                and (n.get("content") or "").strip()
            ]
            if extra_parts:
                merged_parts = [content] if content else []
                for part in extra_parts:
                    if part not in merged_parts:
                        merged_parts.append(part)
                    if sum(len(p) for p in merged_parts) >= 900:
                        break
                row["content"] = "\n\n".join(merged_parts)
                if not row.get("section") and neighbors[0].get("section"):
                    row["section"] = neighbors[0]["section"]
        expanded.append(row)
    return expanded


def _lexical_overlap_score(query: str, item: dict) -> float:
    """Compute normalized term/phrase overlap between query and chunk/doc metadata."""
    terms = extract_search_terms(query)
    if not terms:
        return 0.0
    content_folded = _strip_accents(item.get("content") or "")
    section_folded = _strip_accents(item.get("section") or "")
    doc_folded = _strip_accents(item.get("document_name") or "")
    combined = f"{doc_folded} {section_folded} {content_folded}"

    folded_terms = [_strip_accents(t) for t in terms]
    matched_terms = sum(1 for ft in folded_terms if re.search(rf"(?<![0-9a-z]){re.escape(ft)}(?![0-9a-z])", combined))
    if not matched_terms:
        # Fall back to substring match for compound words/symbols.
        matched_terms = sum(1 for ft in folded_terms if ft in combined)

    coverage = matched_terms / len(folded_terms)
    doc_hits = sum(1 for ft in folded_terms if ft in doc_folded)
    phrase_bonus = 0.0
    if len(folded_terms) >= 2:
        for idx in range(len(folded_terms) - 1):
            bigram = f"{folded_terms[idx]} {folded_terms[idx + 1]}"
            if bigram in combined:
                phrase_bonus = 0.15
                break
    return min(1.0, coverage * 0.65 + (0.12 if doc_hits else 0.0) + phrase_bonus)


def rerank_curriculum_candidates(
    query: str,
    candidates: list[dict],
    *,
    subject: str | None = None,
    min_score: float = DEFAULT_MIN_SCORE,
    vector_scores: dict[tuple[str, str], float] | None = None,
) -> list[dict]:
    """Deduplicate, suppress slide stubs and off-topic noise, and balance document diversity."""
    if not candidates:
        return []

    meta_query = is_meta_document_query(query)
    subject_hint = subject or infer_subject_hint(query)

    # First deduplicate exact chunk IDs without mutating extra scoring keys onto canonical dicts.
    by_chunk_key: dict[tuple[str, str], dict] = {}
    score_lookup: dict[tuple[str, str], float] = dict(vector_scores or {})
    for idx, raw in enumerate(candidates):
        key = (str(raw.get("document_id") or ""), str(raw.get("id") or idx))
        if "vector_score" in raw:
            score_lookup[key] = max(score_lookup.get(key, 0.0), float(raw.get("vector_score") or 0.0))
        existing = by_chunk_key.get(key)
        if existing is None:
            by_chunk_key[key] = raw
        elif len((raw.get("content") or "").strip()) > len((existing.get("content") or "").strip()):
            by_chunk_key[key] = raw

    scored: list[tuple[float, dict]] = []
    seen_fingerprints: set[str] = set()
    for key, item in by_chunk_key.items():
        content = (item.get("content") or "").strip()
        if not content:
            continue
        vec_score = float(score_lookup.get(key, item.get("vector_score") or 0.0))
        lex_score = float(item.get("lexical_score") or _lexical_overlap_score(query, item))
        base = max(vec_score, lex_score * 0.85)
        if vec_score and lex_score:
            base = vec_score * 0.72 + lex_score * 0.48

        # Reject off-topic dense cosine noise when no terms match and similarity is weak.
        if not meta_query and lex_score == 0.0 and base < max(min_score + 0.23, 0.58):
            continue
        if vec_score > 0 and vec_score < min_score and lex_score < 0.25 and not meta_query:
            continue

        score = base
        if len(content) < 90:
            score -= 0.25
        elif len(content) >= 220:
            score += 0.06

        doc_subject = item.get("subject")
        if subject_hint and doc_subject:
            if doc_subject == subject_hint:
                score += 0.12
            elif not subject:
                score -= 0.06

        fingerprint = f"{_normalize_doc_key(item.get('document_name') or '')}::{_strip_accents(content[:160])}"
        if fingerprint in seen_fingerprints:
            continue
        seen_fingerprints.add(fingerprint)
        scored.append((round(score, 4), item))

    scored.sort(key=lambda pair: pair[0], reverse=True)

    # Diversity pass: cap at 3 chunks per normalized document family when alternatives exist.
    selected: list[dict] = []
    overflow: list[dict] = []
    per_doc_counts: dict[str, int] = {}
    for _, item in scored:
        doc_family = _normalize_doc_key(item.get("document_name") or str(item.get("document_id") or ""))
        count = per_doc_counts.get(doc_family, 0)
        if count < 3:
            per_doc_counts[doc_family] = count + 1
            selected.append(item)
        else:
            overflow.append(item)

    if len(selected) < 5 and overflow:
        selected.extend(overflow[: 5 - len(selected)])
    return selected
