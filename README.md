# SmartDJ

Local DJ set builder. It serves your Rekordbox library from SQLite, streams the audio files from disk, and lets you search, queue, and plot a set by BPM, energy, and key.

## Run

You need two processes: the FastAPI library server on port 8000, and the Vite frontend on port 5173.

From the project root:

```bash
# 1. API
.venv/bin/python -m uvicorn api.main:app --reload --port 8000

# 2. Frontend (second terminal)
cd frontend && npm run dev
```

Then open [http://localhost:5173/](http://localhost:5173/).

The frontend talks to `http://localhost:8000/api`. The API reads `data/library.sqlite` by default (override with `SMARTDJ_DB`).

## First-time setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd frontend && npm install
```

A library database should already exist at `data/library.sqlite`. If it is missing, ingest a Rekordbox XML export first (see below) — the UI will show `missing-database` until that file is present.

## Refresh the library

Rekordbox XML is the source of truth:

```bash
.venv/bin/python audio_extraction/ingest_rekordbox.py /path/to/rekordbox.xml
```

- `--skip-audio` — write metadata only (no energy calculation or Essentia fallback)
- `--dry-run` — parse and print counts without writing to SQLite

Optional follow-ups:

```bash
# Folder-scan fallback if you are not using Rekordbox
.venv/bin/python audio_extraction/extract_tags.py /path/to/music

# Fill missing BPM / key / genre
.venv/bin/python audio_extraction/detect_missing.py --apply

# Rebuild energy scores
.venv/bin/python audio_extraction/recompute_energy.py

# Rate mix transitions 0–3 (see LABELING.md)
.venv/bin/python ml/labeling.py
```
