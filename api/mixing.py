"""Mixing preferences: how much BPM, genre, key and energy matter in a transition.

The DJ's slider values are saved in ``data/settings.json`` and written onto the
weight fields in ``ml/config.py`` (see ``ml/mixing_preferences.py``), so the
compatible-track ranking and the mix path both follow them. Importances are
relative: ``{bpm: 60, key: 30, ...}`` and ``{bpm: 20, key: 10, ...}`` are the
same preference.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import auth
from api.settings import load_settings, update_settings

_ML_DIR = Path(__file__).resolve().parent.parent / "ml"
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

import config  # noqa: E402
import mixing_preferences  # noqa: E402

router = APIRouter(
    prefix="/api/mixing-preferences",
    tags=["mixing"],
    dependencies=[Depends(auth.require_user)],
)

SETTINGS_KEY = "mixing_importance"


class MixingImportance(BaseModel):
    bpm: int = Field(ge=0, le=100)
    genre: int = Field(ge=0, le=100)
    key: int = Field(ge=0, le=100)
    energy: int = Field(ge=0, le=100)


def _saved_importance() -> dict[str, int]:
    """The saved sliders, falling back to the default preset if missing or invalid."""
    saved = load_settings().get(SETTINGS_KEY)
    try:
        importance = {factor: int(saved[factor]) for factor in mixing_preferences.FACTORS}
        mixing_preferences.normalize(importance)
        return importance
    except (KeyError, TypeError, ValueError):
        return mixing_preferences.preset_importance(config.DEFAULT_MIXING_PRESET)


def apply_saved() -> None:
    """Load the saved preference into ``config``; call once at API startup."""
    mixing_preferences.apply_importance(_saved_importance())


def _state() -> dict[str, Any]:
    importance = _saved_importance()
    return {
        "importance": importance,
        "weights": mixing_preferences.current_weights(),
        "active_preset": mixing_preferences.matching_preset(importance),
        "default_preset": config.DEFAULT_MIXING_PRESET,
        "presets": [
            {
                "id": preset_id,
                "label": preset["label"],
                "importance": mixing_preferences.preset_importance(preset_id),
            }
            for preset_id, preset in config.MIXING_PRESETS.items()
        ],
    }


@router.get("")
def get_mixing_preferences() -> dict[str, Any]:
    return _state()


@router.post("")
def set_mixing_preferences(request: MixingImportance) -> dict[str, Any]:
    importance = request.model_dump()
    try:
        mixing_preferences.apply_importance(importance)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    update_settings(**{SETTINGS_KEY: importance})
    return _state()
