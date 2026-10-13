"""Real model readiness check; requires allowed model download domains."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.app import get_model, translator, STORE
model=get_model()
chunks, info=model.transcribe(str(STORE/'11111111-1111-4111-8111-111111111111/source'),language='en',vad_filter=True)
text=' '.join(c.text.strip() for c in chunks)
assert len(text)>20 and info.language=='en',f'No useful transcript: {text}'
print('Whisper transcript:',text)
translated=translator('en','sv')('Find your own path.')
assert translated.strip() and translated!='Find your own path.',translated
print('English → Swedish:',translated)
reverse=translator('sv','en')('Hitta din egen väg.')
assert reverse.strip() and reverse!='Hitta din egen väg.',reverse
print('Swedish → English:',reverse)
print('Real transcription and translation checks passed.')
