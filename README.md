# Frame Caption Studio

En Captions.ai-inspirerad videoeditor för uppladdning, lokala AI-undertexter,
översättning, textredigering och export. React/TypeScript + FastAPI.

## Mac — enkel start

Ladda ned den senaste ZIP-filen, packa upp och dubbelklicka på
`STARTA-MAC.command`. Den installerar Homebrew om det saknas (via den
officiella installeraren), Node.js, uv och FFmpeg, installerar Python 3.12 och FFmpeg Full med textningsstöd,
bygger appen och öppnar webbläsaren automatiskt. Följ eventuella frågor från
Homebrew. Låt terminalfönstret vara öppet; Ctrl+C stoppar appen.

Om Finder inte kan starta filen: öppna Terminal, skriv `bash ` (inklusive
mellanslag), dra `STARTA-MAC.command` från Finder till Terminal och tryck Retur.

Mac använder egna låsta versioner av PyTorch, ONNX Runtime, NumPy och spaCy
för kompatibilitet med både Apple Silicon och Intel. Paketupplösningen är
kontrollerad för båda arkitekturerna. Körning på en fysisk Mac är inte
verifierad i Linux-molnmiljön. En aktuell macOS-version rekommenderas för
Homebrew. Startskriptet skapar inte demovideon eftersom den kräver en särskild
FFmpeg-funktion som inte finns i alla Mac-installationer.

## Starta manuellt

Kräver Node.js 22+, Python 3.12, uv och FFmpeg med libass/libx264.

```bash
npm ci
uv sync --frozen
.venv/bin/python scripts/seed_demo.py
./scripts/start.sh
# Alternativt separat backend och frontend:
# npm run dev
# I en andra terminal:
.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Vite kör på port 5173 och proxar `/api` till backend på port 8000.
För en enda server: `npm run build` före start av Uvicorn. Backend serverar då
frontend och API på port 8000.

I molnmiljön används skrivbara cachekataloger:
`npm_config_cache=/workspace/rea-onboarding/npm-cache` och
`UV_CACHE_DIR=/workspace/.cache/uv`. Backend placerar sina egna modellcacher
under `.runtime/`.

## Arbetsflöde

1. Ladda upp MP4, MOV, WebM eller ett annat FFmpeg-kompatibelt videoformat,
   högst 500 MB och 60 minuter. Videon normaliseras till en browser-kompatibel
   MP4 för förhandsvisning; originalfilen behålls för export.
2. Välj talat språk eller automatisk identifiering och undertextspråk.
3. Generera med Whisper på CPU och översätt med Argos Translate lokalt.
   Vid första användningen laddas relevanta modeller ned. Tillgängliga
   språkpar följer Argos modellindex; indirekt översättning kan gå via engelska.
4. Granska text och tidsstämplar, välj stil, färg, storlek och placering. Spara.
5. Exportera SRT, VTT eller en MP4 med undertexterna inbrända med FFmpeg.

Översättning av befintliga undertexter utgår från den senast sparade och
redigerade texten. Om en översättning efter transkribering misslyckas finns
originaltranskriptionen kvar. För manuellt tillagda undertexter: välj deras
språk under **Videons språk** före översättning.

Projekt, originalvideor och exporter ligger lokalt i `.runtime/projects/`.
Demo-videon är en egen vektorillustration med syntetiskt engelskt tal och
förskrivna exempelundertexter. Den är tydligt märkt **EXEMPEL** och dess text
är inte ett bevis på att AI-modellerna har körts.

## Modeller och nätverk

Inga AI-API-nycklar behövs. Whisper använder som standard den flerspråkiga
`tiny`-modellen; ange `WHISPER_MODEL=small` före serverstart för bättre
noggrannhet, till priset av större nedladdning och längre CPU-tid.

För modellhämtning behöver miljön åtkomst till:

- `huggingface.co`, `*.huggingface.co`, `*.hf.co` (Whisper och modellfiler)
- `raw.githubusercontent.com` (Argos officiella modellindex)
- `argos-net.com` (Argos språkpaket)

Video och undertextinnehåll behandlas på servern; nätverket används för
paket och modeller. Modeller cachelagras för senare körningar.

## Verifiering

```bash
npm run build
.venv/bin/python -m pytest tests/test_api.py -q
# Backend och Vite måste vara igång. Använder installerad Chromium:
npx playwright test
# Riktiga AI-kontroller, kräver att modellhämtningen är tillåten:
.venv/bin/python scripts/verify_models.py
```

API-testerna laddar upp en riktig video, testar validering och undertexter,
renderar en export med FFmpeg och kontrollerar inbränd text i bildpixlar.
Browser-testerna kontrollerar redigering, sparning, stilval, SRT-nedladdning,
uppspelning, mobilvy och felhantering. Systemets Chromium används utan en
extra browser-nedladdning; sätt `CHROMIUM_PATH` för annan installation.

**Status i denna molnmiljö:** build och video-/exportflöde verifierade.
Whisper- och Argos-modellhämtning blockerades med HTTP 403 av nätverkspolicyn.
Transkribering och översättning är implementerade men ännu inte verifierade
med riktiga modeller här. Nödvändiga domäner är sparade i miljöutkastet;
spara nätverksändringarna och kör `scripts/verify_models.py` igen.

Appen är en privat prototyp utan inloggning, projektisolering mellan användare
eller automatiserad datarensning. Lägg till detta före publik drift. AI-text
behöver alltid granskas. Det finns 16 caption-stilar med motsvarande videoexport: Spotlight, Klassisk,
Minimal, Statement, Textplatta, Neon, Kontur, Pop, Elegant, Skrivmaskin,
Editorial, Cinema, Comic, Soft glow, Accent label och Sport.
Förhandsvisning och exporter lägger inte till någon vattenstämpel.
Stilvalen färgar hela undertextsegment; ordvis
karaoke och AI-avatarer ingår inte i denna version.

## Fel med metadata_errors

Whisper 1.2.1 använder en PyAV-funktion som saknas i PyAV 19. Appen låser nu
PyAV till 16.0.1. Avkodning av en riktig video med Whisper har verifierats
med denna version och täcks av ett regressionstest. Om du använder en äldre
ZIP-version kan du stoppa appen och köra `uv add "av==16.0.1"` i appmappen.
Använd `/opt/homebrew/bin/uv` om uv saknas i Terminal-sökvägen på Apple Silicon.

`UPPDATERA-MAC.command` hämtar senaste appkoden från GitHub till den befintliga
mappen och bevarar `.runtime` (videor, undertexter och modeller), `.venv` samt
`node_modules`. Den ändrar appens källkod och startar sedan Mac-installationsfilen.
Egna ändringar i appens källkod ska säkerhetskopieras före uppdateringen.
