"""Resolve library audio paths when the stored file has been converted or moved."""

from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path

from api import settings

#: Same set ingest accepts. ``.mp3`` is first because FLAC→MP3 is the usual swap.
FALLBACK_EXTENSIONS = (".mp3", ".m4a", ".mp4", ".wav", ".aiff", ".aif", ".flac")

KIND_FOR_SUFFIX = {
    ".mp3": "MP3 File",
    ".m4a": "M4A File",
    ".mp4": "MP4 File",
    ".wav": "WAV File",
    ".aiff": "AIFF File",
    ".aif": "AIFF File",
    ".flac": "FLAC File",
}


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _prefix_candidates(path: Path) -> list[Path]:
    """Files whose names start with a truncated library path.

    Rekordbox ``file://`` locations lose everything after ``#`` or ``?``,
    so ``Same B#tches.mp3`` is stored as ``Same B``.
    """
    if not path.name or not path.parent.is_dir():
        return []
    prefix = path.name
    return [
        child
        for child in path.parent.iterdir()
        if child.is_file()
        and child.name.startswith(prefix)
        and child.suffix.lower() in KIND_FOR_SUFFIX
    ]


def _pick_candidate(title: str | None, candidates: list[Path]) -> Path | None:
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    if not title:
        return None
    title_tokens = _tokens(title)
    if not title_tokens:
        return None

    best: Path | None = None
    best_score = -1
    for candidate in candidates:
        name_tokens = _tokens(candidate.stem)
        overlap = len(title_tokens & name_tokens)
        extra_in_name = len(name_tokens - title_tokens)
        score = overlap * 100 - extra_in_name
        if title_tokens <= name_tokens:
            score += 25
        if score > best_score:
            best_score = score
            best = candidate
    return best if best_score > 0 else None


def _resolve_at(path: Path, title: str | None) -> Path | None:
    """``path`` itself, a converted sibling, or a truncated-name match."""
    if path.is_file():
        return path
    if path.suffix:
        for extension in FALLBACK_EXTENSIONS:
            if extension.lower() == path.suffix.lower():
                continue
            candidate = path.with_suffix(extension)
            if candidate.is_file():
                return candidate
        return None
    return _pick_candidate(title, _prefix_candidates(path))


def _paths_under_root(path: Path, root: Path) -> list[Path]:
    """``path`` re-rooted at ``root``, keeping as many trailing folders as possible.

    ``/Users/me/Music/DJ/House/song.mp3`` under ``/Volumes/USB/DJ`` tries
    ``.../Music/DJ/House/song.mp3``, ``.../DJ/House/song.mp3``, ``.../House/song.mp3``
    and finally ``/Volumes/USB/DJ/song.mp3``.
    """
    parts = path.parts[1:] if path.is_absolute() else path.parts
    return [root.joinpath(*parts[-keep:]) for keep in range(len(parts) - 1, 0, -1)]


#: Walking a large music folder takes about a second, so one walk serves a
#: whole ingest or listening session and is redone at most this often.
INDEX_MAX_AGE_SECONDS = 300.0

_index_lock = threading.Lock()
_index: tuple[Path, float, dict[str, list[Path]]] | None = None


def _files_by_stem(root: Path) -> dict[str, list[Path]]:
    global _index
    with _index_lock:
        if (
            _index is not None
            and _index[0] == root
            and time.monotonic() - _index[1] < INDEX_MAX_AGE_SECONDS
        ):
            return _index[2]
        by_stem: dict[str, list[Path]] = {}
        for directory, _folders, files in os.walk(root):
            for name in files:
                candidate = Path(directory, name)
                if candidate.suffix.lower() in KIND_FOR_SUFFIX and not name.startswith("._"):
                    by_stem.setdefault(candidate.stem.lower(), []).append(candidate)
        _index = (root, time.monotonic(), by_stem)
        return by_stem


def _find_in_index(path: Path, root: Path) -> Path | None:
    """A file anywhere under ``root`` with the same name, preferring the same extension
    and then the most matching parent folder names."""
    candidates = _files_by_stem(root).get(path.stem.lower()) if path.suffix else None
    if not candidates:
        return None
    stored_folders = [part.lower() for part in reversed(path.parent.parts)]

    def score(candidate: Path) -> tuple[bool, int]:
        shared = 0
        for stored, found in zip(stored_folders, reversed(candidate.parent.parts)):
            if stored != found.lower():
                break
            shared += 1
        return candidate.suffix.lower() == path.suffix.lower(), shared

    return max(candidates, key=score)


_CONFIGURED_ROOT = object()


def resolve_audio_path(
    stored: str | Path | None,
    title: str | None = None,
    music_root: Path | None | object = _CONFIGURED_ROOT,
) -> Path | None:
    """Return the on-disk file for a library path.

    If the stored path is gone, try the same stem with other audio extensions
    so a converted sibling (``song.flac`` → ``song.mp3``) still plays.
    Truncated names (cut at ``#`` / ``?``) are matched by filename prefix
    and title. Then look under the music folder from setup (``music_root``
    overrides it), first at the same relative location and then by filename
    anywhere inside it. When nothing exists, the original path is returned so
    callers can 410.
    """
    if not stored:
        return None
    path = Path(stored)
    found = _resolve_at(path, title)
    if found is not None:
        return found

    root = settings.music_root() if music_root is _CONFIGURED_ROOT else music_root
    if not isinstance(root, Path):
        return path
    for candidate in _paths_under_root(path, root):
        found = _resolve_at(candidate, title)
        if found is not None:
            return found
    found = _find_in_index(path, root)
    return found if found is not None else path
