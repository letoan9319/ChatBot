"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { catalogEntries, documentReaderHref, partLabel } from "@/core/document-catalog";
import type { CatalogEntry } from "@/core/document-catalog";
import type { StudyDocument } from "@/core/types";
import styles from "./document-reader.module.css";

export function useDocumentVolume(id: string, shared: boolean): CatalogEntry | undefined {
  const [volumes, setVolumes] = useState<CatalogEntry[]>([]);
  useEffect(() => {
    if (!shared) return;
    const controller = new AbortController();
    void fetch("/api/knowledge", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const documents: StudyDocument[] = await response.json();
      if (!controller.signal.aborted) setVolumes(catalogEntries(documents, true));
    }).catch(() => {
      // The current file and its citation remain readable if the catalog is unavailable.
    });
    return () => controller.abort();
  }, [shared]);
  return shared ? volumes.find((volume) => volume.parts.some((part) => part.document.id === id)) : undefined;
}

export function DocumentVolumeNavigation({ volume, id, conversation }: {
  volume: CatalogEntry;
  id: string;
  conversation?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const index = volume.parts.findIndex((part) => part.document.id === id);
  const previous = volume.parts[index - 1];
  const next = volume.parts[index + 1];
  return <nav className={styles.volume} aria-label="Mục lục tài liệu">
    <label>
      Phần đang đọc
      <select value={id} onChange={(event) => router.push(documentReaderHref(event.target.value, undefined, conversation))}>
        {volume.parts.map((part) => <option value={part.document.id} key={part.document.id}>{partLabel(part)}</option>)}
      </select>
    </label>
    <div className={styles.volumeLinks}>
      {previous && <Link href={documentReaderHref(previous.document.id, undefined, conversation)}>Phần trước</Link>}
      {next && <Link href={documentReaderHref(next.document.id, undefined, conversation)}>Phần tiếp theo</Link>}
    </div>
    <form onSubmit={(event) => {
      event.preventDefault();
      const page = Number(new FormData(event.currentTarget).get("page"));
      const part = volume.parts.find((item) => page >= item.firstPage && page <= item.lastPage);
      if (!part) {
        setError("Trang này chưa có trong các phần đã công bố.");
        return;
      }
      setError("");
      router.push(documentReaderHref(part.document.id, page, conversation));
    }}>
      <input type="number" name="page" aria-label="Trang trong toàn tài liệu" placeholder="Số trang" min={1} step={1} required onChange={() => setError("")} />
      <button type="submit">Đến trang</button>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </nav>;
}
