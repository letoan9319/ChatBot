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
