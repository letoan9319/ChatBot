import { describe, expect, it } from "vitest";
import { catalogEntries, catalogSearch, documentReaderHref } from "./document-catalog";
import type { StudyDocument } from "./types";

const pdf = (id: string, name: string, subject = "physics"): StudyDocument => ({
  id, name, subject, file_type: "pdf", size_bytes: 1, status: "ready", error: null, created_at: "2026-01-01",
});

describe("document catalog", () => {
  it("sorts sections by original page and keeps different volumes and subjects separate", () => {
    const docs = [
      pdf("a", "Tap1 (trang 338-360).pdf"),
      pdf("b", "Tap1 (trang 1-22).pdf"),
      pdf("c", "Tap2 (trang 1-22).pdf"),
      pdf("d", "Tap1 (trang 1-22).pdf", "calculus"),
    ];
    const entries = catalogEntries(docs, true);
    expect(entries).toHaveLength(3);
    expect(entries[0].parts.map((part) => part.document.id)).toEqual(["b", "a"]);
    expect(catalogEntries(docs, false)).toHaveLength(4);
  });

  it("does not merge ambiguous overlapping ranges or ordinary numbered titles", () => {
    const docs = [pdf("a", "Tap1 (trang 1-22).pdf"), pdf("b", "Tap1 (trang 20-32).pdf"), pdf("c", "Bài tập (1).pdf")];
    expect(catalogEntries(docs, true).map((entry) => entry.name)).toEqual(docs.map((doc) => doc.name));
  });

  it("keeps the volume number next to its name when searching", () => {
    const docs = [pdf("a", "Tap1 (trang 338-360).pdf"), pdf("b", "Giải tích 1 Giáo trình và 300 bài tập có lời giải (trang 309-351).pdf")];
    const entries = catalogEntries(docs, true);
    const search = catalogSearch("tap1 trang 340");
    expect(entries.filter((entry) => search.matches(
      entry.documents[0], entry.name, "Vật lý", entry.parts[0]
    )).map((entry) => entry.name)).toEqual(["Tap1"]);
  });

  it("finds a volume and containing fragment by unaccented terms and original page", () => {
    const docs = [pdf("a", "Tap1 (trang 316-337).pdf"), pdf("b", "Tap1 (trang 338-360).pdf")];
    const [entry] = catalogEntries(docs, true);
    const search = catalogSearch("trang 340 vật lý Tập 1");
    const parts = entry.parts.filter((part) => search.matches(part.document, entry.name, "Vật lý", part));
    expect(parts.map((part) => part.document.id)).toEqual(["b"]);
    expect(documentReaderHref(parts[0].document.id, search.page)).toBe("/study/documents/b?page=340");
    const range = catalogSearch("tap1 trang 335–341");
    expect(entry.parts.filter((part) => range.matches(part.document, entry.name, "Vật lý", part))).toHaveLength(2);
  });
});
