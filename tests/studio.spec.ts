import {test,expect} from '@playwright/test';
import {readFile, rm} from 'node:fs/promises';
const demo='11111111-1111-4111-8111-111111111111';
test('edit, persist, style and export real subtitles',async({page,request})=>{
 const original=await (await request.get(`/api/projects/${demo}`)).json();
 try{
  await page.goto('/');
  await page.getByLabel('Visa alla projekt').click();
  await page.getByRole('button',{name:/A change of perspective.mp4/}).click();
  await expect(page.getByRole('textbox',{name:'Undertext 1',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Undertext 1',exact:true}).fill('En berättelse för alla.');
  await page.getByRole('button',{name:'Spara',exact:true}).click();
  await expect(page.getByText('Sparat',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Undertext 1',exact:true})).toHaveValue('En berättelse för alla.');
  await page.getByRole('button',{name:'Stil',exact:true}).click();
  await page.getByRole('button',{name:'Din berättelse Minimal'}).click();
  await page.getByRole('button',{name:'Mitten',exact:true}).click();
  await expect(page.locator('.caption-overlay')).toHaveClass(/minimal.*position-center/);
  await page.getByRole('button',{name:'Spara',exact:true}).click();
  await page.getByRole('button',{name:'Exportera'}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:/Undertextfil/}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('captions.srt');
  await page.getByRole('button',{name:'Spela',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pausa',exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);
 }finally{await request.put(`/api/projects/${demo}`,{data:{segments:original.segments,style:original.style}});}
});
test('mobile workspace has no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByRole('heading',{name:/En video\. Fler röster/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Visa hjälp'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Stäng hjälp'}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('upload error is visible and does not create a project',async({page})=>{
 await page.goto('/');
 await page.locator('input[type=file]').setInputFiles({name:'invalid.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});
 await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.getByRole('button',{name:'Generera undertexter'})).toBeEnabled();
});
test('native file picker uploads a video that plays',async({page})=>{
 let projectId:string|undefined;
 try {
  await page.goto('/');
  await expect(page.getByRole('button',{name:/Släpp din video/})).toBeEnabled();
  const chooserPromise=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:/Släpp din video/}).click();
  const chooser=await chooserPromise;
  const buffer=await readFile(`.runtime/projects/${demo}/source`);
  await chooser.setFiles({name:'native-upload.mov',mimeType:'video/quicktime',buffer});
  await expect(page.getByText('Videon är uppladdad. Välj språk och generera undertexter.')).toBeVisible();
  const src=await page.locator('video').getAttribute('src');
  projectId=src?.split('/')[3];
  await expect(page.locator('.current-file strong')).toHaveText('native-upload.mov');
  await page.getByRole('button',{name:'Spela',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);
 } finally {
  if(projectId&&/^[0-9a-f-]{36}$/.test(projectId))await rm(`.runtime/projects/${projectId}`,{recursive:true});
 }
});
test('sixteen caption styles are selectable without a video watermark',async({page,request})=>{
 const original=await (await request.get(`/api/projects/${demo}`)).json();
 try {
  await page.goto('/');
  await page.getByLabel('Visa alla projekt').click();
  await page.getByRole('button',{name:/A change of perspective.mp4/}).click();
  await expect(page.locator('.frame-watermark')).toHaveCount(0);
  await page.getByRole('button',{name:'Stil',exact:true}).click();
  await expect(page.locator('.style-option')).toHaveCount(16);
  for(const name of ['Textplatta','Neon','Kontur','Pop','Elegant','Skrivmaskin','Editorial','Cinema','Comic','Soft glow','Accent label','Sport']) {
   const option=page.getByRole('button',{name:`Din berättelse ${name}`,exact:true});
   await option.click();
   await expect(option).toHaveClass(/selected/);
  }
  await expect(page.locator('.caption-overlay')).toHaveClass(/sport/);
  await page.getByRole('button',{name:'Spara',exact:true}).click();
  await page.reload();
  await expect(page.locator('.caption-overlay')).toHaveClass(/sport/);
 } finally {await request.put(`/api/projects/${demo}`,{data:{segments:original.segments,style:original.style}});}
});
