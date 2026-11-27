"""Migrate existing document objects from Supabase Storage to Cloudflare R2 safely.

Usage:
    uv run python -m study_worker.migrate_to_r2 [--limit N] [--delete-source] [--dry-run]
"""

import argparse
import sys

import httpx
import psycopg
from psycopg.rows import dict_row

from .config import Settings
from .r2 import R2Client

FILE_TYPE_MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


def migrate_documents(*, delete_source: bool = False, dry_run: bool = False, limit: int | None = None) -> dict:
    settings = Settings.load()
    if not settings.r2_configured:
        raise RuntimeError(
            "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
        )

    r2 = R2Client(
        settings.r2_endpoint,
        settings.r2_bucket,
        settings.r2_access_key_id,
        settings.r2_secret_access_key,
        timeout=120.0,
    )
    supa = httpx.Client(
        base_url=settings.supabase_url.rstrip("/"),
        headers={
            "Authorization": f"Bearer {settings.supabase_key}",
            "apikey": settings.supabase_key,
        },
        timeout=120.0,
    )

    migrated = 0
    deleted_source = 0
    total_bytes = 0
    try:
        with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
            sql = """
                select id, name, file_type, size_bytes, storage_path, status
                from public.documents
                where storage_provider = 'supabase' and status <> 'deleted'
                order by created_at asc
            """
            params: tuple = ()
            if limit is not None:
                sql += " limit %s"
                params = (limit,)
            rows = conn.execute(sql, params).fetchall()
            print(f"Found {len(rows)} Supabase document(s) to migrate to R2 bucket '{settings.r2_bucket}'.")
            if dry_run:
                planned_bytes = sum(int(r["size_bytes"]) for r in rows)
                print(f"[dry-run] Total size: {planned_bytes / 1_000_000:.2f} MB (cap: 9000.00 MB).")
                return {"found": len(rows), "migrated": 0, "deleted_source": 0, "bytes": planned_bytes}

            for index, doc in enumerate(rows, 1):
                path = doc["storage_path"]
                mime = FILE_TYPE_MIME.get(doc["file_type"], "application/octet-stream")
                expected_size = int(doc["size_bytes"])

                # Enforce 90% storage + Class A hard safety cap in DB before writing to R2.
                with conn.transaction():
                    conn.execute("select app_private.check_r2_storage_capacity(%s)", (expected_size,))

                resp = supa.get(f"/storage/v1/object/authenticated/documents/{path}")
                resp.raise_for_status()
                blob = resp.content
                if len(blob) != expected_size:
                    raise RuntimeError(
                        f"Size mismatch for {doc['id']} ({doc['name']}): expected {expected_size}, got {len(blob)}"
                    )

                r2.put_bytes(path, blob, mime)
                head = r2.head(path)
                if not head or head["size"] != expected_size:
                    raise RuntimeError(f"R2 HEAD verification failed for {path}: {head}")

                with conn.transaction():
                    conn.execute("select app_private.consume_storage_op('class_a', 1)")
                    conn.execute("select app_private.consume_storage_op('class_b', 1)")
                    conn.execute(
                        "update public.documents set storage_provider = 'r2' where id = %s",
                        (doc["id"],),
                    )

                migrated += 1
                total_bytes += expected_size

                if delete_source:
                    del_resp = supa.request("DELETE", "/storage/v1/object/documents", json={"prefixes": [path]})
                    if del_resp.status_code != 404:
                        del_resp.raise_for_status()
                    deleted_source += 1

                if index % 10 == 0 or index == len(rows):
                    print(
                        f"Migrated {index}/{len(rows)} ({total_bytes / 1_000_000:.2f} MB)"
                        + (f", cleaned {deleted_source} source file(s)" if delete_source else "")
                    )
    finally:
        r2.close()
        supa.close()

    return {
        "found": len(rows),
        "migrated": migrated,
        "deleted_source": deleted_source,
        "bytes": total_bytes,
    }


def main():
    parser = argparse.ArgumentParser(description="Migrate LearnStep documents from Supabase Storage to Cloudflare R2.")
    parser.add_argument("--delete-source", action="store_true", help="Delete verified Supabase Storage copies after R2 migration.")
    parser.add_argument("--dry-run", action="store_true", help="Report planned documents without transferring.")
    parser.add_argument("--limit", type=int, default=None, help="Migrate at most N documents.")
    args = parser.parse_args()
    summary = migrate_documents(delete_source=args.delete_source, dry_run=args.dry_run, limit=args.limit)
    print("SUMMARY:", summary)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
