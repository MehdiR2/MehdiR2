#!/bin/bash
set -euo pipefail
cd "${1:-$(dirname "$0")}"
if [[ ! -f server/characters.mjs || ! -f package.json ]]; then
  echo 'Kör uppdateraren från mappen chai-studio.'
  exit 1
fi
muse_update_dir=$(mktemp -d)
trap 'rm -rf "$muse_update_dir"' EXIT
echo 'Hämtar senaste Muse. Chattar, bilder och modeller behålls.'
curl -fL --proto '=https' --proto-redir '=https' \
  https://github.com/MehdiR2/MehdiR2/archive/refs/heads/muse-chat.zip \
  -o "$muse_update_dir/source.zip"
if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)";
elif [[ -x /usr/local/bin/brew ]]; then eval "$(/usr/local/bin/brew shellenv)";fi
if ! command -v node >/dev/null; then echo 'Node.js saknas. Kör STARTA-MUSE.command först.'; exit 1; fi
node --input-type=module - "$muse_update_dir" <<'JS'
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const temp=process.argv[2];const zip=resolve(temp,'source.zip');
execFileSync('/usr/bin/unzip',['-tq',zip],{stdio:'pipe'});
const members=execFileSync('/usr/bin/unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
const prefix=members[0].split('/')[0]+'/chai-studio/';
const files=['README.md','STARTA-MUSE.command','UPPDATERA-MUSE.command','index.html','package.json','package-lock.json','playwright.config.ts','tsconfig.json','vite.config.ts','server/app.mjs','server/characters.mjs','server/index.mjs','src/App.tsx','src/main.tsx','src/style.css','tests/api.test.mjs','tests/muse.spec.ts',...['nova','kai','luna','elena','rowan','mika','atlas','iris'].map(n=>`public/avatars/${n}.svg`)];
for(const name of files)if(!members.includes(prefix+name))throw Error('Appfiler saknas i ZIP-filen. Ingen kod har ändrats.');
const staged=new Map(files.map(name=>[name,execFileSync('/usr/bin/unzip',['-p',zip,prefix+name],{maxBuffer:10*1024*1024})]));
const backup=resolve('.runtime','code-backups',`before-update-${Date.now()}`);mkdirSync(backup,{recursive:true});
for(const name of files){const target=resolve(name);if(existsSync(target)){const saved=resolve(backup,name);mkdirSync(dirname(saved),{recursive:true});copyFileSync(target,saved);}}
for(const [name,data] of staged){const target=resolve(name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);if(name.endsWith('.command'))chmodSync(target,0o755);}
console.log('Muse uppdaterad. Tidigare kod säkerhetskopierades i .runtime/code-backups.');
JS
bash ./STARTA-MUSE.command
