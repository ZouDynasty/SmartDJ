# SmartDJ

Local DJ set builder. It serves your Rekordbox library from SQLite, streams the audio files from disk, and lets you search, queue, and plot a set by BPM, energy, and key.

## Run

```bash
./run.sh
```

That starts both halves — the FastAPI library server on port 8000 and the Vite frontend on port 5173 — and leaves them running in the one terminal. Ctrl-C stops both. Open [http://localhost:5173/](http://localhost:5173/).

The player's pitch buttons shift the current track by up to 12 semitones (one octave) without changing its tempo. That needs the Rubber Band CLI as well as `pyrubberband` from `requirements.txt`:

```bash
brew install rubberband
```

Shifted copies are cached under `data/pitch_cache/`.

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

### Sign-in and saved sets (Supabase)

Accounts and saved sets live in a Supabase project. The library and audio stay local: the browser signs in with Supabase, and the API verifies the Supabase access token on every request.

1. Create a Supabase project. In the SQL Editor, create `public.saved_sets` (`id uuid`, `user_id uuid` referencing `auth.users`, `name text`, `track_ids integer[]`, `saved_at timestamptz`) with row-level security policies that allow each user to select, insert, update, and delete only rows where `auth.uid() = user_id`.
2. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. Add `http://localhost:5173` under **Authorized JavaScript origins** and the callback URL shown in Supabase under **Authentication → Sign In / Providers → Google** under **Authorized redirect URIs**.
3. In that Supabase Google provider, paste the client ID and secret and enable it. Under **Authentication → URL Configuration**, set the Site URL to `http://localhost:5173` and add `http://localhost:5173/**` to the redirect URLs.
4. `cp .env.example .env` and set `SUPABASE_URL` and `MEDIA_TOKEN_SECRET`.
5. `cp frontend/.env.example frontend/.env.local` and set the project URL and the **anon** / **publishable** key. Never the service-role key: everything in the frontend is public.
6. Restart both servers.

Supabase keeps the session in the browser, so you stay signed in across restarts. Sets saved in the browser before the switch to Supabase are copied into your account the first time you sign in.

### Library setup

The first time you sign in on a machine, SmartDJ asks for two paths:

- **Rekordbox XML export.** In Rekordbox, choose **File → Export Collection in xml format**.
- **Music folder.** The folder that holds your audio files. If a track's saved location no longer exists (another drive, another Mac), the API looks for it here, first at the same relative location and then by filename anywhere inside the folder.

**Browse…** opens the native macOS picker through the API. A browser picker can't reveal a full path, so on other systems paste the path instead. Both paths are saved to `data/settings.json` on this machine (gitignored).

The import then runs in the background in two passes. The first writes tracks and playlists, so the catalog appears within seconds. The second analyzes audio for energy and fills in any missing BPM, key, or genre. On a new library that can take a long time; the progress card in the corner shows how far it has got. Reopen setup any time from **Account → Library setup** to change a path or re-import after exporting again. Re-imports are incremental, like the command below.

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
