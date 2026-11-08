"""Machine-local library settings chosen in the first-run setup.

Paths only mean something on this computer, so they live next to the library
database in ``data/settings.json`` (gitignored) rather than in the account.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

SETTINGS_PATH = Path(
    os.environ.get(
        "SMARTDJ_SETTINGS",
        Path(__file__).resolve().parent.parent / "data" / "settings.json",
    )
).expanduser()

_lock = threading.Lock()
_cache: tuple[float, dict[str, Any]] | None = None


def load_settings() -> dict[str, Any]:
    global _cache
    with _lock:
        try:
            mtime = SETTINGS_PATH.stat().st_mtime
        except FileNotFoundError:
            _cache = None
            return {}
        if _cache is not None and _cache[0] == mtime:
            return dict(_cache[1])
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        _cache = (mtime, data)
        return dict(data)


def update_settings(**values: Any) -> dict[str, Any]:
    """Merge ``values`` into the settings file and return the result."""
    settings = load_settings()
    settings.update(values)
    with _lock:
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = SETTINGS_PATH.with_suffix(".json.partial")
        temporary.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
        temporary.replace(SETTINGS_PATH)
    return settings


def music_root() -> Path | None:
    """The configured music folder, or ``None`` when unset or not mounted."""
    raw = load_settings().get("music_root")
    if not raw:
        return None
    root = Path(raw).expanduser()
    return root if root.is_dir() else None
