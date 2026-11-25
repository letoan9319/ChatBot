import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Source, WebSource } from "@/core/types";
import { pastedChatMath } from "./chat-math";
import { Markdown } from "./markdown";
import { revealSegments } from "./streaming-answer";
import { parseStudyCard } from "./study-card";
import { readApproach, ThinkingProgress } from "./thinking-progress";

describe("untrusted chat content", () => {
  it("does not render script tags, raw event handlers or tracking images", () => {
    const html = renderToStaticMarkup(<Markdown content={'<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n![ghi chú](https://example.com/tracker.png)'} />);
    expect(html).not.toMatch(/<script|<img|onerror=/i);
    expect(html).toContain("[Hình: ghi chú]");
  });
  it("rejects executable Markdown and trusted KaTeX URLs", () => {
    const html = renderToStaticMarkup(<Markdown content={'[mở](javascript:alert(1))\n\n$\\href{javascript:alert(1)}{x}$'} />);
    expect(html).not.toMatch(/href=["']javascript:/i);
    expect(html).not.toContain('<script');
  });
});

describe("chat math", () => {
  it("renders standard and legacy inline delimiters in saved replies", () => {
    const content = String.raw`Dùng $R^4$, \(\Delta p\), ( R \to \frac{R}{2} ) và ( \left(\frac{R_{\text{mới}}}{R_{\text{ban đầu}}}\right)^4 ).`;
    const html = renderToStaticMarkup(<Markdown content={content} chatMath />);
    expect(html.match(/class="katex"/g)).toHaveLength(4);
    expect(html).not.toContain("katex-error");
  });

  it("renders display formulas and keeps the adjacent citation outside KaTeX", () => {
    const content = String.raw`\[Q = \frac{\pi \Delta p R^4}{8\eta L}\]

$$
\Delta p \propto R^{-4}
$$ [S2]`;
    const html = renderToStaticMarkup(<Markdown content={content} chatMath />);
    expect(html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(html).toContain("<p>[S2]</p>");
  });

  it("preserves literal code, prose parentheses and Markdown links", () => {
    const content = [
      "`" + String.raw`\(\Delta p\)` + "`",
      "~~~tex",
      String.raw`\[R^4\]`,
      "~~~",
      "",
      "(giữ nguyên lưu lượng) và [Giáo trình](https://example.com/physics)",
    ].join("\n");
    const html = renderToStaticMarkup(<Markdown content={content} chatMath />);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("(giữ nguyên lưu lượng)");
    expect(html).toContain('href="https://example.com/physics"');
  });
});

describe("pasted LaTeX", () => {
  it("preserves a question containing a delimited formula", () => {
    const question = String.raw`Tính \(\lim_{n \to \infty} \frac{1}{n}\) hoặc $x^2$.`;
    expect(pastedChatMath("", question)).toBe(question);
  });

  it("wraps a copied bare formula and renders it in the user message", () => {
    const source = String.raw`\frac{\sqrt{n^2+n}-n}{1+n}`;
    const pasted = pastedChatMath("", source);
    expect(pasted?.trim()).toBe("$$\n" + source + "\n$$");
    const html = renderToStaticMarkup(<Markdown content={pasted ?? ""} chatMath />);
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain("katex-error");
  });

  it("reads a dedicated LaTeX clipboard format over plain text", () => {
    const source = String.raw`\begin{aligned}a&=1\\b&=2\end{aligned}`;
    const html = renderToStaticMarkup(<Markdown content={pastedChatMath(source, "Formula") ?? ""} chatMath />);
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain("katex-error");
  });

  it("does not rewrite ordinary pasted text", () => {
    expect(pastedChatMath("", "Tôi có một câu hỏi về định luật Poiseuille.")).toBeNull();
    expect(pastedChatMath("", "C:\\docs\\reference")).toBeNull();
  });
});

describe("chat visuals", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const block = (data: unknown) => fence + "learnstep-visual\n" + JSON.stringify(data) + "\n" + fence;

  it("renders valid charts and keeps labels as text", () => {
    const content = block({ type: "bar", title: "Kết quả", items: [{ label: "<img src=x>", value: -3 }] });
    const html = renderToStaticMarkup(<Markdown content={content} visuals />);
    expect(html).toContain("<figure");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img");
    expect(renderToStaticMarkup(<Markdown content={content} />)).toContain("<pre>");
  });

  it("renders line plots with sorted coordinates and rejects duplicate x points", () => {
    const data = {
      type: "line", title: "Nhiệt độ", xLabel: "Chiều cao (m)", yLabel: "Nhiệt độ (°C)",
      points: [{ x: 2.5, y: 29 }, { x: 0, y: 24 }],
    };
    const html = renderToStaticMarkup(<Markdown visuals content={block(data)} />);
    expect(html).toContain('points="4,116 296,4"');
    expect(html).toContain("<td>2,5</td>");
    expect(html).toContain("Chiều cao (m)");
    expect(renderToStaticMarkup(<Markdown visuals content={block({
      ...data, points: [{ x: 0, y: 1 }, { x: 0, y: 2 }],
    })} />)).toContain("<pre>");
  });

  it("renders a labeled contour illustration with an accessible description", () => {
    const html = renderToStaticMarkup(<Markdown visuals content={block({
      type: "gradient-contours", title: "Gradient và đường đồng mức",
    })} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('data-level="2"');
    expect(html).toContain("hướng tăng nhanh nhất");
    expect(html).toContain("Tiếp tuyến");
    expect(html).not.toContain("<table");
  });

  it("renders concept branches as text and rejects incomplete relationships", () => {
    const data = {type: "concept", title: "Đường đồng mức", center: "Gradient",
      items: [{label: "Hướng", detail: "<img src=x>"}, {label: "Độ lớn", detail: "Tốc độ tăng"}]};
    const html = renderToStaticMarkup(<Markdown visuals content={block(data)} />);
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img");
    expect(renderToStaticMarkup(<Markdown visuals content={block({...data, items:[{label:"Hướng"}]})} />)).toContain("<pre>");
  });

  it("renders ordered flows and falls back to code for unsupported data", () => {
    expect(renderToStaticMarkup(<Markdown visuals content={block({
      type: "flow", title: "Cách làm", steps: ["Đọc đề", "Chọn quy tắc"],
    })} />)).toContain("<ol");
    expect(renderToStaticMarkup(<Markdown visuals content={block({
      type: "flow", title: "Cách làm", steps: ["Đọc đề", null],
    })} />)).toContain("<pre>");
  });
});


describe("stream display and reasoning details", () => {
  it("keeps a Vietnamese grapheme together during reveal", () => {
    expect(revealSegments("a\u0306\u0301b")).toEqual(["a\u0306\u0301", "b"]);
  });

  it("hides unfinished visual payloads during streaming", () => {
    const source = "Phần giải thích\n\n" + String.fromCharCode(96).repeat(3) + 'learnstep-visual\n{"type":"line"';
    const html = renderToStaticMarkup(<Markdown content={source} streaming />);
    expect(html).toContain("Phần giải thích");
    expect(html).not.toContain("type");
  });

  it("summarizes only the marked approach paragraph", () => {
    expect(readApproach("**Cách tiếp cận:** Lấy đạo hàm riêng.\nXét từng biến.\n\n## Giải thích"))
      .toEqual("Lấy đạo hàm riêng.\nXét từng biến.");
    expect(readApproach("**Cách tiếp cận**: Lấy đạo hàm riêng.\n\nVí dụ"))
      .toEqual("Lấy đạo hàm riêng.");
    expect(readApproach("Một đoạn giải thích không có tóm tắt.")).toBeNull();
  });

  it("auto-expands live thinking stream during generation and collapses once completed", () => {
    const liveHtml = renderToStaticMarkup(
      <ThinkingProgress
        status="generating"
        started
        thinking="Đang xét định nghĩa đạo hàm $f'(x)$"
        content=""
      />,
    );
    expect(liveHtml).toContain('aria-expanded="true"');
    expect(liveHtml).toContain("Luồng suy nghĩ trực tiếp");
    expect(liveHtml).toContain('class="katex"');

    const doneHtml = renderToStaticMarkup(
      <ThinkingProgress
        status="completed"
        started
        duration={2400}
        thinking="Đang xét định nghĩa đạo hàm"
        content="Câu trả lời chính"
      />,
    );
    expect(doneHtml).toContain('aria-expanded="false"');
    expect(doneHtml).toContain("Đã suy nghĩ trong 2 giây");
    expect(doneHtml).toContain("Nội dung suy nghĩ");

    const fastHtml = renderToStaticMarkup(
      <ThinkingProgress
        status="completed"
        started={false}
        content="Trả lời nhanh"
      />,
    );
    expect(fastHtml).toContain("Đã suy nghĩ dưới 1 giây");
    expect(fastHtml).not.toContain("Không ghi nhận suy luận riêng");
  });
});

describe("study cards and citation pills", () => {
  it("renders steps, pipeline, and comparison study-card blocks with inline math", () => {
    const content = [
      "```study-card",
      JSON.stringify({
        kind: "steps",
        steps: [
          { title: "Bước 1 — Đặt biến", body: "Xét phương trình $2x + 5 = 17$" },
          { title: "Bước 2 — Biến đổi", body: "Chuyển vế và rút gọn.", tone: "accent" },
        ],
        loop: "Kiểm tra lại điều kiện nghiệm",
      }),
      "```",
      "",
      "```study-card",
      JSON.stringify({
        kind: "pipeline",
        nodes: [
          { title: "Hàm số liên tục", subtitle: "Điều kiện cần trên đoạn $[a, b]$" },
          { title: "Đạo hàm", subtitle: "Tồn tại tiếp tuyến tại mọi điểm trong $(a, b)$", tone: "accent" },
        ],
      }),
      "```",
      "",
      "```study-card",
      JSON.stringify({
        kind: "comparison",
        columns: [
          { title: "Giáo trình trường", tone: "accent", items: [{ label: "Độ khớp", value: "90%" }] },
          { title: "Nguồn bổ trợ", tone: "neutral", items: [{ label: "Độ khớp", value: 45, display: "45%" }] },
        ],
        caption: "Minh họa tỷ lệ tham chiếu.",
      }),
      "```",
    ].join("\n");

    const html = renderToStaticMarkup(<Markdown content={content} chatMath />);
    expect(html).toContain("Bước 1 — Đặt biến");
    expect(html).toContain("Kiểm tra lại điều kiện nghiệm");
    expect(html).toContain("Hàm số liên tục");
    expect(html).toContain("Giáo trình trường");
    expect(html).toContain("width:90%");
    expect(html).toContain("width:45%");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("&quot;kind&quot;");
  });

  it("shows a loading placeholder while streaming study-card and hides malformed completed cards", () => {
    const incomplete = "```study-card\n{\"kind\":\"steps\",\"steps\":[{\"title\":\"Bước 1";
    const streamingHtml = renderToStaticMarkup(<Markdown content={incomplete} streaming />);
    expect(streamingHtml).toContain("Đang dựng sơ đồ minh họa");

    const malformed = "```study-card\n{not valid json}\n```";
    const completedHtml = renderToStaticMarkup(<Markdown content={malformed} streaming={false} />);
    expect(completedHtml).not.toContain("not valid json");
    expect(completedHtml).not.toContain("Đang dựng sơ đồ minh họa");
    expect(parseStudyCard("{bad")).toBeNull();
  });

  it("renders inline curriculum and web citation pills safely while leaving math and code untouched", () => {
    const sources: Source[] = [{
      id: "src-1",
      document_id: "doc-1",
      label: "S1",
      document_name: "Giao-trinh-Giai-tich-1.pdf",
      page: 23,
      section: null,
      paragraph: 2,
      chunk_id: "chk-1",
    }];
    const webSources: WebSource[] = [
      { label: "S2", title: "Derivative", url: "https://en.wikipedia.org/?curid=1", provider: "Wikipedia", kind: "wikipedia" },
      { label: "S3", title: "Bad link", url: "javascript:alert(1)", provider: "OpenAlex", kind: "article" },
    ];
    const content = "Theo giáo trình [S1] và bài viết [S2] cũng như [S3]. Công thức $[S1]$ và `[S1]`.";
    const html = renderToStaticMarkup(
      <Markdown content={content} chatMath sources={sources} webSources={webSources} onOpenSource={() => {}} />,
    );
    expect(html).toContain("Giao-trinh-Giai-tich-1 · Tr.23");
    expect(html).toContain('href="https://en.wikipedia.org/?curid=1"');
    expect(html).toContain("Wikipedia");
    expect(html).toContain("OpenAlex");
    expect(html).not.toMatch(/href=["']javascript:/i);
    expect(html).toContain("<code>[S1]</code>");
  });
});
