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


def _searxng(http, base_url, terms, research):
    result = http.get(base_url + "/search", params={
        "q": terms, "format": "json", "categories": "general", "safesearch": 1,
    })
    result.raise_for_status()
    sources = []
    domains = {}
    limit = 10 if research else 8
    for item in result.json().get("results", []):
        source = _source(item.get("url"), _plain(item.get("title")), _plain(item.get("content")), "web")
        if not source:
            continue
        domain = urlsplit(source["url"]).hostname.removeprefix("www.")
        if domains.get(domain, 0) >= 2:
            continue
        domains[domain] = domains.get(domain, 0) + 1
        sources.append(source)
        if len(sources) == limit:
            break
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


def _query_terms(text):
    return " ".join(re.findall(r"[^\W_]+", text, re.UNICODE)[:32])[:350]


def _commons_images(http, terms):
    result = http.get("https://commons.wikimedia.org/w/api.php", params={
        "action": "query", "format": "json", "formatversion": 2,
        "generator": "search", "gsrsearch": terms, "gsrnamespace": 6, "gsrlimit": 8,
        "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 480,
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl",
    }, timeout=5)
    result.raise_for_status()
    images = []
    keywords = set(terms.casefold().split()) - {"diagram", "image", "illustration", "hình", "ảnh", "minh", "họa", "là", "gì"}
    for page in sorted(result.json().get("query", {}).get("pages", []), key=lambda item: item.get("index", 0)):
        info = next(iter(page.get("imageinfo", [])), {})
        metadata = info.get("extmetadata", {})
        title = _plain(page.get("title")).removeprefix("File:").rsplit(".", 1)[0]
        title_words = set(_query_terms(title).casefold().split())
        if keywords and not (keywords & title_words):
            continue
        if (title_words & {"background", "wallpaper", "texture"}) - keywords:
            continue
        creator = _plain(metadata.get("Artist", {}).get("value"))
        license_name = _plain(metadata.get("LicenseShortName", {}).get("value"))
        license_url = metadata.get("LicenseUrl", {}).get("value", "")
        if license_url.startswith("http://creativecommons.org/"):
            license_url = "https://" + license_url.removeprefix("http://")
        thumbnail = info.get("thumburl", "").partition("?")[0]
        page_id = page.get("pageid")
        if not (title and creator and license_name and isinstance(page_id, int) and page_id > 0):
            continue
        if not re.fullmatch(r"https://creativecommons\.org/(?:licenses/by(?:-sa)?/[0-9.]+(?:/[a-z-]+)?|publicdomain/(?:zero|mark)/1\.0)/?", license_url):
            continue
        if not re.fullmatch(r"https://(?:upload|thumb)\.wikimedia\.org/wikipedia/commons/[\w%./~+(),@&;-]+\.(?:png|jpe?g|webp)", thumbnail, re.I):
            continue
        images.append({
            "kind": "image", "label": f"I{len(images) + 1}", "title": title[:180],
            "url": f"https://commons.wikimedia.org/?curid={page_id}",
            "thumbnail": thumbnail, "creator": creator[:250],
            "license_name": license_name[:50], "license_url": license_url,
        })
        if len(images) == 2:
            break
    return images


def search_web(question, mode, searxng_url="", *, image_question=""):
    # Keep an explicit topic before ":" separate from instructions about the report.
    topic, separator, _ = question.partition(":")
    focused = _query_terms(topic) if separator and mode == "research" else ""
    terms = focused or _query_terms(question)
    if not terms:
        return [], []
    research = mode == "research"
    web, articles, images, notices = [], [], [], []
    with httpx.Client(timeout=8, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as http:
        with ThreadPoolExecutor(max_workers=2) as pool:
            academic = pool.submit(_crossref, http, terms) if research else None
            image_terms = _query_terms(re.sub(
                r"^(?:hãy )?(?:giải thích|cho (?:mình|tôi) biết|tìm hiểu) "
                r"(?:(?:giúp )?(?:mình|tôi) )?(?:(?:khái niệm )?về )?",
                "", image_question.strip(), flags=re.I,
            ))
            illustrations = pool.submit(_commons_images, http, image_terms) if image_terms else None
            if searxng_url:
                try:
                    web = _searxng(http, searxng_url, terms, research)
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
            if illustrations:
                with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
                    images = illustrations.result()
    if focused and articles:
        keywords = {word for word in focused.casefold().split() if len(word) >= 3}
        if len(keywords) >= 3:
            articles = [
                source for source in articles
                if len(keywords & set(_query_terms(source["title"]).casefold().split())) >= 2
            ]
        if not articles:
            notices.append("Chưa tìm thấy bài báo có tiêu đề sát chủ đề.")
    # Give both source types a chance to fit into the prompt before filling with extras.
    sources = web[:2] + articles[:2] + web[2:] + articles[2:]
    unique = {}
    for item in sources:
        unique.setdefault(item["url"], item)
    return list(unique.values()) + images, notices
