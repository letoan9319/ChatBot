import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

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

describe("assistant math", () => {
  it("renders standard and legacy inline delimiters in saved replies", () => {
    const content = String.raw`Dùng $R^4$, \(\Delta p\), ( R \to \frac{R}{2} ) và ( \left(\frac{R_{\text{mới}}}{R_{\text{ban đầu}}}\right)^4 ).`;
    const html = renderToStaticMarkup(<Markdown content={content} assistant />);
    expect(html.match(/class="katex"/g)).toHaveLength(4);
    expect(html).not.toContain("katex-error");
  });

  it("renders display formulas and keeps the adjacent citation outside KaTeX", () => {
    const content = String.raw`\[Q = \frac{\pi \Delta p R^4}{8\eta L}\]

$$
\Delta p \propto R^{-4}
$$ [S2]`;
    const html = renderToStaticMarkup(<Markdown content={content} assistant />);
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
    const html = renderToStaticMarkup(<Markdown content={content} assistant />);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("(giữ nguyên lưu lượng)");
    expect(html).toContain('href="https://example.com/physics"');
  });
});
