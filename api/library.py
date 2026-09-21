"""Read-only access to the SmartDJ SQLite library for the local API."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from api.paths import resolve_audio_path

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "library.sqlite"

#: Scalar columns returned by the catalog list endpoint. ``tempo_markers_json``
#: is ~6.8 MB across the library and ``rekordbox_attrs_json`` ~1.9 MB, so both
#: are served only by the per-track detail endpoint.
TRACK_COLUMNS: tuple[str, ...] = (
    "id",
    "track_id",
    "file_path",
    "title",
    "artist",
    "composer",
    "album",
    "grouping",
    "genre",
    "clean_genre",
    "macro_genre",
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
    "energy_score",
)

_SELECT_COLUMNS = ", ".join(f'"{column}"' for column in TRACK_COLUMNS)


def connect(db_path: Path) -> sqlite3.Connection:
    """Open the library read-only so the API can never mutate it."""
    if not db_path.exists():
        raise FileNotFoundError(f"Library database not found: {db_path}")
    connection = sqlite3.connect(
        f"file:{db_path}?mode=ro",
        uri=True,
        check_same_thread=False,
    )
    connection.row_factory = sqlite3.Row
    return connection


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _load_json_array(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [entry for entry in parsed if isinstance(entry, dict)]


def parse_tempo_markers(raw: str | None) -> list[dict[str, Any]]:
    """Rekordbox stores every ``<TEMPO>`` attribute as a string; coerce to numbers."""
    return [
        {
            "inizio": _as_float(entry.get("Inizio")),
            "bpm": _as_float(entry.get("Bpm")),
            "metro": entry.get("Metro"),
            "battito": _as_int(entry.get("Battito")),
        }
        for entry in _load_json_array(raw)
    ]


def parse_cue_points(raw: str | None) -> list[dict[str, Any]]:
    """Normalize ``<POSITION_MARK>`` entries into cue points."""
    return [
        {
            "name": entry.get("Name") or None,
            "type": _as_int(entry.get("Type")),
            "start": _as_float(entry.get("Start")),
            "end": _as_float(entry.get("End")),
            "num": _as_int(entry.get("Num")),
            "red": _as_int(entry.get("Red")),
            "green": _as_int(entry.get("Green")),
            "blue": _as_int(entry.get("Blue")),
        }
        for entry in _load_json_array(raw)
    ]


def _row_to_track(row: sqlite3.Row) -> dict[str, Any]:
    track = {column: row[column] for column in TRACK_COLUMNS}
    track["cue_points"] = parse_cue_points(row["position_markers_json"])
    return track


def fetch_tracks(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    """Every track with a resolvable audio file, cheapest payload first."""
    rows = connection.execute(
        f"SELECT {_SELECT_COLUMNS}, position_markers_json "
        "FROM tracks "
        "WHERE file_path IS NOT NULL AND file_path <> '' "
        "ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE"
    ).fetchall()
    return [_row_to_track(row) for row in rows]


def fetch_track(connection: sqlite3.Connection, track_id: int) -> dict[str, Any] | None:
    """Full detail for one track, including the dense beatgrid."""
    row = connection.execute(
        f"SELECT {_SELECT_COLUMNS}, position_markers_json, tempo_markers_json "
        "FROM tracks WHERE track_id = ?",
        (track_id,),
    ).fetchone()
    if row is None:
        return None
    track = _row_to_track(row)
    track["tempo_markers"] = parse_tempo_markers(row["tempo_markers_json"])
    return track


def fetch_audio_path(connection: sqlite3.Connection, track_id: int) -> Path | None:
    """Resolve a track's on-disk location.

    The path always comes from the library, never from the request, so there is
    no traversal surface: callers can only reach files Rekordbox already indexed.
    """
    row = connection.execute(
        "SELECT file_path, title FROM tracks WHERE track_id = ?",
        (track_id,),
    ).fetchone()
    if row is None or not row["file_path"]:
        return None
    return resolve_audio_path(row["file_path"], title=row["title"])


def fetch_playlists(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    """Playlist tree with ordered track keys per node."""
    rows = connection.execute(
        "SELECT id, parent_id, name, node_type, path FROM playlists ORDER BY path"
    ).fetchall()

    members: dict[int, list[int]] = {}
    for entry in connection.execute(
        "SELECT playlist_id, track_id FROM playlist_tracks ORDER BY playlist_id, position"
    ):
        members.setdefault(entry["playlist_id"], []).append(entry["track_id"])

    return [
        {
            "playlist_id": row["id"],
            "parent_id": row["parent_id"],
            "name": row["name"],
            "is_folder": (row["node_type"] or "").upper() == "FOLDER",
            "path": row["path"],
            "track_ids": members.get(row["id"], []),
        }
        for row in rows
    ]
