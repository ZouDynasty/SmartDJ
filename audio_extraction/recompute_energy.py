#!/usr/bin/env python3
"""Recompute ``energy_score`` from 45-second peak-window features.

Two passes:

1. Decode every track, locate the loudest 45 s window, and store the six raw
   features. This is the expensive pass and runs in a process pool.
2. Score each track's stored features on the absolute 0–10 scale in
   ``energy.py``. Weights and ranges there can be retuned and only this pass
   rerun (``--rescore-only``).

Usage::

    .venv/bin/python audio_extraction/recompute_energy.py
    .venv/bin/python audio_extraction/recompute_energy.py --rescore-only
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
from rich.console import Console
from rich.table import Table
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))

from energy import (  # noqa: E402
    FEATURE_COLUMNS,
    analyze_energy_features,
    score_features,
)
from extract_tags import DEFAULT_DB_PATH, connect_db  # noqa: E402

console = Console()

WRITE_BATCH = 200

UPDATE_FEATURES_SQL = f"""
UPDATE tracks SET {", ".join(f"{column} = :{column}" for column in FEATURE_COLUMNS)}
WHERE id = :id
"""


def analyze_one(job: tuple[int, str]) -> tuple[int, dict[str, float] | None, str | None]:
    """Worker entry point: decode one file and extract its energy features."""
    track_id, file_path = job
    try:
        features = analyze_energy_features(file_path)
    except Exception as exc:  # noqa: BLE001 - one bad file must not kill the run
        return track_id, None, f"{type(exc).__name__}: {exc}"
    if features is None:
        return track_id, None, "no usable audio"
    return track_id, features, None


def select_jobs(
    connection: sqlite3.Connection, only_missing: bool, limit: int | None
) -> list[tuple[int, str]]:
    missing_clause = ""
    if only_missing:
        conditions = " OR ".join(f"{column} IS NULL" for column in FEATURE_COLUMNS)
        missing_clause = f"AND ({conditions})"
    query = f"""
        SELECT id, file_path FROM tracks
        WHERE file_path IS NOT NULL AND trim(file_path) <> ''
        {missing_clause}
        ORDER BY id
    """
    if limit is not None:
        query += f" LIMIT {int(limit)}"
    return [(row[0], row[1]) for row in connection.execute(query)]


def extract_pass(
    connection: sqlite3.Connection,
    jobs: list[tuple[int, str]],
    workers: int,
) -> tuple[int, int]:
    """Decode and store raw features for every job. Returns (ok, failed)."""
    pending: list[dict[str, Any]] = []
    ok = 0
    failures: list[tuple[int, str]] = []

    def flush() -> None:
        if not pending:
            return
        connection.executemany(UPDATE_FEATURES_SQL, pending)
        connection.commit()
        pending.clear()

    def consume(result: tuple[int, dict[str, float] | None, str | None]) -> None:
        nonlocal ok
        track_id, features, error = result
        if features is None:
            failures.append((track_id, error or "unknown"))
        else:
            pending.append({"id": track_id, **features})
            ok += 1
            if len(pending) >= WRITE_BATCH:
                flush()

    progress = tqdm(total=len(jobs), desc="Analyzing energy", unit="track")
    try:
        if workers <= 1:
            for job in jobs:
                consume(analyze_one(job))
                progress.update(1)
        else:
            with ProcessPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(analyze_one, job) for job in jobs]
                for future in as_completed(futures):
                    consume(future.result())
                    progress.update(1)
        flush()
    finally:
        progress.close()

    if failures:
        console.print(f"[yellow]{len(failures)} track(s) could not be analyzed[/yellow]")
        for track_id, reason in failures[:10]:
            console.print(f"  [dim]id={track_id}[/dim] {reason}")
        if len(failures) > 10:
            console.print(f"  [dim]... and {len(failures) - 10} more[/dim]")

    return ok, len(failures)


def rescore_pass(connection: sqlite3.Connection) -> np.ndarray | None:
    """Score each track's stored features and write ``energy_score``."""
    columns = ", ".join(FEATURE_COLUMNS)
    conditions = " AND ".join(f"{column} IS NOT NULL" for column in FEATURE_COLUMNS)
    rows = connection.execute(
        f"SELECT id, {columns} FROM tracks WHERE {conditions} ORDER BY id"
    ).fetchall()
    if not rows:
        console.print("[red]No tracks have energy features yet.[/red]")
        return None

    payload: list[tuple[float, int]] = []
    for row in rows:
        score = score_features(dict(zip(FEATURE_COLUMNS, row[1:])))
        if score is not None:
            payload.append((score, int(row[0])))

    with connection:
        connection.executemany(
            "UPDATE tracks SET energy_score = ? WHERE id = ?",
            payload,
        )
    return np.array([score for score, _ in payload], dtype=np.float64)


def print_distribution(scores: np.ndarray) -> None:
    table = Table(title="energy_score distribution", header_style="bold")
    table.add_column("bucket", justify="right")
    table.add_column("tracks", justify="right")
    table.add_column("share", justify="right")
    total = scores.size
    for bucket in range(11):
        count = int(np.sum(np.round(scores) == bucket))
        share = f"{count / total * 100:.1f}%" if total else "-"
        table.add_row(str(bucket), str(count), share)
    console.print(table)
    console.print(
        f"n={total}  min={scores.min():.1f}  median={np.median(scores):.1f}  "
        f"mean={scores.mean():.2f}  max={scores.max():.1f}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--workers",
        type=int,
        default=max((os.cpu_count() or 4) - 1, 1),
        help="Decoder processes (default: cores - 1).",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip tracks that already have energy features.",
    )
    parser.add_argument(
        "--rescore-only",
        action="store_true",
        help="Skip audio analysis; just rescore stored features.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Analyze at most N tracks.")
    args = parser.parse_args(argv)

    connection = connect_db(args.db)
    try:
        if not args.rescore_only:
            jobs = select_jobs(connection, args.only_missing, args.limit)
            if not jobs:
                console.print("[yellow]Nothing to analyze.[/yellow]")
            else:
                console.print(
                    f"Analyzing [bold]{len(jobs)}[/bold] track(s) "
                    f"across [bold]{args.workers}[/bold] workers"
                )
                ok, failed = extract_pass(connection, jobs, args.workers)
                console.print(f"Features stored for {ok} track(s), {failed} failed")

        scores = rescore_pass(connection)
        if scores is not None:
            print_distribution(scores)
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
