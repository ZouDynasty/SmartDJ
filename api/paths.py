"""Resolve library audio paths when the stored file has been converted."""

from __future__ import annotations

import re
from pathlib import Path

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


def resolve_audio_path(
    stored: str | Path | None,
    title: str | None = None,
) -> Path | None:
    """Return the on-disk file for a library path.

    If the stored path is gone, try the same stem with other audio extensions
    so a converted sibling (``song.flac`` → ``song.mp3``) still plays.
    Truncated names (cut at ``#`` / ``?``) are matched by filename prefix
    and title. When nothing exists, the original path is returned so callers
    can 410.
    """
    if not stored:
        return None
    path = Path(stored)
    if path.is_file():
        return path
    if path.suffix:
        for extension in FALLBACK_EXTENSIONS:
            if extension.lower() == path.suffix.lower():
                continue
            candidate = path.with_suffix(extension)
            if candidate.is_file():
                return candidate
        return path

    recovered = _pick_candidate(title, _prefix_candidates(path))
    return recovered if recovered is not None else path
