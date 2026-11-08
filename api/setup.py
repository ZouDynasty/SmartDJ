"""First-run library setup: pick the Rekordbox XML and the music folder, then import.

The import runs ``ingest_rekordbox.ingest_library`` on a background thread in
two passes. The first skips audio analysis so the catalog appears within
seconds; the second fills in energy and any missing BPM / key / genre, which
can take a long time on a fresh library.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api import auth
from api.library import DB_PATH
from api.settings import load_settings, update_settings

logger = logging.getLogger(__name__)

_AUDIO_EXTRACTION_DIR = Path(__file__).resolve().parent.parent / "audio_extraction"

router = APIRouter(
    prefix="/api/setup",
    tags=["setup"],
    dependencies=[Depends(auth.require_user)],
)


class SetupRequest(BaseModel):
    rekordbox_xml: str
    music_root: str


class BrowseRequest(BaseModel):
    kind: Literal["xml", "folder"]


@dataclass
class ImportJob:
    state: Literal["idle", "running", "done", "error"] = "idle"
    #: ``tracks`` writes Rekordbox metadata; ``analysis`` runs the audio passes.
    phase: Literal["tracks", "analysis"] | None = None
    done: int = 0
    total: int = 0
    message: str | None = None


_job = ImportJob()
_job_lock = threading.Lock()


def _update_job(**values: Any) -> None:
    with _job_lock:
        for name, value in values.items():
            setattr(_job, name, value)


def _status() -> dict[str, Any]:
    settings = load_settings()
    database_exists = DB_PATH.exists()
    with _job_lock:
        job = asdict(_job)
    return {
        "configured": bool(
            settings.get("rekordbox_xml")
            and settings.get("music_root")
            and settings.get("imported_at")
            and database_exists
        ),
        "database_exists": database_exists,
        # Once true, the setup dialog no longer opens by itself on page load.
        "seen": bool(settings.get("setup_seen")),
        "rekordbox_xml": settings.get("rekordbox_xml"),
        "music_root": settings.get("music_root"),
        "imported_at": settings.get("imported_at"),
        "job": job,
    }


def _clean_path(raw: str) -> Path:
    return Path(raw.strip().strip("\"'")).expanduser()


def _validate_xml(raw: str) -> Path:
    path = _clean_path(raw)
    if not raw.strip() or not path.is_file():
        raise HTTPException(status_code=400, detail=f"Rekordbox XML not found: {path}")
    with path.open("rb") as handle:
        head = handle.read(4096)
    if b"DJ_PLAYLISTS" not in head:
        raise HTTPException(
            status_code=400,
            detail=(
                "That file is not a Rekordbox collection export. In Rekordbox, "
                "use File → Export Collection in xml format."
            ),
        )
    return path.resolve()


def _validate_folder(raw: str) -> Path:
    path = _clean_path(raw)
    if not raw.strip() or not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Music folder not found: {path}")
    return path.resolve()


def _run_import(xml_path: Path) -> None:
    def on_progress(done: int, total: int) -> None:
        _update_job(done=done, total=total)

    try:
        if str(_AUDIO_EXTRACTION_DIR) not in sys.path:
            sys.path.insert(0, str(_AUDIO_EXTRACTION_DIR))
        from ingest_rekordbox import ingest_library

        stats = ingest_library(xml_path, DB_PATH, skip_audio=True, on_progress=on_progress)
        update_settings(imported_at=datetime.now(timezone.utc).isoformat())
        tracks = stats["unchanged"] + stats["upserted"]

        _update_job(phase="analysis", done=0, total=0)
        stats = ingest_library(xml_path, DB_PATH, on_progress=on_progress)
        missing = stats["missing_file"]
        message = f"Imported {tracks} tracks."
        if missing:
            message += f" {missing} audio files could not be found."
        _update_job(state="done", phase=None, message=message)
    except Exception as error:
        logger.exception("Library import failed")
        _update_job(state="error", message=str(error) or type(error).__name__)


@router.get("")
def get_setup() -> dict[str, Any]:
    return _status()


@router.post("")
def start_setup(request: SetupRequest) -> dict[str, Any]:
    """Save both paths and start importing the XML into the library database."""
    xml_path = _validate_xml(request.rekordbox_xml)
    music_root = _validate_folder(request.music_root)
    with _job_lock:
        if _job.state == "running":
            raise HTTPException(status_code=409, detail="A library import is already running.")
        for name, value in asdict(ImportJob(state="running", phase="tracks")).items():
            setattr(_job, name, value)
    update_settings(
        rekordbox_xml=str(xml_path), music_root=str(music_root), setup_seen=True
    )
    threading.Thread(
        target=_run_import, args=(xml_path,), name="library-import", daemon=True
    ).start()
    return _status()


@router.post("/seen")
def mark_setup_seen() -> dict[str, Any]:
    """Remember that the setup dialog was shown so it only opens by itself once."""
    update_settings(setup_seen=True)
    return _status()


_BROWSE_SCRIPTS = {
    "xml": (
        'POSIX path of (choose file with prompt "Choose your Rekordbox XML export" '
        'of type {"public.xml", "xml"})'
    ),
    "folder": (
        'POSIX path of (choose folder with prompt "Choose the folder that holds your music files")'
    ),
}


@router.post("/browse")
def browse(request: BrowseRequest) -> dict[str, str | None]:
    """Open the native macOS picker on this machine. ``path`` is null on cancel.

    A browser folder picker never reveals the absolute path, but the API runs
    on the same Mac, so it can ask Finder's dialog instead.
    """
    if sys.platform != "darwin":
        raise HTTPException(
            status_code=501,
            detail="The file picker only works on macOS. Paste the path instead.",
        )
    try:
        result = subprocess.run(
            ["osascript", "-e", "activate", "-e", _BROWSE_SCRIPTS[request.kind]],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        return {"path": None}
    if result.returncode != 0:
        if "-128" in result.stderr:
            return {"path": None}
        raise HTTPException(
            status_code=500,
            detail=result.stderr.strip() or "Could not open the file picker.",
        )
    path = result.stdout.strip()
    if len(path) > 1:
        path = path.rstrip("/")
    return {"path": path or None}
