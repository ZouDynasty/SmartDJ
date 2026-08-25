#!/usr/bin/env python3
"""Parse a Rekordbox XML collection export (DJ_PLAYLISTS)."""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse

TEMPO_FIELDS = ("Inizio", "Bpm", "Metro", "Battito")
POSITION_MARK_FIELDS = ("Name", "Type", "Start", "End", "Num", "Red", "Green", "Blue")
WINDOWS_ABS_PATH = re.compile(r"^/[A-Za-z]:")

# Folder vs playlist NODE types in Rekordbox XML.
NODE_FOLDER = "0"
NODE_PLAYLIST = "1"


@dataclass(frozen=True)
class RekordboxTrack:
    """One ``<TRACK>`` entry from ``<COLLECTION>``."""

    track_id: int
    attributes: dict[str, str]
    name: str | None
    artist: str | None
    genre: str | None
    average_bpm: float | None
    tonality: str | None
    total_time: float | None
    comments: str | None
    rating: int | None
    location: str | None
    file_path: str | None
    tempo_markers: list[dict[str, str | None]]
    position_markers: list[dict[str, str | None]]

    def markers_json(self) -> tuple[str, str]:
        return (
            json.dumps(self.tempo_markers, ensure_ascii=False),
            json.dumps(self.position_markers, ensure_ascii=False),
        )


@dataclass
class PlaylistNode:
    """A folder (Type=0) or playlist (Type=1) under ``<PLAYLISTS>``."""

    name: str
    node_type: str
    children: list[PlaylistNode] = field(default_factory=list)
    track_keys: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class RekordboxLibrary:
    tracks: list[RekordboxTrack]
    playlists: PlaylistNode | None
    product: dict[str, str]


def decode_rekordbox_location(location: str | None) -> str | None:
    """URL-decode a ``file://localhost/...`` Location into an absolute path."""
    if location is None:
        return None
    raw = location.strip()
    if not raw:
        return None

    parsed = urlparse(raw)
    if parsed.scheme == "file":
        path = unquote(parsed.path or "")
    else:
        path = unquote(raw)

    if WINDOWS_ABS_PATH.match(path):
        path = path[1:]
    return path or None


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _opt_int(value: str | None) -> int | None:
    text = _blank(value)
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _opt_float(value: str | None) -> float | None:
    text = _blank(value)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_average_bpm(value: str | None) -> float | None:
    """Rekordbox stores ``0`` / ``0.00`` when BPM is unset."""
    bpm = _opt_float(value)
    if bpm is None or bpm <= 0:
        return None
    return bpm


def _child_records(
    element: ET.Element, tag: str, fields: tuple[str, ...]
) -> list[dict[str, str | None]]:
    records: list[dict[str, str | None]] = []
    for child in element.findall(tag):
        records.append({field: child.attrib.get(field) for field in fields})
    return records


def parse_track_element(element: ET.Element) -> RekordboxTrack | None:
    track_id = _opt_int(element.attrib.get("TrackID"))
    if track_id is None:
        return None

    location = _blank(element.attrib.get("Location"))
    return RekordboxTrack(
        track_id=track_id,
        attributes=dict(element.attrib),
        name=_blank(element.attrib.get("Name")),
        artist=_blank(element.attrib.get("Artist")),
        genre=_blank(element.attrib.get("Genre")),
        average_bpm=parse_average_bpm(element.attrib.get("AverageBpm")),
        tonality=_blank(element.attrib.get("Tonality")),
        total_time=_opt_float(element.attrib.get("TotalTime")),
        comments=_blank(element.attrib.get("Comments")),
        rating=_opt_int(element.attrib.get("Rating")),
        location=location,
        file_path=decode_rekordbox_location(location),
        tempo_markers=_child_records(element, "TEMPO", TEMPO_FIELDS),
        position_markers=_child_records(element, "POSITION_MARK", POSITION_MARK_FIELDS),
    )


def _node_type(element: ET.Element) -> str:
    raw = element.attrib.get("Type", NODE_FOLDER)
    if raw == NODE_PLAYLIST:
        return "playlist"
    return "folder"


def parse_playlist_node(element: ET.Element) -> PlaylistNode:
    node = PlaylistNode(name=element.attrib.get("Name") or "", node_type=_node_type(element))
    if node.node_type == "playlist":
        for child in element.findall("TRACK"):
            key = _opt_int(child.attrib.get("Key"))
            if key is not None:
                node.track_keys.append(key)
        return node

    for child in element.findall("NODE"):
        node.children.append(parse_playlist_node(child))
    return node


def parse_rekordbox_xml(source: str | Path | ET.Element) -> RekordboxLibrary:
    """Parse a Rekordbox collection from a path, XML string, or element."""
    if isinstance(source, ET.Element):
        root = source
    else:
        text = source if isinstance(source, str) and "<" in str(source)[:256] else None
        if text is None:
            tree = ET.parse(source)
            root = tree.getroot()
        else:
            root = ET.fromstring(text)

    product_el = root.find("PRODUCT")
    product = dict(product_el.attrib) if product_el is not None else {}

    tracks: list[RekordboxTrack] = []
    collection = root.find("COLLECTION")
    if collection is not None:
        for element in collection.findall("TRACK"):
            parsed = parse_track_element(element)
            if parsed is not None:
                tracks.append(parsed)

    playlists_el = root.find("PLAYLISTS")
    playlists = None
    if playlists_el is not None:
        root_node = playlists_el.find("NODE")
        if root_node is not None:
            playlists = parse_playlist_node(root_node)

    return RekordboxLibrary(tracks=tracks, playlists=playlists, product=product)


def iter_playlist_rows(
    node: PlaylistNode | None,
    *,
    parent_path: str = "",
    skip_root: bool = True,
) -> Iterable[tuple[str, str | None, PlaylistNode]]:
    """Yield ``(path, parent_path, node)`` in depth-first order.

    Rekordbox's synthetic ROOT folder is skipped by default so top-level
    playlists sit at ``/Name``.
    """
    if node is None:
        return
    is_root = skip_root and node.name.upper() == "ROOT" and parent_path == ""
    if is_root:
        for child in node.children:
            yield from iter_playlist_rows(child, parent_path="", skip_root=False)
        return

    path = f"{parent_path}/{node.name}" if parent_path else f"/{node.name}"
    yield path, (parent_path or None), node
    for child in node.children:
        yield from iter_playlist_rows(child, parent_path=path, skip_root=False)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect a Rekordbox XML export.")
    parser.add_argument("xml_path", type=Path, help="Path to rekordbox.xml / Collection.xml")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    xml_path = args.xml_path.expanduser().resolve()
    library = parse_rekordbox_xml(xml_path)
    playlist_count = sum(
        1 for _path, _parent, node in iter_playlist_rows(library.playlists) if node.node_type == "playlist"
    )
    folder_count = sum(
        1 for _path, _parent, node in iter_playlist_rows(library.playlists) if node.node_type == "folder"
    )
    missing_bpm = sum(1 for track in library.tracks if track.average_bpm is None)
    missing_key = sum(1 for track in library.tracks if not track.tonality)
    missing_genre = sum(1 for track in library.tracks if not track.genre)
    print(f"product:    {library.product}")
    print(f"tracks:     {len(library.tracks)}")
    print(f"playlists:  {playlist_count}  folders: {folder_count}")
    print(f"missing:    bpm={missing_bpm}  tonality={missing_key}  genre={missing_genre}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
