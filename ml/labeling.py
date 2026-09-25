#!/usr/bin/env python3
"""Interactive terminal labeler for mix-transition relevance (0–3)."""

from __future__ import annotations

import argparse
import random
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ml"))
sys.path.insert(0, str(ROOT / "audio_extraction"))

from rich.console import Console
from rich.prompt import Prompt

from candidate_retriever import CandidateRetriver
from distance import get_bpm_distance, get_key_distance
from extract_tags import DEFAULT_DB_PATH, connect_db

console = Console()

TARGET_PER_BUCKET = 2
MIN_SAMPLE = 4
MAX_SAMPLE = 6
EXACT_BPM_DISTANCE = 0.05  # normalized; 0.05 == 0.5% BPM at 10% tolerance
BOUNDARY_BPM_DISTANCE = 0.75
#: energy_score is absolute on 0-10 (see audio_extraction/energy.py) and most
#: tracks sit between 4 and 7. 1.4 is the 75th percentile of random pairs,
#: keeping the "energy shift" bucket to genuinely large jumps.
ENERGY_GAP = 1.4
KEY_STEP = 1.0 / 7.0


def fetch_random_seed_id(connection: sqlite3.Connection, exclude: set[int]) -> int | None:
    excluded = tuple(exclude)
    if excluded:
        placeholders = ",".join("?" * len(excluded))
        query = f"""
            SELECT id FROM tracks
            WHERE bpm IS NOT NULL
              AND camelot_key IS NOT NULL
              AND trim(camelot_key) != ''
              AND id NOT IN ({placeholders})
            ORDER BY RANDOM()
            LIMIT 1
        """
        row = connection.execute(query, excluded).fetchone()
    else:
        row = connection.execute(
            """
            SELECT id FROM tracks
            WHERE bpm IS NOT NULL
              AND camelot_key IS NOT NULL
              AND trim(camelot_key) != ''
            ORDER BY RANDOM()
            LIMIT 1
            """
        ).fetchone()
    return int(row[0]) if row is not None else None


def _annotate(seed: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    bpm_distance = get_bpm_distance(seed["bpm"], candidate["bpm"])
    key_distance = get_key_distance(seed["camelot_key"], candidate["camelot_key"])
    seed_energy = seed.get("energy_score")
    cand_energy = candidate.get("energy_score")
    if seed_energy is None or cand_energy is None:
        energy_gap = False
        energy_delta = None
    else:
        energy_delta = cand_energy - seed_energy
        energy_gap = abs(energy_delta) >= ENERGY_GAP

    seed_genre = seed.get("macro_genre")
    cand_genre = candidate.get("macro_genre")
    genre_shift = bool(seed_genre and cand_genre and seed_genre != cand_genre)
    same_key = key_distance <= 1e-9
    adjacent_key = abs(key_distance - KEY_STEP) <= 1e-9
    exact_bpm = bpm_distance <= EXACT_BPM_DISTANCE
    boundary_bpm = bpm_distance >= BOUNDARY_BPM_DISTANCE

    return {
        **candidate,
        "bpm_distance": bpm_distance,
        "key_distance": key_distance,
        "energy_delta": energy_delta,
        "same_key": same_key,
        "adjacent_key": adjacent_key,
        "exact_bpm": exact_bpm,
        "genre_shift": genre_shift,
        "energy_gap": energy_gap,
        "boundary_bpm": boundary_bpm,
        "close": (same_key or adjacent_key) and exact_bpm,
        "shift": same_key and (genre_shift or energy_gap),
        "boundary": boundary_bpm or adjacent_key,
    }


def sample_spread(
    seed: dict[str, Any],
    pool: list[dict[str, Any]],
    rng: random.Random,
) -> list[dict[str, Any]]:
    """Pick 4–6 candidates: close harmonic, energy/genre shifts, and boundary."""
    annotated = [_annotate(seed, candidate) for candidate in pool]
    if not annotated:
        return []

    picked_ids: set[int] = set()
    selected: list[dict[str, Any]] = []

    def take_shuffled(bucket: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
        remaining = [row for row in bucket if row["id"] not in picked_ids]
        rng.shuffle(remaining)
        chosen = remaining[:count]
        picked_ids.update(row["id"] for row in chosen)
        return chosen

    def take_sorted(
        bucket: list[dict[str, Any]],
        count: int,
        key,
        reverse: bool = False,
    ) -> list[dict[str, Any]]:
        remaining = [row for row in bucket if row["id"] not in picked_ids]
        remaining.sort(key=key, reverse=reverse)
        chosen = remaining[:count]
        picked_ids.update(row["id"] for row in chosen)
        return chosen

    close_added = take_shuffled([row for row in annotated if row["close"]], TARGET_PER_BUCKET)
    selected.extend(close_added)
    if len(close_added) < TARGET_PER_BUCKET:
        selected.extend(
            take_sorted(
                annotated,
                TARGET_PER_BUCKET - len(close_added),
                key=lambda row: row["bpm_distance"],
            )
        )

    shift_added = take_shuffled([row for row in annotated if row["shift"]], TARGET_PER_BUCKET)
    selected.extend(shift_added)
    if len(shift_added) < TARGET_PER_BUCKET:
        selected.extend(
            take_sorted(
                [row for row in annotated if row["same_key"]],
                TARGET_PER_BUCKET - len(shift_added),
                key=lambda row: abs(row["energy_delta"] or 0.0),
                reverse=True,
            )
        )

    boundary_added = take_shuffled(
        [row for row in annotated if row["boundary"]], TARGET_PER_BUCKET
    )
    selected.extend(boundary_added)
    if len(boundary_added) < TARGET_PER_BUCKET:
        selected.extend(
            take_sorted(
                annotated,
                TARGET_PER_BUCKET - len(boundary_added),
                key=lambda row: row["bpm_distance"],
                reverse=True,
            )
        )

    if len(selected) < MIN_SAMPLE:
        selected.extend(take_shuffled(annotated, MIN_SAMPLE - len(selected)))

    selected = selected[:MAX_SAMPLE]
    rng.shuffle(selected)
    return selected


def _text(value: object, fallback: str = "?") -> str:
    if value is None or value == "":
        return fallback
    return str(value)


def format_seed(track: dict[str, Any]) -> str:
    return (
        f"[{track['id']}] {_text(track.get('title'), '(untitled)')} - "
        f"{_text(track.get('artist'), '(unknown)')} "
        f"(BPM: {_text(track.get('bpm'))}, Key: {_text(track.get('camelot_key'))}, "
        f"Energy: {_text(track.get('energy_score'))}, Genre: {_text(track.get('macro_genre'))})"
    )


def format_candidate(seed: dict[str, Any], candidate: dict[str, Any]) -> str:
    bpm_delta = candidate["bpm"] - seed["bpm"]
    key_diff = (
        f"{seed['camelot_key']} → {candidate['camelot_key']} "
        f"({candidate['key_distance']:.3f})"
    )
    if candidate["energy_delta"] is None:
        energy_diff = "n/a"
    else:
        energy_diff = f"{candidate['energy_delta']:+.1f}"

    seed_genre = _text(seed.get("macro_genre"))
    cand_genre = _text(candidate.get("macro_genre"))
    if seed_genre == "?" or cand_genre == "?":
        genre_match = f"{seed_genre} vs {cand_genre} (unknown)"
    elif seed_genre == cand_genre:
        genre_match = f"same ({cand_genre})"
    else:
        genre_match = f"shift ({seed_genre} → {cand_genre})"

    return (
        f"{_text(candidate.get('title'), '(untitled)')} - "
        f"{_text(candidate.get('artist'), '(unknown)')}  "
        f"| BPM {candidate['bpm']:.1f} (Δ{bpm_delta:+.1f}, dist {candidate['bpm_distance']:.2f}) "
        f"| Key {key_diff} "
        f"| Energy {energy_diff} "
        f"| Genre {genre_match}"
    )


def save_label(
    connection: sqlite3.Connection,
    seed_id: int,
    candidate_id: int,
    relevance: int,
) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO transition_labels
            (seed_track_id, candidate_track_id, relevance)
        VALUES (?, ?, ?)
        """,
        (seed_id, candidate_id, relevance),
    )


def prompt_rating() -> str:
    return Prompt.ask(
        "Rating",
        choices=["0", "1", "2", "3", "s", "q"],
        show_choices=True,
    ).strip().lower()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Label mix transitions 0–3.")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH}).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = args.db.expanduser().resolve()
    if not db_path.exists():
        console.print(f"[red]Database not found:[/red] {db_path}")
        return 1

    rng = random.Random()
    retriever = CandidateRetriver(str(db_path))
    seen_seeds: set[int] = set()
    labeled = 0

    console.print("[bold]Mix transition labeler[/bold]")
    console.print("0 clash · 1 awkward · 2 standard · 3 signature · s skip seed · q quit & save")
    console.print("See LABELING.md for the rubric. Ratings commit when you quit with [bold]q[/bold].\n")

    connection = connect_db(db_path)
    try:
        while True:
            seed_id = fetch_random_seed_id(connection, seen_seeds)
            if seed_id is None:
                console.print("[yellow]No more unlabeled-capable seed tracks.[/yellow]")
                break
            seen_seeds.add(seed_id)

            try:
                seed, pool = retriever.retrieve_candidates(seed_id)
            except (ValueError, sqlite3.Error) as exc:
                console.print(f"[dim]Skipping seed {seed_id}: {exc}[/dim]")
                continue

            sample = sample_spread(seed, pool, rng)
            if len(sample) < MIN_SAMPLE:
                console.print(
                    f"[dim]Skipping [{seed_id}] {_text(seed.get('title'))}: "
                    f"only {len(sample)} spread candidates[/dim]"
                )
                continue

            console.rule(f"Seed  ({len(pool)} compatible)")
            console.print(f"[bold cyan]{format_seed(seed)}[/bold cyan]")

            skip_seed = False
            quit_requested = False
            for index, candidate in enumerate(sample, start=1):
                console.print(f"\n[bold]Candidate {index}/{len(sample)}[/bold]  id={candidate['id']}")
                console.print(format_candidate(seed, candidate))
                choice = prompt_rating()
                if choice == "q":
                    quit_requested = True
                    break
                if choice == "s":
                    skip_seed = True
                    break
                save_label(connection, seed["id"], candidate["id"], int(choice))
                labeled += 1
                console.print(f"[green]Saved[/green] relevance={choice}  (session {labeled})")

            if quit_requested:
                break
            if skip_seed:
                console.print("[dim]Skipped remaining candidates for this seed.[/dim]\n")

        connection.commit()
        console.print(f"\n[bold green]Committed {labeled} label(s).[/bold green]")
        return 0
    except KeyboardInterrupt:
        connection.rollback()
        console.print(f"\n[yellow]Interrupted. Rolled back {labeled} uncommitted label(s).[/yellow]")
        return 130
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
