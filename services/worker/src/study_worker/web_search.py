"""Retrieve bounded excerpts from web and academic indexes."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from html import unescape
import re
import unicodedata
from urllib.parse import quote, urlsplit

import httpx

USER_AGENT = "LearnStep/1.0 (+https://github.com/letoan9319/ChatBot)"

_LOW_VALUE_DOMAINS = (
    "scribd.com",
    "studocu.com",
    "studocu.vn",
    "123docz.net",
    "tailieu.vn",
    "doc.edu.vn",
    "slideshare.net",
)

_ENCYCLOPEDIC_DOMAINS = (
    "wikipedia.org",
    "britannica.com",
    "scholarpedia.org",
    "wikibooks.org",
    "libretexts.org",
    "khanacademy.org",
    "openstax.org",
    "encyclopedia.com",
    "mathworld.wolfram.com",
)

_VN_CONVERSATIONAL_FILLERS = (
    "hãy giải thích giúp mình",
    "hãy giải thích giúp tôi",
    "hãy giải thích giúp em",
    "giải thích giúp mình",
    "giải thích giúp tôi",
    "giải thích giúp em",
    "giải thích cho mình",
    "giải thích cho tôi",
    "giải thích cho em",
    "giải thích giúp",
    "hãy giải thích về",
    "hãy giải thích",
    "giải thích về",
    "giải thích",
    "cho mình hỏi",
    "cho tôi hỏi",
    "cho em hỏi",
    "cho hỏi",
    "hãy cho mình biết",
    "hãy cho tôi biết",
    "hãy cho em biết",
    "hãy cho biết",
    "cho mình biết",
    "cho tôi biết",
    "cho em biết",
    "cho biết",
    "giúp mình hiểu",
    "giúp tôi hiểu",
    "giúp em hiểu",
    "giúp mình",
    "giúp tôi",
    "giúp em",
    "tìm hiểu về",
    "tìm hiểu",
    "khái niệm về",
    "định nghĩa về",
    "có nghĩa là gì",
    "nghĩa là gì",
    "là như thế nào",
    "như thế nào",
    "là cái gì",
    "là gì",
    "là sao",
    "ra sao",
    "thế nào là",
    "vậy ạ",
)

_VN_SUBJECT_FILLERS = (
    r"vật l[ýí] đại cương(?:\s+(?:[123]|i{1,3}))?",
    r"đại số tuyến tính(?:\s+(?:[12]|i{1,2}))?",
    r"xác suất thống kê",
    r"hóa học đại cương(?:\s+(?:[12]|i{1,2}))?",
    r"hóa đại cương(?:\s+(?:[12]|i{1,2}))?",
    r"tin học đại cương",
    r"giải tích(?:\s+(?:[123]|i{1,3}))?",
)

_WIKIMEDIA_THUMB_RE = re.compile(
    r"https://(?:upload|thumb)\.wikimedia\.org/wikipedia/(?:commons|vi|en)/[\w%./~+(),@&;-]+\.(?:png|jpe?g|webp)",
    re.I,
)
_OPEN_LICENSE_URL_RE = re.compile(
    r"https://creativecommons\.org/(?:licenses/by(?:-sa)?/[0-9.]+(?:/[a-z-]+)?|publicdomain/(?:zero|mark)/1\.0)/?",
    re.I,
)
_PUBLIC_DOMAIN_NAME_RE = re.compile(r"^(?:public\s+domain(?:\s*\(.*\))?|cc0(?:\s+1\.0)?)$", re.I)
_GENERIC_IMAGE_TOKENS = frozenset({
    "icon", "icons", "logo", "logos", "flag", "flags", "stub", "stubs",
    "disambig", "disambiguation", "ambox", "padlock", "favicon",
    "wikimedia", "wikipedia", "wikibooks", "wikiversity", "wiktionary", "wikidata",
    "nuvola", "badge", "emblem", "placeholder", "portal",
})
_GENERIC_IMAGE_PHRASES = (
    "commons logo", "question book", "edit clear", "crystal clear",
    "semi protection", "coat of arms", "flag of", "symbol support",
    "symbol question", "merge arrows", "split arrows",
)
_IMAGE_STOPWORDS = frozenset({
    "diagram", "image", "illustration", "picture", "photo", "figure", "graph",
    "hình", "ảnh", "minh", "họa", "là", "gì", "của", "và", "về", "trong", "cho",
    "một", "các", "cách", "khái", "niệm", "định", "nghĩa", "giải", "thích",
    "mô", "phỏng", "vẽ", "the", "and", "for", "with", "what", "is", "of", "in", "on", "to", "a", "an",
})


def _plain(value):
    text = unescape(re.sub(r"<[^>]*>", " ", value or ""))
    return " ".join(text.split())


def _source(url, title, content, kind, provider=None):
    if not url or not title or len(content) < 40:
        return None
    try:
        address = urlsplit(url)
        if address.scheme not in ("http", "https") or not address.hostname or address.username or address.password:
            return None
    except ValueError:
        return None
    item = {"url": url, "title": title[:180], "content": content[:2200], "kind": kind}
    if provider:
        item["provider"] = provider
    return item


def _matches_domain(host, domain):
    return host == domain or host.endswith("." + domain)


def _searxng_rank(source):
    host = (urlsplit(source["url"]).hostname or "").removeprefix("www.").casefold()
    # Check upload stubs first because domains like doc.edu.vn also match .edu.vn.
    if any(_matches_domain(host, domain) for domain in _LOW_VALUE_DOMAINS):
        tier = 2
    elif (
        any(_matches_domain(host, domain) for domain in _ENCYCLOPEDIC_DOMAINS)
        or re.search(r"\.(?:edu|gov)(?:\.[a-z]{2,})?$", host)
        or re.search(r"\.ac\.[a-z]{2,}$", host)
    ):
        tier = 0
    else:
        tier = 1
    substantive = 0 if len(source["content"]) >= 120 else 1
    return (tier, substantive)


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
        domain = (urlsplit(source["url"]).hostname or "").removeprefix("www.").casefold()
        if domains.get(domain, 0) >= 2:
            continue
        domains[domain] = domains.get(domain, 0) + 1
        sources.append(source)
    sources.sort(key=_searxng_rank)
    return sources[:limit]


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
            sources.append(_source("https://doi.org/" + quote(doi, safe="/"), title, abstract, "article", "Crossref"))
    return [item for item in sources if item]


def _reconstruct_openalex_abstract(inverted):
    if not isinstance(inverted, dict) or not inverted:
        return ""
    tokens = {}
    for word, positions in inverted.items():
        if not isinstance(word, str) or not isinstance(positions, list):
            continue
        for pos in positions:
            if isinstance(pos, int) and not isinstance(pos, bool) and 0 <= pos <= 2000:
                tokens[pos] = word
    return " ".join(tokens[pos] for pos in sorted(tokens)) if tokens else ""


def _resolve_openalex_url(work):
    doi = work.get("doi")
    if isinstance(doi, str) and doi.startswith("https://doi.org/"):
        return doi
    primary = work.get("primary_location")
    if isinstance(primary, dict):
        landing = primary.get("landing_page_url")
        if isinstance(landing, str) and landing.startswith("https://"):
            return landing
    work_id = work.get("id")
    if isinstance(work_id, str) and work_id.startswith("https://openalex.org/"):
        return work_id
    return None


def _openalex(http, terms):
    response = http.get("https://api.openalex.org/works", params={
        "search": terms,
        "per-page": 4,
        "select": "id,display_name,doi,primary_location,abstract_inverted_index,publication_year",
    })
    response.raise_for_status()
    sources = []
    for work in response.json().get("results", []):
        if not isinstance(work, dict):
            continue
        title = _plain(work.get("display_name"))
        year = work.get("publication_year")
        if title and isinstance(year, int) and not isinstance(year, bool):
            title += f" ({year})"
        abstract = _reconstruct_openalex_abstract(work.get("abstract_inverted_index"))
        url = _resolve_openalex_url(work)
        if url and len(abstract) >= 80:
            source = _source(url, title, abstract, "article", "OpenAlex")
            if source:
                sources.append(source)
    return sources


def _is_generic_image_title(raw_title):
    name = _plain(raw_title).removeprefix("File:")
    stem = name.rsplit(".", 1)[0]
    normalized = re.sub(r"[\W_]+", " ", stem.casefold()).strip()
    if not normalized:
        return True
    tokens = set(normalized.split())
    if tokens & _GENERIC_IMAGE_TOKENS:
        return True
    return any(phrase in normalized for phrase in _GENERIC_IMAGE_PHRASES)


def _normalize_license(license_name, license_url):
    name = _plain(license_name)
    url = (license_url or "").strip()
    if url.startswith("http://creativecommons.org/"):
        url = "https://" + url.removeprefix("http://")
    if url:
        if name and _OPEN_LICENSE_URL_RE.fullmatch(url):
            return name, url
        return None, None
    if name and _PUBLIC_DOMAIN_NAME_RE.fullmatch(name):
        canonical = (
            "https://creativecommons.org/publicdomain/zero/1.0/"
            if name.casefold().startswith("cc0")
            else "https://creativecommons.org/publicdomain/mark/1.0/"
        )
        return name, canonical
    return None, None


def _valid_http_url(url):
    if not url:
        return False
    try:
        address = urlsplit(url)
    except ValueError:
        return False
    return (
        address.scheme in ("http", "https")
        and bool(address.hostname)
        and not address.username
        and not address.password
    )


def _wikipedia_query(http, terms, *, host="https://vi.wikipedia.org"):
    response = http.get(host + "/w/api.php", params={
        "action": "query", "format": "json", "formatversion": 2,
        "generator": "search", "gsrsearch": terms, "gsrnamespace": 0, "gsrlimit": 4,
        "prop": "extracts|pageimages|langlinks",
        "exintro": 1, "explaintext": 1, "exchars": 900, "exlimit": "max",
        "piprop": "name", "lllang": "en", "lllimit": "max",
    })
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise ValueError("Wikipedia search returned an error")
    sources = []
    page_images = []
    en_titles = []
    seen_files = set()
    seen_en = set()
    for page in sorted(data.get("query", {}).get("pages", []), key=lambda item: item.get("index", 0)):
        page_id = page.get("pageid")
        title = _plain(page.get("title"))
        if isinstance(page_id, int):
            source = _source(f"{host}/?curid={page_id}", title,
                             _plain(page.get("extract")), "wikipedia", "Wikipedia")
            if source:
                sources.append(source)
        page_image = _plain(page.get("pageimage"))
        if page_image:
            file_title = page_image if page_image.startswith("File:") else f"File:{page_image}"
            key = file_title.casefold()
            if key not in seen_files and not _is_generic_image_title(file_title):
                seen_files.add(key)
                page_images.append(file_title)
        for link in page.get("langlinks") or []:
            if not isinstance(link, dict) or link.get("lang") != "en":
                continue
            en_title = _plain(link.get("title") or link.get("*"))
            if en_title and en_title.casefold() not in seen_en:
                seen_en.add(en_title.casefold())
                en_titles.append(en_title)
        if host == "https://en.wikipedia.org" and title and title.casefold() not in seen_en:
            seen_en.add(title.casefold())
            en_titles.append(title)
    return sources, page_images, en_titles


def _wikipedia(http, terms, *, host="https://vi.wikipedia.org"):
    sources, _, _ = _wikipedia_query(http, terms, host=host)
    return sources


def _wikipedia_pageimages_by_titles(http, titles, *, host="https://en.wikipedia.org"):
    cleaned = [title for title in dict.fromkeys(_plain(t) for t in titles if t) if title][:3]
    if not cleaned:
        return []
    response = http.get(host + "/w/api.php", params={
        "action": "query", "format": "json", "formatversion": 2,
        "titles": "|".join(cleaned), "redirects": 1,
        "prop": "pageimages", "piprop": "name",
    }, timeout=4)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        return []
    files = []
    seen = set()
    for page in data.get("query", {}).get("pages", []):
        name = _plain(page.get("pageimage"))
        if not name:
            continue
        file_title = name if name.startswith("File:") else f"File:{name}"
        key = file_title.casefold()
        if key not in seen and not _is_generic_image_title(file_title):
            seen.add(key)
            files.append(file_title)
    return files


def _query_terms(text):
    return " ".join(re.findall(r"[^\W_]+", text, re.UNICODE)[:32])[:350]


def _core_keyword_count(text):
    return len(re.findall(r"[^\W_]+", text, re.UNICODE))


def _strip_phrase(text, pattern):
    updated = re.sub(rf"(?<!\w)(?:{pattern})(?!\w)[\s?!.,;:-]*", " ", text, flags=re.I)
    return " ".join(updated.strip(" ?!.,;:-").split())


def _strip_vn_question_filler(text):
    current = " ".join(unicodedata.normalize("NFC", text or "").strip(" ?!.,;:-").split())
    if not current:
        return ""
    for phrase in _VN_CONVERSATIONAL_FILLERS:
        candidate = _strip_phrase(current, re.escape(phrase))
        if candidate != current and _core_keyword_count(candidate) >= 2:
            current = candidate
    for pattern in _VN_SUBJECT_FILLERS:
        candidate = _strip_phrase(current, pattern)
        if candidate != current and _core_keyword_count(candidate) >= 2:
            current = candidate
    return current


def _clean_image_terms(text):
    cleaned = (text or "").strip()
    cleaned = re.sub(
        r"^(?:hãy |vui lòng |giúp (?:mình|tôi) )?"
        r"(?:giải thích|cho (?:mình|tôi) (?:biết|xem)|tìm hiểu|minh họa|vẽ|mô phỏng|trình bày|what is|explain)\s+"
        r"(?:(?:giúp )?(?:mình|tôi) )?"
        r"(?:(?:bằng )?(?:hình minh họa|hình ảnh|sơ đồ|đồ thị|biểu đồ)\s+)?"
        r"(?:(?:khái niệm|định nghĩa|nguyên lý|hiện tượng) )?(?:về |của )?",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(
        r"\s+(?:là gì|nghĩa là gì|được phát biểu (?:như )?thế nào|(?:như )?thế nào|"
        r"bằng hình(?: minh họa| ảnh)?|có hình minh họa)\s*[?.!]*$",
        "",
        cleaned,
        flags=re.I,
    )
    return _query_terms(cleaned)


def _commons_image_item(page, *, require_keywords=None):
    if not isinstance(page, dict) or page.get("missing"):
        return None
    info = next(iter(page.get("imageinfo", [])), {})
    if not isinstance(info, dict):
        return None
    width = info.get("width") if isinstance(info.get("width"), int) else info.get("thumbwidth")
    height = info.get("height") if isinstance(info.get("height"), int) else info.get("thumbheight")
    if (isinstance(width, int) and width < 120) or (isinstance(height, int) and height < 120):
        return None
    raw_title = _plain(page.get("title"))
    if _is_generic_image_title(raw_title):
        return None
    title = raw_title.removeprefix("File:").rsplit(".", 1)[0]
    if require_keywords is not None:
        title_words = set(_query_terms(title).casefold().split())
        if require_keywords and not (require_keywords & title_words):
            return None
        if (title_words & {"background", "wallpaper", "texture"}) - require_keywords:
            return None
    metadata = info.get("extmetadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
    creator = _plain((metadata.get("Artist") or {}).get("value"))
    license_name, license_url = _normalize_license(
        (metadata.get("LicenseShortName") or {}).get("value"),
        (metadata.get("LicenseUrl") or {}).get("value", ""),
    )
    if not (license_name and license_url):
        return None
    if not creator:
        if _PUBLIC_DOMAIN_NAME_RE.fullmatch(license_name):
            creator = "Wikimedia Commons"
        else:
            return None
    thumbnail = (info.get("thumburl") or info.get("url") or "").partition("?")[0]
    page_id = page.get("pageid")
    if not (title and isinstance(page_id, int) and page_id > 0):
        return None
    if not _WIKIMEDIA_THUMB_RE.fullmatch(thumbnail):
        return None
    return {
        "kind": "image",
        "label": "I1",
        "title": title[:180],
        "url": f"https://commons.wikimedia.org/?curid={page_id}",
        "thumbnail": thumbnail,
        "creator": creator[:250],
        "license_name": license_name[:50],
        "license_url": license_url,
    }


def _merge_images(*groups, limit=2):
    merged = []
    seen_urls = set()
    seen_thumbs = set()
    for group in groups:
        for item in group or ():
            url = item.get("url")
            thumb = item.get("thumbnail")
            if not url or not thumb or url in seen_urls or thumb in seen_thumbs:
                continue
            seen_urls.add(url)
            seen_thumbs.add(thumb)
            merged.append({**item, "label": f"I{len(merged) + 1}"})
            if len(merged) == limit:
                return merged
    return merged


def _resolve_commons_files(http, file_titles):
    normalized = []
    seen = set()
    for raw in file_titles or ():
        cleaned = _plain(raw)
        if not cleaned:
            continue
        title = cleaned if cleaned.startswith("File:") else f"File:{cleaned}"
        key = title.casefold()
        if key in seen or _is_generic_image_title(title):
            continue
        seen.add(key)
        normalized.append(title)
        if len(normalized) == 8:
            break
    if not normalized:
        return []
    result = http.get("https://commons.wikimedia.org/w/api.php", params={
        "action": "query", "format": "json", "formatversion": 2,
        "titles": "|".join(normalized), "redirects": 1,
        "prop": "imageinfo", "iiprop": "url|extmetadata|dimensions", "iiurlwidth": 640,
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl",
    }, timeout=4)
    result.raise_for_status()
    data = result.json()
    order = {title.replace("_", " ").casefold(): idx for idx, title in enumerate(normalized)}
    pages = data.get("query", {}).get("pages", [])
    pages = sorted(
        pages,
        key=lambda item: order.get(_plain(item.get("title")).replace("_", " ").casefold(), len(order)),
    )
    images = []
    for page in pages:
        item = _commons_image_item(page, require_keywords=None)
        if item:
            images.append(item)
    return _merge_images(images, limit=2)


def _commons_images(http, terms, *, extra_queries=()):
    queries = []
    seen_queries = set()
    for candidate in (*extra_queries, terms):
        cleaned = _query_terms(candidate or "")
        key = cleaned.casefold()
        if cleaned and key not in seen_queries:
            seen_queries.add(key)
            queries.append(cleaned)
    images = []
    for query in queries:
        result = http.get("https://commons.wikimedia.org/w/api.php", params={
            "action": "query", "format": "json", "formatversion": 2,
            "generator": "search", "gsrsearch": query, "gsrnamespace": 6, "gsrlimit": 8,
            "prop": "imageinfo", "iiprop": "url|extmetadata|dimensions", "iiurlwidth": 640,
            "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl",
        }, timeout=5)
        result.raise_for_status()
        keywords = set(query.casefold().split()) - _IMAGE_STOPWORDS
        found = []
        for page in sorted(result.json().get("query", {}).get("pages", []), key=lambda item: item.get("index", 0)):
            item = _commons_image_item(page, require_keywords=keywords)
            if item:
                found.append(item)
        images = _merge_images(images, found, limit=2)
        if len(images) == 2:
            break
    return images


def _is_same_origin_proxy(thumbnail, base_url):
    if not thumbnail or not base_url:
        return None
    base = base_url.rstrip("/")
    if thumbnail.startswith("/image_proxy"):
        return base + thumbnail
    try:
        base_parts = urlsplit(base)
        thumb_parts = urlsplit(thumbnail)
    except ValueError:
        return None
    if (
        thumb_parts.scheme == base_parts.scheme
        and thumb_parts.hostname == base_parts.hostname
        and thumb_parts.port == base_parts.port
        and not thumb_parts.username
        and not thumb_parts.password
        and thumb_parts.path.startswith("/image_proxy")
    ):
        return thumbnail
    return None


def _searxng_images(http, base_url, terms):
    if not base_url or not terms:
        return []
    base = base_url.rstrip("/")
    result = http.get(base + "/search", params={
        "q": terms, "format": "json", "categories": "images", "safesearch": 1,
    }, timeout=4)
    result.raise_for_status()
    images = []
    for item in result.json().get("results", []):
        if not isinstance(item, dict):
            continue
        title = _plain(item.get("title"))
        page_url = (item.get("url") or "").strip()
        if not title or _is_generic_image_title(title) or not _valid_http_url(page_url):
            continue
        resolution = str(item.get("resolution") or "")
        dim_match = re.match(r"^\s*(\d+)\s*[x×]\s*(\d+)\s*$", resolution, re.I)
        if dim_match and (int(dim_match.group(1)) < 120 or int(dim_match.group(2)) < 120):
            continue
        raw_thumb = (item.get("thumbnail_src") or item.get("img_src") or "").strip()
        proxy_thumb = _is_same_origin_proxy(raw_thumb, base)
        if proxy_thumb:
            license_name, license_url = _normalize_license(
                item.get("license") or item.get("license_name"),
                item.get("license_url") or "",
            )
            creator = _plain(item.get("author") or item.get("source") or urlsplit(page_url).hostname)
            images.append({
                "kind": "image",
                "label": "I1",
                "title": title[:180],
                "url": page_url,
                "thumbnail": proxy_thumb,
                "creator": (creator or "SearXNG")[:250],
                "license_name": (license_name or "Nguồn web")[:50],
                "license_url": license_url or page_url,
            })
            continue
        clean_thumb = raw_thumb.partition("?")[0]
        if not _WIKIMEDIA_THUMB_RE.fullmatch(clean_thumb):
            continue
        license_name, license_url = _normalize_license(
            item.get("license") or item.get("license_name"),
            item.get("license_url") or "",
        )
        if not (license_name and license_url):
            continue
        creator = _plain(item.get("author") or item.get("source"))
        if not creator:
            if _PUBLIC_DOMAIN_NAME_RE.fullmatch(license_name):
                creator = "Wikimedia Commons"
            else:
                continue
        images.append({
            "kind": "image",
            "label": "I1",
            "title": title[:180],
            "url": page_url,
            "thumbnail": clean_thumb,
            "creator": creator[:250],
            "license_name": license_name[:50],
            "license_url": license_url,
        })
    return _merge_images(images, limit=2)


def _collect_illustrations(
    http, image_terms, *, searxng_url="", pageimages=(), en_titles=(), lookup_wiki=True, subject_label="",
):
    files = list(pageimages)
    titles = list(en_titles)
    if lookup_wiki:
        with suppress(httpx.HTTPError, ValueError):
            _, vi_files, vi_en = _wikipedia_query(http, image_terms)
            files.extend(vi_files)
            titles.extend(vi_en)
        if not files and not titles and subject_label:
            with suppress(httpx.HTTPError, ValueError):
                _, subj_files, subj_en = _wikipedia_query(http, f"{image_terms} {subject_label}")
                files.extend(subj_files)
                titles.extend(subj_en)
        if not files and not titles:
            with suppress(httpx.HTTPError, ValueError):
                _, en_files, en_found = _wikipedia_query(http, image_terms, host="https://en.wikipedia.org")
                files.extend(en_files)
                titles.extend(en_found)
    if titles and len(files) < 2:
        with suppress(httpx.HTTPError, ValueError):
            files.extend(_wikipedia_pageimages_by_titles(http, titles, host="https://en.wikipedia.org"))
    images = []
    if files:
        with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
            images = _merge_images(images, _resolve_commons_files(http, files), limit=2)
    if len(images) < 2:
        with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
            images = _merge_images(images, _commons_images(http, image_terms, extra_queries=titles), limit=2)
    if len(images) < 2 and searxng_url:
        sx_terms = titles[0] if titles else image_terms
        with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
            images = _merge_images(images, _searxng_images(http, searxng_url, sx_terms), limit=2)
    return images


def search_illustrations(question, searxng_url="", *, subject_label=""):
    image_terms = _clean_image_terms(question)
    if not image_terms:
        return []
    with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
        with httpx.Client(timeout=4, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as http:
            return _collect_illustrations(
                http, image_terms, searxng_url=searxng_url, lookup_wiki=True, subject_label=subject_label,
            )
    return []


def search_web(question, mode, searxng_url="", *, image_question=""):
    # Keep an explicit topic before ":" separate from instructions about the report.
    topic, separator, _ = question.partition(":")
    focused = _query_terms(topic) if separator and mode == "research" else ""
    terms = focused or _query_terms(question)
    if not terms:
        return [], []
    research = mode == "research"
    web, articles, images, notices = [], [], [], []
    image_terms = _clean_image_terms(image_question) if image_question else ""
    wiki_pageimages, wiki_en_titles = [], []
    with httpx.Client(timeout=8, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as http:
        with ThreadPoolExecutor(max_workers=2) as pool:
            academic = pool.submit(_crossref, http, terms) if research else None
            illustrations = (
                pool.submit(_collect_illustrations, http, image_terms, searxng_url=searxng_url, lookup_wiki=True)
                if (image_terms and searxng_url)
                else None
            )
            if searxng_url:
                try:
                    web = _searxng(http, searxng_url, terms, research)
                except (httpx.HTTPError, ValueError):
                    notices.append("Tìm kiếm web đang gián đoạn.")
            else:
                notices.append("Chưa cấu hình tìm kiếm web đa trang.")
            if not web:
                wiki_failed = False
                try:
                    web, wiki_pageimages, wiki_en_titles = _wikipedia_query(http, terms)
                except (httpx.HTTPError, ValueError):
                    wiki_failed = True
                if not web and not wiki_failed and len(terms.split()) >= 3 and focused != terms:
                    stripped = _strip_vn_question_filler(terms)
                    if stripped and stripped != terms:
                        with suppress(httpx.HTTPError, ValueError):
                            web = _wikipedia(http, stripped)
                if wiki_failed:
                    with suppress(httpx.HTTPError, ValueError):
                        web, wiki_pageimages, wiki_en_titles = _wikipedia_query(
                            http, terms, host="https://en.wikipedia.org"
                        )
                if web:
                    notices.append("Nguồn web dự phòng từ Wikipedia.")
            if academic:
                academic_failed = False
                try:
                    articles = academic.result()
                except (httpx.HTTPError, ValueError):
                    academic_failed = True
                if not articles:
                    with suppress(httpx.HTTPError, ValueError):
                        articles = _openalex(http, terms)
                if academic_failed and not articles:
                    notices.append("Tra cứu bài báo đang gián đoạn.")
                elif not articles:
                    notices.append("Chưa tìm thấy bài báo có tóm tắt cho truy vấn này.")
            if illustrations is not None:
                with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
                    images = illustrations.result()
            elif image_terms:
                with suppress(httpx.HTTPError, ValueError, TypeError, AttributeError):
                    images = _collect_illustrations(
                        http,
                        image_terms,
                        searxng_url=searxng_url,
                        pageimages=wiki_pageimages,
                        en_titles=wiki_en_titles,
                        lookup_wiki=False,
                    )
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
