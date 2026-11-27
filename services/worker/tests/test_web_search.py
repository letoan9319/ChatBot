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


def test_wikipedia_langlinks_and_pageimages_resolve_verified_commons_diagrams(monkeypatch):
    seen_requests = []

    def respond(request):
        seen_requests.append(request)
        if request.url.host == "vi.wikipedia.org":
            assert request.url.params["prop"] == "extracts|pageimages|langlinks"
            assert request.url.params["piprop"] == "name"
            assert request.url.params["lllang"] == "en"
            assert request.url.params["lllimit"] == "max"
            return httpx.Response(200, json={"query": {"pages": [{
                "index": 1,
                "pageid": 10,
                "title": "Hiệu ứng Doppler",
                "extract": "Hiệu ứng Doppler mô tả sự thay đổi tần số sóng khi nguồn và người quan sát chuyển động tương đối.",
                "pageimage": "Commons-logo.svg",
                "langlinks": [{"lang": "en", "title": "Doppler effect"}],
            }]}})
        if request.url.host == "en.wikipedia.org":
            assert request.url.params["titles"] == "Doppler effect"
            assert request.url.params["prop"] == "pageimages"
            return httpx.Response(200, json={"query": {"pages": [{
                "pageid": 20,
                "title": "Doppler effect",
                "pageimage": "Doppler_effect_diagrammatic.svg",
            }]}})
        assert request.url.host == "commons.wikimedia.org"
        if request.url.params.get("titles"):
            return httpx.Response(200, json={"query": {"pages": [{
                "pageid": 301,
                "title": "File:Doppler_effect_diagrammatic.svg",
                "imageinfo": [{
                    "width": 640,
                    "height": 420,
                    "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Doppler_effect_diagrammatic.svg/640px-Doppler_effect_diagrammatic.svg.png",
                    "extmetadata": {
                        "Artist": {"value": "Physics Illustrator"},
                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0/"},
                    },
                }],
            }]}})
        return httpx.Response(200, json={"query": {"pages": []}})

    real_client = httpx.Client
    client = real_client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    images = web_search.search_illustrations("Hiệu ứng Doppler là gì?")
    assert len(images) == 1
    assert images[0]["label"] == "I1"
    assert images[0]["kind"] == "image"
    assert images[0]["title"] == "Doppler_effect_diagrammatic"
    assert images[0]["thumbnail"].startswith("https://upload.wikimedia.org/wikipedia/commons/")

    def failing_respond(_request):
        raise httpx.ConnectError("offline")

    offline_client = real_client(transport=httpx.MockTransport(failing_respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: offline_client)
    assert web_search.search_illustrations("Hiệu ứng Doppler là gì?") == []


def test_commons_images_uses_english_langlinks_without_vietnamese_filename_rejection(monkeypatch):
    commons_queries = []

    def respond(request):
        if request.url.host == "vi.wikipedia.org":
            return httpx.Response(200, json={"query": {"pages": [{
                "index": 1,
                "pageid": 55,
                "title": "Biến đổi Fourier",
                "extract": "Biến đổi Fourier phân tích một hàm theo các thành phần tần số điều hòa cơ bản.",
                "langlinks": [{"lang": "en", "title": "Fourier transform"}],
            }]}})
        if request.url.host == "en.wikipedia.org":
            return httpx.Response(200, json={"query": {"pages": [{"pageid": 56, "title": "Fourier transform"}]}})
        assert request.url.host == "commons.wikimedia.org"
        commons_queries.append(request.url.params.get("gsrsearch"))
        return httpx.Response(200, json={"query": {"pages": [{
            "index": 1,
            "pageid": 88,
            "title": "File:Fourier_transform_time_and_frequency_domains.png",
            "imageinfo": [{
                "width": 800,
                "height": 400,
                "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Fourier_transform_time_and_frequency_domains.png/640px-Fourier_transform_time_and_frequency_domains.png",
                "extmetadata": {
                    "Artist": {"value": ""},
                    "LicenseShortName": {"value": "Public domain"},
                    "LicenseUrl": {"value": ""},
                },
            }],
        }]}})

    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(web_search.httpx, "Client", lambda **_: client)
    sources, _ = web_search.search_web(
        "Biến đổi Fourier là gì?",
        "search",
        image_question="Biến đổi Fourier là gì?",
    )
    images = [item for item in sources if item["kind"] == "image"]
    assert commons_queries[0] == "Fourier transform"
    assert len(images) == 1
    assert images[0]["license_name"] == "Public domain"
    assert images[0]["license_url"] == "https://creativecommons.org/publicdomain/mark/1.0/"


def test_resolve_commons_files_filters_icons_flags_tiny_and_nonfree():
    def respond(request):
        assert request.url.host == "commons.wikimedia.org"
        requested = request.url.params["titles"].split("|")
        assert "File:Flag_of_Vietnam.svg" not in requested
        assert "File:Question_book-new.svg" not in requested
        assert "File:Commons-logo.svg" not in requested
        return httpx.Response(200, json={"query": {"pages": [
            {
                "pageid": 10,
                "title": "File:Tiny_diagram.png",
                "imageinfo": [{
                    "width": 80,
                    "height": 80,
                    "thumburl": "https://upload.wikimedia.org/wikipedia/commons/a/a0/Tiny_diagram.png",
                    "extmetadata": {
                        "Artist": {"value": "Author"},
                        "LicenseShortName": {"value": "CC BY 4.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by/4.0/"},
                    },
                }],
            },
            {
                "pageid": 11,
                "title": "File:Fair_use_cover.jpg",
                "imageinfo": [{
                    "width": 500,
                    "height": 500,
                    "thumburl": "https://upload.wikimedia.org/wikipedia/commons/b/b1/Fair_use_cover.jpg",
                    "extmetadata": {
                        "Artist": {"value": "Publisher"},
                        "LicenseShortName": {"value": "Fair use"},
                        "LicenseUrl": {"value": "https://example.org/fair-use"},
                    },
                }],
            },
            {
                "pageid": 12,
                "title": "File:Vector_addition.svg",
                "imageinfo": [{
                    "width": 640,
                    "height": 480,
                    "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Vector_addition.svg/640px-Vector_addition.svg.png",
                    "extmetadata": {
                        "Artist": {"value": "Math Author"},
                        "LicenseShortName": {"value": "CC BY 4.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by/4.0/"},
                    },
                }],
            },
        ]}})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        resolved = web_search._resolve_commons_files(
            client,
            [
                "Flag_of_Vietnam.svg",
                "Question_book-new.svg",
                "Commons-logo.svg",
                "Tiny_diagram.png",
                "Fair_use_cover.jpg",
                "Vector_addition.svg",
            ],
        )
    assert len(resolved) == 1
    assert resolved[0]["title"] == "Vector_addition"
    assert resolved[0]["label"] == "I1"


def test_searxng_images_accepts_wikimedia_and_same_origin_proxy_only():
    def respond(request):
        assert request.url.host == "127.0.0.1"
        assert request.url.params["categories"] == "images"
        return httpx.Response(200, json={"results": [
            {
                "title": "Harmonic oscillator diagram",
                "url": "https://commons.wikimedia.org/wiki/File:Harmonic.svg",
                "thumbnail_src": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Harmonic.svg/640px-Harmonic.svg.png",
                "author": "Wiki User",
                "license": "CC BY-SA 4.0",
                "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "resolution": "640x480",
            },
            {
                "title": "Third party host leak",
                "url": "https://tracker.example/page",
                "thumbnail_src": "https://tracker.example/pic.jpg",
                "author": "Tracker",
                "license": "CC BY 4.0",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "resolution": "800x600",
            },
            {
                "title": "Tiny wiki icon",
                "url": "https://commons.wikimedia.org/wiki/File:Tiny.png",
                "thumbnail_src": "https://upload.wikimedia.org/wikipedia/commons/1/12/Tiny.png",
                "author": "Wiki User",
                "license": "CC BY 4.0",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "resolution": "64x64",
            },
            {
                "title": "Proxied pendulum diagram",
                "url": "https://physics.edu/pendulum",
                "thumbnail_src": "/image_proxy?url=https%3A%2F%2Fphysics.edu%2Fpendulum.png&h=deadbeef",
                "author": "Physics Dept",
                "resolution": "600x400",
            },
        ]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        images = web_search._searxng_images(client, "http://127.0.0.1:8888", "harmonic oscillator")
    assert len(images) == 2
    assert [img["label"] for img in images] == ["I1", "I2"]
    assert images[0]["thumbnail"].startswith("https://upload.wikimedia.org/wikipedia/commons/")
    assert images[1]["thumbnail"] == "http://127.0.0.1:8888/image_proxy?url=https%3A%2F%2Fphysics.edu%2Fpendulum.png&h=deadbeef"
