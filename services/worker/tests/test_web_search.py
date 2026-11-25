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


def test_searxng_prioritizes_educational_domains_and_substantive_snippets(monkeypatch):
    long_stub = (
        "Tai lieu hoc tap tom tat kien thuc dai cuong day du va chi tiet cho sinh vien nam nhat "
        "cung voi cac vi du minh hoa va dinh nghia chuan xac."
    )
    substantive_general = (
        "Bai viet phan tich chi tiet khai niem thu nguyen trong vat ly co dien, cach kiem tra "
        "thu nguyen phuong trinh va moi lien he voi he don vi SI quoc te."
    )
    short_general = "Tom tat ngan gon ve thu nguyen trong vat ly."

    def respond(request):
        assert request.url.host == "127.0.0.1"
        return httpx.Response(200, json={"results": [
            {"url": "https://www.scribd.com/doc/1", "title": "Scribd 1", "content": long_stub},
            {"url": "https://www.scribd.com/doc/2", "title": "Scribd 2", "content": long_stub},
            {"url": "https://www.scribd.com/doc/3", "title": "Scribd 3", "content": long_stub},
            {"url": "https://www.studocu.com/vn/doc/1", "title": "Studocu 1", "content": long_stub},
            {"url": "https://studocu.vn/doc/2", "title": "Studocu VN", "content": long_stub},
            {"url": "https://123docz.net/doc/1", "title": "123docz", "content": long_stub},
            {"url": "https://tailieu.vn/doc/1", "title": "Tailieu", "content": long_stub},
            {"url": "https://doc.edu.vn/tai-lieu/1", "title": "Doc edu vn", "content": long_stub},
            {"url": "https://www.slideshare.net/doc/1", "title": "Slideshare", "content": long_stub},
            {"url": "https://example.org/short", "title": "General short", "content": short_general},
            {"url": "https://example.org/long", "title": "General substantive", "content": substantive_general},
            {"url": "https://vi.wikipedia.org/wiki/Thu_nguyen", "title": "Wiki 1", "content": long_stub},
            {"url": "https://vi.wikipedia.org/wiki/Phan_tich_thu_nguyen", "title": "Wiki 2", "content": long_stub},
            {"url": "https://vi.wikipedia.org/wiki/He_SI", "title": "Wiki 3", "content": long_stub},
            {"url": "https://phys.hcmus.edu.vn/thu-nguyen", "title": "HCMUS", "content": long_stub},
            {"url": "https://ocw.mit.edu/physics", "title": "MIT", "content": long_stub},
            {"url": "https://ox.ac.uk/physics", "title": "Oxford", "content": long_stub},
            {"url": "https://nist.gov/pml/si", "title": "NIST", "content": long_stub},
        ]})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, notices = web_search.search_web("thứ nguyên là gì Vật lý đại cương", "search", "http://127.0.0.1:8888")
    assert not notices
    urls = [source["url"] for source in sources]
    assert len(urls) == 8
    assert urls[:6] == [
        "https://vi.wikipedia.org/wiki/Thu_nguyen",
        "https://vi.wikipedia.org/wiki/Phan_tich_thu_nguyen",
        "https://phys.hcmus.edu.vn/thu-nguyen",
        "https://ocw.mit.edu/physics",
        "https://ox.ac.uk/physics",
        "https://nist.gov/pml/si",
    ]
    # Substantive general domain ranks ahead of short general snippet and upload stubs.
    assert urls[6:] == [
        "https://example.org/long",
        "https://example.org/short",
    ]
    assert "https://vi.wikipedia.org/wiki/He_SI" not in urls
    assert all("scribd.com" not in url and "studocu" not in url and "doc.edu.vn" not in url for url in urls)


def test_searxng_keeps_per_domain_cap_and_pushes_upload_stubs_last(monkeypatch):
    long_stub = "Tai lieu tham khao mon hoc dai cuong voi vi du minh hoa va bai tap co loi giai."

    def respond(request):
        return httpx.Response(200, json={"results": [
            {"url": "https://www.scribd.com/doc/1", "title": "Scribd 1", "content": long_stub},
            {"url": "https://www.scribd.com/doc/2", "title": "Scribd 2", "content": long_stub},
            {"url": "https://www.scribd.com/doc/3", "title": "Scribd 3", "content": long_stub},
            {"url": "https://doc.edu.vn/tai-lieu/1", "title": "Doc edu vn", "content": long_stub},
            {"url": "https://example.org/overview", "title": "General", "content": long_stub},
            {"url": "https://en.wikipedia.org/wiki/Dimensional_analysis", "title": "Wiki", "content": long_stub},
        ]})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, _ = web_search.search_web("thứ nguyên", "search", "http://127.0.0.1:8888")
    urls = [source["url"] for source in sources]
    assert urls == [
        "https://en.wikipedia.org/wiki/Dimensional_analysis",
        "https://example.org/overview",
        "https://www.scribd.com/doc/1",
        "https://www.scribd.com/doc/2",
        "https://doc.edu.vn/tai-lieu/1",
    ]


def test_strip_vn_question_filler():
    assert web_search._strip_vn_question_filler("thứ nguyên là gì Vật lý đại cương") == "thứ nguyên"
    assert web_search._strip_vn_question_filler("Cho mình hỏi đạo hàm nghĩa là gì?") == "đạo hàm"
    assert web_search._strip_vn_question_filler("Giải thích giúp mình không gian vectơ Đại số tuyến tính") == "không gian vectơ"
    assert web_search._strip_vn_question_filler("Tích phân suy rộng Giải tích 1") == "Tích phân suy rộng"
    # Preserve query when fewer than 2 core keywords would remain.
    assert web_search._strip_vn_question_filler("Newton là gì") == "Newton là gì"
    assert web_search._strip_vn_question_filler("gradient Giải tích") == "gradient Giải tích"
    assert web_search._strip_vn_question_filler("Giải tích là gì") == "Giải tích"


def test_search_web_retries_vietnamese_wikipedia_with_stripped_terms(monkeypatch):
    queries = []

    def respond(request):
        assert request.url.host == "vi.wikipedia.org"
        gsrsearch = request.url.params["gsrsearch"]
        queries.append(gsrsearch)
        if gsrsearch == "thứ nguyên là gì Vật lý đại cương":
            return httpx.Response(200, json={"query": {"pages": []}})
        assert gsrsearch == "thứ nguyên"
        return httpx.Response(200, json={"query": {"pages": [{
            "pageid": 456,
            "title": "Thứ nguyên",
            "extract": "Trong vật lý học, thứ nguyên của một đại lượng vật lý biểu diễn sự phụ thuộc vào các đại lượng cơ bản.",
        }]}})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, notices = web_search.search_web("thứ nguyên là gì Vật lý đại cương", "search")
    assert queries == ["thứ nguyên là gì Vật lý đại cương", "thứ nguyên"]
    assert len(sources) == 1
    assert sources[0]["kind"] == "wikipedia"
    assert sources[0]["title"] == "Thứ nguyên"
    assert "Nguồn web dự phòng từ Wikipedia." in notices
