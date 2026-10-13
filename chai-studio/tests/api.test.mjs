import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.mjs';

async function setup(fetchImpl){const dir=await mkdtemp(join(tmpdir(),'muse-test-'));const app=createApp({dataDir:dir,fetchImpl,staticDir:join(dir,'no-build')});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;return{base,dir,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true});}};}
const json=data=>({headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const modelFixture=async(url,options)=>{if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen2.5:1.5b'}]});const req=JSON.parse(options.body);assert.equal(req.messages.at(-1).role,'user');assert.match(req.messages[0].content,/fiktiv/);const encoder=new TextEncoder();return new Response(new ReadableStream({start(c){for(const token of ['Hej! ','Vad vill du upptäcka?'])c.enqueue(encoder.encode(JSON.stringify({message:{content:token},done:false})+'\n'));c.enqueue(encoder.encode(JSON.stringify({done:true})+'\n'));c.close();}}));};
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
