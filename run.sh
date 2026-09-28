#!/usr/bin/env bash
# Start the API and the frontend together. Ctrl-C stops both.
set -euo pipefail

# Both ports are fixed on the other side of the wire: the frontend calls
# localhost:8000 and the API only allows CORS from localhost:5173.
API_PORT=8000
WEB_PORT=5173

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PYTHON="$ROOT/.venv/bin/python"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

if [ ! -x "$PYTHON" ]; then
  die "no virtualenv at .venv — run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
fi

if [ ! -d frontend/node_modules ]; then
  die "frontend dependencies missing — run: cd frontend && npm install"
fi

for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $port is already in use — stop the old server first"
  fi
done

if [ ! -f data/library.sqlite ]; then
  printf 'warning: data/library.sqlite is missing; the UI will report missing-database\n' >&2
fi

# Every launch starts signed out. This lives here rather than in the API's
# startup hook so that --reload does not sign you out on each code change.
"$PYTHON" -c 'from api.db import clear_sessions; clear_sessions()'

"$PYTHON" -m uvicorn api.main:app --reload --port "$API_PORT" &
API_PID=$!

(cd frontend && exec npm run dev -- --port "$WEB_PORT" --strictPort) &
WEB_PID=$!

# uvicorn's reloader and npm each fork a child that outlives a plain kill of
# the parent, so walk down and signal descendants first.
stop_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  stop_tree "$API_PID"
  stop_tree "$WEB_PID"
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

printf '\nAPI       http://localhost:%s/api/health\nFrontend  http://localhost:%s/\n\nCtrl-C stops both.\n\n' \
  "$API_PORT" "$WEB_PORT"

# Quit as soon as either server dies, so a crashed backend is not left hidden
# behind a frontend that still loads. macOS ships bash 3.2, which has no `wait -n`.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
