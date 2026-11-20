import type { StudyDocument } from "./types";

export type DocumentPart = {
  document: StudyDocument;
  firstPage: number;
  lastPage: number;
};

export type CatalogEntry = {
  name: string;
  documents: StudyDocument[];
  parts: DocumentPart[];
};

const splitPdf = /^(.+?)\s+\(trang\s+(\d+)\s*[-–]\s*(\d+)\)\.pdf$/iu;

export function catalogEntries(documents: StudyDocument[], groupParts: boolean): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>();
  for (const document of documents) {
    const match = groupParts && document.file_type === "pdf" ? splitPdf.exec(document.name) : null;
    const firstPage = Number(match?.[2]);
    const lastPage = Number(match?.[3]);
    if (!match || !Number.isSafeInteger(firstPage) || !Number.isSafeInteger(lastPage) || firstPage < 1 || lastPage < firstPage) {
      entries.set(document.id, { name: document.name, documents: [document], parts: [] });
      continue;
    }
    const name = match[1].trim();
    const key = JSON.stringify([document.subject, name]);
    const entry = entries.get(key) ?? { name, documents: [], parts: [] };
    entry.documents.push(document);
    entry.parts.push({ document, firstPage, lastPage });
    entries.set(key, entry);
  }
  return [...entries.values()].flatMap((entry) => {
    entry.parts.sort((a, b) => a.firstPage - b.firstPage);
    const overlap = entry.parts.some((part, index) => index > 0 && entry.parts[index - 1].lastPage >= part.firstPage);
    return overlap ? entry.documents.map((document) => ({ name: document.name, documents: [document], parts: [] })) : [entry];
  });
}

export function partLabel(part: DocumentPart): string {
  return part.firstPage === part.lastPage ? "Trang " + part.firstPage : "Trang " + part.firstPage + "–" + part.lastPage;
}

const normalizeSearch = (text: string) => text.normalize("NFD").toLowerCase()
  .replace(/\p{M}/gu, "").replace(/đ/g, "d")
  .replace(/([\p{L}])(\d)/gu, "$1 $2").replace(/(\d)([\p{L}])/gu, "$1 $2")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function catalogSearch(query: string, matchPages = true) {
  const plain = query.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "");
  const page = /\btrang\s+(\d+)(?:\s*[-–]\s*(\d+))?\b/u.exec(matchPages ? plain : "");
  const keywords = normalizeSearch(plain.replace(page?.[0] ?? "", ""));
  const numberedWords = [...keywords.matchAll(/(?:^| )([a-z]+ \d+)(?= |$)/g)].map((match) => match[1]);
  const terms = keywords.split(" ").filter(Boolean);
  const firstPage = Number(page?.[1]);
  const lastPage = Number(page?.[2] ?? page?.[1]);
  return {
    page: page && !page[2] ? firstPage : undefined,
    matches(document: StudyDocument, title: string, subject: string, part?: DocumentPart): boolean {
      const haystack = normalizeSearch([document.name, title, subject, document.description ?? ""].join(" "));
      if (!numberedWords.every((phrase) => (" " + haystack + " ").includes(" " + phrase + " "))) return false;
      if (!terms.every((term) => /^\d+$/.test(term) ? haystack.split(" ").includes(term) : haystack.includes(term))) {
        return false;
      }
      if (!page) return true;
      return Boolean(part && firstPage <= lastPage && firstPage <= part.lastPage && lastPage >= part.firstPage);
    },
  };
}

export function documentReaderHref(id: string, page?: number, conversation?: string): string {
  const params = new URLSearchParams();
  if (page) params.set("page", String(page));
  if (conversation) params.set("conversation", conversation);
  return "/study/documents/" + id + (params.size ? "?" + params.toString() : "");
}
