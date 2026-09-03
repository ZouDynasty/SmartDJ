"""Embedded album artwork extraction.

Cover art is read straight out of the audio file that the library's
``file_path`` points at, so nothing extra needs to be indexed. Each container
stores pictures differently: ID3 uses ``APIC`` frames, FLAC/Ogg expose a
``pictures`` list, and MP4/M4A uses the ``covr`` atom. Formats with no tag
support (WAV, AIFF) fall back to a cover image sitting next to the file.
"""

from __future__ import annotations

from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.mp4 import MP4Cover

#: Sidecar filenames checked when a file has no embedded picture.
SIDECAR_NAMES = (
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "folder.jpg",
    "folder.png",
    "front.jpg",
    "album.jpg",
)

SIDECAR_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

#: Magic bytes, used when a tag reports no or a bogus MIME type.
_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF8", "image/gif"),
)


def _sniff_media_type(data: bytes, declared: str | None = None) -> str:
    for signature, media_type in _SIGNATURES:
        if data.startswith(signature):
            return media_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if declared and declared.startswith("image/"):
        return declared
    return "application/octet-stream"


def _from_id3(tags: object) -> tuple[bytes, str] | None:
    getall = getattr(tags, "getall", None)
    if getall is None:
        return None
    frames = getall("APIC")
    if not frames:
        return None
    # Prefer the front cover (APIC type 3) when several pictures are embedded.
    frames = sorted(frames, key=lambda frame: getattr(frame, "type", 0) != 3)
    picture = frames[0]
    data = bytes(picture.data)
    if not data:
        return None
    return data, _sniff_media_type(data, getattr(picture, "mime", None))


def _from_pictures(audio: object) -> tuple[bytes, str] | None:
    pictures = getattr(audio, "pictures", None)
    if not pictures:
        return None
    ordered = sorted(pictures, key=lambda pic: getattr(pic, "type", 0) != 3)
    data = bytes(ordered[0].data)
    if not data:
        return None
    return data, _sniff_media_type(data, getattr(ordered[0], "mime", None))


def _from_mp4(tags: object) -> tuple[bytes, str] | None:
    if tags is None:
        return None
    try:
        covers = tags["covr"]
    except (KeyError, TypeError):
        return None
    if not covers:
        return None
    cover = covers[0]
    data = bytes(cover)
    if not data:
        return None
    declared = None
    if getattr(cover, "imageformat", None) == MP4Cover.FORMAT_PNG:
        declared = "image/png"
    elif getattr(cover, "imageformat", None) == MP4Cover.FORMAT_JPEG:
        declared = "image/jpeg"
    return data, _sniff_media_type(data, declared)


def _from_sidecar(path: Path) -> tuple[bytes, str] | None:
    directory = path.parent
    for name in SIDECAR_NAMES:
        candidate = directory / name
        if not candidate.is_file():
            continue
        data = candidate.read_bytes()
        if not data:
            continue
        declared = SIDECAR_MEDIA_TYPES.get(candidate.suffix.lower())
        return data, _sniff_media_type(data, declared)
    return None


def extract_artwork(path: Path) -> tuple[bytes, str] | None:
    """Return ``(image bytes, media type)`` for a track, or ``None``."""
    if not path.is_file():
        return None

    try:
        audio = MutagenFile(path)
    except Exception:  # noqa: BLE001 - malformed tags must not break the request
        audio = None

    if audio is not None:
        tags = getattr(audio, "tags", None)
        for candidate in (
            _from_pictures(audio),
            _from_id3(tags),
            _from_mp4(tags),
        ):
            if candidate is not None:
                return candidate

    return _from_sidecar(path)
