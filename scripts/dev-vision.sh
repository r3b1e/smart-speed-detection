#!/usr/bin/env bash
# Start the vision service using its local venv when present.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f apps/vision/app/main.py ]; then
  echo "[vision] not implemented yet (Phase 6)" >&2
  exit 1
fi

if [ -x apps/vision/.venv/bin/python ]; then
  PY=apps/vision/.venv/bin/python
else
  PY=python3
  echo "[warning] apps/vision/.venv missing — run: python3 -m venv apps/vision/.venv && apps/vision/.venv/bin/pip install -r apps/vision/requirements.txt" >&2
fi

exec "$PY" -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8001 --app-dir apps/vision
