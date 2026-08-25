#!/usr/bin/env python3
"""Perceptual energy scoring for the SmartDJ library.

The original metric was the loudest 45s RMS window mapped onto a fixed dB
range. Because commercial dance masters are all limited to roughly the same
loudness, that measured the mastering engineer more than the track: 96% of the
library landed between 7 and 9, and 56% sat on a single value.

This module replaces it with two changes:

1. **Spectral features instead of loudness alone.** Brightness (spectral
   centroid, high-frequency ratio) and rhythmic density (spectral flux, onset
   rate) track perceived intensity far better than level does. Loudness stays
   as a small contributor.
2. **Percentile ranking within your own library.** Each feature is converted to
   its rank among all tracks before being combined, and the composite is ranked
   again to produce the final 0-10. Energy is inherently relative — "an 8" only
   means anything next to the rest of the crate — and ranking guarantees the
   scale actually spreads.

Raw features are persisted per track, so the weights below can be retuned and
scores recomputed without touching the audio again.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

ANALYSIS_SAMPLE_RATE = 44100

# STFT geometry: 46ms frames at 23ms hop, fine enough to resolve onsets.
FRAME_SIZE = 2048
HOP_SIZE = 1024
#: Frames per vectorized FFT batch, bounding peak memory on long files.
FRAME_BATCH = 2048

#: Split between body and "air"/percussion presence.
HF_CUTOFF_HZ = 4000.0

#: Frames quieter than this fraction of the median frame energy are treated as
#: silence and excluded, so intros and outros do not drag brightness down.
SILENCE_ENERGY_RATIO = 0.05

LOUDNESS_WINDOW_SEC = 45.0

#: Minimum gap between accepted onsets (seconds); ~750 BPM ceiling.
MIN_ONSET_GAP_SEC = 0.08

#: Feature name -> weight in the composite. Brightness and rhythmic density get
#: 45% each; loudness is deliberately small because it is mastering-dominated.
FEATURE_WEIGHTS: dict[str, float] = {
    "energy_hf_ratio": 0.25,
    "energy_centroid_hz": 0.20,
    "energy_onset_rate": 0.25,
    "energy_flux": 0.20,
    "energy_loudness_db": 0.10,
}

FEATURE_COLUMNS: tuple[str, ...] = tuple(FEATURE_WEIGHTS)

#: Quantile breakpoints stored in the calibration file (p0..p100).
CALIBRATION_POINTS = 101

DEFAULT_CALIBRATION_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "energy_calibration.json"
)

_MONO_LOADER: Any = None


def _mono_loader() -> Any:
    """Import only MonoLoader; the genre/rhythm models are not needed here."""
    global _MONO_LOADER
    if _MONO_LOADER is None:
        from essentia.standard import MonoLoader  # type: ignore

        _MONO_LOADER = MonoLoader
    return _MONO_LOADER


def load_audio(file_path: str | Path, sample_rate: int = ANALYSIS_SAMPLE_RATE):
    """Decode one file to mono float at ``sample_rate``."""
    loader = _mono_loader()
    audio = loader(filename=str(file_path), sampleRate=sample_rate)()
    if audio is None or len(audio) == 0:
        return None
    return audio


def peak_window_loudness_db(
    samples: np.ndarray, sample_rate: int, window_sec: float = LOUDNESS_WINDOW_SEC
) -> float | None:
    """dBFS of the loudest ``window_sec`` RMS window, via a prefix sum."""
    if samples.size == 0:
        return None
    window = min(int(window_sec * sample_rate), samples.size)
    if window <= 0:
        return None
    squared = np.cumsum(
        np.concatenate(([0.0], np.square(samples, dtype=np.float64)))
    )
    sums = squared[window:] - squared[:-window]
    if sums.size == 0:
        sums = squared[-1:] - squared[:1]
    best_mean_square = float(np.max(sums) / window)
    if best_mean_square <= 0:
        return None
    return float(20.0 * np.log10(max(np.sqrt(best_mean_square), 1e-12)))


def _onset_rate(flux: np.ndarray, hop_sec: float) -> float | None:
    """Onsets per second from peaks in the flux novelty curve."""
    if flux.size < 3:
        return None
    smoothed = np.convolve(flux, np.ones(3) / 3.0, mode="same")
    threshold = float(np.median(smoothed) + np.std(smoothed))
    interior = smoothed[1:-1]
    is_peak = (
        (interior > smoothed[:-2])
        & (interior >= smoothed[2:])
        & (interior > threshold)
    )
    candidates = np.flatnonzero(is_peak) + 1
    if candidates.size == 0:
        return 0.0

    min_gap = max(int(MIN_ONSET_GAP_SEC / hop_sec), 1)
    kept = 0
    last = -min_gap
    for index in candidates:
        if index - last >= min_gap:
            kept += 1
            last = int(index)

    duration = flux.size * hop_sec
    if duration <= 0:
        return None
    return kept / duration


def extract_energy_features(
    audio, sample_rate: int = ANALYSIS_SAMPLE_RATE
) -> dict[str, float] | None:
    """Raw perceptual-energy features for one decoded track.

    Returns ``None`` for empty or unusably short audio. All spectral aggregates
    are energy-weighted so quiet passages do not skew the result.
    """
    if audio is None or len(audio) == 0:
        return None
    samples = np.asarray(audio, dtype=np.float32)
    if samples.size < FRAME_SIZE * 2:
        return None

    loudness_db = peak_window_loudness_db(samples, sample_rate)

    frames = np.lib.stride_tricks.sliding_window_view(samples, FRAME_SIZE)[
        ::HOP_SIZE
    ]
    if frames.shape[0] < 2:
        return None

    window = np.hanning(FRAME_SIZE).astype(np.float32)
    freqs = np.fft.rfftfreq(FRAME_SIZE, d=1.0 / sample_rate)
    hf_mask = freqs >= HF_CUTOFF_HZ

    frame_energy: list[np.ndarray] = []
    frame_centroid: list[np.ndarray] = []
    frame_hf: list[np.ndarray] = []
    frame_flux: list[np.ndarray] = []
    previous_norm: np.ndarray | None = None

    for start in range(0, frames.shape[0], FRAME_BATCH):
        batch = frames[start : start + FRAME_BATCH] * window
        magnitude = np.abs(np.fft.rfft(batch, axis=1))

        power = np.square(magnitude, dtype=np.float64)
        energy = power.sum(axis=1)
        magnitude_sum = magnitude.sum(axis=1)
        safe_magnitude = np.where(magnitude_sum > 0, magnitude_sum, 1.0)
        safe_energy = np.where(energy > 0, energy, 1.0)

        frame_energy.append(energy)
        frame_centroid.append((magnitude * freqs).sum(axis=1) / safe_magnitude)
        frame_hf.append(power[:, hf_mask].sum(axis=1) / safe_energy)

        # Loudness-invariant spectral flux: rectified change in shape.
        normalized = magnitude / safe_magnitude[:, None]
        if previous_norm is not None:
            normalized = np.vstack((previous_norm[None, :], normalized))
        deltas = np.diff(normalized, axis=0)
        frame_flux.append(np.clip(deltas, 0.0, None).sum(axis=1))
        previous_norm = normalized[-1]

    energy_all = np.concatenate(frame_energy)
    centroid_all = np.concatenate(frame_centroid)
    hf_all = np.concatenate(frame_hf)
    flux_all = np.concatenate(frame_flux)

    median_energy = float(np.median(energy_all))
    voiced = energy_all > median_energy * SILENCE_ENERGY_RATIO
    if not voiced.any():
        voiced = np.ones_like(energy_all, dtype=bool)

    weights = energy_all[voiced]
    weight_total = float(weights.sum())
    if weight_total <= 0:
        weights = np.ones_like(weights)
        weight_total = float(weights.sum())

    centroid_hz = float(np.dot(centroid_all[voiced], weights) / weight_total)
    hf_ratio = float(np.dot(hf_all[voiced], weights) / weight_total)
    flux_mean = float(np.mean(flux_all[voiced[: flux_all.size]]))
    onset_rate = _onset_rate(flux_all, HOP_SIZE / float(sample_rate))

    features = {
        "energy_loudness_db": loudness_db,
        "energy_centroid_hz": centroid_hz,
        "energy_hf_ratio": hf_ratio,
        "energy_flux": flux_mean,
        "energy_onset_rate": onset_rate,
    }
    if any(
        value is None or not np.isfinite(value) for value in features.values()
    ):
        return None
    return {name: float(value) for name, value in features.items()}


def analyze_energy_features(
    file_path: str | Path, sample_rate: int = ANALYSIS_SAMPLE_RATE
) -> dict[str, float] | None:
    """Decode a file and extract its energy features."""
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

    order = np.argsort(array, kind="mergesort")
    ordered = array[order]
    ranks = np.empty(count, dtype=np.float64)

    index = 0
    while index < count:
        end = index
        while end + 1 < count and ordered[end + 1] == ordered[index]:
            end += 1
        ranks[order[index : end + 1]] = (index + end) / 2.0
        index = end + 1

    return ranks / (count - 1)


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
        "version": 1,
        "track_count": int(composite.size),
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

    total_weight = sum(FEATURE_WEIGHTS[name] for name in ranks if name in FEATURE_WEIGHTS)
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
