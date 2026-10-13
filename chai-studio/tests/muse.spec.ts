import {test,expect} from '@playwright/test';
test('search, categories and favorites work',async({page,request})=>{
 const cs=await (await request.get('/api/characters')).json();
 const elena=cs.find((c:any)=>c.id==='elena');if(elena.favorite)await request.post('/api/characters/elena/favorite');
 await page.goto('/');await expect(page.locator('.character-card')).toHaveCount(cs.length);
 await page.getByLabel('Sök karaktärer').fill('Elena');await expect(page.locator('.character-card')).toHaveCount(1);
 await page.getByRole('button',{name:'Spara Elena som favorit'}).click();
 await page.getByRole('button',{name:'Rensa sökning'}).click();
 await page.locator('.sidebar nav').getByRole('button',{name:/^Favoriter/}).click();await expect(page.locator('.character-card')).toHaveCount(1);
 await page.getByRole('button',{name:'Ta bort Elena från favoriter'}).click();await expect(page.getByRole('heading',{name:'Spara någon du vill träffa igen'})).toBeVisible();
 await page.getByRole('button',{name:'Upptäck',exact:false}).first().click();
 await page.getByRole('button',{name:'Lärande',exact:true}).click();await expect(page.locator('.character-card')).toHaveCount(2);
});
test('create and edit a character, then start and export a saved conversation',async({page,request})=>{
 const name=`Test Alex ${Date.now()}`;let createdId:string|undefined;
 try{
 await page.goto('/');await page.locator('.create-top').click();
 await page.getByLabel('Namn',{exact:true}).fill(name);await page.getByLabel('Kort presentation').fill('En kreativ testvän');
 await page.getByLabel('Om karaktären').fill('En illustrerad musikkompis.');await page.getByLabel('Personlighet & sätt att prata',{exact:false}).fill('Du är Alex, en kreativ musikkompis som pratar svenska.');await page.getByLabel('Första meddelandet').fill('Hej! Vad vill du skapa idag?');
 const {default:sharp}=await import('sharp');
 const avatarImage=await sharp({create:{width:80,height:100,channels:3,background:'#8d6baa'}}).png().toBuffer();
 await page.locator('input[type=file]').setInputFiles({name:'my-avatar.png',mimeType:'image/png',buffer:avatarImage});
 await expect(page.locator('.image-upload-row>img')).toHaveAttribute('src',/^\/api\/avatars\//);
 const createResponse=page.waitForResponse(r=>r.url().endsWith('/api/characters')&&r.request().method()==='POST');
 await page.getByRole('dialog').getByRole('button',{name:'Skapa karaktär',exact:true}).click();createdId=(await (await createResponse).json()).id;
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:`Redigera ${name}`}).click();await page.getByLabel('Kort presentation').fill('Nya kreativa idéer');await page.getByRole('button',{name:'Spara karaktär'}).click();
 await expect(page.getByText('Nya kreativa idéer',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:`Prata med ${name}`}).click();await expect(page.locator('.message-bubble')).toHaveText('Hej! Vad vill du skapa idag?');
 await page.reload();await page.locator('.chat-link').filter({hasText:name}).first().click();await expect(page.locator('.message-bubble')).toHaveText('Hej! Vad vill du skapa idag?');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportera konversation'}).click();expect((await download).suggestedFilename()).toBe(`muse-${name.toLowerCase()}.txt`);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Radera konversation'}).click();await expect(page.getByRole('heading',{name:'Vem vill du prata med idag?'})).toBeVisible();
 }finally{if(createdId)await request.delete(`/api/characters/${createdId}`);}
});
test('mobile layout, menu and editor are usable',async({page,request})=>{
 const cs=await (await request.get('/api/characters')).json();
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.character-card')).toHaveCount(cs.length);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Öppna sidomenyn'}).click();await page.getByRole('button',{name:'Mina karaktärer'}).click();await expect(page.getByRole('heading',{name:'Dina idéer. Deras personligheter.'})).toBeVisible();
 await page.locator('.create-top').click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('Namn',{exact:true}).fill('Mobiltest');await page.getByRole('button',{name:'Stäng karaktärseditor'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('chat UI consumes an Ollama protocol fixture and persists streamed replies',async({page})=>{
 const {createApp}=await import('../server/app.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'muse-browser-'));
 const fixture=async(url:string)=>url.endsWith('/api/tags')?Response.json({models:[{name:'qwen3:4b'}]}):new Response(['Hej! ','Vad vill du upptäcka idag?'].map(t=>JSON.stringify({message:{content:t},done:false})).join('\n')+'\n'+JSON.stringify({done:true})+'\n');
 const server=createApp({dataDir:dir,fetchImpl:fixture}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Möt Nova'}).click();
  await page.getByLabel('Ditt meddelande').fill('Hej Nova!');await page.getByRole('button',{name:'Skicka meddelande'}).click();
  await expect(page.locator('.message.assistant').last()).toContainText('Hej! Vad vill du upptäcka idag?');
  await expect(page.getByRole('button',{name:'Skicka meddelande'})).toBeVisible();
  await page.reload();await page.locator('.chat-link').filter({hasText:'Nova'}).first().click();
  await expect(page.locator('.message.user')).toContainText('Hej Nova!');await expect(page.locator('.message.assistant').last()).toContainText('Vad vill du upptäcka idag?');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true});}
});
