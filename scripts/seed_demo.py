"""Generate a self-contained demo, with synthetic voice and illustrated scenery."""
from pathlib import Path
import json, subprocess, sys, uuid, time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import STORE, CaptionStyle
pid='11111111-1111-4111-8111-111111111111'
p=STORE / pid
if (p / 'project.json').exists():
    raise SystemExit()
p.mkdir(exist_ok=True)
# FFmpeg's built-in Flite voice provides a reproducible speech fixture.
speech='Sometimes, all you need is a little change of perspective. Take a breath. Find your own path. And let the world surprise you.'
(p/'speech.txt').write_text(speech)
subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',f'flite=textfile={p / "speech.txt"}:voice=slt','-ar','16000',str(p/'speech.wav')],check=True)
duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p/'speech.wav')])) + 1
# Original vector artwork is rendered through FFmpeg's librsvg decoder.
svg='''<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#b1c2c0"/><stop offset=".5" stop-color="#e3ceb1"/><stop offset="1" stop-color="#69857b"/></linearGradient><linearGradient id="m" x2=".2" y2="1"><stop stop-color="#829b93"/><stop offset="1" stop-color="#344f4c"/></linearGradient><linearGradient id="f" x2=".5" y2="1"><stop stop-color="#426e63"/><stop offset="1" stop-color="#172f31"/></linearGradient></defs><rect width="720" height="1280" fill="url(#sky)"/><circle cx="530" cy="310" r="71" fill="#edddae"/><path d="M0 750L120 640L280 740L495 410L720 670V1280H0Z" fill="#8a9c93"/><path d="M495 410L545 520L522 508L511 531L479 508L460 530L440 496Z" fill="#ccd0bd"/><path d="M0 1000L170 720L350 950L485 760L720 1060V1280H0Z" fill="url(#m)"/><path d="M0 1000L170 720L190 788L168 805L148 782L120 799Z" fill="#b5c1ad"/><path d="M0 1130L190 1000L425 1120L600 950L720 1040V1280H0Z" fill="url(#f)"/><path d="M430 1280Q350 1210 430 1160Q510 1100 440 1080" fill="none" stroke="#9b9e7c" stroke-width="9" opacity=".6"/><text x="56" y="106" fill="#39514b" font-family="sans-serif" font-size="19" letter-spacing="5">A CHANGE OF PERSPECTIVE</text><text x="56" y="147" fill="#39514b" font-family="sans-serif" font-size="13" letter-spacing="3">AN ILLUSTRATED SHORT FILM</text></svg>'''
(p/'scenery.svg').write_text(svg)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(p/'scenery.svg'),'-frames:v','1',str(p/'scenery.png')],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-loop','1','-i',str(p/'scenery.png'),'-i',str(p/'speech.wav'),'-vf','scale=720:1280,zoompan=z=min(zoom+0.00015\\,1.07):x=iw/2-iw/zoom/2:y=ih/2-ih/zoom/2:d=1:s=720x1280:fps=24','-t',str(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(p/'preview.mp4')],check=True)
import shutil
shutil.copy2(p/'preview.mp4',p/'source')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(p/'preview.mp4'),'-frames:v','1','-vf','scale=360:-2',str(p/'poster.jpg')],check=True)
segments=[{'id':str(uuid.uuid4()),'start':a,'end':min(b,duration),'text':t} for a,b,t in [(0,2.0,'Sometimes, all you need'),(2.0,4.0,'is a little change of perspective.'),(4.0,5.2,'Take a breath.'),(5.2,6.7,'Find your own path.'),(6.7,duration-.1,'And let the world surprise you.')]]
project={'id':pid,'name':'A change of perspective.mp4','duration':duration,'width':720,'height':1280,'hasAudio':True,'created':time.time(),'segments':segments,'sourceSegments':segments,'language':'en','captionLanguage':'en','style':CaptionStyle().model_dump(),'demo':True}
(p/'project.json').write_text(json.dumps(project,ensure_ascii=False))
print(f'Demo ready: {duration:.1f}s')
