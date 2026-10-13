#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 &
backend_pid=$!
frontend_pid=''
cleanup() {
  kill "$backend_pid" 2>/dev/null || true
  if [[ -n "$frontend_pid" ]]; then kill "$frontend_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
npm run dev -- --port 5173 --strictPort &
frontend_pid=$!
.venv/bin/python - <<'PY'
import time, urllib.request
for port, path in [(8000,'/api/health'),(5173,'/')]:
    deadline=time.monotonic()+15
    while True:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}',timeout=2) as r:
                assert r.status==200
            break
        except Exception:
            if time.monotonic()>deadline:
                raise SystemExit(f'Service on port {port} did not become ready')
            time.sleep(.3)
print('Frame backend and frontend are responding. AI models need separate validation.')
PY
wait -n "$backend_pid" "$frontend_pid"
