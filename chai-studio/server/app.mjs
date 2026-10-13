import express from 'express';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import sharp from 'sharp';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {characters as seeds} from './characters.mjs';

export function createApp({dataDir=resolve('.runtime'),ollamaUrl=process.env.OLLAMA_URL||'http://127.0.0.1:11434',model=process.env.OLLAMA_MODEL||'qwen3:4b',fetchImpl=fetch,staticDir=resolve('dist')}={}){
 mkdirSync(dataDir,{recursive:true});const file=resolve(dataDir,'data.json');
 const imagesDir=resolve(dataDir,'avatars');mkdirSync(imagesDir,{recursive:true});
 const db=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{characters:[],chats:[],favorites:[]};
 const all=()=>[...seeds,...db.characters];const character=id=>all().find(c=>c.id===id);
 const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(db,null,2));renameSync(file+'.tmp',file);};
 const busy=new Set();const app=express();app.use(express.json({limit:'64kb'}));
 const error=(res,status,message)=>res.status(status).json({error:message});
 const publicCharacter=c=>({...c,custom:db.characters.some(x=>x.id===c.id),favorite:db.favorites.includes(c.id)});
 const string=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
 const validAvatar=value=>!value||(typeof value==='string'&&/^\/api\/avatars\/[0-9a-f-]{36}\.jpg$/.test(value)&&existsSync(resolve(imagesDir,value.split('/').at(-1))));
 async function readiness(){
  try{const r=await fetchImpl(`${ollamaUrl}/api/tags`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('bad status');
   const data=await r.json();const ready=(data.models||[]).some(m=>m.name===model||m.model===model);
   return {status:ready?'ready':'missing_model',model,message:ready?'Lokal AI är redo':`AI-modellen saknas. Kör ollama pull ${model}.`};
  }catch{return {status:'offline',model,message:'AI-servern är inte igång. Starta appen med STARTA-MUSE.command.'};}
 }
 app.get('/api/health',async(req,res)=>res.json(await readiness()));
 app.post('/api/avatars',express.raw({type:()=>true,limit:'5mb'}),async(req,res)=>{
  if(!Buffer.isBuffer(req.body)||!req.body.length)return error(res,422,'Välj en JPG-, PNG- eller WebP-bild.');
  const png=req.body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=req.body[0]===255&&req.body[1]===216;
  const webp=req.body.toString('ascii',0,4)==='RIFF'&&req.body.toString('ascii',8,12)==='WEBP';
  if(!png&&!jpeg&&!webp)return error(res,415,'Bildformatet stöds inte. Använd JPG, PNG eller WebP.');
  try{
   const image=sharp(req.body,{limitInputPixels:20000000,animated:false});const metadata=await image.metadata();
   if(!['jpeg','png','webp'].includes(metadata.format))return error(res,415,'Bildformatet stöds inte. Använd JPG, PNG eller WebP.');
   const filename=`${randomUUID()}.jpg`;
   await image.rotate().resize(600,720,{fit:'cover',position:'attention'}).jpeg({quality:85}).toFile(resolve(imagesDir,filename));
   res.status(201).json({avatarUrl:`/api/avatars/${filename}`});
  }catch{return error(res,422,'Bilden kunde inte läsas. Välj en hel JPG-, PNG- eller WebP-bild på högst 5 MB.');}
 });
 app.get('/api/avatars/:filename',(req,res)=>{
  if(!/^[0-9a-f-]{36}\.jpg$/.test(req.params.filename)||!existsSync(resolve(imagesDir,req.params.filename)))return error(res,404,'Bilden finns inte.');
  res.setHeader('Cache-Control','private, max-age=3600');res.sendFile(resolve(imagesDir,req.params.filename));
 });
 app.get('/api/characters',(req,res)=>res.json(all().map(publicCharacter)));
 app.get('/api/chats',(req,res)=>res.json(db.chats.map(c=>({...c,messages:undefined,count:c.messages.length,lastMessage:c.messages.at(-1)?.content||'',character:publicCharacter(character(c.characterId))})).sort((a,b)=>b.updated-a.updated)));
 app.post('/api/characters',(req,res)=>{
  const b=req.body;
  if(!string(b.name,40)||!string(b.tagline,100)||!string(b.personality,4000)||!string(b.greeting,1000)||!string(b.description,1000))return error(res,422,'Fyll i namn, beskrivning, personlighet och första meddelande.');
  if(!['violet','amber','blue','rose','green','peach','teal','lavender'].includes(b.color)||!['Vänner','Äventyr','Lärande','Kreativt'].includes(b.category))return error(res,422,'Välj en kategori och en avatar.');
  if(!validAvatar(b.avatarUrl))return error(res,422,'Ladda upp avatarbilden igen.');
  const c={id:randomUUID(),name:b.name.trim(),tagline:b.tagline.trim(),description:b.description.trim(),personality:b.personality.trim(),greeting:b.greeting.trim(),category:b.category,color:b.color,avatar:b.avatar&&['nova','kai','luna','elena','rowan','mika','atlas','iris'].includes(b.avatar)?b.avatar:'nova',avatarUrl:b.avatarUrl||null,tags:['Din karaktär'],featured:false};
  db.characters.push(c);save();res.status(201).json(publicCharacter(c));
 });
 app.put('/api/characters/:id',(req,res)=>{
  const c=db.characters.find(c=>c.id===req.params.id);if(!c)return error(res,404,'Din karaktär finns inte.');
  const b=req.body;if(!string(b.name,40)||!string(b.tagline,100)||!string(b.description,1000)||!string(b.personality,4000)||!string(b.greeting,1000))return error(res,422,'Fyll i alla textfält.');
  if(!['violet','amber','blue','rose','green','peach','teal','lavender'].includes(b.color)||!['Vänner','Äventyr','Lärande','Kreativt'].includes(b.category)||!['nova','kai','luna','elena','rowan','mika','atlas','iris'].includes(b.avatar))return error(res,422,'Välj en kategori och en avatar.');
  if(!validAvatar(b.avatarUrl))return error(res,422,'Ladda upp avatarbilden igen.');
  Object.assign(c,{name:b.name.trim(),tagline:b.tagline.trim(),description:b.description.trim(),personality:b.personality.trim(),greeting:b.greeting.trim(),category:b.category,color:b.color,avatar:b.avatar,avatarUrl:b.avatarUrl||null});save();res.json(publicCharacter(c));
 });
 app.delete('/api/characters/:id',(req,res)=>{
  const i=db.characters.findIndex(c=>c.id===req.params.id);if(i<0)return error(res,404,'Din karaktär finns inte.');
  if(db.chats.some(c=>c.characterId===req.params.id&&busy.has(c.id)))return error(res,409,'Vänta tills AI-svaret är klart.');
  const avatarUrl=db.characters[i].avatarUrl;
  db.characters.splice(i,1);db.chats=db.chats.filter(c=>c.characterId!==req.params.id);db.favorites=db.favorites.filter(id=>id!==req.params.id);save();
  if(avatarUrl&&!db.characters.some(c=>c.avatarUrl===avatarUrl)){const image=resolve(imagesDir,avatarUrl.split('/').at(-1));if(existsSync(image))unlinkSync(image);}
  res.sendStatus(204);
 });
 app.post('/api/characters/:id/favorite',(req,res)=>{if(!character(req.params.id))return error(res,404,'Karaktären finns inte.');const i=db.favorites.indexOf(req.params.id);if(i<0)db.favorites.push(req.params.id);else db.favorites.splice(i,1);save();res.json({favorite:i<0});});
 app.post('/api/chats',(req,res)=>{
  const c=character(req.body.characterId);if(!c)return error(res,404,'Karaktären finns inte.');
  const chat={id:randomUUID(),characterId:c.id,updated:Date.now(),messages:[{id:randomUUID(),role:'assistant',content:c.greeting,created:Date.now()}]};
  db.chats.push(chat);save();res.status(201).json({...chat,character:publicCharacter(c)});
 });
 app.get('/api/chats/:id',(req,res)=>{const c=db.chats.find(c=>c.id===req.params.id);if(!c)return error(res,404,'Chatten finns inte.');res.json({...c,character:publicCharacter(character(c.characterId))});});
 app.delete('/api/chats/:id',(req,res)=>{if(busy.has(req.params.id))return error(res,409,'Vänta tills svaret är klart.');const i=db.chats.findIndex(c=>c.id===req.params.id);if(i<0)return error(res,404,'Chatten finns inte.');db.chats.splice(i,1);save();res.sendStatus(204);});
 app.post('/api/chats/:id/messages',async(req,res)=>{
  const chat=db.chats.find(c=>c.id===req.params.id);if(!chat)return error(res,404,'Chatten finns inte.');
  if(!string(req.body.content,4000))return error(res,422,'Skriv ett meddelande på högst 4 000 tecken.');
  if(busy.has(chat.id))return error(res,409,'Karaktären skriver redan ett svar.');
  busy.add(chat.id);const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),180000);
  res.on('close',()=>controller.abort());let assistant='';let userSaved=false;let completed=false;
  const c=character(chat.characterId);const user={id:randomUUID(),role:'user',content:req.body.content.trim(),created:Date.now()};
  try{
   const system=`Du spelar en vuxen, fiktiv AI-karaktär, inte en verklig person. ${c.personality}\nSvara naturligt på användarens språk, svenska som standard. Visa eget perspektiv: du får säga emot, skämta och ställa konkreta frågor. Undvik mekaniska upprepningar, överdrivet medhåll och onödiga förklaringar om att du är AI. Håll svar till cirka 2–5 meningar om inte användaren ber om mer. Flirt och romantik kan vara lekfulla men ska inte innehålla grafiska sexuella beskrivningar. Följ användarens gränser. Skriv inte åt användaren. När du inte vet något, säg det.`;
   const upstream=await fetchImpl(`${ollamaUrl}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model,think:false,stream:true,messages:[{role:'system',content:system},...chat.messages.slice(-32).map(m=>({role:m.role,content:m.content})),{role:'user',content:user.content}],options:{temperature:.75,num_predict:512,num_ctx:4096}})});
   if(!upstream.ok){const detail=await upstream.json().catch(()=>({}));if(upstream.status===404)throw Error('AI-modellen saknas. Starta med STARTA-MUSE.command så hämtas den.');throw Error(detail.error?'AI-servern kunde inte skapa ett svar. Försök igen.':'AI-servern svarade med ett fel.');}
   if(!upstream.body)throw Error('AI-servern gav ett tomt svar.');
   chat.messages.push(user);chat.updated=Date.now();save();userSaved=true;
   res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache');res.flushHeaders();
   const event=(type,data)=>{if(!res.destroyed)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
   event('user',user);let buffer='';const decoder=new TextDecoder();
   for await(const chunk of upstream.body){buffer+=decoder.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';
    for(const line of lines){if(!line.trim())continue;const data=JSON.parse(line);if(data.error)throw Error('AI-servern avbröt svaret. Försök igen.');const text=data.message?.content||'';assistant+=text;if(text)event('token',{text});if(data.done)completed=true;}
   }
   if(buffer.trim()){const data=JSON.parse(buffer);if(data.error)throw Error('AI-servern avbröt svaret.');const text=data.message?.content||'';assistant+=text;if(text)event('token',{text});if(data.done)completed=true;}
   if(!assistant.trim()||!completed)throw Error('AI-servern avslutade inte svaret. Försök igen.');
   const reply={id:randomUUID(),role:'assistant',content:assistant,created:Date.now()};chat.messages.push(reply);chat.updated=Date.now();save();event('done',reply);res.end();
  }catch(e){
   const message=controller.signal.aborted?'Svaret avbröts eller tog för lång tid. Försök igen.':e.cause?.code==='ECONNREFUSED'?'AI-servern är inte igång. Starta appen med STARTA-MUSE.command.':e.message==='fetch failed'?'Kunde inte ansluta till lokal AI. Starta om appen.':e.message;
   if(userSaved){if(assistant.trim()){chat.messages.push({id:randomUUID(),role:'assistant',content:assistant,created:Date.now(),interrupted:true});}else chat.messages.pop();chat.updated=Date.now();save();}
   if(res.headersSent){if(!res.destroyed)res.write(`event: error\ndata: ${JSON.stringify({message})}\n\n`);res.end();}
   else if(!res.destroyed)error(res,503,message);
  }finally{clearTimeout(timeout);busy.delete(chat.id);}
 });
 app.use('/api',(req,res)=>error(res,404,'Den här funktionen finns inte.'));
 if(existsSync(staticDir)){app.use(express.static(staticDir));app.get('/',(req,res)=>res.sendFile(resolve(staticDir,'index.html')));}
 app.use((err,req,res,next)=>{console.error(err);if(!res.headersSent)error(res,err.status||500,err.status===413?'Bilden får vara högst 5 MB.':'Något gick fel. Kontrollera meddelandet och försök igen.');else res.end();});
 return app;
}
