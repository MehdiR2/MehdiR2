#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
while [[ ! -f server/characters.mjs || ! -f package.json ]]; do
  if [[ -d chai-studio && -f chai-studio/server/characters.mjs ]]; then cd chai-studio; break; fi
  if [[ "$PWD" == / ]]; then echo 'Muse-mappen hittades inte. Lägg startfilen i mappen chai-studio.'; exit 1; fi
  cd ..
done
if [[ "$(uname -s)" != Darwin ]]; then echo 'Den här startfilen är för Mac.'; exit 1; fi
failed() { echo; echo 'Muse kunde inte startas. Kopiera feltexten ovan till chatten.'; read -r -p 'Tryck Retur för att avsluta. ' || true; }
trap failed ERR
printf '\nMuse — din egen värld av AI-karaktärer\n\n'
if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)";
elif [[ -x /usr/local/bin/brew ]]; then eval "$(/usr/local/bin/brew shellenv)";
elif ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; else eval "$(/usr/local/bin/brew shellenv)"; fi
fi
brew install node ollama
mkdir -p .runtime/models
muse_ai_pid='';muse_app_pid=''
cleanup() {
 if [[ -n "$muse_app_pid" ]]; then kill "$muse_app_pid" 2>/dev/null || true; fi
 if [[ -n "$muse_ai_pid" ]]; then kill "$muse_ai_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NO_CLOUD=true
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  OLLAMA_MODELS="$PWD/.runtime/models" ollama serve > .runtime/ollama.log 2>&1 &
  muse_ai_pid=$!
  for muse_attempt in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null; then cat .runtime/ollama.log; exit 1; fi
fi
echo 'Första gången hämtas AI-modellen (ungefär 1 GB). Låt fönstret vara öppet.'
ollama pull "$OLLAMA_MODEL"
npm ci
npm run build
echo 'Testar ett riktigt AI-svar innan appen öppnas…'
node --input-type=module - <<'JS'
const r=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),body:JSON.stringify({model:process.env.OLLAMA_MODEL,stream:false,messages:[{role:'user',content:'Svara kort på svenska: säg hej.'}],options:{num_predict:32,temperature:0,num_ctx:2048}})});
const data=await r.json();
if(!r.ok||!data.message?.content?.trim())throw Error('AI-modellen kunde inte ge ett svar. '+(data.error||'Se Terminal-texten ovan.'));
console.log('AI-testet lyckades: modellen gav ett riktigt svar.');
JS
node --input-type=module - <<'JS'
import net from 'node:net';
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error('Port 8001 används redan. Stoppa en tidigare Muse-session med control+C först.')));s.listen(8001,'127.0.0.1',()=>s.close(resolve));});
JS
node server/index.mjs &
muse_app_pid=$!
node --input-type=module - <<'JS'
import {execFileSync} from 'node:child_process';
let ready=false;
for(let i=0;i<60;i++){
 try{const r=await fetch('http://127.0.0.1:8001/api/health');const h=await r.json();if(h.status==='ready'){ready=true;break;}}
 catch{}
 await new Promise(r=>setTimeout(r,500));
}
if(!ready)throw Error('Muse eller AI-modellen är inte redo. Se feltexten ovan.');
execFileSync('open',['http://127.0.0.1:8001']);
JS
echo 'Muse är igång! Låt Terminal vara öppet. Tryck control+C när du vill stänga appen.'
wait "$muse_app_pid"
