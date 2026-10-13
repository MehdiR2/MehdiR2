import json
import subprocess
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend import app as backend

DEMO=Path(__file__).resolve().parents[1]/'.runtime/projects/11111111-1111-4111-8111-111111111111/source'

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(backend,'STORE',tmp_path)
    monkeypatch.setattr(backend,'JOBS',{})
    return TestClient(backend.app)

def upload(client):
    with DEMO.open('rb') as f:
        response=client.post('/api/projects',files={'file':('test.mp4',f,'video/mp4')})
    assert response.status_code==201, response.text
    return response.json()

def wait_job(client, job_id):
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        job=client.get(f'/api/jobs/{job_id}').json()
        if job['status'] in ('done','error'):
            return job
        time.sleep(.1)
    raise AssertionError('Timed out waiting for export')

def test_upload_edit_subtitles_and_burned_video(client):
    p=upload(client)
    assert p['hasAudio'] and p['height']==1280
    assert client.get(f'/api/projects/{p["id"]}/media',headers={'Range':'bytes=0-99'}).status_code==206
    segments=[{'id':'one','start':0,'end':2.0,'text':'Hej världen! <script> & العربية'},{'id':'two','start':2.1,'end':4,'text':'Nästa berättelse.'}]
    style={'preset':'highlight','color':'lime','position':'bottom','size':32}
    edited=client.put(f'/api/projects/{p["id"]}',json={'segments':segments,'style':style,'language':'sv'})
    assert edited.status_code==200,edited.text
    assert edited.json()['captionLanguage']=='sv'
    srt=client.get(f'/api/projects/{p["id"]}/subtitles/srt')
    assert '00:00:00,000 --> 00:00:02,000' in srt.text and 'Hej världen!' in srt.text
    vtt=client.get(f'/api/projects/{p["id"]}/subtitles/vtt')
    assert vtt.text.startswith('WEBVTT') and '&lt;script&gt; &amp;' in vtt.text
    response=client.post(f'/api/projects/{p["id"]}/export')
    assert response.status_code==200,response.text
    job=wait_job(client,response.json()['id'])
    assert job['status']=='done',job
    download=client.get(job['download'])
    assert download.status_code==200 and download.content[4:8]==b'ftyp'
    exported=backend.STORE/p['id']/'export.mp4'
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(exported)]))
    assert any(s['codec_type']=='audio' for s in info['streams'])
    assert any(s['codec_type']=='video' and s['width']==720 for s in info['streams'])
    def frame(file):
        return subprocess.check_output(['ffmpeg','-v','error','-ss','0.5','-i',str(file),'-vf','crop=500:230:110:900','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
    original=frame(backend.STORE/p['id']/'source')
    rendered=frame(exported)
    # Accent-colored pixels in the expected caption band prove text was burned.
    def lime_count(pixels):
        return sum(1 for r,g,b in zip(pixels[::3],pixels[1::3],pixels[2::3]) if r>140 and g>160 and b<155 and g>r)
    assert lime_count(rendered)>lime_count(original)+100

def test_reject_bad_upload_and_unknown_project(client):
    r=client.post('/api/projects',files={'file':('bad.mp4',b'not video','video/mp4')})
    assert r.status_code==422
    assert client.get('/api/projects').json()==[]
    assert client.get('/api/projects/not-a-uuid').status_code==404

def test_reject_overlapping_or_out_of_bounds_captions(client):
    p=upload(client)
    base=f'/api/projects/{p["id"]}'
    overlap=[{'id':'1','start':0,'end':3,'text':'A'},{'id':'2','start':2,'end':4,'text':'B'}]
    assert client.put(base,json={'segments':overlap,'style':p['style']}).status_code==422
    assert client.put(base,json={'segments':[{'id':'1','start':0,'end':p['duration']+1,'text':'A'}],'style':p['style']}).status_code==422
    assert client.put(base,json={'segments':[{'id':'1','start':2,'end':1,'text':'A'}],'style':p['style']}).status_code==422
    assert client.post(base+'/export').status_code==422

def test_ass_text_cannot_inject_style_overrides():
    p={'width':720,'height':1280,'style':backend.CaptionStyle().model_dump(),'segments':[{'start':0,'end':2,'text':r'{\pos(0,0)} unsafe'}]}
    ass=backend.ass_subtitles(p)
    assert r'{\pos' not in ass
    assert '0:00:00.00,0:00:02.00' in ass
