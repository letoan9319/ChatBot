"""Bounded retrieval of public Wikipedia introductions."""

import re
from itertools import zip_longest

import httpx


def search_web(question, mode):
    # Only public search terms go upstream. Never include history or document text.
    terms = " ".join(re.findall(r"[^\W_]+", question, re.UNICODE)[:24])
    if not terms:
        return []
    searches = [("vi", terms)]
    if mode == "research":
        topics = [part for part in re.split(r"[,;!?]|\s+và\s+", question) if len(part.split()) >= 2]
        if len(topics) > 1:
            searches.append(("vi", " ".join(re.findall(r"[^\W_]+", topics[-1])[:16])))
        searches.append(("en", terms))

    batches = []
    success = False
    with httpx.Client(timeout=8, headers={"User-Agent": "LearnStep/1.0 (https://github.com/letoan9319/ChatBot)"}) as http:
        for language, query in dict.fromkeys(searches):
            host = f"https://{language}.wikipedia.org"
            try:
                response = http.get(host + "/w/api.php", params={
                    "action": "query", "format": "json", "formatversion": 2,
                    "generator": "search", "gsrsearch": query, "gsrnamespace": 0,
                    "gsrlimit": 4, "prop": "extracts", "exintro": 1, "explaintext": 1,
                    "exchars": 900, "exlimit": "max",
                })
                response.raise_for_status()
                data = response.json()
                if "error" in data:
                    continue
            except (httpx.HTTPError, ValueError):
                continue
            success = True
            batch = []
            for page in sorted(data.get("query", {}).get("pages", []), key=lambda page: page.get("index", 0)):
                page_id, title, content = page.get("pageid"), page.get("title"), page.get("extract", "").strip()
                if not isinstance(page_id, int) or not title or len(content) < 40:
                    continue
                url = f"{host}/?curid={page_id}"
                batch.append({"url": url, "title": title[:180], "content": content[:1000]})
            batches.append(batch)
    if not success:
        raise httpx.RequestError("Public search unavailable")
    sources = {}
    for group in zip_longest(*batches):
        for item in group:
            if item:
                sources.setdefault(item["url"], item)
    return list(sources.values())
