"use client";
import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeChatMath } from "./chat-math";
import { ChatVisual, parseChatVisual } from "./chat-visual";

export function Markdown({ content, chatMath = false, visuals = false }: {
  content: string;
  chatMath?: boolean;
  visuals?: boolean;
}) {
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
          pre: ({ children }) => {
            if (visuals && isValidElement<{ className?: string; children?: unknown }>(children) &&
              children.props.className === "language-learnstep-visual" && typeof children.props.children === "string") {
              const visual = parseChatVisual(children.props.children);
              if (visual) return <ChatVisual visual={visual} />;
            }
            return <pre>{children}</pre>;
          },
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
        {chatMath ? normalizeChatMath(content) : content}
      </ReactMarkdown>
    </div>
  );
}
