import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, Clapperboard, CloudUpload, FileVideo, Film, FolderOpen, Globe2, HelpCircle, Languages, LoaderCircle, Maximize2, Pause, Play, Plus, Scissors, Settings2, ShieldCheck, Sparkles, Type, Volume2, VolumeX, X } from 'lucide-react';

type Segment = { id: string; start: number; end: number; text: string };
type Style = { preset: 'classic'|'highlight'|'minimal'|'bold'; color: 'lime'|'white'|'yellow'|'pink'; position: 'bottom'|'center'|'top'; size: number };
type Project = { id: string; name: string; duration: number; width: number; height: number; hasAudio: boolean; created: number; segments: Segment[]; sourceSegments: Segment[]; language: string|null; captionLanguage: string|null; style: Style; demo?: boolean };
type Job = { id: string; projectId: string; status: string; progress: number; message: string; download?: string };
const languages = [['sv','Svenska','SE'],['en','Engelska','EN'],['ar','Arabiska','AR'],['fr','Franska','FR'],['de','Tyska','DE'],['es','Spanska','ES'],['it','Italienska','IT'],['pt','Portugisiska','PT'],['pl','Polska','PL'],['uk','Ukrainska','UA'],['ru','Ryska','RU'],['zh','Kinesiska','ZH'],['ja','Japanska','JP'],['ko','Koreanska','KR'],['tr','Turkiska','TR'],['hi','Hindi','HI'],['fa','Persiska','FA'],['nl','Nederländska','NL'],['da','Danska','DK'],['fi','Finska','FI']];
const languageName = (code:string|null) => languages.find(l=>l[0]===code)?.[1] ?? code ?? 'Inte genererat';
const timeLabel = (seconds:number) => `${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
const ratioLabel=(p:Project)=>{const d=gcd(p.width,p.height);return `${p.width/d}:${p.height/d}`;};
const exactTime = (seconds:number) => `${timeLabel(seconds)}.${Math.floor(seconds%1*100).toString().padStart(2,'0')}`;
async function api<T>(url:string, init?:RequestInit):Promise<T> {
 const res = await fetch(url, init);
 if (!res.ok) { const data = await res.json().catch(()=>({})); throw new Error(typeof data.detail==='string'?data.detail:'Något gick fel. Försök igen.'); }
 return res.json();
}
const json = (body:unknown) => ({ headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });

export default function App() {
 const [projects,setProjects]=useState<Project[]>([]);
 const [project,setProject]=useState<Project|null>(null);
 const [source,setSource]=useState('auto');
 const [target,setTarget]=useState('original');
 const [tab,setTab]=useState<'captions'|'style'>('captions');
 const [job,setJob]=useState<Job|null>(null);
 const [uploading,setUploading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [saved,setSaved]=useState(true);
 const [saving,setSaving]=useState(false);
 const [playing,setPlaying]=useState(false);
 const [muted,setMuted]=useState(false);
 const [current,setCurrent]=useState(0);
 const [selected,setSelected]=useState<string|null>(null);
 const [exportOpen,setExportOpen]=useState(false);
 const [help,setHelp]=useState(false);
 const [dragging,setDragging]=useState(false);
 const [showProjects,setShowProjects]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const video=useRef<HTMLVideoElement>(null);
 const preview=useRef<HTMLDivElement>(null);
 const projectRef=useRef(project); projectRef.current=project;
 const busy=uploading || saving || Boolean(job && ['queued','running'].includes(job.status));

 useEffect(()=>{api<Project[]>('/api/projects').then(ps=>{setProjects(ps);if(ps.length)setProject(ps[0]);}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{setPlaying(false);setCurrent(0);setSelected(null);setSaved(true);setSource('auto');setTarget('original');setExportOpen(false);},[project?.id]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
 useEffect(()=>{
  if(!job || !['queued','running'].includes(job.status)) return;
  let stopped=false; let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{
    const next=await api<Job>(`/api/jobs/${job.id}`); if(stopped)return;setJob(next);
    if(next.status==='done'||next.status==='error'){
      const fresh=await api<Project>(`/api/projects/${next.projectId}`); if(stopped)return;
      setProjects(ps=>ps.map(p=>p.id===fresh.id?fresh:p));
      if(projectRef.current?.id===fresh.id){setProject(fresh);setSaved(true);}
      if(next.status==='error')setError(next.message);
      else if(next.download){const link=document.createElement('a');link.href=next.download;link.download='frame-captioned.mp4';link.click();setNotice('Din video är klar för nedladdning.');}
      else setNotice('Dina undertexter är klara.');
    }else timer=setTimeout(poll,1200);
  }catch(e){if(!stopped){setError((e as Error).message);setJob(null);}}};
  timer=setTimeout(poll,500);return()=>{stopped=true;clearTimeout(timer);};
 },[job?.id]);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(!saved){e.preventDefault();}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[saved]);

 const update=(patch:Partial<Project>)=>{setProject(p=>p?{...p,...patch}:null);setSaved(false);};
 const changeStyle=(patch:Partial<Style>)=>{if(project)update({style:{...project.style,...patch}});};
 const save=async()=>{
  if(!project)return null; if(saved && (project.captionLanguage || !project.segments.length || source==='auto'))return project;
  setSaving(true);setError('');
  try{const p=await api<Project>(`/api/projects/${project.id}`,{method:'PUT',...json({segments:project.segments,style:project.style,language:project.captionLanguage ?? (source==='auto'?undefined:source)})});setProject(p);setProjects(ps=>ps.map(x=>x.id===p.id?p:x));setSaved(true);return p;}
  catch(e){setError((e as Error).message);return null;}finally{setSaving(false);}
 };
 const selectProject=async(p:Project)=>{if(busy)return;if(!saved && !await save())return;setProject(p);setShowProjects(false);setError('');setJob(null);};
 const upload=async(file?:File)=>{
  if(!file||busy)return;if(!saved && !await save())return;
  if(file.size>500*1024*1024){setError('Videon får vara högst 500 MB.');return;}
  setUploading(true);setError('');setJob(null);const data=new FormData();data.append('file',file);
  try{const p=await api<Project>('/api/projects',{method:'POST',body:data});setProjects(ps=>[p,...ps]);setProject(p);setNotice('Videon är uppladdad. Välj språk och generera undertexter.');}
  catch(e){setError((e as Error).message);}finally{setUploading(false);if(fileInput.current)fileInput.current.value='';}
 };
 const generate=async()=>{
  if(!project||busy)return;
  if(project.segments.length && !window.confirm('Generera nya undertexter? Dina nuvarande undertexter ersätts.'))return;
  if(!await save())return;setError('');video.current?.pause();
  try{setJob(await api<Job>(`/api/projects/${project.id}/generate`,{method:'POST',...json({language:source,target})}));}
  catch(e){setError((e as Error).message);}
 };
 const translate=async()=>{
  if(!project||target==='original'||busy)return;if(!await save())return;setError('');
  try{setJob(await api<Job>(`/api/projects/${project.id}/translate`,{method:'POST',...json({target})}));}
  catch(e){setError((e as Error).message);}
 };
 const exportFile=async(kind:'srt'|'vtt'|'mp4')=>{
  if(!project||busy)return;if(!await save())return;setExportOpen(false);setError('');
  if(kind==='mp4')try{setJob(await api<Job>(`/api/projects/${project.id}/export`,{method:'POST'}));}catch(e){setError((e as Error).message);}
  else{const a=document.createElement('a');a.href=`/api/projects/${project.id}/subtitles/${kind}`;a.download=`captions.${kind}`;a.click();}
 };
 const seek=(t:number)=>{if(video.current){video.current.currentTime=t;setCurrent(t);}};
 const togglePlay=()=>{const v=video.current;if(!v)return;if(v.paused)v.play().catch(()=>setError('Videon kunde inte spelas upp. Ladda om projektet.'));else v.pause();};
 const editSegment=(id:string,patch:Partial<Segment>)=>{if(project)update({segments:project.segments.map(s=>s.id===id?{...s,...patch}:s)});};
 const addSegment=()=>{
  if(!project||busy)return;
  const segments=[...project.segments].sort((a,b)=>a.start-b.start);
  let start=Math.min(current,Math.max(0,project.duration-.1));
  for(const s of segments){if(s.end<=start)continue;if(s.start>start+.1)break;start=s.end;}
  const next=segments.find(s=>s.start>start);
  const end=Math.min(start+2,next?.start??project.duration,project.duration);
  if(end-start<.1){setError('Ingen ledig tid här. Flytta spelhuvudet till ett mellanrum mellan undertexterna.');return;}
  const s={id:crypto.randomUUID(),start,end,text:'Ny undertext'};update({segments:[...segments,s].sort((a,b)=>a.start-b.start)});setSelected(s.id);setTab('captions');seek(start);
 };
 const active=project?.segments.find(s=>current>=s.start&&current<s.end);
 const displayCaption=active?.text ?? (!project?'Din berättelse.\nPå alla språk.':'');
 const style=project?.style ?? {preset:'highlight',color:'lime',position:'bottom',size:32};
 const jobActive=job&&['queued','running'].includes(job.status);

 return <div className="app-shell">
  <aside className="rail">
   <a className="brand-mark" href="/" aria-label="Frame startsida"><span/><span/><span/></a>
   <div className="rail-group">
    <button className={!showProjects?'rail-button active':'rail-button'} title="Videoeditor" aria-label="Videoeditor" onClick={()=>setShowProjects(false)}><Clapperboard size={21}/></button>
    <button className={showProjects?'rail-button active':'rail-button'} title="Mina projekt" aria-label="Mina projekt" onClick={()=>setShowProjects(v=>!v)}><FolderOpen size={21}/></button>
   </div>
   <div className="rail-bottom"><button className="rail-button" aria-label="Hjälp" onClick={()=>setHelp(true)}><HelpCircle size={21}/></button><span className="avatar" title="Lokal arbetsyta">M</span></div>
  </aside>
  <div className="app-body">
   <header className="topbar"><a className="wordmark" href="/">frame<span>studio</span></a><span className="topbar-divider"/><span className="workspace">Din kreativa arbetsyta <ChevronDown size={13}/></span><div className="topbar-right"><span className="local-badge"><span/> Lokal AI</span><button className="icon-button" aria-label="Visa hjälp" onClick={()=>setHelp(true)}><HelpCircle size={18}/></button></div></header>
   <div className="page-heading"><div><div className="breadcrumb"><span>Arbetsyta</span><ChevronRight size={12}/><span>Videoeditor</span></div><h1>En video. Fler röster.<span className="heading-dot">✦</span></h1><p>Gör din berättelse tillgänglig, på vilket språk du vill.</p></div><button className="button secondary new-project" disabled={busy} onClick={()=>fileInput.current?.click()}><Plus size={16}/> Nytt projekt</button></div>
   {error&&<div className="error-banner" role="alert"><span>{error}</span><button aria-label="Stäng felmeddelande" onClick={()=>setError('')}><X size={16}/></button></div>}
   {notice&&<div className="toast" role="status"><CheckCheck size={17}/>{notice}</div>}
   <input type="file" ref={fileInput} accept="video/*,.mp4,.mov,.webm,.mkv" hidden onChange={(e:ChangeEvent<HTMLInputElement>)=>upload(e.target.files?.[0])}/>
   {showProjects?<section className="projects-page"><div className="panel-title"><h2>Mina projekt</h2><span>{projects.length} projekt</span></div><div className="project-grid">{projects.map(p=><button key={p.id} className="project-card" disabled={busy} onClick={()=>selectProject(p)}><img src={`/api/projects/${p.id}/poster`} alt=""/><span>{p.name}</span><small>{timeLabel(p.duration)} · {p.segments.length} undertexter</small></button>)}<button className="project-card project-add" disabled={busy} onClick={()=>fileInput.current?.click()}><Plus size={26}/><span>Ladda upp en video</span></button></div></section>:
   <main className="studio">
    <section className="setup-panel">
     <div className="panel-title"><h2>Ditt projekt</h2><span className="step-badge">01</span></div>
     <button className={`upload-zone ${dragging?'drag-over':''}`} disabled={busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);upload(e.dataTransfer.files[0]);}}><span className="upload-icon">{uploading?<LoaderCircle className="spin" size={24}/>:<CloudUpload size={24}/>}</span><strong>{uploading?'Förbereder din video…':'Släpp din video här'}</strong><span>eller <em>välj en fil</em></span><small>MP4, MOV, WebM · upp till 500 MB</small></button>
     {project&&<div className="current-file"><img src={`/api/projects/${project.id}/poster`} alt=""/><div><strong title={project.name}>{project.name}</strong><small>{timeLabel(project.duration)} <span>·</span> {project.width} × {project.height}</small></div><Check size={15}/></div>}
     <div className="section-rule"/>
     <div className="panel-title language-title"><h2>Språk & undertexter</h2><Languages size={17}/></div>
     <label className="field-label" htmlFor="source-language">Videons språk</label><div className="select-wrap"><Globe2 size={16}/><select id="source-language" value={source} disabled={busy} onChange={e=>setSource(e.target.value)}><option value="auto">Identifiera automatiskt</option>{languages.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select><ChevronDown size={14}/></div>
     <div className="translate-divider"><span/><ArrowDownToLine size={13}/><span/></div>
     <label className="field-label" htmlFor="target-language">Undertexternas språk <span className="small-pill">ÖVERSÄTT</span></label><div className="select-wrap"><Languages size={16}/><select id="target-language" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="original">Samma som videon</option>{languages.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select><ChevronDown size={14}/></div>
     <button className="button primary generate-button" disabled={!project||busy||!project.hasAudio} onClick={generate}>{jobActive?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} Generera undertexter <ArrowRight size={16}/></button>
     {project&&project.segments.length>0&&target!=='original'&&<button className="translate-button" disabled={busy} onClick={translate}><Languages size={14}/> Översätt befintliga undertexter</button>}
     {jobActive?<div className="job-progress" role="status"><div><span>{job.message}</span><b>{job.progress}%</b></div><div className="progress-track"><span style={{width:`${job.progress}%`}}/></div></div>:<p className="generation-hint">{project&&!project.hasAudio?'Videon saknar ljud. Lägg till text manuellt.':'AI lyssnar, transkriberar och synkar åt dig.'}</p>}
     <div className="privacy-note"><span className="privacy-icon"><ShieldCheck size={18}/></span><div><strong>Din video stannar hos dig</strong><p>Bearbetas lokalt. Inga API-nycklar.<br/>Språkmodeller hämtas vid behov.</p></div></div>
     <div className="recent-section"><div className="recent-heading"><span>Senaste projekt</span><button aria-label="Visa alla projekt" onClick={()=>setShowProjects(true)}><ArrowRight size={14}/></button></div>{projects.slice(0,3).map(p=><button className={`recent-project ${project?.id===p.id?'selected':''}`} key={p.id} disabled={busy} onClick={()=>selectProject(p)}><FileVideo size={16}/><span>{p.name}</span>{p.demo?<small>EXEMPEL</small>:<ChevronRight size={12}/>}</button>)}{!projects.length&&<p className="no-projects">Dina videor dyker upp här.</p>}</div>
    </section>
    <section className="preview-panel"><div className="preview-toolbar"><div><span className="live-dot"/> Förhandsvisning {project?.demo&&<span className="example-label">EXEMPEL</span>}</div><button className="icon-button" aria-label="Visa video i helskärm" onClick={()=>preview.current?.requestFullscreen()}><Maximize2 size={16}/></button></div>
     <div className="preview-stage" ref={preview}><div className={`video-frame ${project&&project.width>=project.height?'landscape':''}`} style={{aspectRatio:project?`${project.width}/${project.height}`:'9/16'}}>
      {project?<video key={project.id} ref={video} src={`/api/projects/${project.id}/media`} poster={`/api/projects/${project.id}/poster`} muted={muted} playsInline onTimeUpdate={e=>setCurrent(e.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onClick={togglePlay}/>:<div className="empty-scene"><div className="scene-sun"/><div className="scene-mountain back"/><div className="scene-mountain front"/><div className="scene-grain"/></div>}
      {!project&&<div className="preview-empty-label">DIN NÄSTA BERÄTTELSE BÖRJAR HÄR</div>}
      <div className={`caption-overlay ${style.preset} position-${style.position} color-${style.color}`} style={{fontSize:`calc(${style.size} * 100cqw / 360)`}} dir="auto">{displayCaption}</div>
      {project&&!playing&&<button className="video-play-overlay" aria-label="Spela video" onClick={togglePlay}><Play size={23} fill="currentColor"/></button>}
      <span className="frame-watermark">frame<span>✦</span></span>
     </div><div className="preview-format">{project?`${ratioLabel(project)} FORMAT`:'9:16 FORMAT'}<span/> {project?'ORIGINAL':'FÖRHANDSVISNING'}</div></div>
     <div className="player"><button className="icon-button player-play" aria-label={playing?'Pausa':'Spela'} disabled={!project} onClick={togglePlay}>{playing?<Pause size={17} fill="currentColor"/>:<Play size={17} fill="currentColor"/>}</button><span className="player-time">{timeLabel(current)} <span>/ {timeLabel(project?.duration??0)}</span></span><input type="range" className="scrubber" aria-label="Videoposition" min={0} max={project?.duration??1} step={0.01} value={current} disabled={!project} onChange={e=>seek(Number(e.target.value))} style={{'--progress':`${current/(project?.duration||1)*100}%`} as React.CSSProperties}/><button className="icon-button" disabled={!project} aria-label={muted?'Slå på ljud':'Stäng av ljud'} onClick={()=>setMuted(v=>!v)}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button></div>
     <div className="timeline"><div className="timeline-header"><span><Scissors size={13}/> Tidslinje</span><span>{project?.segments.length??0} undertexter</span></div><div className="timeline-ruler">{[0,.25,.5,.75,1].map((n)=><span key={n}>{timeLabel(n*(project?.duration??12))}</span>)}</div><div className="timeline-track" onClick={e=>{if(project){const r=e.currentTarget.getBoundingClientRect();seek((e.clientX-r.left)/r.width*project.duration);}}}><div className="track-base"/>{project?.segments.map(s=><button key={s.id} className={`timeline-segment ${active?.id===s.id?'is-active':''}`} aria-label={`Hoppa till ${s.text}`} style={{left:`${s.start/project.duration*100}%`,width:`${(s.end-s.start)/project.duration*100}%`}} onClick={e=>{e.stopPropagation();seek(s.start);setSelected(s.id);}}>{s.text}</button>)}{!project&&<span className="timeline-placeholder">Ladda upp en video för att börja</span>}<div className="playhead" style={{left:`${current/(project?.duration||1)*100}%`}}><span/></div></div></div>
    </section>
    <section className="editor-panel"><div className="editor-tabs"><button className={tab==='captions'?'active':''} onClick={()=>setTab('captions')}><Type size={16}/> Undertexter <span>{project?.segments.length??0}</span></button><button className={tab==='style'?'active':''} onClick={()=>setTab('style')}><Settings2 size={15}/> Stil</button></div>
     {tab==='captions'?<div className="caption-editor"><div className="editor-heading"><div><h2>Varje ord räknas.</h2><p>Finjustera texten. Gör den till din.</p></div><button className="icon-button" title="Lägg till undertext" aria-label="Lägg till undertext" disabled={!project||busy} onClick={addSegment}><Plus size={18}/></button></div>
      {project?.captionLanguage&&<div className="caption-language"><span className="language-tag">{project.captionLanguage.toUpperCase()}</span><span>{languageName(project.captionLanguage)}</span><span className="synced"><CheckCheck size={12}/> Synkat</span></div>}
      <div className="caption-list">{project?.segments.length?project.segments.map((s,i)=><div key={s.id} className={`caption-card ${selected===s.id||active?.id===s.id?'selected':''}`} onClick={()=>setSelected(s.id)}><div className="caption-card-top"><button className="caption-index" onClick={()=>seek(s.start)} title="Spela från undertext">{String(i+1).padStart(2,'0')}</button><button className="caption-time" onClick={()=>{seek(s.start);setSelected(s.id);}}>{exactTime(s.start)} <span>→</span> {exactTime(s.end)}</button><button className="remove-caption" aria-label={`Ta bort undertext ${i+1}`} disabled={busy} onClick={()=>update({segments:project.segments.filter(x=>x.id!==s.id)})}><X size={13}/></button></div><textarea aria-label={`Undertext ${i+1}`} value={s.text} disabled={busy} dir="auto" rows={2} onChange={e=>editSegment(s.id,{text:e.target.value})}/>{selected===s.id&&<div className="time-edit"><label>Start <input aria-label={`Starttid ${i+1}`} type="number" min="0" step="0.1" value={s.start} disabled={busy} onChange={e=>editSegment(s.id,{start:Number(e.target.value)})}/></label><label>Slut <input aria-label={`Sluttid ${i+1}`} type="number" min="0" step="0.1" value={s.end} disabled={busy} onChange={e=>editSegment(s.id,{end:Number(e.target.value)})}/></label><span>sek</span></div>}</div>):<div className="captions-empty"><span><Type size={29}/></span><h3>Ge din video en röst.</h3><p>Generera undertexter med AI,<br/>eller skriv dina egna.</p><button className="text-button" disabled={!project||busy} onClick={addSegment}><Plus size={14}/> Lägg till manuellt</button></div>}</div>
      {Boolean(project?.segments.length)&&<button className="add-caption-button" disabled={busy} onClick={addSegment}><Plus size={14}/> Lägg till undertext</button>}
     </div>:<div className="style-editor"><div className="editor-heading"><div><h2>Text med personlighet.</h2><p>En stil som matchar din berättelse.</p></div></div><label className="field-label">Välj en stil</label><div className="style-grid">{(['highlight','classic','minimal','bold'] as const).map(p=><button key={p} className={`style-option ${p} ${style.preset===p?'selected':''}`} disabled={!project||busy} onClick={()=>changeStyle({preset:p})}><span>Din berättelse</span><small>{({highlight:'Spotlight',classic:'Klassisk',minimal:'Minimal',bold:'Statement'})[p]}</small>{style.preset===p&&<Check size={12}/>}</button>)}</div><label className="field-label">Accentfärg</label><div className="color-options">{(['lime','white','yellow','pink'] as const).map(c=><button key={c} className={`swatch color-${c} ${style.color===c?'selected':''}`} aria-label={`Färg ${c}`} disabled={!project||busy} onClick={()=>changeStyle({color:c})}>{style.color===c&&<Check size={15}/>}</button>)}</div><label className="field-label" htmlFor="caption-size">Textstorlek <span className="size-value">{style.size} px</span></label><input id="caption-size" type="range" min={16} max={64} value={style.size} disabled={!project||busy} onChange={e=>changeStyle({size:Number(e.target.value)})}/><label className="field-label">Placering</label><div className="position-options">{(['top','center','bottom'] as const).map(p=><button key={p} className={style.position===p?'selected':''} disabled={!project||busy} onClick={()=>changeStyle({position:p})}>{({top:'Överst',center:'Mitten',bottom:'Nederst'})[p]}</button>)}</div><div className="style-tip"><Sparkles size={17}/><p>Korta rader ger större genomslag. Sikta på 5–7 ord per undertext.</p></div></div>}
     <div className="editor-footer"><span>{saved?<><CheckCheck size={14}/> Sparat</>:<><span className="unsaved-dot"/> Osparade ändringar</>}</span><button className="text-button" disabled={saved||busy} onClick={save}>{saving?'Sparar…':'Spara'}</button></div>
    </section>
   </main>}
   <footer className="bottom-bar"><div><span className="footer-spark">✦</span><span>Skapad för din nästa <strong>stora idé.</strong></span></div><div className="export-area"><span className="export-info">{project?.segments.length?`${project.segments.length} undertexter · ${languageName(project.captionLanguage)}`:'Din berättelse, utan språkgränser.'}</span><div className="export-wrapper"><button className="button export-button" disabled={!project?.segments.length||busy} onClick={()=>setExportOpen(v=>!v)}><ArrowDownToLine size={16}/> Exportera <ChevronDown size={14}/></button>{exportOpen&&<><button className="menu-backdrop" aria-label="Stäng exportmenyn" onClick={()=>setExportOpen(false)}/><div className="export-menu"><span>VÄLJ FORMAT</span><button onClick={()=>exportFile('mp4')}><Film size={18}/><div>Video med undertexter<small>MP4 · inbränd text med din stil</small></div></button><button onClick={()=>exportFile('srt')}><Type size={18}/><div>Undertextfil<small>SRT · för redigerare och plattformar</small></div></button><button onClick={()=>exportFile('vtt')}><Globe2 size={18}/><div>Webbundertexter<small>VTT · för videospelare på webben</small></div></button></div></>}</div></div></footer>
  </div>
  {help&&<div className="modal-backdrop" onClick={()=>setHelp(false)}><div className="help-modal" role="dialog" aria-modal="true" aria-label="Om Frame" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="Stäng hjälp" onClick={()=>setHelp(false)}><X size={20}/></button><span className="help-icon"><Sparkles size={27}/></span><h2>Från video till fler röster.</h2><p>1. Ladda upp en video med tal.<br/>2. Välj videons språk och önskat undertextspråk.<br/>3. Generera, redigera och exportera.</p><p>Whisper transkriberar och Argos översätter lokalt på servern. Första körningen kan ta längre tid när modeller hämtas. Översättningsspråk beror på tillgängliga Argos-modeller; en saknad modell ger ett tydligt fel.</p><p>AI-text kan innehålla fel. Granska alltid undertexterna före publicering. Filer sparas lokalt på den här servern. Appen är avsedd för en privat arbetsyta och har ingen inloggning.</p><button className="button primary" onClick={()=>setHelp(false)}>Börja skapa <ArrowRight size={16}/></button></div></div>}
 </div>;
}
