#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
failed() {
  echo
  echo 'Installationen eller starten avbröts. Kopiera feltexten ovan och skicka den i chatten.'
  read -r -p 'Tryck på Retur för att avsluta. ' || true
}
trap failed ERR
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Den här startfilen är för Mac.'
  exit 1
fi
printf '\nFrame Caption Studio — installerar och startar på din Mac\n\n'
if ! command -v brew >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/brew && ! -x /usr/local/bin/brew ]]; then
  echo 'Homebrew behövs för att installera Node.js, uv och FFmpeg.'
  echo 'Homebrews officiella installerare startar nu. Följ instruktionerna i terminalen.'
  /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
brew install node uv ffmpeg
uv python install 3.12
uv sync --frozen --python 3.12
npm ci
npm run build
.venv/bin/python - <<'PY'
import socket
with socket.socket() as s:
    if s.connect_ex(('127.0.0.1',8000)) == 0:
        raise SystemExit('Port 8000 används redan. Stäng en tidigare Frame-session med Ctrl+C och försök igen.')
PY
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 &
frame_server_pid=$!
cleanup() { kill "$frame_server_pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
.venv/bin/python - <<'PY'
import time, urllib.request, subprocess
for _ in range(60):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=2) as response:
            assert response.status==200
        subprocess.run(['open','http://127.0.0.1:8000'],check=True)
        break
    except Exception:
        time.sleep(.5)
else:
    raise SystemExit('Appen kunde inte startas. Kopiera feltexten från terminalen till chatten.')
PY
echo
echo 'Appen är igång i webbläsaren. Låt det här terminalfönstret vara öppet.'
echo 'Tryck Ctrl+C i det här fönstret när du vill stänga appen.'
wait "$frame_server_pid"
