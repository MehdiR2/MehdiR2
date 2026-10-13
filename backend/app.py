"""Local caption studio: Whisper transcription, Argos translation, FFmpeg export."""
from __future__ import annotations
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import threading
import uuid
from typing import Literal

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
RUNTIME.mkdir(exist_ok=True)
# Model and package caches belong to this project, not a read-only home.
os.environ.setdefault('HF_HOME', str(RUNTIME / 'huggingface'))
os.environ.setdefault('XDG_CACHE_HOME', str(RUNTIME / 'cache'))
os.environ.setdefault('XDG_DATA_HOME', str(RUNTIME / 'data'))
os.environ.setdefault('XDG_CONFIG_HOME', str(RUNTIME / 'config'))
os.environ.setdefault('ARGOS_PACKAGES_DIR', str(RUNTIME / 'argos-packages'))
os.environ.setdefault('STANZA_RESOURCES_DIR', str(RUNTIME / 'stanza'))
os.environ.setdefault('ARGOS_INTRA_THREADS', '4')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

app = FastAPI(title='Frame Caption Studio')
log = logging.getLogger('frame')
STORE = RUNTIME / 'projects'
STORE.mkdir(exist_ok=True)
JOBS: dict[str, dict] = {}
LOCK = threading.RLock()
AI_LOCK = threading.Lock()
MODEL = None
MAX_UPLOAD = 500 * 1024 * 1024
MEDIA_TOOL_DIRS = (Path('/opt/homebrew/bin'), Path('/usr/local/bin'))

class Segment(BaseModel):
    id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = Field(max_length=2000)
    @model_validator(mode='after')
    def ordered(self):
        if self.end <= self.start:
            raise ValueError('Sluttiden måste vara efter starttiden.')
        return self

class CaptionStyle(BaseModel):
    preset: Literal['classic', 'highlight', 'minimal', 'bold'] = 'highlight'
    color: Literal['lime', 'white', 'yellow', 'pink'] = 'lime'
    position: Literal['bottom', 'center', 'top'] = 'bottom'
    size: int = Field(default=32, ge=16, le=64)

class Edits(BaseModel):
    segments: list[Segment] = Field(max_length=20000)
    style: CaptionStyle
    language: str | None = Field(default=None, pattern=r'^[a-z]{2,3}$')

class Generate(BaseModel):
    language: str = Field(default='auto', pattern=r'^(auto|[a-z]{2,3})$')
    target: str = Field(default='original', pattern=r'^(original|[a-z]{2,3})$')

class Translate(BaseModel):
    target: str = Field(pattern=r'^[a-z]{2,3}$')

def project_dir(project_id: str) -> Path:
    try:
        if str(uuid.UUID(project_id)) != project_id:
            raise ValueError()
    except ValueError:
        raise HTTPException(404, 'Projektet finns inte.')
    path = STORE / project_id
    if not (path / 'project.json').exists():
        raise HTTPException(404, 'Projektet finns inte.')
    return path

def read_project(project_id: str) -> dict:
    with LOCK:
        return json.loads((project_dir(project_id) / 'project.json').read_text())

def save_project(project: dict):
    with LOCK:
        path = STORE / project['id'] / 'project.json'
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(project, ensure_ascii=False))
        tmp.replace(path)

def media_binary(name: str) -> str | None:
    """Homebrew's bin directory may be absent from a manually started shell."""
    found = shutil.which(name)
    if found:
        return found
    for directory in MEDIA_TOOL_DIRS:
        candidate = directory / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None

def run_command(args: list[str], timeout=300):
    executable = media_binary(args[0])
    if not executable:
        raise RuntimeError('Videoverktyget saknas. Starta appen med STARTA-MAC.command så att FFmpeg hittas eller installeras.')
    p = subprocess.run([executable, *args[1:]], capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        log.error('Media command failed: %s', p.stderr[-2000:])
        raise RuntimeError('Videon kunde inte bearbetas. Kontrollera att filformatet stöds och att filen är hel.')
    return p.stdout

def update_job(job_id: str, **fields):
    with LOCK:
        JOBS[job_id].update(fields)

def get_model():
    global MODEL
    if MODEL is None:
        from faster_whisper import WhisperModel
        try:
            MODEL = WhisperModel(os.getenv('WHISPER_MODEL', 'tiny'), device='cpu', compute_type='int8',
                                 cpu_threads=min(4, os.cpu_count() or 2), download_root=str(RUNTIME / 'whisper'))
        except Exception as exc:
            raise RuntimeError('Talmodellen kunde inte laddas. Kontrollera serverns nätverksåtkomst för modellhämtning och försök igen.') from exc
    return MODEL

def translator(source: str, target: str):
    from argostranslate import package, translate
    if source == target:
        return lambda text: text
    def installed(a, b):
        langs = translate.get_installed_languages()
        src = next((x for x in langs if x.code == a), None)
        dst = next((x for x in langs if x.code == b), None)
        if src and dst:
            try:
                return src.get_translation(dst)
            except Exception:
                return None
        return None
    existing = installed(source, target)
    if existing:
        return existing.translate
    package.update_package_index()
    available = package.get_available_packages()
    direct = next((p for p in available if p.from_code == source and p.to_code == target), None)
    pairs = [(source, target)] if direct else [(source, 'en'), ('en', target)]
    for a, b in pairs:
        if a == b or installed(a, b):
            continue
        pkg = next((p for p in available if p.from_code == a and p.to_code == b), None)
        if not pkg:
            raise RuntimeError(f'Ingen lokal översättningsmodell finns för {source} → {target}. Välj ett annat språk.')
        try:
            package.install_from_path(pkg.download())
        except Exception as exc:
            raise RuntimeError('Översättningsmodellen kunde inte hämtas. Kontrollera serverns nätverksåtkomst och försök igen.') from exc
    result = installed(source, target)
    if not result:
        raise RuntimeError('Översättningsmodellen kunde inte startas.')
    return result.translate

def new_job(project_id: str, operation):
    with LOCK:
        if any(j['projectId'] == project_id and j['status'] in ('queued', 'running') for j in JOBS.values()):
            raise HTTPException(409, 'Projektet bearbetas redan. Vänta tills det är klart.')
        job_id = str(uuid.uuid4())
        JOBS[job_id] = {'id': job_id, 'projectId': project_id, 'status': 'queued', 'progress': 0, 'message': 'Förbereder…'}
    def worker():
        try:
            update_job(job_id, status='running')
            with AI_LOCK:
                operation(job_id)
            update_job(job_id, status='done', progress=100, message='Klart')
        except Exception as exc:
            log.exception('Caption job failed')
            message = str(exc) if isinstance(exc, RuntimeError) else 'Bearbetningen misslyckades. Kontrollera anslutningen för modellhämtning och försök igen.'
            update_job(job_id, status='error', message=message)
    threading.Thread(target=worker, daemon=True).start()
    return dict(JOBS[job_id])

def stamp(seconds: float, vtt=False) -> str:
    total = round(seconds * 1000)
    hours, rem = divmod(total, 3600000)
    mins, rem = divmod(rem, 60000)
    secs, ms = divmod(rem, 1000)
    return f'{hours:02}:{mins:02}:{secs:02}{"." if vtt else ","}{ms:03}'

def subtitle_file(segments, vtt=False):
    blocks = []
    for i, s in enumerate(segments):
        text = s['text'].strip().replace('\r', '').replace('\n\n', '\n').replace('-->', '→')
        # Prevent captions from being interpreted as HTML/VTT formatting.
        if vtt:
            text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        blocks.append(f'{i + 1}\n{stamp(s["start"], vtt)} --> {stamp(s["end"], vtt)}\n{text}\n')
    return ('WEBVTT\n\n' if vtt else '') + '\n'.join(blocks)

def ass_subtitles(project):
    style = project['style']
    width, height = project['width'], project['height']
    # Match preview size in a 360px-wide reference frame.
    size = style['size'] * width / 360
    colors = {'lime': '&H0075E3CC', 'white': '&H00FFFFFF', 'yellow': '&H0059DDFF', 'pink': '&H00CBA4FF'}
    primary = colors[style['color']] if style['preset'] in ('highlight', 'bold') else '&H00FFFFFF'
    alignment = {'bottom': 2, 'center': 5, 'top': 8}[style['position']]
    margin = round(height * .13)
    outline = 0 if style['preset'] == 'minimal' else max(1, width / 360 * 2)
    bold = 0 if style['preset'] == 'minimal' else -1
    header = f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,{size},{primary},&H00FFFFFF,&H00101010,&H80000000,{bold},0,0,0,100,100,0,0,1,{outline},1,{alignment},{round(width*.06)},{round(width*.06)},{margin},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    def ass_time(t):
        total = round(t * 100)
        hours, rem = divmod(total, 360000)
        mins, rem = divmod(rem, 6000)
        secs, hundredths = divmod(rem, 100)
        return f'{hours}:{mins:02}:{secs:02}.{hundredths:02}'
    rows = []
    for s in project['segments']:
        text = s['text'].replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\r', '').replace('\n', r'\N')
        if style['preset'] == 'bold':
            text = text.upper()
        rows.append(f'Dialogue: 0,{ass_time(s["start"])},{ass_time(s["end"])},Default,,0,0,0,,{text}')
    return header + '\n'.join(rows)

@app.get('/api/health')
def health():
    return {'status': 'ok', 'ffmpeg': bool(media_binary('ffmpeg')), 'ffprobe': bool(media_binary('ffprobe')), 'transcription': 'faster-whisper', 'translation': 'argos-local', 'model': os.getenv('WHISPER_MODEL', 'tiny')}

@app.get('/api/projects')
def projects():
    with LOCK:
        result = [json.loads(p.read_text()) for p in STORE.glob('*/project.json')]
    return sorted(result, key=lambda p: p['created'], reverse=True)

@app.post('/api/projects', status_code=201)
async def upload(file: UploadFile = File(...)):
    import time
    pid = str(uuid.uuid4())
    path = STORE / pid
    path.mkdir()
    video = path / 'source'
    total = 0
    try:
        with video.open('wb') as out:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD:
                    raise HTTPException(413, 'Videon får vara högst 500 MB.')
                out.write(chunk)
        raw = run_command(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(video)], 30)
        probe = json.loads(raw)
        stream = next((s for s in probe['streams'] if s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
        if not stream:
            raise HTTPException(422, 'Filen innehåller ingen video. Ladda upp MP4, MOV eller WebM.')
        duration = float(probe['format'].get('duration') or stream.get('duration') or 0)
        if duration <= 0 or duration > 3600:
            raise HTTPException(422, 'Videon måste vara mellan 0 och 60 minuter lång.')
        rotation = int(stream.get('tags', {}).get('rotate', 0))
        for entry in stream.get('side_data_list', []):
            rotation = int(entry.get('rotation', rotation))
        width, height = stream['width'], stream['height']
        if rotation % 180:
            width, height = height, width
        project = {'id': pid, 'name': Path(file.filename or 'Video').name, 'duration': duration, 'width': width, 'height': height,
                   'hasAudio': any(s['codec_type'] == 'audio' for s in probe['streams']), 'created': time.time(),
                   'segments': [], 'sourceSegments': [], 'language': None, 'captionLanguage': None,
                   'style': CaptionStyle().model_dump()}
        save_project(project)
        # Normalize upload for reliable browser playback and remove container metadata.
        run_command(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-map', '0:v:0', '-map', '0:a:0?',
                     '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
                     '-c:a', 'aac', '-movflags', '+faststart', '-map_metadata', '-1', str(path / 'preview.mp4')], 600)
        run_command(['ffmpeg', '-v', 'error', '-y', '-i', str(path / 'preview.mp4'), '-frames:v', '1', '-vf', 'scale=360:-2', str(path / 'poster.jpg')], 30)
        return project
    except HTTPException:
        shutil.rmtree(path, ignore_errors=True)
        raise
    except Exception as exc:
        log.exception('Video upload failed')
        shutil.rmtree(path, ignore_errors=True)
        raise HTTPException(422, str(exc) if isinstance(exc, RuntimeError) else 'Videon kunde inte läsas. Prova MP4, MOV eller WebM.')
    finally:
        await file.close()

@app.get('/api/projects/{pid}')
def get_project(pid: str):
    return read_project(pid)

@app.get('/api/projects/{pid}/media')
def media(pid: str):
    return FileResponse(project_dir(pid) / 'preview.mp4', media_type='video/mp4')

@app.get('/api/projects/{pid}/poster')
def poster(pid: str):
    return FileResponse(project_dir(pid) / 'poster.jpg', media_type='image/jpeg')

@app.put('/api/projects/{pid}')
def edit(pid: str, edits: Edits):
    with LOCK:
        if any(j['projectId'] == pid and j['status'] in ('queued', 'running') for j in JOBS.values()):
            raise HTTPException(409, 'Vänta tills bearbetningen är klar innan du sparar.')
        p = read_project(pid)
        previous_end = 0
        for s in edits.segments:
            if s.end > p['duration'] + .05 or s.start < previous_end - .001:
                raise HTTPException(422, 'Undertexter måste ligga i tidsordning, utan överlapp, inom videons längd.')
            previous_end = s.end
        p.update(segments=[s.model_dump() for s in edits.segments], style=edits.style.model_dump())
        if edits.language and not p['captionLanguage']:
            p.update(language=edits.language, captionLanguage=edits.language)
        save_project(p)
    return p

@app.post('/api/projects/{pid}/generate')
def generate(pid: str, options: Generate):
    p = read_project(pid)
    if not p['hasAudio']:
        raise HTTPException(422, 'Videon saknar ljud. Du kan lägga till undertexter manuellt.')
    if options.language != 'auto':
        from faster_whisper.tokenizer import _LANGUAGE_CODES
        if options.language not in _LANGUAGE_CODES:
            raise HTTPException(422, 'Det valda språket stöds inte för transkribering.')
    def work(job_id):
        update_job(job_id, progress=5, message='Laddar talmodell… Första gången hämtas modellen.')
        model = get_model()
        update_job(job_id, progress=15, message='Lyssnar på videon…')
        chunks, info = model.transcribe(str(project_dir(pid) / 'source'), language=None if options.language == 'auto' else options.language,
                                       vad_filter=True, word_timestamps=True, beam_size=3)
        segments = []
        # Short subtitle groups fit social video without changing the transcript.
        for chunk in chunks:
            words = list(chunk.words or [])
            if not words and chunk.text.strip():
                words = [chunk]
            group = []
            def flush():
                if not group:
                    return
                text = ''.join(getattr(w, 'word', getattr(w, 'text', '')) for w in group).strip()
                start, end = max(0, group[0].start), min(p['duration'], group[-1].end)
                if text and end > start:
                    segments.append({'id': str(uuid.uuid4()), 'start': round(start, 3), 'end': round(end, 3), 'text': text})
                group.clear()
            for word in words:
                if group and (len(group) >= 7 or word.end - group[0].start > 3.5):
                    flush()
                group.append(word)
            flush()
            update_job(job_id, progress=min(75, 15 + int(chunk.end / p['duration'] * 60)), message='Genererar undertexter…')
        if not segments:
            raise RuntimeError('Inget tal hittades. Kontrollera ljudet eller lägg till undertexter manuellt.')
        p.update(sourceSegments=segments, segments=segments, language=info.language, captionLanguage=info.language)
        # Preserve a successful transcript even if a requested translation fails.
        save_project(p)
        if options.target != 'original' and options.target != info.language:
            update_job(job_id, progress=80, message='Förbereder lokal översättningsmodell…')
            fn = translator(info.language, options.target)
            translated = [{**s, 'text': fn(s['text'])} for s in segments]
            p.update(segments=translated, captionLanguage=options.target)
            save_project(p)
    return new_job(pid, work)

@app.post('/api/projects/{pid}/translate')
def translate_project(pid: str, options: Translate):
    p = read_project(pid)
    if not p['segments'] or not p['captionLanguage']:
        raise HTTPException(422, 'Välj videons språk och spara de manuella undertexterna innan du översätter.')
    def work(job_id):
        update_job(job_id, progress=15, message='Förbereder lokal översättningsmodell…')
        # Translate the currently edited text, not a stale original transcript.
        fn = translator(p['captionLanguage'], options.target)
        result = []
        for i, s in enumerate(p['segments']):
            result.append({**s, 'text': fn(s['text'])})
            update_job(job_id, progress=20 + int((i + 1) / len(p['segments']) * 75), message='Översätter undertexter…')
        p.update(segments=result, captionLanguage=options.target)
        save_project(p)
    return new_job(pid, work)

@app.get('/api/jobs/{job_id}')
def job(job_id: str):
    with LOCK:
        if job_id not in JOBS:
            raise HTTPException(404, 'Bearbetningen finns inte längre. Ladda om projektet.')
        return dict(JOBS[job_id])

@app.get('/api/projects/{pid}/subtitles/{kind}')
def subtitles(pid: str, kind: Literal['srt', 'vtt']):
    p = read_project(pid)
    if not p['segments']:
        raise HTTPException(422, 'Lägg till undertexter före export.')
    return Response(subtitle_file(p['segments'], kind == 'vtt'), media_type='text/vtt' if kind == 'vtt' else 'application/x-subrip',
                    headers={'Content-Disposition': f'attachment; filename="captions.{kind}"'})

@app.post('/api/projects/{pid}/export')
def export(pid: str):
    p = read_project(pid)
    if not p['segments']:
        raise HTTPException(422, 'Lägg till undertexter före export.')
    def work(job_id):
        path = project_dir(pid)
        update_job(job_id, progress=20, message='Renderar video med undertexter…')
        ass = path / 'captions.ass'
        ass.write_text(ass_subtitles(p))
        temporary = path / 'export-new.mp4'
        run_command(['ffmpeg', '-v', 'error', '-y', '-i', str(path / 'source'), '-map', '0:v:0', '-map', '0:a:0?',
                     '-vf', f'ass={ass}', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac',
                     '-movflags', '+faststart', '-map_metadata', '-1', str(temporary)], 1800)
        temporary.replace(path / 'export.mp4')
        update_job(job_id, download=f'/api/projects/{pid}/export.mp4')
    return new_job(pid, work)

@app.get('/api/projects/{pid}/export.mp4')
def download_export(pid: str):
    path = project_dir(pid) / 'export.mp4'
    if not path.exists():
        raise HTTPException(404, 'Exportera videon först.')
    return FileResponse(path, media_type='video/mp4', filename='frame-captioned.mp4')

if (ROOT / 'dist').exists():
    app.mount('/assets', StaticFiles(directory=ROOT / 'dist/assets'), name='assets')
    @app.get('/')
    def frontend():
        return FileResponse(ROOT / 'dist/index.html')
