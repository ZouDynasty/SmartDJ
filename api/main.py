"""Local API exposing the SmartDJ library and its audio files to the frontend.

Run with::

    .venv/bin/python -m uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import os
import re
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from api.artwork import extract_artwork
from api.library import (
    DEFAULT_DB_PATH,
    connect,
    fetch_audio_path,
    fetch_playlists,
    fetch_track,
    fetch_tracks,
)

DB_PATH = Path(os.environ.get("SMARTDJ_DB", DEFAULT_DB_PATH)).expanduser()

#: Vite dev server origins.
ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)

STREAM_CHUNK_BYTES = 256 * 1024

MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
}

RANGE_PATTERN = re.compile(r"bytes=(\d*)-(\d*)")

app = FastAPI(title="SmartDJ Library API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_methods=["GET"],
    allow_headers=["Range", "Content-Type"],
    expose_headers=["Accept-Ranges", "Content-Range", "Content-Length"],
)

#: Parsing 3k rows is cheap but not free; reuse it until the library is re-ingested.
_catalog_cache: tuple[float, list[dict[str, Any]]] | None = None


def get_connection() -> Iterator[sqlite3.Connection]:
    """Per-request read-only connection; SQLite opens are cheap enough."""
    try:
        connection = connect(DB_PATH)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    try:
        yield connection
    finally:
        connection.close()


@app.get("/api/health")
def health() -> dict[str, Any]:
    exists = DB_PATH.exists()
    return {
        "status": "ok" if exists else "missing-database",
        "database": str(DB_PATH),
        "database_exists": exists,
    }


def _cached_catalog(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    global _catalog_cache

    mtime = DB_PATH.stat().st_mtime
    if _catalog_cache is not None and _catalog_cache[0] == mtime:
        return _catalog_cache[1]

    tracks = fetch_tracks(connection)
    _catalog_cache = (mtime, tracks)
    return tracks


@app.get("/api/tracks")
def list_tracks(
    min_duration: float = 0.0,
    connection: sqlite3.Connection = Depends(get_connection),
) -> list[dict[str, Any]]:
    """Full catalog without beatgrids, cached against the database mtime.

    ``min_duration`` (seconds) filters out sample-pack one-shots that Rekordbox
    indexed alongside real tracks; it defaults to 0 so nothing is hidden.
    """
    tracks = _cached_catalog(connection)
    if min_duration <= 0:
        return tracks
    return [
        track
        for track in tracks
        if (track["duration"] or 0.0) >= min_duration
    ]


@app.get("/api/tracks/{track_id}")
def get_track(
    track_id: int,
    connection: sqlite3.Connection = Depends(get_connection),
) -> dict[str, Any]:
    """One track including its tempo markers."""
    track = fetch_track(connection, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail=f"Unknown track_id {track_id}")
    return track


@app.get("/api/playlists")
def list_playlists(
    connection: sqlite3.Connection = Depends(get_connection),
) -> list[dict[str, Any]]:
    return fetch_playlists(connection)


@app.get("/api/tracks/{track_id}/artwork")
def get_track_artwork(
    track_id: int,
    connection: sqlite3.Connection = Depends(get_connection),
) -> Response:
    """Album cover embedded in the track's own file."""
    path = fetch_audio_path(connection, track_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Unknown track_id {track_id}")

    artwork = extract_artwork(path)
    if artwork is None:
        raise HTTPException(status_code=404, detail="No artwork for this track")

    data, media_type = artwork
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    """Resolve an HTTP ``Range`` header to inclusive byte offsets."""
    match = RANGE_PATTERN.fullmatch(range_header.strip())
    if match is None:
        raise HTTPException(status_code=400, detail="Malformed Range header")

    raw_start, raw_end = match.groups()
    if raw_start == "" and raw_end == "":
        raise HTTPException(status_code=400, detail="Malformed Range header")

    if raw_start == "":
        # Suffix form: the last N bytes.
        length = int(raw_end)
        if length <= 0:
            raise HTTPException(status_code=416, detail="Unsatisfiable range")
        start = max(file_size - length, 0)
        end = file_size - 1
    else:
        start = int(raw_start)
        end = int(raw_end) if raw_end else file_size - 1

    end = min(end, file_size - 1)
    if start > end or start >= file_size:
        raise HTTPException(status_code=416, detail="Unsatisfiable range")
    return start, end


def _iter_file(path: Path, start: int, length: int) -> Iterator[bytes]:
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            chunk = handle.read(min(STREAM_CHUNK_BYTES, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@app.get("/api/tracks/{track_id}/audio")
def stream_track_audio(
    track_id: int,
    range_header: str | None = Header(default=None, alias="Range"),
    connection: sqlite3.Connection = Depends(get_connection),
) -> Response:
    """Stream the track's file from disk, honouring Range so seeking works."""
    path = fetch_audio_path(connection, track_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Unknown track_id {track_id}")
    if not path.is_file():
        raise HTTPException(status_code=410, detail=f"Audio file missing: {path}")

    file_size = path.stat().st_size
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")

    if range_header is None:
        start, end = 0, file_size - 1
        status_code = 200
    else:
        start, end = _parse_range(range_header, file_size)
        status_code = 206

    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "no-cache",
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(
        _iter_file(path, start, length),
        status_code=status_code,
        media_type=media_type,
        headers=headers,
    )
