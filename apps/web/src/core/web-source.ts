import type { WebSource } from "./types";

export function safeExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function resolveWebProvider(source: Pick<WebSource, "url" | "provider" | "kind">): string {
  const explicit = source.provider?.trim();
  if (explicit) return explicit;
  try {
    const host = new URL(source.url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith("wikibooks.org")) return "Wikibooks";
    if (host.endsWith("openalex.org")) return "OpenAlex";
    if (host === "doi.org") return source.kind === "article" ? "Bài báo" : "DOI";
    if (host.endsWith("arxiv.org")) return "arXiv";
    if (host.endsWith("wikipedia.org")) return "Wikipedia";
    return source.kind === "article" ? "Bài báo" : (host || "Nguồn web");
  } catch {
    return source.kind === "article" ? "Bài báo" : "Nguồn web";
  }
}

export function compactDocumentLabel(name: string, page: number | null): string {
  const base = name.replace(/\.(pdf|docx)$/i, "").trim();
  const short = base.length > 26 ? `${base.slice(0, 25)}…` : base;
  return page ? `${short} · Tr.${page}` : short;
}
