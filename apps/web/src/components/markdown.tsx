"use client";

import { isValidElement, useCallback, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Source, WebSource } from "@/core/types";
import { compactDocumentLabel, resolveWebProvider, safeExternalUrl } from "@/core/web-source";
import { normalizeChatMath } from "./chat-math";
import { ChatVisual, parseChatVisual } from "./chat-visual";
import { StudyCardBlock, parseStudyCard } from "./study-card";
import styles from "./markdown.module.css";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: Record<string, unknown>;
};

const SKIP_AST_TYPES = new Set(["code", "inlineCode", "math", "inlineMath", "link", "linkReference"]);

function remarkCitePills(labels: Set<string>) {
  return () => (tree: MdastNode) => {
    if (labels.size === 0) return;
    const visit = (node: MdastNode) => {
      if (!node.children || SKIP_AST_TYPES.has(node.type)) return;
      const next: MdastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string" && child.value.includes("[S")) {
          const pattern = /\[(S\d+)\]/g;
          let lastIndex = 0;
          let matched = false;
          for (const match of child.value.matchAll(pattern)) {
            const label = match[1];
            const index = match.index ?? 0;
            if (!labels.has(label)) continue;
            matched = true;
            if (index > lastIndex) {
              next.push({ type: "text", value: child.value.slice(lastIndex, index) });
            }
            next.push({
              type: "citePill",
              data: {
                hName: "cite",
                hProperties: { "data-cite": label },
              },
              children: [{ type: "text", value: `[${label}]` }],
            });
            lastIndex = index + match[0].length;
          }
          if (!matched) {
            next.push(child);
          } else if (lastIndex < child.value.length) {
            next.push({ type: "text", value: child.value.slice(lastIndex) });
          }
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}

function readNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(readNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return readNodeText(node.props.children);
  return "";
}

type CitationEntry =
  | { kind: "curriculum"; source: Source }
  | { kind: "web"; source: WebSource };

export function Markdown({
  content,
  chatMath = false,
  visuals = false,
  streaming = false,
  sources,
  webSources,
  onOpenSource,
}: {
  content: string;
  chatMath?: boolean;
  visuals?: boolean;
  streaming?: boolean;
  sources?: Source[];
  webSources?: WebSource[];
  onOpenSource?: (source: Source) => void;
}) {
  const citationMap = useMemo(() => {
    const map = new Map<string, CitationEntry>();
    for (const item of sources ?? []) {
      map.set(item.label, { kind: "curriculum", source: item });
    }
    for (const item of webSources ?? []) {
      if (item.kind !== "image" && !map.has(item.label)) {
        map.set(item.label, { kind: "web", source: item });
      }
    }
    return map;
  }, [sources, webSources]);

  const remarkPlugins = useMemo(() => {
    if (citationMap.size === 0) return [remarkMath];
    return [remarkMath, remarkCitePills(new Set(citationMap.keys()))];
  }, [citationMap]);

  const renderInline = useCallback(
    (text: string) => (
      <span className={styles.inlineRich}>
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
            p: ({ children }) => <span className={styles.inlineParagraph}>{children}</span>,
            a: ({ children }) => <span>{children}</span>,
            img: ({ alt }) => <span>{alt ? `[Hình: ${alt}]` : "[Hình ảnh]"}</span>,
          }}
        >
          {chatMath ? normalizeChatMath(text) : text}
        </ReactMarkdown>
      </span>
    ),
    [chatMath],
  );

  // Raw HTML is never parsed; KaTeX cannot trust URLs or HTML commands.
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={remarkPlugins}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: "ignore", throwOnError: false },
          ],
        ]}
        components={{
          pre: ({ children }) => {
            if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
              const className = typeof children.props.className === "string" ? children.props.className : "";
              if (/\blanguage-(?:study-card|vis)\b/.test(className)) {
                return (
                  <StudyCardBlock
                    raw={readNodeText(children.props.children)}
                    streaming={streaming}
                    renderInline={renderInline}
                  />
                );
              }
              if ((visuals || streaming) && className === "language-learnstep-visual" && typeof children.props.children === "string") {
                if (streaming) return null;
                const raw = children.props.children;
                if (/"(?:kind|type)"\s*:\s*"(?:steps|pipeline|comparison)"/.test(raw) && parseStudyCard(raw)) {
                  return <StudyCardBlock raw={raw} streaming={false} renderInline={renderInline} />;
                }
                const visual = parseChatVisual(raw);
                if (visual) return <ChatVisual visual={visual} />;
              }
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
          cite: (props) => {
            const label = (props as Record<string, unknown>)["data-cite"];
            if (typeof label !== "string") return <cite>{props.children}</cite>;
            const entry = citationMap.get(label);
            if (!entry) return <>{`[${label}]`}</>;
            if (entry.kind === "curriculum") {
              const item = entry.source;
              const text = compactDocumentLabel(item.document_name, item.page);
              if (!onOpenSource) {
                return (
                  <span
                    className={`${styles.citePill} ${styles.curriculumPill}`}
                    title={`[${item.label}] ${item.document_name}`}
                  >
                    {text}
                  </span>
                );
              }
              return (
                <button
                  type="button"
                  className={`${styles.citePill} ${styles.curriculumPill}`}
                  title={`[${item.label}] ${item.document_name}`}
                  onClick={() => onOpenSource(item)}
                >
                  {text}
                </button>
              );
            }
            const item = entry.source;
            const provider = resolveWebProvider(item);
            const safeUrl = safeExternalUrl(item.url);
            if (!safeUrl) {
              return (
                <span className={`${styles.citePill} ${styles.webPill}`} title={item.title}>
                  {provider}
                </span>
              );
            }
            return (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.citePill} ${styles.webPill}`}
                title={item.title}
              >
                {provider}
              </a>
            );
          },
        }}
      >
        {chatMath ? normalizeChatMath(content) : content}
      </ReactMarkdown>
    </div>
  );
}
