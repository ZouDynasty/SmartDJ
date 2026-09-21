#!/usr/bin/env python3
"""Point library rows at converted siblings when the stored file is gone.

Typical case: Rekordbox still has ``song.flac`` after the file was replaced
with ``song.mp3`` in the same folder. Playback already falls back at runtime;
this rewrites ``file_path`` / ``kind`` / ``size`` so the catalog matches disk.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from rich.console import Console

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.paths import KIND_FOR_SUFFIX, resolve_audio_path
from extract_tags import DEFAULT_DB_PATH, connect_db

console = Console()


def relink_rows(connection: sqlite3.Connection, *, apply: bool) -> int:
    rows = connection.execute(
        "SELECT id, title, file_path, kind, size FROM tracks "
        "WHERE file_path IS NOT NULL AND trim(file_path) <> ''"
    ).fetchall()

    updated = 0
    for row in rows:
        stored = Path(row["file_path"])
        if stored.is_file():
            continue
        resolved = resolve_audio_path(stored, title=row["title"])
        if resolved is None or not resolved.is_file() or resolved == stored:
            continue
        kind = KIND_FOR_SUFFIX.get(resolved.suffix.lower(), row["kind"])
        size = resolved.stat().st_size
        console.print(
            f"[dim]{stored.name}[/dim] → [bold]{resolved.name}[/bold]"
        )
        if apply:
            connection.execute(
                "UPDATE tracks SET file_path = ?, kind = ?, size = ? WHERE id = ?",
                (str(resolved), kind, size, row["id"]),
            )
        updated += 1
    return updated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write remapped paths to SQLite (default is a dry run).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = args.db.expanduser().resolve()
    if not db_path.exists():
        console.print(f"[red]Database not found:[/red] {db_path}")
        return 1

    with connect_db(db_path) as connection:
        connection.row_factory = sqlite3.Row
        updated = relink_rows(connection, apply=args.apply)
        if args.apply:
            connection.commit()
            console.print(f"[bold green]Updated {updated} path(s).[/bold green]")
        else:
            console.print(
                f"[yellow]{updated} path(s) would be updated.[/yellow] "
                "Re-run with --apply to write them."
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
