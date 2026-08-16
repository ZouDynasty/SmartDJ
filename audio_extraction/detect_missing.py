#!/usr/bin/env python3
"""Fill null track fields by analyzing audio (or the filename).

Run after extract_tags.py. Existing non-null values are never overwritten.
Each detectable column has one detect_* helper.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import ssl
import urllib.request
from pathlib import Path
from typing import Any, Callable

import certifi
import librosa
import numpy as np
import soundfile as sf
import soxr
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from extract_tags import (
    DEFAULT_DB_PATH,
    connect_db,
    parse_key_fields,
    sql_ident,
)

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

Detector = Callable[[Path, dict[str, Any]], Any]

PASS1_SR = 8000
PASS1_WINDOW_SEC = 45.0
PASS1_HOP_SEC = 5.0
TRIM_FRACTION = 0.10

PASS2_SR = 22050
PASS2_DURATION_SEC = 45.0
PASS2_FRAME_LENGTH = 2048
PASS2_HOP_LENGTH = 512

LOUDNESS_DB_MIN = -30.0
LOUDNESS_DB_MAX = -4.0
CENTROID_HZ_MIN = 200.0
CENTROID_HZ_MAX = 6000.0
ONSETS_PER_SEC_MAX = 10.0

# Mastered club tracks compress into a narrow raw band (~6–8.3). Stretch that onto 0–10.
RAW_ENERGY_LOW = 6.0
RAW_ENERGY_HIGH = 8.3

KRUMHANSL_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
KRUMHANSL_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

MODELS_DIR = Path(__file__).resolve().parent / "models"
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

_GENRE_RUNTIME: dict[str, Any] | None = None
_GENRE_LOAD_ERROR: BaseException | None = None

LEADING_INDEX = re.compile(r"^\d{1,3}\s*[-._]\s*")
ARTIST_TITLE = re.compile(r"^(?:(?:\d{1,3}\s*[-._]\s*))?(.+?)\s+-\s+(.+)$")


# ---------------------------------------------------------------------------
# Shared audio helpers
# ---------------------------------------------------------------------------

def _audio_duration(path: Path) -> float | None:
    try:
        return float(librosa.get_duration(path=str(path)))
    except Exception:
        try:
            info = sf.info(str(path))
        except Exception:
            return None
        if info.samplerate <= 0:
            return None
        return info.frames / float(info.samplerate)


def _to_mono(block: np.ndarray) -> np.ndarray:
    if block.ndim == 1:
        return np.asarray(block, dtype=np.float32)
    return np.asarray(block.mean(axis=1), dtype=np.float32)


def _resample(samples: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr or samples.size == 0:
        return np.asarray(samples, dtype=np.float32)
    return np.asarray(soxr.resample(samples, orig_sr, target_sr), dtype=np.float32)


def _stream_mono(path: Path, target_sr: int, block_sec: float = 10.0):
    """Yield downsampled mono chunks. Prefers streaming; falls back to a full load."""
    try:
        with sf.SoundFile(str(path)) as snd:
            native_sr = snd.samplerate
            blocksize = max(int(block_sec * native_sr), native_sr // 4)
            for block in snd.blocks(blocksize=blocksize, dtype="float32", always_2d=True):
                mono = _resample(_to_mono(block), native_sr, target_sr)
                if len(mono):
                    yield mono
            return
    except Exception:
        pass

    samples, _ = librosa.load(str(path), sr=target_sr, mono=True)
    if len(samples):
        yield np.asarray(samples, dtype=np.float32)


def _load_mono_segment(
    path: Path, target_sr: int, offset: float = 0.0, duration: float | None = None
) -> tuple[np.ndarray, int] | None:
    """Load a mono slice, streaming from soundfile when the format allows it."""
    try:
        with sf.SoundFile(str(path)) as snd:
            start = int(max(offset, 0.0) * snd.samplerate)
            start = min(start, max(snd.frames - 1, 0))
            snd.seek(start)
            n_frames = snd.frames - start
            if duration is not None:
                n_frames = min(n_frames, int(duration * snd.samplerate))
            block = snd.read(n_frames, dtype="float32", always_2d=True)
            mono = _resample(_to_mono(block), snd.samplerate, target_sr)
            return mono, target_sr
    except Exception:
        pass

    try:
        samples, sr = librosa.load(
            str(path), sr=target_sr, mono=True, offset=offset, duration=duration
        )
    except Exception:
        return None
    if samples.size == 0:
        return None
    return np.asarray(samples, dtype=np.float32), sr


def _unit_interval(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))


# ---------------------------------------------------------------------------
# detect_title
# ---------------------------------------------------------------------------

def detect_title(path: Path, row: dict[str, Any]) -> str | None:
    stem = path.stem.strip()
    match = ARTIST_TITLE.match(stem)
    if match:
        return match.group(2).strip() or None
    title = LEADING_INDEX.sub("", stem).strip()
    return title or None


# ---------------------------------------------------------------------------
# detect_artist
# ---------------------------------------------------------------------------

def detect_artist(path: Path, row: dict[str, Any]) -> str | None:
    match = ARTIST_TITLE.match(path.stem.strip())
    if match:
        return match.group(1).strip() or None
    return None


# ---------------------------------------------------------------------------
# detect_duration
# ---------------------------------------------------------------------------

def detect_duration(path: Path, row: dict[str, Any]) -> float | None:
    return _audio_duration(path)


# ---------------------------------------------------------------------------
# detect_bpm
# ---------------------------------------------------------------------------

def detect_bpm(path: Path, row: dict[str, Any]) -> float | None:
    duration = row.get("duration") or _audio_duration(path) or 0.0
    offset = duration * 0.15 if duration else 0.0
    loaded = _load_mono_segment(path, PASS2_SR, offset=offset, duration=90.0)
    if loaded is None:
        return None
    samples, sr = loaded
    tempo, _ = librosa.beat.beat_track(y=samples, sr=sr, start_bpm=120.0)
    bpm = float(np.atleast_1d(tempo)[0])
    return round(bpm, 2) if bpm > 0 else None


# ---------------------------------------------------------------------------
# detect_key
# ---------------------------------------------------------------------------

def detect_key(path: Path, row: dict[str, Any]) -> str | None:
    duration = row.get("duration") or _audio_duration(path) or 0.0
    offset = duration * 0.15 if duration else 0.0
    loaded = _load_mono_segment(path, PASS2_SR, offset=offset, duration=90.0)
    if loaded is None:
        return None
    samples, sr = loaded

    chroma = np.mean(
        librosa.feature.chroma_cqt(y=samples, sr=sr, hop_length=4096),
        axis=1,
    )
    if not np.any(chroma):
        return None

    best_score = -np.inf
    best_label = None
    for shift in range(12):
        rotated = np.roll(chroma, -shift)
        major = float(np.corrcoef(KRUMHANSL_MAJOR, rotated)[0, 1])
        minor = float(np.corrcoef(KRUMHANSL_MINOR, rotated)[0, 1])
        if not np.isfinite(major):
            major = -np.inf
        if not np.isfinite(minor):
            minor = -np.inf
        if major > best_score:
            best_score = major
            best_label = f"{PITCH_CLASSES[shift]} major"
        if minor > best_score:
            best_score = minor
            best_label = f"{PITCH_CLASSES[shift]} minor"
    return best_label


# ---------------------------------------------------------------------------
# detect_camelot_key
# ---------------------------------------------------------------------------

def detect_camelot_key(path: Path, row: dict[str, Any]) -> str | None:
    _ = path
    _, camelot = parse_key_fields(row.get("key"))
    return camelot


# ---------------------------------------------------------------------------
# detect_energy_score
# Pass 1: low-resolution drop pinpointing
# Pass 2: 45s high-resolution loudness / brightness / transient mix
# ---------------------------------------------------------------------------

def _window_rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples))))


def _find_drop_offset(path: Path, duration: float) -> float:
    """Stream 8 kHz mono and pick the loudest 45s window inside the middle 80%."""
    window_samples = int(PASS1_WINDOW_SEC * PASS1_SR)
    hop_samples = int(PASS1_HOP_SEC * PASS1_SR)
    usable_start = duration * TRIM_FRACTION
    usable_end = duration * (1.0 - TRIM_FRACTION)

    buffer = np.zeros(0, dtype=np.float32)
    playhead = 0.0
    candidates: list[tuple[float, float]] = []

    for chunk in _stream_mono(path, PASS1_SR):
        buffer = np.concatenate([buffer, chunk])
        while len(buffer) >= window_samples:
            rms = _window_rms(buffer[:window_samples])
            window_end = playhead + PASS1_WINDOW_SEC
            in_bounds = playhead >= usable_start and window_end <= usable_end
            if duration < PASS1_WINDOW_SEC / (1.0 - 2 * TRIM_FRACTION):
                in_bounds = True
            if in_bounds:
                candidates.append((playhead, rms))
            buffer = buffer[hop_samples:]
            playhead += PASS1_HOP_SEC

    if not candidates:
        return max(duration * 0.25, 0.0)

    drop_offset, _ = max(candidates, key=lambda item: item[1])
    max_start = max(duration - PASS2_DURATION_SEC, 0.0)
    return float(np.clip(drop_offset, 0.0, max_start))


def _peak_log_loudness(samples: np.ndarray) -> float:
    """Top 10% frame RMS, converted to dB and mapped from [-30, -4] to 0–1."""
    rms = librosa.feature.rms(
        y=samples,
        frame_length=PASS2_FRAME_LENGTH,
        hop_length=PASS2_HOP_LENGTH,
    )[0]
    if rms.size == 0:
        return 0.0
    top_n = max(1, int(np.ceil(rms.size * 0.10)))
    peak = float(np.mean(np.sort(rms)[-top_n:]))
    db = 20.0 * np.log10(max(peak, 1e-12))
    return _unit_interval(db, LOUDNESS_DB_MIN, LOUDNESS_DB_MAX)


def _spectral_brightness(samples: np.ndarray, sr: int) -> float:
    centroid = librosa.feature.spectral_centroid(
        y=samples,
        sr=sr,
        n_fft=PASS2_FRAME_LENGTH,
        hop_length=PASS2_HOP_LENGTH,
    )[0]
    if centroid.size == 0:
        return 0.0
    return _unit_interval(float(np.mean(centroid)), CENTROID_HZ_MIN, CENTROID_HZ_MAX)


def _transient_density(samples: np.ndarray, sr: int) -> float:
    onset_env = librosa.onset.onset_strength(y=samples, sr=sr)
    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, units="time"
    )
    seconds = max(len(samples) / float(sr), 1e-6)
    hits_per_sec = len(onsets) / seconds
    return _unit_interval(hits_per_sec, 0.0, ONSETS_PER_SEC_MAX)


def detect_energy_score(path: Path, row: dict[str, Any]) -> float | None:
    duration = row.get("duration") or _audio_duration(path)
    if not duration or duration <= 0:
        return None

    drop_offset = _find_drop_offset(path, float(duration))
    loaded = _load_mono_segment(
        path, PASS2_SR, offset=drop_offset, duration=PASS2_DURATION_SEC
    )
    if loaded is None:
        return None
    samples, sr = loaded

    loudness = _peak_log_loudness(samples)
    brightness = _spectral_brightness(samples, sr)
    transients = _transient_density(samples, sr)
    composite = 0.50 * loudness + 0.30 * brightness + 0.20 * transients
    raw = 1.0 + composite * 9.0
    return _scale_energy_score(raw)


def _scale_energy_score(raw: float) -> float:
    """Expand the typical 6–8.3 raw band onto a 0–10 mixing scale."""
    stretched = (raw - RAW_ENERGY_LOW) / (RAW_ENERGY_HIGH - RAW_ENERGY_LOW) * 10.0
    return round(float(np.clip(stretched, 0.0, 10.0)), 1)


# ---------------------------------------------------------------------------
# detect_genre  (essentia-tensorflow Discogs-EffNet + genre_discogs400)
# ---------------------------------------------------------------------------

def _download_model(filename: str) -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    destination = MODELS_DIR / filename
    if destination.exists() and destination.stat().st_size > 0:
        return destination

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
            MonoLoader,
            TensorflowPredict2D,
            TensorflowPredictEffnetDiscogs,
        )

        embedding_path = _download_model(EMBEDDING_MODEL)
        classifier_path = _download_model(GENRE_MODEL)
        labels_path = _download_model(GENRE_LABELS)
        labels = json.loads(labels_path.read_text())["classes"]

        _GENRE_RUNTIME = {
            "MonoLoader": MonoLoader,
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


def detect_genre(path: Path, row: dict[str, Any]) -> str | None:
    runtime = _load_genre_runtime()
    if runtime is None:
        return None

    audio = runtime["MonoLoader"](
        filename=str(path), sampleRate=16000, resampleQuality=4
    )()
    if audio is None or len(audio) == 0:
        return None

    embeddings = runtime["embedder"](audio)
    predictions = np.asarray(runtime["classifier"](embeddings))
    if predictions.size == 0:
        return None

    scores = np.mean(predictions, axis=0) if predictions.ndim == 2 else predictions
    label = runtime["labels"][int(np.argmax(scores))]
    if "---" in label:
        return label.split("---", 1)[1].strip()
    return str(label)


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------

DETECTORS: dict[str, Detector] = {
    "title": detect_title,
    "artist": detect_artist,
    "duration": detect_duration,
    "bpm": detect_bpm,
    "key": detect_key,
    "camelot_key": detect_camelot_key,
    "energy_score": detect_energy_score,
    "genre": detect_genre,
}


def load_tracks_with_nulls(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    placeholders = " OR ".join(f"{sql_ident(field)} IS NULL" for field in DETECTABLE_FIELDS)
    query = f"SELECT * FROM tracks WHERE {placeholders}"
    connection.row_factory = sqlite3.Row
    return [dict(row) for row in connection.execute(query).fetchall()]


def detect_missing_fields(path: Path, row: dict[str, Any]) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    working = dict(row)
    for field in DETECTABLE_FIELDS:
        if working.get(field) is not None:
            continue
        detector = DETECTORS[field]
        try:
            value = detector(path, working)
        except Exception as exc:
            console.print(f"[yellow]{path.name} / {field}:[/yellow] {exc}")
            continue
        if value is not None:
            updates[field] = value
            working[field] = value
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect missing track fields and write them back to SQLite."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print detections without writing to the database.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = args.db.expanduser().resolve()
    if not db_path.exists():
        console.print(f"[red]Database not found:[/red] {db_path}")
        console.print("Run extract_tags.py first.")
        return 1

    with connect_db(db_path) as connection:
        tracks = load_tracks_with_nulls(connection)
        if not tracks:
            console.print("No tracks with null detectable fields.")
            return 0

        if any(row.get("genre") is None for row in tracks):
            _load_genre_runtime()

        filled = 0
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            transient=True,
            console=console,
        ) as progress:
            task = progress.add_task(
                f"Detecting missing fields in {len(tracks)} track(s)...",
                total=len(tracks),
            )
            for row in tracks:
                path = Path(row["file_path"])
                updates = detect_missing_fields(path, row)
                if updates:
                    filled += 1
                    if args.dry_run:
                        console.print(f"{path.name}: {updates}")
                    else:
                        apply_updates(connection, row["file_path"], updates)
                progress.advance(task)

        if not args.dry_run:
            connection.commit()

    action = "Would update" if args.dry_run else "Updated"
    console.print(f"{action} {filled} of {len(tracks)} track(s) in [bold]{db_path}[/bold]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
