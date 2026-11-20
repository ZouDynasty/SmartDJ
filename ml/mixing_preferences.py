"""Turns the DJ's per-factor importance into the weights in ``config``.

The ml code reads ``config.BPM_WEIGHT`` and friends at call time, so writing
new values onto the module changes every later ranking and mix path without a
restart. The importances are relative: only their proportions matter.
"""

from __future__ import annotations

from collections.abc import Mapping

import config

FACTORS = ("bpm", "genre", "key", "energy")

#: Attribute on ``config`` that holds each factor's weight.
_WEIGHT_ATTRIBUTES = {
    "bpm": "BPM_WEIGHT",
    "genre": "GENRE_WEIGHT",
    "key": "KEY_WEIGHT",
    "energy": "ENERGY_WEIGHT",
}


def normalize(importance: Mapping[str, float]) -> dict[str, float]:
    """Scale importances so they sum to 1.

    Raises ``ValueError`` for a negative value or when everything is zero,
    since there would be nothing left to weigh a transition by.
    """
    values = {factor: float(importance[factor]) for factor in FACTORS}
    if any(value < 0 for value in values.values()):
        raise ValueError("importance cannot be negative")
    total = sum(values.values())
    if total <= 0:
        raise ValueError("at least one factor must matter")
    return {factor: value / total for factor, value in values.items()}


def apply_importance(importance: Mapping[str, float]) -> dict[str, float]:
    """Normalize ``importance`` and write the result onto ``config``."""
    weights = normalize(importance)
    for factor, attribute in _WEIGHT_ATTRIBUTES.items():
        setattr(config, attribute, weights[factor])
    return weights


def current_weights() -> dict[str, float]:
    return {
        factor: getattr(config, attribute)
        for factor, attribute in _WEIGHT_ATTRIBUTES.items()
    }


def preset_importance(preset_id: str) -> dict[str, int]:
    preset = config.MIXING_PRESETS[preset_id]
    return {factor: preset[factor] for factor in FACTORS}


def matching_preset(importance: Mapping[str, float]) -> str | None:
    """The preset whose proportions equal ``importance``, if any."""
    weights = normalize(importance)
    for preset_id in config.MIXING_PRESETS:
        preset_weights = normalize(preset_importance(preset_id))
        if all(abs(weights[f] - preset_weights[f]) < 0.005 for f in FACTORS):
            return preset_id
    return None
