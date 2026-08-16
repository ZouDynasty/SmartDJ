#!/usr/bin/env python3
"""Project-root entry point for genre normalization."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "audio_extraction"))

from normalize_genres import main

if __name__ == "__main__":
    raise SystemExit(main())
