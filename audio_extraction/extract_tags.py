#!/usr/bin/env python3
"""Scan a music library or open the SmartDJ SQLite schema.

Primary ingest is Rekordbox XML via ``ingest_rekordbox.py``. This module still
extracts existing audio tags, owns the ``tracks`` schema, and remains the
folder-scan fallback.

Supported formats: mp3, mp4, m4a, wav, aiff/aif, flac.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

from mutagen import File as MutagenFile
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from tinytag import TinyTag

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "library.sqlite"

SUPPORTED_EXTENSIONS = {".mp3", ".mp4", ".m4a", ".wav", ".aiff", ".aif", ".flac"}

BPM_TAG_NAMES = ("tbpm", "bpm", "tmpo")
KEY_TAG_NAMES = ("tkey", "initialkey", "initial_key", "key")
GENRE_TAG_NAMES = ("genre", "tcon", "\xa9gen")

MIN_BPM = 40.0
MAX_BPM = 260.0
CAMELOT_PATTERN = re.compile(r"^(?:[1-9]|1[0-2])[AB]$", re.IGNORECASE)

TRACK_COLUMNS = (
    "id",
    "file_path",
    "title",
    "artist",
    "duration",
    "bpm",
    "key",
    "camelot_key",
    "energy_score",
    "genre",
)

# Rekordbox XML fields plus scalar energy. ``id`` stays the internal PK used by
# labeling FKs; ``track_id`` is the Rekordbox TrackID upsert key.
TRACKS_TABLE_COLUMNS = (
    "id",
    "track_id",
    "file_path",
    "title",
    "artist",
    "composer",
    "album",
    "grouping",
    "genre",
    "kind",
    "size",
    "duration",
    "disc_number",
    "track_number",
    "year",
    "bpm",
    "date_added",
    "bitrate",
    "sample_rate",
    "comments",
    "play_count",
    "rating",
    "remixer",
    "key",
    "camelot_key",
    "label",
    "mix",
    "colour",
    "date_modified",
    "tempo_markers_json",
    "position_markers_json",
    "rekordbox_attrs_json",
    "energy_score",
    "energy_loudness_db",
    "energy_centroid_hz",
    "energy_hf_ratio",
    "energy_lf_ratio",
    "energy_flux",
    "energy_onset_rate",
    "energy_onsets_per_beat",
    "clean_genre",
    "macro_genre",
)

TRACKS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER UNIQUE,
    file_path TEXT,
    title TEXT,
    artist TEXT,
    composer TEXT,
    album TEXT,
    grouping TEXT,
    genre TEXT,
    kind TEXT,
    size INTEGER,
    duration REAL,
    disc_number INTEGER,
    track_number INTEGER,
    year INTEGER,
    bpm REAL,
    date_added TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    comments TEXT,
    play_count INTEGER,
    rating INTEGER,
    remixer TEXT,
    "key" TEXT,
    camelot_key TEXT,
    label TEXT,
    mix TEXT,
    colour TEXT,
    date_modified TEXT,
    tempo_markers_json TEXT,
    position_markers_json TEXT,
    rekordbox_attrs_json TEXT,
    energy_score REAL,
    energy_loudness_db REAL,
    energy_centroid_hz REAL,
    energy_hf_ratio REAL,
    energy_lf_ratio REAL,
    energy_flux REAL,
    energy_onset_rate REAL,
    energy_onsets_per_beat REAL,
    clean_genre TEXT,
    macro_genre TEXT
)
"""

REKORDBOX_ALTER_COLUMNS = (
    ("track_id", "INTEGER"),
    ("composer", "TEXT"),
    ("album", "TEXT"),
    ("grouping", "TEXT"),
    ("kind", "TEXT"),
    ("size", "INTEGER"),
    ("disc_number", "INTEGER"),
    ("track_number", "INTEGER"),
    ("year", "INTEGER"),
    ("date_added", "TEXT"),
    ("bitrate", "INTEGER"),
    ("sample_rate", "INTEGER"),
    ("comments", "TEXT"),
    ("play_count", "INTEGER"),
    ("rating", "INTEGER"),
    ("remixer", "TEXT"),
    ("label", "TEXT"),
    ("mix", "TEXT"),
    ("colour", "TEXT"),
    ("date_modified", "TEXT"),
    ("tempo_markers_json", "TEXT"),
    ("position_markers_json", "TEXT"),
    ("rekordbox_attrs_json", "TEXT"),
    # Raw perceptual-energy features; see audio_extraction/energy.py.
    ("energy_loudness_db", "REAL"),
    ("energy_centroid_hz", "REAL"),
    ("energy_hf_ratio", "REAL"),
    ("energy_lf_ratio", "REAL"),
    ("energy_flux", "REAL"),
    ("energy_onset_rate", "REAL"),
    ("energy_onsets_per_beat", "REAL"),
)

# Canonical musical key -> Camelot code.
CAMELOT_FROM_KEY = {
    ("c", "major"): "8B",
    ("a", "minor"): "8A",
    ("g", "major"): "9B",
    ("e", "minor"): "9A",
    ("d", "major"): "10B",
    ("b", "minor"): "10A",
    ("a", "major"): "11B",
    ("f#", "minor"): "11A",
    ("e", "major"): "12B",
    ("c#", "minor"): "12A",
    ("b", "major"): "1B",
    ("g#", "minor"): "1A",
    ("f#", "major"): "2B",
    ("d#", "minor"): "2A",
    ("c#", "major"): "3B",
    ("a#", "minor"): "3A",
    ("f", "major"): "7B",
    ("d", "minor"): "7A",
    ("a#", "major"): "6B",
    ("g", "minor"): "6A",
    ("d#", "major"): "5B",
    ("c", "minor"): "5A",
    ("g#", "major"): "4B",
    ("f", "minor"): "4A",
}

NOTE_ALIASES = {
    "db": "c#",
    "eb": "d#",
    "gb": "f#",
    "ab": "g#",
    "bb": "a#",
    "c#": "c#",
    "d#": "d#",
    "f#": "f#",
    "g#": "g#",
    "a#": "a#",
}

CAMELOT_TO_KEY = {
    code: f"{note.upper()} {mode}"
    for (note, mode), code in CAMELOT_FROM_KEY.items()
}

console = Console()


@dataclass
class TrackInfo:
    file_path: str
    title: str | None = None
    artist: str | None = None
    duration: float | None = None
    bpm: float | None = None
    key: str | None = None
    camelot_key: str | None = None
    energy_score: float | None = None
    genre: str | None = None


def find_audio_files(library_path: Path) -> list[Path]:
    files: list[Path] = []
    for path in library_path.rglob("*"):
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)
    return sorted(files)


def _first(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return str(value[0]) if value else None
    text = str(value).strip()
    return text or None


def _other_field(tag: TinyTag, name: str) -> str | None:
    other = getattr(tag, "other", None) or {}
    return _first(other.get(name))


def parse_bpm(value: object) -> float | None:
    """Parse a BPM tag and accept it only if it is in ``[MIN_BPM, MAX_BPM]``."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        bpm = float(value)
        return bpm if MIN_BPM <= bpm <= MAX_BPM else None
    match = re.search(r"(\d+(?:\.\d+)?)", str(value))
    if not match:
        return None
    bpm = float(match.group(1))
    return bpm if MIN_BPM <= bpm <= MAX_BPM else None


def camelot_from_key(note: str | None, scale: str | None) -> str | None:
    """Map a musical note + scale (Essentia or ID3) to Camelot ``1A``–``12B``."""
    if not note or not scale:
        return None
    canonical = _canonical_note(str(note))
    mode_raw = str(scale).strip().lower()
    if mode_raw in {"maj", "major"}:
        mode = "major"
    elif mode_raw in {"min", "minor", "m"}:
        mode = "minor"
    else:
        return None
    return CAMELOT_FROM_KEY.get((canonical, mode))


def is_valid_camelot(value: object) -> bool:
    if value is None:
        return False
    return bool(CAMELOT_PATTERN.fullmatch(str(value).strip().upper().replace(" ", "")))


def _canonical_note(note: str) -> str:
    cleaned = note.strip().lower().replace("♯", "#").replace("♭", "b")
    cleaned = cleaned.replace(" ", "")
    return NOTE_ALIASES.get(cleaned, cleaned)


def parse_key_fields(raw: str | None) -> tuple[str | None, str | None]:
    """Return (musical key, Camelot code) from a tag string."""
    if not raw:
        return None, None
    text = raw.strip()
    if not text:
        return None, None

    camelot_match = re.fullmatch(r"(\d{1,2})\s*([ABab])", text)
    if camelot_match:
        number = int(camelot_match.group(1))
        letter = camelot_match.group(2).upper()
        code = f"{number}{letter}"
        if code in CAMELOT_TO_KEY:
            return CAMELOT_TO_KEY[code], code

    key_match = re.fullmatch(
        r"([A-Ga-g][b#♯♭]?)\s*(maj(?:or)?|min(?:or)?|m)?",
        text,
        flags=re.IGNORECASE,
    )
    if not key_match:
        return text, None

    note = _canonical_note(key_match.group(1))
    mode_raw = (key_match.group(2) or "major").lower()
    mode = "minor" if mode_raw.startswith("m") and not mode_raw.startswith("maj") else "major"
    display_note = note[0].upper() + note[1:]
    musical = f"{display_note} {mode}"
    camelot = camelot_from_key(note, mode)
    return musical, camelot


def sql_ident(column: str) -> str:
    return '"key"' if column == "key" else column


def _mutagen_tag_map(path: Path) -> dict[str, str]:
    """Flatten mutagen tags into a lowercase name -> first-value map."""
    try:
        audio = MutagenFile(path)
    except Exception:
        return {}
    if audio is None or audio.tags is None:
        return {}

    flattened: dict[str, str] = {}
    try:
        items = audio.tags.items()
    except Exception:
        return {}

    for raw_key, raw_value in items:
        name = str(raw_key).lower()
        value: str | None = None
        if hasattr(raw_value, "text") and raw_value.text:
            value = str(raw_value.text[0])
        elif isinstance(raw_value, list) and raw_value:
            first = raw_value[0]
            if isinstance(first, bytes):
                try:
                    value = first.decode("utf-8", errors="ignore")
                except Exception:
                    value = None
            else:
                value = str(first)
        elif raw_value is not None:
            value = str(raw_value)

        if value and name not in flattened:
            flattened[name] = value.strip()
    return flattened


def _lookup_tag(tags: dict[str, str], names: tuple[str, ...]) -> str | None:
    for name in names:
        if name in tags and tags[name]:
            return tags[name]
    for key, value in tags.items():
        if any(name in key for name in names) and value:
            return value
    return None


def extract_tags(path: Path) -> TrackInfo:
    info = TrackInfo(file_path=str(path))
    try:
        tag = TinyTag.get(str(path))
    except Exception:
        return info

    info.title = _first(tag.title)
    info.artist = _first(tag.artist)
    info.duration = tag.duration
    info.bpm = parse_bpm(_other_field(tag, "bpm"))
    info.genre = _first(tag.genre)
    raw_key = _other_field(tag, "initial_key") or _other_field(tag, "key")

    if not info.bpm or not raw_key or not info.genre:
        mutagen_tags = _mutagen_tag_map(path)
        info.bpm = info.bpm or parse_bpm(_lookup_tag(mutagen_tags, BPM_TAG_NAMES))
        raw_key = raw_key or _lookup_tag(mutagen_tags, KEY_TAG_NAMES)
        info.genre = info.genre or _lookup_tag(mutagen_tags, GENRE_TAG_NAMES)

    info.key, info.camelot_key = parse_key_fields(raw_key)
    return info


def _unique_index_on(connection: sqlite3.Connection, table: str, column: str) -> bool:
    for index in connection.execute(f"PRAGMA index_list({table})"):
        if not index[2]:
            continue
        index_name = index[1]
        cols = [
            info[2]
            for info in connection.execute(f"PRAGMA index_info({index_name})")
        ]
        if cols == [column]:
            return True
    return False


def connect_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys = ON")

    existing = {
        row[1] for row in connection.execute("PRAGMA table_info(tracks)").fetchall()
    }
    needs_rebuild = bool(existing) and (
        not set(TRACK_COLUMNS).issubset(existing)
        or "track_id" not in existing
        or _unique_index_on(connection, "tracks", "file_path")
    )
    if needs_rebuild:
        _rebuild_tracks_table(connection, existing)

    connection.execute(TRACKS_TABLE_SQL)
    _ensure_column(connection, "tracks", "clean_genre", "TEXT")
    _ensure_column(connection, "tracks", "macro_genre", "TEXT")
    for column, definition in REKORDBOX_ALTER_COLUMNS:
        _ensure_column(connection, "tracks", column, definition)
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_track_id ON tracks(track_id)"
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tracks_camelot ON tracks(camelot_key)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre)")
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_clean_genre ON tracks(clean_genre)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_macro_genre ON tracks(macro_genre)"
    )
    ensure_playlist_schema(connection)
    try:
        from normalize_genres import ensure_genre_schema
    except ImportError:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from normalize_genres import ensure_genre_schema

    ensure_genre_schema(connection)
    ensure_transition_label_schema(connection)
    return connection


def ensure_transition_label_schema(connection: sqlite3.Connection) -> None:
    """Create the mix-label table used by the ranking labeler."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS transition_labels (
            seed_track_id INTEGER NOT NULL,
            candidate_track_id INTEGER NOT NULL,
            relevance INTEGER NOT NULL CHECK (relevance BETWEEN 0 AND 3),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (seed_track_id, candidate_track_id),
            FOREIGN KEY (seed_track_id) REFERENCES tracks(id),
            FOREIGN KEY (candidate_track_id) REFERENCES tracks(id)
        )
        """
    )
    connection.commit()


def ensure_playlist_schema(connection: sqlite3.Connection) -> None:
    """Folders, playlists, and ordered Rekordbox track keys."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER,
            name TEXT NOT NULL,
            node_type TEXT NOT NULL CHECK (node_type IN ('folder', 'playlist')),
            path TEXT NOT NULL UNIQUE,
            FOREIGN KEY (parent_id) REFERENCES playlists(id) ON DELETE CASCADE
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, position),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(track_id)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id)"
    )
    connection.commit()


def _ensure_column(
    connection: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    existing = {
        row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in existing:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _rebuild_tracks_table(connection: sqlite3.Connection, existing: set[str]) -> None:
    """Recreate tracks with the current schema, copying any overlapping columns."""
    copy_columns = [column for column in TRACKS_TABLE_COLUMNS if column in existing]
    quoted = ", ".join(sql_ident(column) for column in copy_columns)
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("ALTER TABLE tracks RENAME TO tracks_legacy")
    connection.execute(TRACKS_TABLE_SQL.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1))
    if quoted:
        connection.execute(
            f"INSERT INTO tracks ({quoted}) SELECT {quoted} FROM tracks_legacy ORDER BY rowid"
        )
    connection.execute("DROP TABLE tracks_legacy")
    max_id = connection.execute("SELECT MAX(id) FROM tracks").fetchone()[0]
    if max_id is not None:
        try:
            connection.execute("DELETE FROM sqlite_sequence WHERE name = 'tracks'")
            connection.execute(
                "INSERT INTO sqlite_sequence(name, seq) VALUES ('tracks', ?)",
                (int(max_id),),
            )
        except sqlite3.Error:
            pass
    connection.execute("PRAGMA foreign_keys = ON")
    connection.commit()


def save_tracks(connection: sqlite3.Connection, tracks: list[TrackInfo]) -> None:
    insert_sql = """
        INSERT INTO tracks (
            file_path, title, artist, duration, bpm, "key", camelot_key, genre
        ) VALUES (
            :file_path, :title, :artist, :duration, :bpm, :key, :camelot_key, :genre
        )
    """
    update_sql = """
        UPDATE tracks SET
            title = :title,
            artist = :artist,
            duration = :duration,
            bpm = :bpm,
            "key" = :key,
            camelot_key = :camelot_key,
            genre = COALESCE(:genre, genre)
        WHERE file_path = :file_path
    """
    for track in tracks:
        payload = {
            "file_path": track.file_path,
            "title": track.title,
            "artist": track.artist,
            "duration": track.duration,
            "bpm": track.bpm,
            "key": track.key,
            "camelot_key": track.camelot_key,
            "genre": track.genre,
        }
        exists = connection.execute(
            "SELECT 1 FROM tracks WHERE file_path = ?",
            (track.file_path,),
        ).fetchone()
        if exists:
            connection.execute(update_sql, payload)
        else:
            connection.execute(insert_sql, payload)
    connection.commit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract existing tags from audio files and store them in SQLite."
    )
    parser.add_argument(
        "library_path",
        type=Path,
        help="Path to a folder of audio files (searched recursively).",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH}).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    library_path = args.library_path.expanduser().resolve()

    if not library_path.exists():
        console.print(f"[red]Path does not exist:[/red] {library_path}")
        return 1
    if not library_path.is_dir():
        console.print(f"[red]Not a directory:[/red] {library_path}")
        return 1

    files = find_audio_files(library_path)
    if not files:
        console.print(f"[yellow]No supported audio files found in[/yellow] {library_path}")
        console.print(f"[dim]Looked for: {', '.join(sorted(SUPPORTED_EXTENSIONS))}[/dim]")
        return 0

    tracks: list[TrackInfo] = []
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        transient=True,
        console=console,
    ) as progress:
        task = progress.add_task(f"Reading tags from {len(files)} file(s)...", total=len(files))
        for path in files:
            tracks.append(extract_tags(path))
            progress.advance(task)

    db_path = args.db.expanduser().resolve()
    with connect_db(db_path) as connection:
        save_tracks(connection, tracks)

    console.print(f"Saved {len(tracks)} track(s) to [bold]{db_path}[/bold]")
    console.print(
        f"[dim]{sum(1 for track in tracks if track.bpm)} with BPM, "
        f"{sum(1 for track in tracks if track.key)} with key, "
        f"{sum(1 for track in tracks if track.genre)} with genre.[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
