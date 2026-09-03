#!/usr/bin/env python3
"""Peak-window perceptual energy scoring for the SmartDJ library.

Energy is measured on the loudest 45-second stretch of a track, not the whole
file. That makes the score invariant to intro/outro length and comparable
across EDM (long builds), hip-hop (short runtime), and more dynamic genres.

Pipeline:

1. Decode mono at 22.05 kHz.
2. Slide a 45 s window at a 5 s hop and keep the chunk with peak RMS.
3. Extract six features **only inside that chunk**.
4. Percentile-rank each feature in the library, mix them, and rank the
   composite again onto 0–10.

Raw features are stored per track so weights can be retuned with
``recompute_energy.py --rescore-only``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.stats import rankdata

ANALYSIS_SAMPLE_RATE = 22050
WINDOW_SEC = 45.0
HOP_SEC = 5.0

N_FFT = 2048
HOP_LENGTH = 512

HF_CUTOFF_HZ = 4000.0
LF_LOW_HZ = 30.0
LF_HIGH_HZ = 150.0
MIN_TEMPO_BPM = 60.0

FEATURE_WEIGHTS: dict[str, float] = {
    "energy_hf_ratio": 0.20,
    "energy_centroid_hz": 0.15,
    "energy_lf_ratio": 0.15,
    "energy_onsets_per_beat": 0.20,
    "energy_flux": 0.15,
    "energy_loudness_db": 0.15,
}

FEATURE_COLUMNS: tuple[str, ...] = tuple(FEATURE_WEIGHTS)

CALIBRATION_POINTS = 101

DEFAULT_CALIBRATION_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "energy_calibration.json"
)


def load_audio(file_path: str | Path, sample_rate: int = ANALYSIS_SAMPLE_RATE):
    """Decode one file to mono float at ``sample_rate``.

    ``librosa`` is the primary decoder. AAC/M4A often needs Essentia's
    ``MonoLoader`` as a fallback because librosa has no bundled AAC support.
    """
    path = str(file_path)
    try:
        audio, _sr = librosa.load(path, sr=sample_rate, mono=True)
        if audio is not None and len(audio) > 0:
            return np.asarray(audio, dtype=np.float32)
    except Exception:  # noqa: BLE001
        pass

    try:
        from essentia.standard import MonoLoader  # type: ignore

        audio = MonoLoader(filename=path, sampleRate=sample_rate)()
        if audio is not None and len(audio) > 0:
            return np.asarray(audio, dtype=np.float32)
    except Exception:  # noqa: BLE001
        return None
    return None


def _resample_if_needed(samples: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    if sample_rate == ANALYSIS_SAMPLE_RATE:
        return samples, sample_rate
    resampled = librosa.resample(
        samples.astype(np.float32, copy=False),
        orig_sr=sample_rate,
        target_sr=ANALYSIS_SAMPLE_RATE,
    )
    return np.asarray(resampled, dtype=np.float32), ANALYSIS_SAMPLE_RATE


def locate_peak_window(
    samples: np.ndarray,
    sample_rate: int,
    window_sec: float = WINDOW_SEC,
    hop_sec: float = HOP_SEC,
) -> np.ndarray:
    """Return the 45 s chunk with the highest RMS, or the whole buffer if shorter."""
    window = int(window_sec * sample_rate)
    if samples.size <= window:
        return samples

    hop = max(int(hop_sec * sample_rate), 1)
    squared = np.cumsum(
        np.concatenate(([0.0], np.square(samples, dtype=np.float64)))
    )

    best_start = 0
    best_sum = -1.0
    last_start = samples.size - window
    for start in range(0, last_start + 1, hop):
        energy = float(squared[start + window] - squared[start])
        if energy > best_sum:
            best_sum = energy
            best_start = start
    if last_start % hop != 0:
        energy = float(squared[last_start + window] - squared[last_start])
        if energy > best_sum:
            best_start = last_start
    return samples[best_start : best_start + window]


def _window_features(peak: np.ndarray, sample_rate: int) -> dict[str, float] | None:
    """Six discrete features, computed only on the peak window."""
    if peak.size < N_FFT * 2:
        return None

    rms = float(np.sqrt(np.mean(np.square(peak, dtype=np.float64))))
    loudness_db = float(20.0 * np.log10(rms + 1e-9))

    stft = librosa.stft(peak, n_fft=N_FFT, hop_length=HOP_LENGTH, window="hann")
    magnitude = np.abs(stft)
    if magnitude.size == 0 or not np.any(magnitude):
        return None

    power = np.square(magnitude, dtype=np.float64)
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=N_FFT)
    total_power = float(power.sum())
    if total_power <= 0:
        return None

    hf_ratio = float(power[freqs >= HF_CUTOFF_HZ].sum() / total_power)
    lf_mask = (freqs >= LF_LOW_HZ) & (freqs <= LF_HIGH_HZ)
    lf_ratio = float(power[lf_mask].sum() / total_power)

    freq_weights = magnitude.sum(axis=0)
    safe = np.where(freq_weights > 0, freq_weights, 1.0)
    centroid = float(np.mean((freqs[:, None] * magnitude).sum(axis=0) / safe))

    frame_power = power.sum(axis=0, keepdims=True)
    normalized = power / np.maximum(frame_power, 1e-12)
    if normalized.shape[1] < 2:
        flux = 0.0
    else:
        deltas = np.diff(normalized, axis=1)
        flux = float(np.clip(deltas, 0.0, None).sum(axis=0).mean())

    onset_env = librosa.onset.onset_strength(
        y=peak, sr=sample_rate, hop_length=HOP_LENGTH
    )
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sample_rate, hop_length=HOP_LENGTH, units="frames"
    )
    duration_sec = peak.size / float(sample_rate)
    onsets_per_sec = float(len(onset_frames) / duration_sec) if duration_sec > 0 else 0.0
    tempo = float(
        librosa.feature.tempo(
            onset_envelope=onset_env, sr=sample_rate, hop_length=HOP_LENGTH
        )[0]
    )
    if not np.isfinite(tempo) or tempo <= 0:
        tempo = MIN_TEMPO_BPM
    onsets_per_beat = onsets_per_sec / (max(tempo, MIN_TEMPO_BPM) / 60.0)

    features = {
        "energy_hf_ratio": hf_ratio,
        "energy_lf_ratio": lf_ratio,
        "energy_centroid_hz": centroid,
        "energy_flux": flux,
        "energy_onsets_per_beat": onsets_per_beat,
        "energy_loudness_db": loudness_db,
    }
    if any(not np.isfinite(value) for value in features.values()):
        return None
    return features


def extract_energy_features(
    audio, sample_rate: int = ANALYSIS_SAMPLE_RATE
) -> dict[str, float] | None:
    """Peak-window features for one already-decoded buffer."""
    if audio is None or len(audio) == 0:
        return None
    samples = np.asarray(audio, dtype=np.float32)
    samples, sample_rate = _resample_if_needed(samples, sample_rate)
    if samples.size < N_FFT * 2:
        return None
    peak = locate_peak_window(samples, sample_rate)
    return _window_features(peak, sample_rate)


def analyze_energy_features(
    file_path: str | Path, sample_rate: int = ANALYSIS_SAMPLE_RATE
) -> dict[str, float] | None:
    """Decode a file and extract its peak-window energy features."""
    audio = load_audio(file_path, sample_rate)
    if audio is None:
        return None
    return extract_energy_features(audio, sample_rate)


def percentile_ranks(values: np.ndarray) -> np.ndarray:
    """Rank ``values`` into 0..1, averaging ranks across ties."""
    array = np.asarray(values, dtype=np.float64)
    count = array.size
    if count == 0:
        return array
    if count == 1:
        return np.array([0.5])
    return (rankdata(array, method="average") - 1.0) / (count - 1)


def composite_from_ranks(ranks: dict[str, np.ndarray]) -> np.ndarray:
    """Weighted mean of per-feature ranks, renormalized over present features."""
    total_weight = sum(
        FEATURE_WEIGHTS[name] for name in ranks if name in FEATURE_WEIGHTS
    )
    if total_weight <= 0:
        raise ValueError("No weighted energy features supplied")
    stacked = None
    for name, values in ranks.items():
        weight = FEATURE_WEIGHTS.get(name)
        if weight is None:
            continue
        contribution = values * (weight / total_weight)
        stacked = contribution if stacked is None else stacked + contribution
    if stacked is None:
        raise ValueError("No weighted energy features supplied")
    return stacked


def build_calibration(
    features: dict[str, np.ndarray], composite: np.ndarray
) -> dict[str, Any]:
    """Quantile breakpoints letting a single new track be scored later."""
    probabilities = np.linspace(0.0, 100.0, CALIBRATION_POINTS)
    return {
        "version": 2,
        "track_count": int(composite.size),
        "window_sec": WINDOW_SEC,
        "hop_sec": HOP_SEC,
        "sample_rate": ANALYSIS_SAMPLE_RATE,
        "weights": FEATURE_WEIGHTS,
        "features": {
            name: np.percentile(values, probabilities).tolist()
            for name, values in features.items()
        },
        "composite": np.percentile(composite, probabilities).tolist(),
    }


def save_calibration(calibration: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(calibration, indent=2), encoding="utf-8")


def load_calibration(path: Path = DEFAULT_CALIBRATION_PATH) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict) or "composite" not in parsed:
        return None
    return parsed


def _rank_against(value: float, breakpoints: list[float]) -> float:
    """Where ``value`` falls within stored quantiles, as 0..1."""
    curve = np.asarray(breakpoints, dtype=np.float64)
    if curve.size == 0:
        return 0.5
    positions = np.linspace(0.0, 1.0, curve.size)
    return float(np.interp(value, curve, positions))


def score_with_calibration(
    features: dict[str, float], calibration: dict[str, Any] | None
) -> float | None:
    """Score one track's features against a stored library distribution.

    Used when ingesting a handful of new tracks, where re-ranking the whole
    library would be wasteful. Returns ``None`` without a calibration file.
    """
    if not calibration:
        return None
    feature_curves = calibration.get("features") or {}
    ranks = {
        name: _rank_against(value, feature_curves[name])
        for name, value in features.items()
        if name in feature_curves and value is not None
    }
    if not ranks:
        return None

    total_weight = sum(
        FEATURE_WEIGHTS[name] for name in ranks if name in FEATURE_WEIGHTS
    )
    if total_weight <= 0:
        return None
    composite = sum(
        rank * FEATURE_WEIGHTS[name] / total_weight
        for name, rank in ranks.items()
        if name in FEATURE_WEIGHTS
    )
    return round(_rank_against(composite, calibration["composite"]) * 10.0, 1)


def scores_from_features(
    features: dict[str, np.ndarray],
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Rank a whole library at once.

    Returns ``(scores 0-10, composite, calibration)``. Ranking the composite a
    second time is what forces the output to occupy the full scale.
    """
    ranks = {name: percentile_ranks(values) for name, values in features.items()}
    composite = composite_from_ranks(ranks)
    scores = np.round(percentile_ranks(composite) * 10.0, 1)
    return scores, composite, build_calibration(features, composite)
