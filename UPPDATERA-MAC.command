#!/bin/bash
set -euo pipefail
cd "${1:-$(dirname "$0")}"
if [[ ! -f pyproject.toml || ! -f backend/app.py || ! -x .venv/bin/python ]]; then
  echo 'Kör uppdateringen från din befintliga appmapp.'
  exit 1
fi
frame_update_dir=$(mktemp -d)
trap 'rm -rf "$frame_update_dir"' EXIT
printf '\nHämtar uppdateringen. Dina videor och modeller behålls.\n'
curl -fL --proto '=https' --proto-redir '=https' \
  https://github.com/MehdiR2/MehdiR2/archive/refs/heads/frame-caption-studio.zip \
  -o "$frame_update_dir/source.zip"
.venv/bin/python - "$frame_update_dir/source.zip" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import sys, tarfile, time, os
root = Path.cwd()
files = ['.gitignore','README.md','STARTA-MAC.command','UPPDATERA-MAC.command',
         'backend/app.py','index.html','package.json','package-lock.json',
         'playwright.config.ts','pyproject.toml','tsconfig.json','uv.lock','vite.config.ts',
         'scripts/seed_demo.py','scripts/start.sh','scripts/verify_models.py',
         'src/App.tsx','src/main.tsx','src/style.css','tests/test_api.py','tests/studio.spec.ts']
with ZipFile(sys.argv[1]) as archive:
    if archive.testzip() is not None:
        raise SystemExit('ZIP-filen kunde inte verifieras. Ingen appkod har ändrats.')
    prefix = archive.namelist()[0].split('/')[0] + '/'
    content = {name: archive.read(prefix + name) for name in files}
    backup_dir = root / '.runtime' / 'code-backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f'before-update-{time.time_ns()}.tar.gz'
    with tarfile.open(backup,'w:gz') as tar:
        for name in files:
            p = root / name
            if p.is_file():
                tar.add(p, arcname=name)
    for name, data in content.items():
        target = root / name
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary = target.with_name(target.name + '.frame-update-tmp')
        temporary.write_bytes(data)
        if name.endswith(('.command','.sh')):
            temporary.chmod(0o755)
        os.replace(temporary,target)
print('Appkoden uppdaterad. En säkerhetskopia av tidigare kod finns i .runtime/code-backups.')
PY
bash ./STARTA-MAC.command
