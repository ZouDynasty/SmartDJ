#!/usr/bin/env python3
"""Ingest a Rekordbox XML collection into SQLite.

Rekordbox metadata is the source of truth. Scalar ``energy_score`` is computed
from the local audio file and preserved on re-import. Missing BPM, tonality, or
genre fall back to the existing Essentia analysis pipeline.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.progress import BarColumn, Progress, TextColumn, TimeRemainingColumn
from rich.prompt import Prompt

from urllib.parse import unquote

from detect_missing import analyze_track
from extract_tags import (
    DEFAULT_DB_PATH,
    SUPPORTED_EXTENSIONS,
    connect_db,
    parse_bpm,
    parse_key_fields,
)
from normalize_genres import apply_normalization
from rekordbox_xml import (
    RekordboxLibrary,
    RekordboxTrack,
    _opt_int,
    iter_playlist_rows,
    parse_rekordbox_xml,
)

console = Console()

UPSERT_COLUMNS = (
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
)

def _sql_ident(column: str) -> str:
    return '"key"' if column == "key" else column


def _update_assignments(*, from_excluded: bool) -> str:
    parts: list[str] = []
    for column in UPSERT_COLUMNS:
        if column == "track_id":
            continue
        ident = _sql_ident(column)
        value = f"excluded.{ident}" if from_excluded else f":{column}"
        if column == "energy_score":
            parts.append(f"energy_score = COALESCE(tracks.energy_score, {value})")
        else:
            parts.append(f"{ident} = {value}")
    return ", ".join(parts)


UPSERT_SQL = f"""
INSERT INTO tracks ({", ".join(_sql_ident(c) for c in UPSERT_COLUMNS)})
VALUES ({", ".join(f":{c}" for c in UPSERT_COLUMNS)})
ON CONFLICT(track_id) DO UPDATE SET
    {_update_assignments(from_excluded=True)}
"""

UPDATE_BY_ID_SQL = f"""
UPDATE tracks SET
    track_id = :track_id,
    {_update_assignments(from_excluded=False)}
WHERE id = :id
"""


def _attr_int(track: RekordboxTrack, name: str) -> int | None:
    return _opt_int(track.attributes.get(name))


def _attr_text(track: RekordboxTrack, name: str) -> str | None:
    value = track.attributes.get(name)
    if value is None:
        return None
    text = value.strip()
    return text or None


def is_soundcloud_track(track: RekordboxTrack) -> bool:
    location = (track.location or "").lower()
    kind = (track.attributes.get("Kind") or "").lower()
    return "soundcloud" in location or "soundcloud" in kind


def location_suffix(track: RekordboxTrack) -> str:
    """File extension from the raw Location, keeping ``?`` / ``#`` in the name."""
    raw = unquote((track.location or track.file_path or "").strip())
    lower = raw.lower()
    if lower.startswith("file://localhost"):
        raw = raw[len("file://localhost") :]
    elif lower.startswith("file://"):
        raw = raw[len("file://") :]
    elif lower.startswith("file:"):
        raw = raw[len("file:") :]
    return Path(raw).suffix.lower()


def skip_reason(track: RekordboxTrack) -> str | None:
    """Return why a TRACK should not be ingested, or None to keep it."""
    if is_soundcloud_track(track):
        return "soundcloud"
    if location_suffix(track) not in SUPPORTED_EXTENSIONS:
        return "unsupported"
    return None


def prune_skipped_tracks(
    connection: sqlite3.Connection, skipped_ids: set[int]
) -> int:
    """Remove previously imported SoundCloud / unsupported rows."""
    clauses = [
        "json_extract(rekordbox_attrs_json, '$.Location') LIKE '%soundcloud%'",
        "lower(coalesce(kind, '')) LIKE '%soundcloud%'",
    ]
    params: list[Any] = []
    if skipped_ids:
        placeholders = ",".join("?" * len(skipped_ids))
        clauses.append(f"track_id IN ({placeholders})")
        params.extend(skipped_ids)
    where = " OR ".join(clauses)
    internal_ids = [
        int(row[0])
        for row in connection.execute(f"SELECT id FROM tracks WHERE {where}", params)
    ]
    if not internal_ids:
        return 0
    id_placeholders = ",".join("?" * len(internal_ids))
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute(
        f"""
        DELETE FROM transition_labels
        WHERE seed_track_id IN ({id_placeholders})
           OR candidate_track_id IN ({id_placeholders})
        """,
        (*internal_ids, *internal_ids),
    )
    connection.execute(
        f"""
        DELETE FROM playlist_tracks
        WHERE track_id IN (
            SELECT track_id FROM tracks WHERE id IN ({id_placeholders})
        )
        """,
        internal_ids,
    )
    deleted = connection.execute(
        f"DELETE FROM tracks WHERE id IN ({id_placeholders})",
        internal_ids,
    ).rowcount
    connection.execute("PRAGMA foreign_keys = ON")
    return deleted


def metadata_gaps(track: RekordboxTrack) -> tuple[bool, bool, bool]:
    """Return (missing_bpm, missing_tonality, missing_genre)."""
    return (
        track.average_bpm is None,
        not track.tonality,
        not track.genre,
    )


def lookup_energy(
    connection: sqlite3.Connection, track_id: int, file_path: str | None
) -> float | None:
    row = connection.execute(
        "SELECT energy_score FROM tracks WHERE track_id = ?",
        (track_id,),
    ).fetchone()
    if row is not None and row[0] is not None:
        return float(row[0])
    if file_path:
        row = connection.execute(
            "SELECT energy_score FROM tracks WHERE file_path = ?",
            (file_path,),
        ).fetchone()
        if row is not None and row[0] is not None:
            return float(row[0])
    return None


def enrich_track(
    track: RekordboxTrack,
    *,
    existing_energy: float | None,
    skip_audio: bool,
) -> dict[str, Any]:
    musical_key, camelot_key = parse_key_fields(track.tonality)
    bpm = parse_bpm(track.average_bpm)
    genre = track.genre
    duration = track.total_time
    energy = existing_energy
    sources = {
        "bpm": "rekordbox" if bpm is not None else None,
        "key": "rekordbox" if camelot_key is not None else None,
        "genre": "rekordbox" if genre else None,
        "energy_score": "stored" if energy is not None else None,
        "duration": "rekordbox" if duration is not None else None,
    }

    missing_bpm, missing_tonality, missing_genre = metadata_gaps(track)
    needs_audio = (not skip_audio) and (
        missing_bpm or missing_tonality or missing_genre or energy is None
    )
    audio_path = Path(track.file_path) if track.file_path else None
    missing_file = bool(needs_audio and (audio_path is None or not audio_path.is_file()))

    if needs_audio and audio_path is not None and audio_path.is_file():
        try:
            analysis = analyze_track(
                audio_path,
                {
                    "title": track.name,
                    "artist": track.artist,
                    "duration": duration,
                    "bpm": bpm,
                    "key": musical_key,
                    "camelot_key": camelot_key,
                    "energy_score": energy,
                    "genre": genre,
                },
            )
        except Exception as exc:
            console.print(f"[yellow]{audio_path.name}: analysis failed:[/yellow] {exc}")
            analysis = None
        if analysis is not None:
            bpm = analysis.get("bpm")
            musical_key = analysis.get("key")
            camelot_key = analysis.get("camelot_key")
            genre = analysis.get("genre")
            duration = analysis.get("duration")
            energy = analysis.get("energy_score")
            sources = analysis.get("sources") or sources

    tempo_json, position_json = track.markers_json()
    return {
        "track_id": track.track_id,
        "file_path": track.file_path,
        "title": track.name,
        "artist": track.artist,
        "composer": _attr_text(track, "Composer"),
        "album": _attr_text(track, "Album"),
        "grouping": _attr_text(track, "Grouping"),
        "genre": genre,
        "kind": _attr_text(track, "Kind"),
        "size": _attr_int(track, "Size"),
        "duration": duration,
        "disc_number": _attr_int(track, "DiscNumber"),
        "track_number": _attr_int(track, "TrackNumber"),
        "year": _attr_int(track, "Year"),
        "bpm": bpm,
        "date_added": _attr_text(track, "DateAdded"),
        "bitrate": _attr_int(track, "BitRate"),
        "sample_rate": _attr_int(track, "SampleRate"),
        "comments": track.comments,
        "play_count": _attr_int(track, "PlayCount"),
        "rating": track.rating,
        "remixer": _attr_text(track, "Remixer"),
        "key": musical_key,
        "camelot_key": camelot_key,
        "label": _attr_text(track, "Label"),
        "mix": _attr_text(track, "Mix"),
        "colour": _attr_text(track, "Colour"),
        "date_modified": _attr_text(track, "DateModified"),
        "tempo_markers_json": tempo_json,
        "position_markers_json": position_json,
        "rekordbox_attrs_json": json.dumps(track.attributes, ensure_ascii=False),
        "energy_score": energy,
        "sources": sources,
        "missing_file": missing_file,
        "imputed_bpm": missing_bpm and bpm is not None,
        "imputed_key": missing_tonality and camelot_key is not None,
        "imputed_genre": missing_genre and bool(genre),
        "computed_energy": existing_energy is None and energy is not None,
        "preserved_energy": existing_energy is not None,
    }


def upsert_track(connection: sqlite3.Connection, row: dict[str, Any]) -> None:
    """Idempotent write keyed by Rekordbox ``track_id``.

    Re-imports use ``ON CONFLICT(track_id)``. A legacy row that still has a
    matching ``file_path`` and no TrackID is updated in place so energy is kept.
    Duplicate Rekordbox entries that share an audio file insert as separate rows.
    """
    payload = {column: row.get(column) for column in UPSERT_COLUMNS}
    existing = connection.execute(
        "SELECT id FROM tracks WHERE track_id = ?",
        (row["track_id"],),
    ).fetchone()
    if existing is None and row.get("file_path"):
        existing = connection.execute(
            "SELECT id FROM tracks WHERE file_path = ? AND track_id IS NULL",
            (row["file_path"],),
        ).fetchone()
        if existing is not None:
            connection.execute(UPDATE_BY_ID_SQL, {**payload, "id": existing[0]})
            return
    connection.execute(UPSERT_SQL, payload)


def replace_playlists(
    connection: sqlite3.Connection,
    library: RekordboxLibrary,
    known_track_ids: set[int],
) -> dict[str, int]:
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("DELETE FROM playlist_tracks")
    connection.execute("DELETE FROM playlists")
    connection.execute("PRAGMA foreign_keys = ON")
    path_ids: dict[str, int] = {}
    stats = {"folders": 0, "playlists": 0, "playlist_tracks": 0, "skipped_keys": 0}

    for path, parent_path, node in iter_playlist_rows(library.playlists):
        parent_id = path_ids.get(parent_path) if parent_path else None
        cursor = connection.execute(
            """
            INSERT INTO playlists (parent_id, name, node_type, path)
            VALUES (?, ?, ?, ?)
            """,
            (parent_id, node.name, node.node_type, path),
        )
        playlist_id = int(cursor.lastrowid)
        path_ids[path] = playlist_id
        if node.node_type == "folder":
            stats["folders"] += 1
            continue
        stats["playlists"] += 1
        for position, track_id in enumerate(node.track_keys):
            if track_id not in known_track_ids:
                stats["skipped_keys"] += 1
                continue
            connection.execute(
                """
                INSERT INTO playlist_tracks (playlist_id, track_id, position)
                VALUES (?, ?, ?)
                """,
                (playlist_id, track_id, position),
            )
            stats["playlist_tracks"] += 1
    return stats


def ingest_library(
    xml_path: Path,
    db_path: Path,
    *,
    skip_audio: bool = False,
    dry_run: bool = False,
) -> dict[str, int]:
    library = parse_rekordbox_xml(xml_path)
    accepted: list[RekordboxTrack] = []
    skipped_ids: set[int] = set()
    stats = {
        "xml_tracks": len(library.tracks),
        "upserted": 0,
        "skipped_soundcloud": 0,
        "skipped_unsupported": 0,
        "pruned": 0,
        "missing_file": 0,
        "imputed_bpm": 0,
        "imputed_key": 0,
        "imputed_genre": 0,
        "computed_energy": 0,
        "preserved_energy": 0,
        "folders": 0,
        "playlists": 0,
        "playlist_tracks": 0,
        "skipped_keys": 0,
    }
    for track in library.tracks:
        reason = skip_reason(track)
        if reason == "soundcloud":
            stats["skipped_soundcloud"] += 1
            skipped_ids.add(track.track_id)
            continue
        if reason == "unsupported":
            stats["skipped_unsupported"] += 1
            skipped_ids.add(track.track_id)
            continue
        accepted.append(track)

    if dry_run:
        playlist_count = sum(
            1
            for _path, _parent, node in iter_playlist_rows(library.playlists)
            if node.node_type == "playlist"
        )
        console.print(f"[bold]Dry run[/bold] {xml_path}")
        console.print(
            f"xml_tracks={len(library.tracks)} accepted={len(accepted)} "
            f"skipped_soundcloud={stats['skipped_soundcloud']} "
            f"skipped_unsupported={stats['skipped_unsupported']} "
            f"playlists={playlist_count}"
        )
        return stats

    with connect_db(db_path) as connection:
        known_ids: set[int] = set()
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeRemainingColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(
                f"Ingesting {len(accepted)} Rekordbox track(s)...",
                total=len(accepted),
            )
            for index, track in enumerate(accepted, start=1):
                energy = lookup_energy(connection, track.track_id, track.file_path)
                row = enrich_track(
                    track, existing_energy=energy, skip_audio=skip_audio
                )
                upsert_track(connection, row)
                known_ids.add(track.track_id)
                stats["upserted"] += 1
                stats["missing_file"] += int(row["missing_file"])
                stats["imputed_bpm"] += int(row["imputed_bpm"])
                stats["imputed_key"] += int(row["imputed_key"])
                stats["imputed_genre"] += int(row["imputed_genre"])
                stats["computed_energy"] += int(row["computed_energy"])
                stats["preserved_energy"] += int(row["preserved_energy"])
                if index % 25 == 0:
                    connection.commit()
                progress.advance(task)

        playlist_stats = replace_playlists(connection, library, known_ids)
        stats.update(playlist_stats)
        stats["pruned"] = prune_skipped_tracks(connection, skipped_ids)
        apply_normalization(connection)
        connection.commit()

    return stats


def ask_xml_path() -> Path:
    while True:
        raw = Prompt.ask("Rekordbox XML filepath").strip().strip("\"'")
        if not raw:
            console.print("[yellow]Please enter a path.[/yellow]")
            continue
        xml_path = Path(raw).expanduser()
        if xml_path.is_file():
            return xml_path.resolve()
        console.print(f"[red]XML file not found:[/red] {xml_path}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a Rekordbox XML collection into the SmartDJ library."
    )
    parser.add_argument(
        "xml_path",
        nargs="?",
        type=Path,
        help="Path to the Rekordbox XML export. Prompted if omitted.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH}).",
    )
    parser.add_argument(
        "--skip-audio",
        action="store_true",
        help="Write XML metadata only (no energy calculation or Essentia fallback).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse the XML and print counts without writing to SQLite.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    xml_path = args.xml_path.expanduser().resolve() if args.xml_path else ask_xml_path()
    if not xml_path.is_file():
        console.print(f"[red]XML file not found:[/red] {xml_path}")
        return 1

    stats = ingest_library(
        xml_path,
        args.db.expanduser().resolve(),
        skip_audio=args.skip_audio,
        dry_run=args.dry_run,
    )
    if args.dry_run:
        return 0

    console.print(
        f"Upserted {stats['upserted']} of {stats['xml_tracks']} track(s) into "
        f"[bold]{args.db}[/bold]"
    )
    console.print(
        f"[dim]skipped soundcloud={stats['skipped_soundcloud']} "
        f"unsupported={stats['skipped_unsupported']} "
        f"pruned={stats['pruned']}[/dim]"
    )
    console.print(
        f"[dim]energy computed={stats['computed_energy']} "
        f"preserved={stats['preserved_energy']}  "
        f"imputed bpm={stats['imputed_bpm']} key={stats['imputed_key']} "
        f"genre={stats['imputed_genre']}  "
        f"missing files={stats['missing_file']}[/dim]"
    )
    console.print(
        f"[dim]playlists={stats['playlists']} folders={stats['folders']} "
        f"playlist tracks={stats['playlist_tracks']} "
        f"skipped keys={stats['skipped_keys']}[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
