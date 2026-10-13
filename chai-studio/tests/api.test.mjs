import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.mjs';

async function setup(fetchImpl){const dir=await mkdtemp(join(tmpdir(),'muse-test-'));const app=createApp({dataDir:dir,fetchImpl,staticDir:join(dir,'no-build')});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;return{base,dir,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true});}};}
const json=data=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const modelFixture=async(url,options)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:4b'}]});const req=JSON.parse(options.body);assert.equal(req.messages.at(-1).role,'user');assert.equal(req.think,false);assert.equal(req.model,'qwen3:4b');assert.match(req.messages[0].content,/fiktiv/);const encoder=new TextEncoder();return new Response(new ReadableStream({start(c){for(const token of ['Hej! ','Vad vill du upptäcka?'])c.enqueue(encoder.encode(JSON.stringify({message:{content:token},done:false})+'\n'));c.enqueue(encoder.encode(JSON.stringify({done:true})+'\n'));c.close();}}));};
test('custom character, favorite, chat and messages persist across restarts',async()=>{
 const s=await setup(modelFixture);
 try{
  const builtins=await (await fetch(s.base+'/api/characters')).json();assert.equal(builtins.length,8);
  const created=await fetch(s.base+'/api/characters',{method:'POST',...json({name:'Alex',tagline:'En kreativ vän',description:'Hjälper dig bolla idéer.',personality:'Du är Alex och gillar musik.',greeting:'Hej där!',category:'Kreativt',color:'violet',avatar:'nova'})});assert.equal(created.status,201);const c=await created.json();
  const fav=await fetch(s.base+`/api/characters/${c.id}/favorite`,{method:'POST'});assert.equal((await fav.json()).favorite,true);
  const chat=await (await fetch(s.base+'/api/chats',{method:'POST',...json({characterId:c.id})})).json();assert.equal(chat.messages[0].content,'Hej där!');
  const r=await fetch(s.base+`/api/chats/${chat.id}/messages`,{method:'POST',...json({content:'Hej, vad vill du göra?'})});assert.equal(r.status,200);const events=await r.text();assert.match(events,/event: token/);assert.match(events,/event: done/);
  const persisted=JSON.parse(await readFile(join(s.dir,'data.json'),'utf8'));assert.equal(persisted.chats[0].messages.length,3);assert.equal(persisted.chats[0].messages[2].content,'Hej! Vad vill du upptäcka?');
  const app2=createApp({dataDir:s.dir,fetchImpl:modelFixture});const server2=app2.listen(0,'127.0.0.1');await new Promise(r=>server2.once('listening',r));const cs=await (await fetch(`http://127.0.0.1:${server2.address().port}/api/characters`)).json();assert.equal(cs.find(x=>x.id===c.id).favorite,true);server2.closeAllConnections();await new Promise(r=>server2.close(r));
 }finally{await s.close();}
});
test('invalid inputs and missing AI are reported without phantom user messages',async()=>{
 const s=await setup(async()=>{throw Error('fetch failed')});
 try{
  assert.equal((await (await fetch(s.base+'/api/health')).json()).status,'offline');
  assert.equal((await fetch(s.base+'/api/characters',{method:'POST',...json({name:'Bad'})})).status,422);
  assert.equal((await fetch(s.base+'/api/chats',{method:'POST',...json({characterId:'not-a-character'})})).status,404);
  const chat=await (await fetch(s.base+'/api/chats',{method:'POST',...json({characterId:'nova'})})).json();
  assert.equal((await fetch(s.base+`/api/chats/${chat.id}/messages`,{method:'POST',...json({content:''})})).status,422);
  const r=await fetch(s.base+`/api/chats/${chat.id}/messages`,{method:'POST',...json({content:'Hej'})});assert.equal(r.status,503);assert.match((await r.json()).error,/lokal AI/);
  assert.equal((await (await fetch(s.base+`/api/chats/${chat.id}`)).json()).messages.length,1);
  assert.equal((await fetch(s.base+`/api/chats/${chat.id}`,{method:'DELETE'})).status,204);
  assert.equal((await fetch(s.base+`/api/chats/${chat.id}`)).status,404);
 }finally{await s.close();}
});
test('stream ending without completion reports error and retains partial text honestly',async()=>{
 const s=await setup(async()=>new Response(JSON.stringify({message:{content:'Ett avbrutet svar'}})+'\n'));
 try{const chat=await (await fetch(s.base+'/api/chats',{method:'POST',...json({characterId:'kai'})})).json();const r=await fetch(s.base+`/api/chats/${chat.id}/messages`,{method:'POST',...json({content:'Hej!'})});const body=await r.text();assert.match(body,/event: error/);assert.doesNotMatch(body,/event: done/);const fresh=await (await fetch(s.base+`/api/chats/${chat.id}`)).json();assert.equal(fresh.messages.at(-1).interrupted,true);}
 finally{await s.close();}
});
test('uploaded avatar becomes a persistent JPEG without embedded metadata',async()=>{
 const {default:sharp}=await import('sharp');const s=await setup(modelFixture);
 try{
  const image=await sharp({create:{width:100,height:80,channels:3,background:'#bb88cc'}}).withMetadata().png().toBuffer();
  const r=await fetch(s.base+'/api/avatars',{method:'POST',headers:{'Content-Type':'image/png'},body:image});assert.equal(r.status,201);const {avatarUrl}=await r.json();assert.match(avatarUrl,/^\/api\/avatars\/[0-9a-f-]+\.jpg$/);
  const downloaded=await fetch(s.base+avatarUrl);assert.equal(downloaded.status,200);const bytes=Buffer.from(await downloaded.arrayBuffer());const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,600);assert.equal(metadata.height,720);assert.equal(metadata.exif,undefined);
  const body={name:'Photo Alex',tagline:'En avatar med eget foto',description:'En fiktiv karaktär med en egen bild.',personality:'Du är Alex.',greeting:'Hej!',category:'Vänner',color:'violet',avatar:'nova',avatarUrl};
  const c=await(await fetch(s.base+'/api/characters',{method:'POST',...json(body)})).json();assert.equal(c.avatarUrl,avatarUrl);
  const stored=JSON.parse(await readFile(join(s.dir,'data.json'),'utf8'));assert.equal(stored.characters[0].avatarUrl,avatarUrl);
  assert.equal((await fetch(s.base+'/api/avatars',{method:'POST',headers:{'Content-Type':'image/svg+xml'},body:'<svg xmlns="http://www.w3.org/2000/svg"/>'})).status,415);
  assert.equal((await fetch(s.base+'/api/characters',{method:'POST',...json({...body,avatarUrl:'https://example.com/avatar.jpg'})})).status,422);
  await fetch(s.base+`/api/characters/${c.id}`,{method:'DELETE'});assert.equal((await fetch(s.base+avatarUrl)).status,404);
 }finally{await s.close();}
});
