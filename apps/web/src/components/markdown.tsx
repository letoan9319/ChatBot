"use client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export function Markdown({ content }: { content: string }) {
  // Raw HTML is never parsed; KaTeX cannot trust URLs or HTML commands.
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: "ignore", throwOnError: false },
          ],
        ]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span>{alt ? `[Hình: ${alt}]` : "[Hình ảnh]"}</span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
