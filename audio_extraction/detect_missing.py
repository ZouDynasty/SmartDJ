#!/usr/bin/env python3
"""Fill missing/invalid track fields with ID3 tags first, then Essentia.

Importing this module does not touch the database. Batch writes require
``--apply``; ``--dry-run`` prints detections only. Analyze one file with
``--file path`` (no DB).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import ssl
import urllib.request
from pathlib import Path
from typing import Any

import certifi
import numpy as np
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from energy import extract_energy_features, score_features
from extract_tags import (
    DEFAULT_DB_PATH,
    TrackInfo,
    camelot_from_key,
    connect_db,
    extract_tags,
    parse_bpm,
    parse_key_fields,
    sql_ident,
)
from normalize_genres import GENERIC_LABELS, UNCATEGORIZED

console = Console()

DETECTABLE_FIELDS = (
    "title",
    "artist",
    "duration",
    "bpm",
    "key",
    "camelot_key",
    "energy_score",
    "genre",
)

ANALYSIS_SAMPLE_RATE = 44100
GENRE_SAMPLE_RATE = 16000

REPO_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
LOCAL_MODELS_DIR = Path(__file__).resolve().parent / "models"
EMBEDDING_MODEL = "discogs-effnet-bs64-1.pb"
GENRE_MODEL = "genre_discogs400-discogs-effnet-1.pb"
GENRE_LABELS = "genre_discogs400-discogs-effnet-1.json"
MODEL_URLS = {
    EMBEDDING_MODEL: (
        "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/"
        "discogs-effnet-bs64-1.pb"
    ),
    GENRE_MODEL: (
        "https://essentia.upf.edu/models/classification-heads/genre_discogs400/"
        "genre_discogs400-discogs-effnet-1.pb"
    ),
    GENRE_LABELS: (
        "https://essentia.upf.edu/models/classification-heads/genre_discogs400/"
        "genre_discogs400-discogs-effnet-1.json"
    ),
}

_AUDIO_RUNTIME: dict[str, Any] | None = None
_GENRE_RUNTIME: dict[str, Any] | None = None
_GENRE_LOAD_ERROR: BaseException | None = None

LEADING_INDEX = re.compile(r"^\d{1,3}\s*[-._]\s*")
ARTIST_TITLE = re.compile(r"^(?:(?:\d{1,3}\s*[-._]\s*))?(.+?)\s+-\s+(.+)$")


def _essentia_runtime() -> dict[str, Any]:
    global _AUDIO_RUNTIME
    if _AUDIO_RUNTIME is None:
        from essentia.standard import (  # type: ignore
            KeyExtractor,
            MonoLoader,
            Resample,
            RhythmExtractor2013,
        )

        # Essentia does not ship a TensorFlow musical-key model. The strongest
        # in-tree detector is Faraldo's EDM profile (bgate) on 36-bin HPCP so
        # averageDetuningCorrection can actually run (it is a no-op at 12 bins).
        _AUDIO_RUNTIME = {
            "MonoLoader": MonoLoader,
            "rhythm": RhythmExtractor2013(method="multifeature"),
            "key": KeyExtractor(
                profileType="bgate",
                hpcpSize=36,
                averageDetuningCorrection=True,
                sampleRate=ANALYSIS_SAMPLE_RATE,
            ),
            "Resample": Resample,
        }
    return _AUDIO_RUNTIME


def load_audio(file_path: str | Path, sample_rate: int = ANALYSIS_SAMPLE_RATE):
    """Decode a file once as mono float audio at ``sample_rate`` Hz."""
    runtime = _essentia_runtime()
    audio = runtime["MonoLoader"](filename=str(file_path), sampleRate=sample_rate)()
    if audio is None or len(audio) == 0:
        return None
    return audio


def extract_bpm(audio) -> float | None:
    """BPM from a mono buffer via ``RhythmExtractor2013(method='multifeature')``."""
    if audio is None or len(audio) == 0:
        return None
    runtime = _essentia_runtime()
    bpm, _ticks, _confidence, _estimates, _intervals = runtime["rhythm"](audio)
    return parse_bpm(float(bpm))


def extract_key(audio) -> tuple[str | None, str | None]:
    """Return ``(musical key, Camelot)`` from ``KeyExtractor(profileType='bgate', hpcpSize=36)``."""
    if audio is None or len(audio) == 0:
        return None, None
    runtime = _essentia_runtime()
    note, scale, _strength = runtime["key"](audio)
    camelot = camelot_from_key(str(note), str(scale))
    if not camelot:
        return None, None
    display_note = str(note).strip()
    display_scale = str(scale).strip().lower()
    return f"{display_note} {display_scale}", camelot


def extract_energy_score(audio, sample_rate: int = ANALYSIS_SAMPLE_RATE) -> float | None:
    """Score perceived energy on an absolute 0–10 scale.

    Features come from the loudest 45 s of the file (see ``energy.py``).
    """
    features = extract_energy_features(audio, sample_rate)
    if features is None:
        return None
    return score_features(features)


def _model_destination(filename: str) -> Path:
    for directory in (REPO_MODELS_DIR, LOCAL_MODELS_DIR):
        candidate = directory / filename
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return REPO_MODELS_DIR / filename


def _download_model(filename: str) -> Path:
    destination = _model_destination(filename)
    if destination.exists() and destination.stat().st_size > 0:
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    url = MODEL_URLS[filename]
    console.print(f"[dim]Downloading {filename}...[/dim]")
    context = ssl.create_default_context(cafile=certifi.where())
    tmp_path = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with urllib.request.urlopen(url, context=context) as response, tmp_path.open("wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        tmp_path.replace(destination)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise
    return destination


def _load_genre_runtime() -> dict[str, Any] | None:
    global _GENRE_RUNTIME, _GENRE_LOAD_ERROR
    if _GENRE_RUNTIME is not None:
        return _GENRE_RUNTIME
    if _GENRE_LOAD_ERROR is not None:
        return None

    try:
        from essentia.standard import (  # type: ignore
            TensorflowPredict2D,
            TensorflowPredictEffnetDiscogs,
        )

        embedding_path = _download_model(EMBEDDING_MODEL)
        classifier_path = _download_model(GENRE_MODEL)
        labels_path = _download_model(GENRE_LABELS)
        labels = json.loads(labels_path.read_text())["classes"]

        _GENRE_RUNTIME = {
            "embedder": TensorflowPredictEffnetDiscogs(
                graphFilename=str(embedding_path),
                output="PartitionedCall:1",
                patchHopSize=128,
            ),
            "classifier": TensorflowPredict2D(
                graphFilename=str(classifier_path),
                input="serving_default_model_Placeholder",
                output="PartitionedCall:0",
            ),
            "labels": labels,
        }
        return _GENRE_RUNTIME
    except Exception as exc:
        _GENRE_LOAD_ERROR = exc
        console.print(f"[yellow]Genre detection disabled:[/yellow] {exc}")
        return None


def _empty_model_input(value: object) -> bool:
    if value is None:
        return True
    try:
        if len(value) == 0:  # type: ignore[arg-type]
            return True
    except TypeError:
        pass
    return np.asarray(value).size == 0


def extract_genre(audio, sample_rate: int = ANALYSIS_SAMPLE_RATE) -> str | None:
    """Discogs-EffNet genre label from a mono buffer (resampled to 16 kHz)."""
    if audio is None or len(audio) == 0:
        return None
    runtime = _load_genre_runtime()
    if runtime is None:
        return None
    try:
        audio_16k = audio
        if sample_rate != GENRE_SAMPLE_RATE:
            resampler = _essentia_runtime()["Resample"]
            audio_16k = resampler(
                inputSampleRate=sample_rate, outputSampleRate=GENRE_SAMPLE_RATE
            )(audio)
        if _empty_model_input(audio_16k):
            return None
        embeddings = runtime["embedder"](audio_16k)
        if _empty_model_input(embeddings):
            return None
        predictions = np.asarray(runtime["classifier"](embeddings))
        if predictions.size == 0:
            return None
        scores = np.mean(predictions, axis=0) if predictions.ndim == 2 else predictions
        label = runtime["labels"][int(np.argmax(scores))]
        if "---" in label:
            return label.split("---", 1)[1].strip()
        return str(label)
    except Exception as exc:
        console.print(f"[yellow]Genre detection failed:[/yellow] {exc}")
        return None


def detect_title(path: Path, row: dict[str, Any] | None = None) -> str | None:
    _ = row
    stem = path.stem.strip()
    match = ARTIST_TITLE.match(stem)
    if match:
        return match.group(2).strip() or None
    title = LEADING_INDEX.sub("", stem).strip()
    return title or None


def detect_artist(path: Path, row: dict[str, Any] | None = None) -> str | None:
    _ = row
    match = ARTIST_TITLE.match(path.stem.strip())
    if match:
        return match.group(1).strip() or None
    return None


def _accepted_bpm(*values: object) -> float | None:
    for value in values:
        parsed = parse_bpm(value)
        if parsed is not None:
            return parsed
    return None


def _accepted_key_camelot(*pairs: tuple[object, object]) -> tuple[str | None, str | None]:
    for key_value, camelot_value in pairs:
        if camelot_value:
            musical, camelot = parse_key_fields(str(camelot_value))
            if camelot:
                return musical, camelot
        if key_value:
            musical, camelot = parse_key_fields(str(key_value))
            if camelot:
                return musical, camelot
    return None, None


def _empty(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def analyze_track(
    file_path: str | Path,
    current_tags: dict[str, Any] | TrackInfo | None = None,
    *,
    force_audio_key: bool = False,
    force_audio_genre: bool = False,
) -> dict[str, Any]:
    """Tag-first analysis of one file. Loads audio at 44.1 kHz only if needed."""
    path = Path(file_path)
    if isinstance(current_tags, TrackInfo):
        tags = {
            "title": current_tags.title,
            "artist": current_tags.artist,
            "duration": current_tags.duration,
            "bpm": current_tags.bpm,
            "key": current_tags.key,
            "camelot_key": current_tags.camelot_key,
            "energy_score": current_tags.energy_score,
            "genre": current_tags.genre,
        }
    else:
        tags = dict(current_tags or {})

    id3 = extract_tags(path)
    sources = {
        "title": None,
        "artist": None,
        "duration": None,
        "bpm": None,
        "key": None,
        "genre": None,
        "energy_score": None,
    }

    title = tags.get("title") or id3.title or detect_title(path)
    sources["title"] = (
        "current" if tags.get("title") else "id3" if id3.title else "filename" if title else None
    )
    artist = tags.get("artist") or id3.artist or detect_artist(path)
    sources["artist"] = (
        "current" if tags.get("artist") else "id3" if id3.artist else "filename" if artist else None
    )

    bpm = _accepted_bpm(tags.get("bpm"), id3.bpm)
    if bpm is not None:
        sources["bpm"] = "current" if parse_bpm(tags.get("bpm")) is not None else "id3"

    key, camelot_key = (None, None) if force_audio_key else _accepted_key_camelot(
        (tags.get("key"), tags.get("camelot_key")),
        (id3.key, id3.camelot_key),
    )
    if camelot_key is not None:
        sources["key"] = (
            "current"
            if _accepted_key_camelot((tags.get("key"), tags.get("camelot_key")))[1]
            else "id3"
        )

    if force_audio_genre:
        genre = None
    else:
        genre = tags.get("genre") or id3.genre
        if not _empty(genre):
            sources["genre"] = "current" if tags.get("genre") else "id3"
        else:
            genre = None

    duration = tags.get("duration") if tags.get("duration") else id3.duration
    if duration:
        sources["duration"] = "current" if tags.get("duration") else "id3"

    energy = tags.get("energy_score")
    if energy is not None:
        sources["energy_score"] = "current"

    needs_audio = any(
        value is None
        for value in (bpm, key, camelot_key, genre, duration, energy)
    )
    audio = None
    if needs_audio and path.is_file():
        try:
            audio = load_audio(path, ANALYSIS_SAMPLE_RATE)
        except Exception as exc:
            console.print(f"[yellow]{path.name}: audio load failed:[/yellow] {exc}")
            audio = None

    if audio is not None:
        if duration is None:
            duration = len(audio) / float(ANALYSIS_SAMPLE_RATE)
            sources["duration"] = "essentia"
        if bpm is None:
            bpm = extract_bpm(audio)
            if bpm is not None:
                sources["bpm"] = "essentia"
        if camelot_key is None:
            key, camelot_key = extract_key(audio)
            if camelot_key is not None:
                sources["key"] = "essentia"
        if energy is None:
            energy = extract_energy_score(audio, ANALYSIS_SAMPLE_RATE)
            if energy is not None:
                sources["energy_score"] = "essentia"
        if genre is None:
            genre = extract_genre(audio, ANALYSIS_SAMPLE_RATE)
            if genre is not None:
                sources["genre"] = "essentia"

    return {
        "file_path": str(path),
        "title": title,
        "artist": artist,
        "duration": duration,
        "bpm": bpm,
        "key": key,
        "camelot_key": camelot_key,
        "energy_score": energy,
        "genre": genre,
        "sources": sources,
    }


def load_tracks_needing_analysis(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    placeholders = " OR ".join(f"{sql_ident(field)} IS NULL" for field in DETECTABLE_FIELDS)
    query = f"""
        SELECT * FROM tracks
        WHERE {placeholders}
           OR bpm < 40 OR bpm > 260
           OR camelot_key IS NULL
           OR trim(coalesce(camelot_key, '')) = ''
    """
    connection.row_factory = sqlite3.Row
    return [dict(row) for row in connection.execute(query).fetchall()]


def load_all_tracks(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    connection.row_factory = sqlite3.Row
    return [dict(row) for row in connection.execute("SELECT * FROM tracks").fetchall()]


def _strip_dsp_fields(row: dict[str, Any]) -> dict[str, Any]:
    """Keep metadata, but force BPM/key/energy through ID3 + Essentia again."""
    stripped = dict(row)
    for field in ("bpm", "key", "camelot_key", "energy_score"):
        stripped[field] = None
    return stripped


def _strip_key_fields(row: dict[str, Any]) -> dict[str, Any]:
    stripped = dict(row)
    stripped["key"] = None
    stripped["camelot_key"] = None
    return stripped


def _generic_genre(value: object) -> bool:
    if _empty(value):
        return True
    return preprocess_genre_label(str(value)) in GENERIC_LABELS


def preprocess_genre_label(raw: str) -> str:
    return " ".join(raw.strip().casefold().split())


def _needs_genre_refresh(row: dict[str, Any]) -> bool:
    return (
        _generic_genre(row.get("genre"))
        or row.get("macro_genre") == UNCATEGORIZED
        or _empty(row.get("clean_genre"))
    )


def _strip_genre_field(row: dict[str, Any]) -> dict[str, Any]:
    stripped = dict(row)
    stripped["genre"] = None
    return stripped


def detect_missing_fields(
    path: Path,
    row: dict[str, Any],
    *,
    force_audio_key: bool = False,
    force_audio_genre: bool = False,
) -> dict[str, Any]:
    """Return fields to write: missing or failing ID3/range validation."""
    analysis = analyze_track(
        path,
        current_tags=row,
        force_audio_key=force_audio_key,
        force_audio_genre=force_audio_genre,
    )
    updates: dict[str, Any] = {}
    for field in DETECTABLE_FIELDS:
        new_value = analysis.get(field)
        if new_value is None:
            continue
        current = row.get(field)
        if field == "bpm":
            if parse_bpm(current) is None:
                updates[field] = new_value
            continue
        if field == "camelot_key":
            _, camelot = _accepted_key_camelot((row.get("key"), row.get("camelot_key")))
            if camelot is None:
                updates[field] = new_value
            continue
        if field == "key":
            musical, _camelot = _accepted_key_camelot((row.get("key"), row.get("camelot_key")))
            if _empty(current) or musical is None:
                updates[field] = new_value
            continue
        if _empty(current):
            updates[field] = new_value
    return updates


def apply_updates(
    connection: sqlite3.Connection, file_path: str, updates: dict[str, Any]
) -> None:
    if not updates:
        return
    assignments = ", ".join(f"{sql_ident(field)} = :{field}" for field in updates)
    params = {**updates, "file_path": file_path}
    connection.execute(
        f"UPDATE tracks SET {assignments} WHERE file_path = :file_path",
        params,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect missing track fields (ID3 first, then Essentia)."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH}).",
    )
    parser.add_argument(
        "--file",
        type=Path,
        help="Analyze a single audio file and print the result. Does not touch the DB.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan the DB and print detections without writing.",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Scan the DB and write detections to SQLite.",
    )
    parser.add_argument(
        "--reanalyze",
        action="store_true",
        help=(
            "Recompute BPM, key, Camelot, and energy for every track "
            "(ID3 first, then Essentia). Use with --apply or --dry-run."
        ),
    )
    parser.add_argument(
        "--reanalyze-keys",
        action="store_true",
        help="Recompute only key and Camelot for every track (ID3 first, then bgate HPCP).",
    )
    parser.add_argument(
        "--reanalyze-genres",
        action="store_true",
        help="Recompute genre only when the current tag is missing, generic, or Uncategorized.",
    )
    return parser.parse_args(argv)


def _print_analysis(result: dict[str, Any]) -> None:
    sources = result.get("sources") or {}
    for field in DETECTABLE_FIELDS:
        origin = sources.get("key") if field == "camelot_key" else sources.get(field)
        origin_text = f" [dim]({origin})[/dim]" if origin else ""
        console.print(f"{field}: {result.get(field)}{origin_text}")


def run_batch(
    db_path: Path,
    *,
    apply: bool,
    reanalyze: bool = False,
    reanalyze_keys: bool = False,
    reanalyze_genres: bool = False,
) -> int:
    if not db_path.exists():
        console.print(f"[red]Database not found:[/red] {db_path}")
        console.print("Run extract_tags.py first.")
        return 1

    refresh_all = reanalyze or reanalyze_keys or reanalyze_genres
    with connect_db(db_path) as connection:
        tracks = load_all_tracks(connection) if refresh_all else load_tracks_needing_analysis(connection)
        if not tracks:
            console.print("No tracks with missing or invalid detectable fields.")
            return 0

        if reanalyze_genres or any(_empty(row.get("genre")) for row in tracks):
            _load_genre_runtime()

        filled = 0
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            transient=False,
            console=console,
        ) as progress:
            task = progress.add_task(
                f"Analyzing {len(tracks)} track(s)...",
                total=len(tracks),
            )
            for index, row in enumerate(tracks, start=1):
                path = Path(row["file_path"])
                if reanalyze:
                    analysis_row = _strip_dsp_fields(row)
                elif reanalyze_keys:
                    analysis_row = _strip_key_fields(row)
                elif reanalyze_genres:
                    if not _needs_genre_refresh(row):
                        progress.advance(task)
                        continue
                    analysis_row = _strip_genre_field(row)
                else:
                    analysis_row = row
                updates = detect_missing_fields(
                    path,
                    analysis_row,
                    force_audio_key=reanalyze_keys,
                    force_audio_genre=reanalyze_genres,
                )
                if reanalyze_keys:
                    updates = {k: v for k, v in updates.items() if k in {"key", "camelot_key"}}
                if reanalyze_genres:
                    updates = {k: v for k, v in updates.items() if k == "genre"}
                if updates:
                    filled += 1
                    if not apply:
                        console.print(f"{path.name}: {updates}")
                    else:
                        apply_updates(connection, row["file_path"], updates)
                        if filled % 10 == 0:
                            connection.commit()
                            console.print(
                                f"[dim]Committed {filled} updates "
                                f"({index}/{len(tracks)} scanned)[/dim]"
                            )
                progress.advance(task)

        if apply:
            connection.commit()

    action = "Updated" if apply else "Would update"
    console.print(f"{action} {filled} of {len(tracks)} track(s) in [bold]{db_path}[/bold]")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.file is not None:
        path = args.file.expanduser().resolve()
        if not path.is_file():
            console.print(f"[red]File not found:[/red] {path}")
            return 1
        _print_analysis(analyze_track(path))
        return 0

    if not args.dry_run and not args.apply:
        console.print("Pass --dry-run or --apply to scan the library, or --file PATH.")
        console.print("Importing this module does not write to the database.")
        return 2

    if args.reanalyze and not args.dry_run and not args.apply:
        console.print("Pass --reanalyze with --apply or --dry-run.")
        return 2

    return run_batch(
        args.db.expanduser().resolve(),
        apply=args.apply,
        reanalyze=args.reanalyze,
        reanalyze_keys=args.reanalyze_keys,
        reanalyze_genres=args.reanalyze_genres,
    )


if __name__ == "__main__":
    raise SystemExit(main())
