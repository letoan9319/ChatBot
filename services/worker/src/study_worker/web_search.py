"""Retrieve bounded excerpts from web and academic indexes."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from html import unescape
import re
from urllib.parse import quote, urlsplit

import httpx

USER_AGENT = "LearnStep/1.0 (+https://github.com/letoan9319/ChatBot)"


def _plain(value):
    text = unescape(re.sub(r"<[^>]*>", " ", value or ""))
    return " ".join(text.split())


def _source(url, title, content, kind):
    if not url or not title or len(content) < 40:
        return None
    try:
        address = urlsplit(url)
        if address.scheme not in ("http", "https") or not address.hostname or address.username or address.password:
            return None
    except ValueError:
        return None
    return {"url": url, "title": title[:180], "content": content[:2200], "kind": kind}


def _brave(http, terms, key, research):
    result = http.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"X-Subscription-Token": key},
        params={"q": terms, "count": 10 if research else 8,
                "result_filter": "web", "extra_snippets": str(research).lower()},
    )
    result.raise_for_status()
    sources = []
    domains = {}
    for item in result.json().get("web", {}).get("results", []):
        snippets = [item.get("description")]
        if research:
            snippets.extend(item.get("extra_snippets") or [])
        content = " ".join(dict.fromkeys(filter(None, map(_plain, snippets))))
        source = _source(item.get("url"), _plain(item.get("title")), content, "web")
        if source:
            domain = urlsplit(source["url"]).hostname.removeprefix("www.")
            if domains.get(domain, 0) < 2:
                domains[domain] = domains.get(domain, 0) + 1
                sources.append(source)
    return sources


def _crossref(http, terms):
    response = http.get("https://api.crossref.org/works", params={
        "query.bibliographic": terms,
        "filter": "type:journal-article,has-abstract:true",
        "select": "DOI,title,abstract,published",
        "rows": 5,
    })
    response.raise_for_status()
    sources = []
    for item in response.json().get("message", {}).get("items", []):
        titles = item.get("title") or []
        doi = item.get("DOI", "")
        if not titles or not doi.startswith("10."):
            continue
        date = (item.get("published") or {}).get("date-parts") or [[]]
        title = _plain(titles[0])
        if date[0]:
            title += f" ({date[0][0]})"
        abstract = _plain(item.get("abstract"))
        if len(abstract) >= 80:
            sources.append(_source("https://doi.org/" + quote(doi, safe="/"), title, abstract, "article"))
    return [item for item in sources if item]


def _wikipedia(http, terms):
    response = http.get("https://vi.wikipedia.org/w/api.php", params={
        "action": "query", "format": "json", "formatversion": 2,
        "generator": "search", "gsrsearch": terms, "gsrnamespace": 0, "gsrlimit": 4,
        "prop": "extracts", "exintro": 1, "explaintext": 1, "exchars": 900, "exlimit": "max",
    })
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise ValueError("Wikipedia search returned an error")
    sources = []
    for page in sorted(data.get("query", {}).get("pages", []), key=lambda item: item.get("index", 0)):
        page_id = page.get("pageid")
        if isinstance(page_id, int):
            source = _source(f"https://vi.wikipedia.org/?curid={page_id}", _plain(page.get("title")),
                             _plain(page.get("extract")), "wikipedia")
            if source:
                sources.append(source)
    return sources


def search_web(question, mode, brave_key=""):
    # Forward only terms from the current user input, never history or document excerpts.
    terms = " ".join(re.findall(r"[^\W_]+", question, re.UNICODE)[:32])[:350]
    if not terms:
        return [], []
    research = mode == "research"
    web, articles, notices = [], [], []
    with httpx.Client(timeout=8, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as http:
        with ThreadPoolExecutor(max_workers=2) as pool:
            academic = pool.submit(_crossref, http, terms) if research else None
            if brave_key:
                try:
                    web = _brave(http, terms, brave_key, research)
                except (httpx.HTTPError, ValueError):
                    notices.append("Tìm kiếm web đang gián đoạn.")
            else:
                notices.append("Chưa cấu hình tìm kiếm web đa trang.")
            if not web:
                with suppress(httpx.HTTPError, ValueError):
                    web = _wikipedia(http, terms)
                if web:
                    notices.append("Nguồn web dự phòng từ Wikipedia.")
            if academic:
                try:
                    articles = academic.result()
                except (httpx.HTTPError, ValueError):
                    notices.append("Tra cứu bài báo đang gián đoạn.")
                else:
                    if not articles:
                        notices.append("Chưa tìm thấy bài báo có tóm tắt cho truy vấn này.")
    # Give both source types a chance to fit into the prompt before filling with extras.
    sources = web[:2] + articles[:2] + web[2:] + articles[2:]
    unique = {}
    for item in sources:
        unique.setdefault(item["url"], item)
    return list(unique.values()), notices
