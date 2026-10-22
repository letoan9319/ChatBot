import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("untrusted model output", () => {
  it("renders math and prevents HTML, script URLs and remote tracking images", () => {
    const html = renderToStaticMarkup(
      <Markdown
        content={
          "$$x^2 + y^2 = 1$$\n\n<script>alert(1)</script>\n\n[link](javascript:alert(1))\n\n![tracking](https://example.com/pixel)"
        }
      />,
    );
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });
});
