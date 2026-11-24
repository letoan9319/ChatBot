import httpx

from study_worker import web_search
from study_worker.rag import build_prompt, validate_citations


def test_research_combines_web_snippets_and_article_abstracts(monkeypatch):
    requests = []
    snippet = "A long excerpt from a university web page describing the research topic."

    def respond(request):
        requests.append(request)
        if request.url.host == "127.0.0.1":
            return httpx.Response(200, json={"results": [
                {"url": "https://university.edu/page", "title": "University overview",
                 "content": "<b>" + snippet + "</b> More details."},
                {"url": "javascript:alert(1)", "title": "Unsafe link", "content": snippet},
            ]})
        assert request.url.host == "api.crossref.org"
        return httpx.Response(200, json={"message": {"items": [{
            "DOI": "10.1234/example(1)", "title": ["Article title"],
            "abstract": "<jats:p>" + snippet + " An independent journal abstract.</jats:p>",
        }]}})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, notices = web_search.search_web("Newton's laws", "research", "http://127.0.0.1:8888")
    assert not notices
    assert [source["kind"] for source in sources] == ["web", "article"]
    assert sources[0]["content"].count(snippet) == 1
    assert sources[1]["url"] == "https://doi.org/10.1234/example%281%29"
    by_host = {request.url.host: request for request in requests}
    assert by_host["127.0.0.1"].url.path == "/search"
    assert by_host["127.0.0.1"].url.params["format"] == "json"
    assert by_host["api.crossref.org"].url.params["query.bibliographic"] == "Newton s laws"
    prompt, selected = build_prompt("Newton", [], sources, lambda value: len(value.split()), "research")
    assert "tổng hợp chi tiết" in prompt[0]["content"]
    assert '"kind": "article"' in prompt[0]["content"]
    assert validate_citations("Bằng chứng [S2].", selected)[1] == [selected[1]]


def test_basic_search_without_endpoint_uses_disclosed_wikipedia_fallback(monkeypatch):
    def respond(request):
        assert request.url.host == "vi.wikipedia.org"
        return httpx.Response(200, json={"query": {"pages": [{
            "pageid": 123, "title": "Overview", "extract": "A public encyclopedia description long enough for retrieval.",
        }]}})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, notices = web_search.search_web("Newton", "search")
    assert [source["kind"] for source in sources] == ["wikipedia"]
    assert "Nguồn web dự phòng từ Wikipedia." in notices


def test_research_uses_explicit_topic_and_discards_irrelevant_papers(monkeypatch):
    def respond(request):
        if request.url.host == "vi.wikipedia.org":
            return httpx.Response(200, json={})
        assert request.url.params["query.bibliographic"] == "Physics informed neural networks"
        abstract = " ".join(["Long abstract."] * 12)
        return httpx.Response(200, json={"message": {"items": [
            {"DOI": "10.1234/off-topic", "title": ["Kết quả thực nghiệm của doanh nghiệp"], "abstract": abstract},
            {"DOI": "10.1234/pinn", "title": ["Physics-informed neural networks"], "abstract": abstract},
        ]}})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, _ = web_search.search_web(
        "Physics-informed neural networks: cơ chế hoạt động, kết quả thực nghiệm và giới hạn", "research",
    )
    assert [source["url"] for source in sources] == ["https://doi.org/10.1234/pinn"]


def test_search_images_keep_attribution_and_reject_external_thumbnails(monkeypatch):
    def respond(request):
        if request.url.host == "vi.wikipedia.org":
            return httpx.Response(200, json={})
        assert request.url.host == "commons.wikimedia.org"
        assert request.url.params["gsrsearch"] == "gradient"
        metadata = {
            "Artist": {"value": "<b>Example author</b>"},
            "LicenseShortName": {"value": "CC BY-SA 4.0"},
            "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0/"},
        }
        return httpx.Response(200, json={"query": {"pages": [
            {"pageid": 1, "title": "File:Gradient.svg", "imageinfo": [
                {"thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Gradient.svg/500px-Gradient.svg.png?utm_source=example",
                 "extmetadata": metadata},
            ]},
            {"pageid": 2, "title": "File:Gradient.png", "imageinfo": [
                {"thumburl": "https://example.net/image.png", "extmetadata": metadata},
            ]},
        ]}})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, _ = web_search.search_web("gradient Giải tích", "search", image_question="Giải thích giúp mình khái niệm về gradient")
    assert len(sources) == 1
    assert sources[0]["creator"] == "Example author"
    assert sources[0]["kind"] == "image"
    assert "?" not in sources[0]["thumbnail"]

    prompt, _ = build_prompt("Gradient là gì?", [], [], len, "search", reasoning=True)
    assert "nhãn trích dẫn đã được cấp" in prompt[-1]["content"]
