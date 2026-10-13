# Muse — lokal AI-karaktärschatt

En separat CHAI-inspirerad app med åtta fiktiva karaktärer, egna avatarbilder, kategorier,
sökning, favoriter, egna karaktärer, sparade konversationer och strömmande
AI-svar. React/TypeScript, Express och Ollama. Illustrationer och design är
original; appen är inte ansluten till CHAI.

## Enkel start på Mac

1. Packa upp GitHub-ZIP-filen och öppna mappen `chai-studio`.
2. Öppna Terminal. Skriv `bash `, dra `STARTA-MUSE.command` till fönstret och
   tryck Retur.
3. Följ installationsfrågorna. Homebrew återanvänds om det redan finns.
4. Startfilen installerar Node.js och Ollama, hämtar `qwen3:4b` (cirka
   2,6 GB), bygger appen och kräver ett riktigt AI-svar innan webbläsaren öppnas.
5. Låt Terminal vara öppet. Control+C stoppar appen och den AI-server som
   startfilen själv startade. En tidigare befintlig Ollama-server lämnas igång.

Muse kör på port **8001**, separat från videoappen på port 8000. Inga
API-nycklar krävs. Första starten behöver internet för installation och
modellhämtning. Senare chattar behandlas lokalt av modellen. På Mac används
Ollamas stöd för Apple Silicon. AI-svar kan innehålla fel och kvaliteten beror
på den lokala modellen. En större modell kan väljas med `OLLAMA_MODEL`, till
exempel `qwen3:8b`, men behöver mer minne och diskutrymme.

## Manuellt utvecklingsflöde

Kräver Node.js 22+ och Ollama. Använd den befintliga checkouten; molnuppgifter
är redan isolerade och behöver ingen extra Git-worktree.

```bash
cd chai-studio
npm ci
ollama serve
# I en annan terminal:
ollama pull qwen3:4b
npm run server
# I ytterligare en terminal:
npm run dev
```

Frontend kör på 5174 och proxar `/api` till 8001. För en enda server: bygg med
`npm run build` och kör `npm start` från `chai-studio`. Servern binder till
127.0.0.1 som standard; `HOST` och `PORT` kan sättas för en utvecklingsmiljö.
`OLLAMA_URL` anger en annan Ollama-server, standard `http://127.0.0.1:11434`.
Inga andra AI-tjänster eller reservsvar används vid ett fel.

## Lagring

Karaktärer, favoriter och meddelanden sparas i `.runtime/data.json`.
Egna avatarbilder (JPG, PNG eller WebP, högst 5 MB) sparas lokalt under
`.runtime/avatars` efter konvertering till JPEG. Bildmetadata tas bort.
Avatarbilderna analyseras inte av språkmodellen. HEIC och SVG stöds inte;
exportera sådana bilder till JPEG eller PNG före uppladdning.

Standardmodellen är Qwen3 4B. Appen begär direkta svar (`think: false`) och
behåller de senaste 32 meddelandena i modellens samtalskontext. Modellbytet
är implementerat och API-kontraktet testat, men modellens svarskvalitet har
inte benchmarkats i molnmiljön. Kontextfönstret är begränsat till 4096 tokens;
hela chatten sparas på disk men skickas inte obegränsat till modellen.
Mac-startfilen använder `.runtime/models` om den startar en egen Ollama-server.
Om en redan körande Ollama-server återanvänds används dess befintliga
modellkatalog. Stoppade eller avbrutna AI-svar markeras som avbrutna.
Konversationer kan exporteras till text eller raderas. Egna karaktärer kan
redigeras och raderas; radering tar även bort karaktärens konversationer.

Appen är avsedd för en privat arbetsyta. Den har ingen inloggning, ingen
användarisolering och ingen publik karaktärsmarknad. Publicera inte servern
som en fleranvändartjänst utan att lägga till detta.

## Verifiering

```bash
npm test
npm run build
# Kräver frontend/backend igång samt Chromium:
npm run test:browser
```

API-testerna använder en tydligt märkt Ollama-protokollfixture för strömning,
lagring och felhantering. De bevisar inte riktiga AI-svar. Browser-tester
kontrollerar kategorier, sökning, favoriter, karaktärsredigering, sparade
chattar, export och mobilvy. Playwright använder `/usr/bin/chromium` här;
sätt `CHROMIUM_PATH` för en annan browser-installation.

**Molnstatus:** build, API-tester och browser-tester har passerat. Den riktiga
Ollama-motorn har installerats och startats på CPU. Modellhämtningen från
`registry.ollama.ai` blockerades med HTTP 403 av molnpolicyn, så riktig
LLM-generering är ännu inte verifierad i den här miljön. Domänkraven
`registry.ollama.ai`, `ollama.com` och `*.r2.cloudflarestorage.com` är sparade
som tillägg i miljöutkastet. Mac-startfilen utför ett faktiskt AI-test före
start, men körning på en fysisk Mac har inte verifierats här.

## Uppdatera på Mac

Stoppa Muse med control+C och kör `UPPDATERA-MUSE.command` från appmappen.
Den hämtar senaste appkoden från GitHub, säkerhetskopierar tidigare kod och
bevarar `.runtime` med chattar, avatarbilder och modeller. Sedan startas
Mac-installationsfilen. Egna ändringar i källkod säkerhetskopieras lokalt.

För att använda en mindre modell kan du ange `OLLAMA_MODEL=qwen2.5:1.5b`
vid start. En större modell tar mer minne och kan svara långsammare.
