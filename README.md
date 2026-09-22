# SmartDJ

Local DJ set builder. It serves your Rekordbox library from SQLite, streams the audio files from disk, and lets you search, queue, and plot a set by BPM, energy, and key.

## Run

```bash
./run.sh
```

That starts both halves — the FastAPI library server on port 8000 and the Vite frontend on port 5173 — and leaves them running in the one terminal. Ctrl-C stops both. Open [http://localhost:5173/](http://localhost:5173/).

Before starting, the script checks that `.venv` and `frontend/node_modules` exist and that both ports are free, so a leftover server fails fast with a clear message instead of half-starting. It also exits if either server dies, rather than leaving a loading frontend in front of a dead API.

To run them separately — handy when restarting just one:

```bash
# API (from the project root)
.venv/bin/python -m uvicorn api.main:app --reload --port 8000

# Frontend (second terminal)
cd frontend && npm run dev
```

Start the API from the project root. It imports `api.main`, so any other working directory fails with `ModuleNotFoundError: No module named 'api'`.

The frontend talks to `http://localhost:8000/api`. Both ports are hardcoded on both sides — the API only allows CORS from `localhost:5173` — so changing one means editing `api/main.py` and `frontend/src/lib/api.ts` together. The API reads `data/library.sqlite` by default (override with `SMARTDJ_DB`).

## First-time setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd frontend && npm install
```

A library database should already exist at `data/library.sqlite`. If it is missing, ingest a Rekordbox XML export first (see below) — the UI will show `missing-database` until that file is present.

## Refresh the library

Re-export from Rekordbox and ingest again. The second (and later) run is incremental: unchanged tracks keep their stored energy / BPM / key / genre, playlists and Rekordbox fields are updated in place, and audio analysis runs only for new files or files that changed on disk.

```bash
.venv/bin/python audio_extraction/ingest_rekordbox.py /path/to/rekordbox.xml
```

- `--dry-run` — show how many tracks would be skipped / updated / analyzed
- `--skip-audio` — write XML metadata only (no energy or Essentia)
- `--force-audio` — re-analyze every track even if it is already stored

Optional follow-ups:

```bash
# Point rows at converted siblings (FLAC → MP3 in the same folder)
.venv/bin/python audio_extraction/relink_audio.py --apply

# Folder-scan fallback if you are not using Rekordbox
.venv/bin/python audio_extraction/extract_tags.py /path/to/music

# Fill missing BPM / key / genre
.venv/bin/python audio_extraction/detect_missing.py --apply

# Rebuild energy scores
.venv/bin/python audio_extraction/recompute_energy.py

# Rate mix transitions 0–3 (see LABELING.md)
.venv/bin/python ml/labeling.py
```
