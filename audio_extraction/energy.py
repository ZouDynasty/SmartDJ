#!/usr/bin/env python3
"""Peak-window perceptual energy scoring for the SmartDJ library.

Energy is measured on the loudest 45-second stretch of a track, not the whole
file. That makes the score invariant to intro/outro length and comparable
across EDM (long builds), hip-hop (short runtime), and more dynamic genres.

Pipeline:

1. Decode mono at 22.05 kHz.
2. Slide a 45 s window at a 5 s hop and keep the chunk with peak RMS.
3. Extract six features **only inside that chunk**.
4. Scale each feature onto 0–1 between fixed floor / ceiling values, take the
   weighted mean, and multiply by 10.

Scores are absolute: a track's energy depends only on its own audio, never on
the rest of the library. Raw features are stored per track so weights and
ranges can be retuned with ``recompute_energy.py --rescore-only``.
"""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np

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

#: Fixed (floor, ceiling) per feature: the floor scores 0 and the ceiling 1,
#: clipped outside. They are absolute on purpose so a track's energy never
#: depends on what else is in the library (e.g. short scratch samples).
FEATURE_RANGES: dict[str, tuple[float, float]] = {
    "energy_hf_ratio": (0.0, 0.10),
    "energy_centroid_hz": (1000.0, 4000.0),
    "energy_lf_ratio": (0.2, 0.9),
    "energy_onsets_per_beat": (0.5, 4.0),
    "energy_flux": (0.1, 0.4),
    "energy_loudness_db": (-24.0, -4.0),
}


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


def normalize_feature(name: str, value: float) -> float:
    """Place ``value`` on 0..1 between the feature's fixed floor and ceiling."""
    floor, ceiling = FEATURE_RANGES[name]
    return float(np.clip((value - floor) / (ceiling - floor), 0.0, 1.0))


def score_features(features: dict[str, float | None]) -> float | None:
    """Absolute 0–10 energy from one track's raw features.

    Weights are renormalized over the features that are present, so a single
    missing value does not zero the score. Returns ``None`` if none are usable.
    """
    parts = [
        (FEATURE_WEIGHTS[name], normalize_feature(name, float(value)))
        for name, value in features.items()
        if name in FEATURE_WEIGHTS and value is not None and np.isfinite(value)
    ]
    total_weight = sum(weight for weight, _ in parts)
    if total_weight <= 0:
        return None
    composite = sum(weight * part for weight, part in parts) / total_weight
    return round(composite * 10.0, 1)
