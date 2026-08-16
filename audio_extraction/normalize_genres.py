#!/usr/bin/env python3
"""Normalize raw music genre tags into canonical + macro genres.

Load rules from the ``genre_rules`` table (priority ASC). Use ``--test`` to
normalize a single string, or ``--apply`` to write ``clean_genre`` /
``macro_genre`` on every track and refresh ``data/unresolved_genres.log``.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from extract_tags import DEFAULT_DB_PATH, connect_db

GENERIC_LABELS = frozenset(
    {
        "",
        "music",
        "other",
        "remix",
        "unknown",
        "n/a",
        "na",
        "none",
        "various",
        "various artists",
    }
)
UNCATEGORIZED = "Uncategorized"
TOKEN_SPLIT = re.compile(r"\s*[;,/]\s*")
WHITESPACE = re.compile(r"\s+")

UNRESOLVED_LOG = DEFAULT_DB_PATH.parent / "unresolved_genres.log"

# pattern, match_type, canonical_genre, macro_genre, priority (lower = first)
SEED_RULES: tuple[tuple[str, str, str, str, int], ...] = (
    # K-Pop & Asian
    (r"k[\s\-]*pop", "REGEX", "K-Pop", "K-Pop & Asian", 10),
    ("kpop", "EXACT", "K-Pop", "K-Pop & Asian", 11),
    ("k pop", "EXACT", "K-Pop", "K-Pop & Asian", 11),
    ("k-pop", "EXACT", "K-Pop", "K-Pop & Asian", 11),
    ("kpop x edm", "EXACT", "K-Pop", "K-Pop & Asian", 12),
    ("j-pop", "EXACT", "J-Pop", "K-Pop & Asian", 13),
    ("jpop", "EXACT", "J-Pop", "K-Pop & Asian", 13),
    ("j pop", "EXACT", "J-Pop", "K-Pop & Asian", 13),
    ("asian music", "EXACT", "K-Pop", "K-Pop & Asian", 14),
    ("댄스/팝", "EXACT", "Pop", "Pop & Mainstream", 15),
    ("댄스", "CONTAINS", "Pop", "Pop & Mainstream", 16),
    # House styles flatten to House
    ("electro house", "EXACT", "House", "House & EDM", 20),
    ("electrohouse", "EXACT", "House", "House & EDM", 20),
    ("deep house", "EXACT", "House", "House & EDM", 21),
    ("tech house", "EXACT", "House", "House & EDM", 22),
    ("future house", "EXACT", "House", "House & EDM", 23),
    ("tropical house", "EXACT", "House", "House & EDM", 24),
    ("progressive house", "EXACT", "House", "House & EDM", 25),
    ("speed house", "EXACT", "House", "House & EDM", 26),
    ("house / electro", "EXACT", "House", "House & EDM", 27),
    ("house/electro", "EXACT", "House", "House & EDM", 27),
    ("electroclash", "EXACT", "House", "House & EDM", 28),
    ("bass house", "EXACT", "Bass House", "Bass Music", 29),
    # Bass & fast breaks — keep specific subgenre
    (r"drum\s*[&n]\s*bass", "REGEX", "Drum & Bass", "Bass Music", 40),
    ("drum & bass", "EXACT", "Drum & Bass", "Bass Music", 41),
    ("drum n bass", "EXACT", "Drum & Bass", "Bass Music", 41),
    ("drum and bass", "EXACT", "Drum & Bass", "Bass Music", 41),
    ("dnb", "EXACT", "Drum & Bass", "Bass Music", 41),
    ("d&b", "EXACT", "Drum & Bass", "Bass Music", 41),
    ("halftime", "EXACT", "Drum & Bass", "Bass Music", 42),
    ("dubstep", "EXACT", "Dubstep", "Bass Music", 43),
    ("future bass", "EXACT", "Future Bass", "Bass Music", 44),
    ("uk garage", "EXACT", "UK Garage", "Bass Music", 45),
    ("ukg", "EXACT", "UK Garage", "Bass Music", 45),
    ("bassline", "EXACT", "Bassline", "Bass Music", 46),
    ("jersey club", "EXACT", "Jersey Club", "Bass Music", 47),
    # Rap & Trap
    ("cloud rap", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 60),
    ("hip-hop/rap", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 61),
    ("hip hop/rap", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 61),
    ("hip-hop rap", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 61),
    ("pop rap", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 62),
    ("trap", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 63),
    ("latin trap", "EXACT", "Latin Trap", "Latin & Global", 64),
    ("gangsta", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 65),
    ("crunk", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 65),
    ("bounce", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 65),
    ("grime", "EXACT", "Grime", "Hip Hop & Urban", 66),
    ("hip hop", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 70),
    ("hip-hop", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 70),
    ("hiphop", "EXACT", "Hip Hop / Trap", "Hip Hop & Urban", 70),
    # Pop variants
    ("dance pop", "EXACT", "Pop", "Pop & Mainstream", 80),
    ("dance-pop", "EXACT", "Pop", "Pop & Mainstream", 80),
    ("dance/pop", "EXACT", "Pop", "Pop & Mainstream", 80),
    ("synth-pop", "EXACT", "Pop", "Pop & Mainstream", 81),
    ("synth pop", "EXACT", "Pop", "Pop & Mainstream", 81),
    ("top 40 / dance", "EXACT", "Pop", "Pop & Mainstream", 82),
    ("top 40", "EXACT", "Pop", "Pop & Mainstream", 83),
    ("indie pop", "EXACT", "Pop", "Pop & Mainstream", 84),
    ("latin pop", "EXACT", "Latin Pop", "Latin & Global", 85),
    ("pop rock", "EXACT", "Pop", "Pop & Mainstream", 86),
    ("ballad", "EXACT", "Pop", "Pop & Mainstream", 87),
    ("vocal", "EXACT", "Pop", "Pop & Mainstream", 88),
    ("pop", "EXACT", "Pop", "Pop & Mainstream", 90),
    # Dance / EDM
    ("dance & edm", "EXACT", "Dance", "Pop & Mainstream", 100),
    ("hands up", "EXACT", "Dance", "House & EDM", 101),
    ("dance", "EXACT", "Dance", "Pop & Mainstream", 102),
    ("hardstyle", "EXACT", "Hardstyle", "House & EDM", 110),
    ("mandarin hardstyle", "EXACT", "Hardstyle", "House & EDM", 110),
    ("hard dance", "EXACT", "Hardstyle", "House & EDM", 111),
    ("happy hardcore", "EXACT", "Hardstyle", "House & EDM", 112),
    ("jumpstyle", "EXACT", "Hardstyle", "House & EDM", 113),
    ("psy-trance", "EXACT", "Trance", "House & EDM", 114),
    ("psytrance", "EXACT", "Trance", "House & EDM", 114),
    ("tech trance", "EXACT", "Trance", "House & EDM", 115),
    ("trance", "EXACT", "Trance", "House & EDM", 116),
    ("techno", "EXACT", "Techno", "House & EDM", 117),
    ("disco", "EXACT", "Disco", "House & EDM", 118),
    ("chillwave", "EXACT", "Chillwave", "House & EDM", 119),
    ("downtempo", "EXACT", "Chillwave", "House & EDM", 120),
    ("electronica", "EXACT", "Electronic", "House & EDM", 121),
    ("electronic", "EXACT", "Electronic", "House & EDM", 122),
    ("electro", "EXACT", "House", "House & EDM", 123),
    ("experimental", "EXACT", "Electronic", "House & EDM", 124),
    ("house", "EXACT", "House", "House & EDM", 130),
    # R&B / soul / funk
    ("contemporary r&b", "EXACT", "R&B", "Hip Hop & Urban", 140),
    ("r&b/soul", "EXACT", "R&B", "Hip Hop & Urban", 141),
    ("r&b", "EXACT", "R&B", "Hip Hop & Urban", 142),
    ("rnb", "EXACT", "R&B", "Hip Hop & Urban", 142),
    ("neo soul", "EXACT", "R&B", "Hip Hop & Urban", 143),
    ("funk", "EXACT", "Funk", "Hip Hop & Urban", 144),
    # Rock / alternative / folk / country
    ("alternative rock", "EXACT", "Rock", "Rock & Alternative", 150),
    ("alternative", "EXACT", "Rock", "Rock & Alternative", 151),
    ("rock", "EXACT", "Rock", "Rock & Alternative", 152),
    ("folk", "EXACT", "Folk", "Rock & Alternative", 153),
    ("country", "EXACT", "Country", "Roots & Folk", 154),
    # Latin & global
    ("reggaeton", "EXACT", "Reggaeton", "Latin & Global", 160),
    ("baile funk", "EXACT", "Baile Funk", "Latin & Global", 161),
    ("latin", "EXACT", "Latin", "Latin & Global", 162),
    ("african", "EXACT", "African", "Latin & Global", 163),
    ("nursery rhymes", "EXACT", "Pop", "Pop & Mainstream", 170),
    # Broader CONTAINS fallbacks (after exacts)
    ("drum n bass", "CONTAINS", "Drum & Bass", "Bass Music", 300),
    ("drum & bass", "CONTAINS", "Drum & Bass", "Bass Music", 300),
    ("future bass", "CONTAINS", "Future Bass", "Bass Music", 301),
    ("uk garage", "CONTAINS", "UK Garage", "Bass Music", 302),
    ("cloud rap", "CONTAINS", "Hip Hop / Trap", "Hip Hop & Urban", 310),
    ("hip hop", "CONTAINS", "Hip Hop / Trap", "Hip Hop & Urban", 311),
    ("hip-hop", "CONTAINS", "Hip Hop / Trap", "Hip Hop & Urban", 311),
    ("dubstep", "CONTAINS", "Dubstep", "Bass Music", 320),
    ("hardstyle", "CONTAINS", "Hardstyle", "House & EDM", 330),
    ("house", "CONTAINS", "House", "House & EDM", 340),
    ("trap", "CONTAINS", "Hip Hop / Trap", "Hip Hop & Urban", 350),
    ("kpop", "CONTAINS", "K-Pop", "K-Pop & Asian", 360),
    ("pop", "CONTAINS", "Pop", "Pop & Mainstream", 500),
)


@dataclass(frozen=True)
class GenreRule:
    """One matching rule loaded from ``genre_rules``."""

    id: int
    pattern: str
    match_type: str
    canonical_genre: str
    macro_genre: str
    priority: int
    compiled: re.Pattern[str] | None = None


@dataclass(frozen=True)
class NormalizedGenre:
    """Result of running the normalization engine on one raw tag."""

    canonical_genre: str
    macro_genre: str
    matched_pattern: str | None
    unresolved: bool


def preprocess_genre(raw: str | None) -> str:
    """Trim, case-fold, and collapse whitespace."""
    if raw is None:
        return ""
    return WHITESPACE.sub(" ", str(raw).strip().casefold())


def split_genre_tokens(preprocessed: str) -> list[str]:
    """Split a preprocessed tag on ``;``, ``/``, and ``,``."""
    if not preprocessed:
        return []
    tokens = [token.strip() for token in TOKEN_SPLIT.split(preprocessed)]
    return [token for token in tokens if token]


def _text_variants(text: str) -> list[str]:
    hyphen_folded = WHITESPACE.sub(" ", text.replace("-", " ").replace("_", " ")).strip()
    alnum = re.sub(r"[^a-z0-9]+", "", text)
    variants: list[str] = []
    for item in (text, hyphen_folded, alnum):
        if item and item not in variants:
            variants.append(item)
    return variants


def _rule_matches(rule: GenreRule, text: str) -> bool:
    match_type = rule.match_type.upper()
    pattern = rule.pattern.casefold()
    if match_type == "EXACT":
        return any(variant == pattern for variant in _text_variants(text))
    if match_type == "CONTAINS":
        return any(pattern in variant for variant in _text_variants(text))
    if match_type == "REGEX":
        if rule.compiled is None:
            return False
        return any(rule.compiled.search(variant) for variant in _text_variants(text))
    return False


def load_rules(connection: sqlite3.Connection) -> list[GenreRule]:
    """Load rules sorted by priority, then id."""
    rows = connection.execute(
        """
        SELECT id, pattern, match_type, canonical_genre, macro_genre, priority
        FROM genre_rules
        ORDER BY priority ASC, id ASC
        """
    ).fetchall()
    rules: list[GenreRule] = []
    for row in rows:
        compiled = None
        if str(row[2]).upper() == "REGEX":
            compiled = re.compile(row[1], re.IGNORECASE)
        rules.append(
            GenreRule(
                id=int(row[0]),
                pattern=str(row[1]),
                match_type=str(row[2]).upper(),
                canonical_genre=str(row[3]),
                macro_genre=str(row[4]),
                priority=int(row[5]),
                compiled=compiled,
            )
        )
    return rules


def normalize_genre(raw: str | None, rules: Iterable[GenreRule]) -> NormalizedGenre:
    """Return the highest-priority (lowest number) match for a raw genre string."""
    preprocessed = preprocess_genre(raw)
    if preprocessed in GENERIC_LABELS:
        return NormalizedGenre(UNCATEGORIZED, UNCATEGORIZED, None, unresolved=True)

    candidates = [preprocessed]
    for token in split_genre_tokens(preprocessed):
        if token not in candidates:
            candidates.append(token)

    best: GenreRule | None = None
    for candidate in candidates:
        for rule in rules:
            if _rule_matches(rule, candidate):
                if best is None or (rule.priority, rule.id) < (best.priority, best.id):
                    best = rule
                break

    if best is None:
        return NormalizedGenre(UNCATEGORIZED, UNCATEGORIZED, None, unresolved=True)

    return NormalizedGenre(
        canonical_genre=best.canonical_genre,
        macro_genre=best.macro_genre,
        matched_pattern=best.pattern,
        unresolved=False,
    )


def ensure_genre_schema(connection: sqlite3.Connection, *, reseed: bool = False) -> None:
    """Create ``genre_rules``, seed rows, and rebuild ``v_tracks_normalized``."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS genre_rules (
            id INTEGER PRIMARY KEY,
            pattern TEXT NOT NULL,
            match_type TEXT NOT NULL,
            canonical_genre TEXT NOT NULL,
            macro_genre TEXT NOT NULL,
            priority INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_genre_rules_priority ON genre_rules(priority)"
    )
    count = connection.execute("SELECT COUNT(*) FROM genre_rules").fetchone()[0]
    if reseed or count == 0:
        if reseed:
            connection.execute("DELETE FROM genre_rules")
        connection.executemany(
            """
            INSERT INTO genre_rules (
                id, pattern, match_type, canonical_genre, macro_genre, priority
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (index, pattern, match_type, canonical, macro, priority)
                for index, (pattern, match_type, canonical, macro, priority) in enumerate(
                    SEED_RULES, start=1
                )
            ],
        )
    connection.execute("DROP VIEW IF EXISTS v_tracks_normalized")
    connection.execute(
        """
        CREATE VIEW v_tracks_normalized AS
        SELECT
            t.id,
            t.file_path,
            t.title,
            t.artist,
            t.duration,
            t.bpm,
            t."key",
            t.camelot_key,
            t.energy_score,
            t.genre,
            t.clean_genre AS stored_clean_genre,
            t.macro_genre AS stored_macro_genre,
            (
                SELECT r.canonical_genre
                FROM genre_rules r
                WHERE
                    (
                        r.match_type = 'EXACT'
                        AND lower(trim(coalesce(t.genre, ''))) = lower(r.pattern)
                    )
                    OR (
                        r.match_type = 'CONTAINS'
                        AND lower(coalesce(t.genre, '')) LIKE '%' || lower(r.pattern) || '%'
                    )
                ORDER BY r.priority ASC, r.id ASC
                LIMIT 1
            ) AS clean_genre,
            (
                SELECT r.macro_genre
                FROM genre_rules r
                WHERE
                    (
                        r.match_type = 'EXACT'
                        AND lower(trim(coalesce(t.genre, ''))) = lower(r.pattern)
                    )
                    OR (
                        r.match_type = 'CONTAINS'
                        AND lower(coalesce(t.genre, '')) LIKE '%' || lower(r.pattern) || '%'
                    )
                ORDER BY r.priority ASC, r.id ASC
                LIMIT 1
            ) AS macro_genre
        FROM tracks t
        """
    )
    connection.commit()


def apply_normalization(
    connection: sqlite3.Connection,
    log_path: Path = UNRESOLVED_LOG,
) -> dict[str, int]:
    """Idempotently set ``clean_genre`` and ``macro_genre`` on every track."""
    rules = load_rules(connection)
    rows = connection.execute("SELECT id, genre FROM tracks").fetchall()
    unresolved: Counter[str] = Counter()
    updated = 0
    for track_id, raw_genre in rows:
        result = normalize_genre(raw_genre, rules)
        connection.execute(
            """
            UPDATE tracks
            SET clean_genre = ?, macro_genre = ?
            WHERE id = ?
            """,
            (result.canonical_genre, result.macro_genre, track_id),
        )
        updated += 1
        if result.unresolved:
            unresolved[raw_genre if raw_genre else "(empty)"] += 1

    connection.commit()
    _write_unresolved_log(log_path, unresolved)
    return {
        "tracks": updated,
        "unresolved": sum(unresolved.values()),
        "unresolved_distinct": len(unresolved),
    }


def _write_unresolved_log(log_path: Path, unresolved: Counter[str]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Unmapped or generic genre tags (count, raw value)",
        "# Rebuilt on each --apply run.",
    ]
    if not unresolved:
        lines.append("# (none)")
    else:
        for raw, count in unresolved.most_common():
            lines.append(f"{count}\t{raw}")
    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize library genre tags using genre_rules."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH}).",
    )
    parser.add_argument(
        "--test",
        metavar="GENRE",
        help='Normalize one string and print the result, e.g. "Pop; Electro house".',
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write clean_genre and macro_genre for every track.",
    )
    parser.add_argument(
        "--reseed",
        action="store_true",
        help="Replace genre_rules with the built-in seed data.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    db_path = args.db.expanduser().resolve()

    if args.test is not None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with connect_db(db_path) as connection:
            if args.reseed:
                ensure_genre_schema(connection, reseed=True)
            rules = load_rules(connection)
        result = normalize_genre(args.test, rules)
        print(f"input:      {args.test}")
        print(f"canonical:  {result.canonical_genre}")
        print(f"macro:      {result.macro_genre}")
        print(f"matched:    {result.matched_pattern or '(none)'}")
        print(f"unresolved: {result.unresolved}")
        return 0

    if not args.apply and not args.reseed:
        print("Pass --test GENRE or --apply. Use -h for help.", file=sys.stderr)
        return 2

    if not db_path.exists() and args.apply:
        print(f"Database not found: {db_path}", file=sys.stderr)
        return 1

    with connect_db(db_path) as connection:
        if args.reseed:
            ensure_genre_schema(connection, reseed=True)
            print(f"Reseeded {len(SEED_RULES)} genre_rules.")
        if args.apply:
            stats = apply_normalization(connection)
            print(
                f"Updated {stats['tracks']} tracks "
                f"({stats['unresolved']} unresolved across "
                f"{stats['unresolved_distinct']} labels)."
            )
            print(f"Unresolved log: {UNRESOLVED_LOG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
