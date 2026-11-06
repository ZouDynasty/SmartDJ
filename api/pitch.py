"""Pitch-shift a library track with pyrubberband and cache the WAV.

Rubber Band changes pitch without changing duration, so BPM stays put and only
the key moves. The ``rubberband`` CLI has to be on ``PATH`` (Homebrew:
``brew install rubberband``).
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

MIN_SEMITONES = -12
MAX_SEMITONES = 12

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "pitch_cache"

_KEY_LOCKS: dict[str, threading.Lock] = {}
_KEY_LOCKS_GUARD = threading.Lock()
#: One Rubber Band process at a time. A full track is only a few seconds, but
#: two of them at once will fight over CPU and disk.
_RENDER_LOCK = threading.Lock()


class PitchShiftError(RuntimeError):
    """The track could not be pitch-shifted."""


def prepare_shifted_audio(source: Path, track_id: int, semitones: int) -> Path:
    """Return a cached WAV of ``source`` shifted by ``semitones`` (nonzero)."""
    if semitones == 0 or not MIN_SEMITONES <= semitones <= MAX_SEMITONES:
        raise PitchShiftError(
            f"semitones must be a non-zero integer from {MIN_SEMITONES} to {MAX_SEMITONES}"
        )
    if not source.is_file():
        raise PitchShiftError(f"Audio file missing: {source}")

    cache = _cache_path(source, track_id, semitones)
    if _is_ready(cache):
        return cache

    with _lock_for(cache.name):
        if _is_ready(cache):
            return cache
        with _RENDER_LOCK:
            if _is_ready(cache):
                return cache
            _render(source, cache, track_id, semitones)
    return cache


def _cache_path(source: Path, track_id: int, semitones: int) -> Path:
    stat = source.stat()
    name = f"{track_id}_{stat.st_mtime_ns}_{stat.st_size}_{semitones:+d}.wav"
    return CACHE_DIR / name


def _is_ready(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 44


def _lock_for(name: str) -> threading.Lock:
    with _KEY_LOCKS_GUARD:
        lock = _KEY_LOCKS.get(name)
        if lock is None:
            lock = threading.Lock()
            _KEY_LOCKS[name] = lock
        return lock


def _ensure_rubberband_on_path() -> None:
    if shutil.which("rubberband"):
        return
    for directory in ("/opt/homebrew/bin", "/usr/local/bin"):
        if (Path(directory) / "rubberband").is_file():
            os.environ["PATH"] = directory + os.pathsep + os.environ.get("PATH", "")
            return
    raise PitchShiftError(
        "rubberband CLI is not installed. Install it with: brew install rubberband"
    )


def _load_audio(path: Path):
    import numpy as np
    import soundfile as sf

    try:
        audio, sample_rate = sf.read(path, always_2d=True, dtype="float32")
        return audio, int(sample_rate)
    except Exception as error:
        logger.info("soundfile could not read %s (%s); trying librosa", path.name, error)

    import librosa

    audio, sample_rate = librosa.load(path, sr=None, mono=False)
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio.reshape(-1, 1)
    else:
        audio = np.ascontiguousarray(audio.T)
    return audio, int(sample_rate)


def _render(source: Path, cache: Path, track_id: int, semitones: int) -> None:
    import soundfile as sf

    _ensure_rubberband_on_path()
    started = time.perf_counter()
    logger.info("Pitch-shifting track %s by %+d semitones", track_id, semitones)

    try:
        import pyrubberband as pyrb

        audio, sample_rate = _load_audio(source)
        if audio.size == 0 or sample_rate <= 0:
            raise PitchShiftError("Audio file is empty")
        shifted = pyrb.pitch_shift(
            audio,
            sample_rate,
            n_steps=semitones,
            rbargs={"--centre-focus": ""},
        )
    except PitchShiftError:
        raise
    except Exception as error:
        raise PitchShiftError(f"Pitch shift failed: {error}") from error

    cache.parent.mkdir(parents=True, exist_ok=True)
    # Keep a .wav suffix so libsndfile accepts the file, but don't use the
    # final name until the write finishes.
    temporary = cache.with_name(f"{cache.stem}.partial.wav")
    try:
        sf.write(temporary, shifted, sample_rate, subtype="PCM_16")
        temporary.replace(cache)
    except Exception as error:
        temporary.unlink(missing_ok=True)
        raise PitchShiftError(f"Could not store the shifted audio: {error}") from error

    elapsed = time.perf_counter() - started
    logger.info("Cached pitch shift for track %s in %.1fs", track_id, elapsed)
