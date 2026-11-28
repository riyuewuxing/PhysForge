import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
const out=path.resolve('evidence/h88-title');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],camera:[],issues:[],errors:[],external:[]};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
let browser;
async function inspect(page,id,width,theme,mode){
 await page.getByTestId('fullscreen-title').waitFor({state:'visible'});
 await page.getByTestId('fullscreen-formula').waitFor({state:'visible'});
 await page.evaluate(()=>document.fonts.ready);
 const v=await page.evaluate(()=>{
  const b=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const t=document.querySelector('[data-testid="fullscreen-title"]'),label=t.firstElementChild,f=document.querySelector('[data-testid="fullscreen-formula"]');
  const canvas=document.querySelector('[data-testid="simulation-canvas"]');
  const c=canvas?b(canvas):null;
  const view=JSON.parse(canvas?.dataset.capacitorView||'null');
  return {text:label.textContent,subtitle:t.lastElementChild.textContent,title:b(t),label:b(label),formula:b(f),scroll:label.scrollWidth,client:label.clientWidth,font:getComputedStyle(label).fontSize,canvas:c,view};
 });
 const key=width+'-'+id+'-'+theme+'-'+mode;
 check(v.title.right+15<=v.formula.left,key+': title/formula gap');
 check(v.scroll<=v.client+1,key+': actual title text not truncated');
 check(v.font==='24px',key+': title size unchanged');
 check(v.title.left>=0&&v.title.top>=0,key+': title within viewport');
 if(id==='em-capacitor-millikan'){
  check(mode==='stage'?v.text.includes('密立根油滴')&&v.text.includes('(E02)'):v.subtitle==='分镜讲课模式',key+': full correct title/mode');
  const intersects=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
  if(v.view&&v.canvas)for(const x of v.view.boxes){
    const r={left:x.left+v.canvas.left,right:x.right+v.canvas.left,top:x.top+v.canvas.top,bottom:x.bottom+v.canvas.top};
    check(!intersects(r,v.title)&&!intersects(r,v.formula),key+': capacitor geometry clear '+x.id);
  }
 }
 report.cases.push({key,...v});
 await page.screenshot({path:path.join(out,key+'.png')});
}
async function run(base,width,id,preset){
 const context=await browser.newContext({viewport:{width,height:width===1024?768:900},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 try{
  await page.goto(base+'?model='+id+(preset?'&preset='+preset:''),{waitUntil:'networkidle'});
  await page.waitForFunction(id=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId===id,id);
  if(id==='em-capacitor-millikan'){
   const canvas=page.getByTestId('simulation-canvas');
   const read=async()=>JSON.parse(await canvas.getAttribute('data-capacitor-view'));
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.sourceVoltageU0===-200);
   const slider=page.getByTestId('param-slider-distanceMm');
   await slider.fill('40');
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===40);
   const scope=page.getByTestId('btn-toggle-oscilloscope');if(await scope.isVisible())await scope.click();
   await page.waitForFunction(()=>{const c=document.querySelector('[data-testid="simulation-canvas"]'),v=JSON.parse(c?.dataset.capacitorView||'null');return v&&v.automatic&&Math.abs(v.width-c.getBoundingClientRect().width)<3;});
   const before=await read(),bb=await canvas.boundingBox();
   await page.mouse.move(bb.x+bb.width*.36,bb.y+bb.height*.42);await page.mouse.wheel(0,-100);
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorView||'null')?.automatic===false);
   const manual=await read();check(manual.scale>before.scale,width+': actual manual zoom increases');
   await slider.fill('8');
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===8);
   const after=await read();check(!after.automatic&&after.scale===manual.scale&&after.offsetX===manual.offsetX&&after.offsetY===manual.offsetY,width+': manual zoom and pan survive param update');
   await page.getByTestId('btn-reset-view').click();
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorView||'null')?.automatic===true);
   const reset=await read();
   await page.getByTestId('btn-reset-view').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorView||'null')?.automatic===true);
   const repeated=await read();
   check(reset.scale===repeated.scale&&reset.offsetX===repeated.offsetX&&reset.offsetY===repeated.offsetY,width+': repeat reset camera stable');
   report.camera.push({width,before,manual,after,reset,repeated});
  }
  for(const theme of ['chalkboard','projector']){
   if(theme==='projector'){
    await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
   }
   await page.getByTestId('btn-fullscreen-speech').click();
   if(id==='em-capacitor-millikan')await page.waitForFunction(()=>{const c=document.querySelector('[data-testid="simulation-canvas"]'),v=JSON.parse(c?.dataset.capacitorView||'null');return v?.automatic&&Math.abs(v.width-c.getBoundingClientRect().width)<3;});
   await inspect(page,id,width,theme,'stage');
   const story=page.getByTestId('btn-toggle-story');
   if(id==='em-capacitor-millikan'&&await story.isEnabled()){
    await story.click();await page.waitForFunction(()=>document.querySelector('[data-testid="fullscreen-title"]')?.textContent.includes('分镜讲课模式'));
    await inspect(page,id,width,theme,'story');
    await story.click();await page.waitForFunction(()=>document.querySelector('[data-testid="fullscreen-title"]')?.textContent.includes('全屏课堂演说模式'));
   }
   await page.getByTestId('btn-exit-fullscreen-speech').click();
  }
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-'+id+'-failure.png')}).catch(()=>{});}
 finally{await context.close();}
}
async function runE10(base,width){
 const ctx=await browser.newContext({viewport:{width,height:width===1024?768:900},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 try{
  await page.goto(base+'?model=em-3d-magnetic-fields&preset=finite-solenoid-3d',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='em-3d-magnetic-fields');
  const stage=page.getByTestId('three-stage-container');
  await page.getByTestId('btn-fullscreen-speech').click();
  const toggle=page.getByTestId('btn-view-3d-fullscreen');
  if((await toggle.innerText()).includes('3D 空间'))await toggle.click();
  await stage.waitFor({state:'visible'});
  const settle=async(mode)=>{
   await page.waitForFunction(mode=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;const b=JSON.parse(d?.e10SolenoidBounds||'null');return b?.mode===mode&&d.e10AutoFit==='true'&&d.fieldLineCount==='33'&&d.conductorCount==='10'&&b.fitOverlaps===0&&b.overlays.length>=3;},mode);
   const r=await stage.evaluate(n=>{
    const d=n.dataset,b=JSON.parse(d.e10SolenoidBounds),r=n.getBoundingClientRect();
    return {b,width:r.width,height:r.height,t:Number(d.simTime),speed:Number(d.speed),force:Number(d.lorentzForceMagnitude),trail:Number(d.trailPoints),fieldLines:Number(d.fieldLineCount),conductors:Number(d.conductorCount),particle:JSON.parse(d.e10ParticleProjection||'null')};
   });
   const key=width+'-E10-'+mode;
   check(r.b.body.visible&&r.b.body.left>=r.b.safe.left&&r.b.body.right<=r.b.safe.right&&r.b.body.top>=r.b.safe.top&&r.b.body.bottom<=r.b.safe.bottom,key+': actual body fit');
   if(mode==='domain')check(r.b.bounds.visible&&r.b.overlaps===0,key+': full field visible and clear');
   check([r.t,r.speed,r.force,r.trail].every(Number.isFinite)&&r.speed>0,key+': real physical telemetry');
   await page.screenshot({path:path.join(out,key+'.png')});
   return r;
  };
  const domain=await settle('domain');
  await page.getByTestId('e10-frame-body').click();const body=await settle('body');
  await page.getByTestId('e10-frame-domain').click();const again=await settle('domain');
  const phys=r=>[r.t,r.speed,r.force,r.trail,r.fieldLines,r.conductors,r.b.samples,r.b.bodySamples];
  check(JSON.stringify(phys(domain))===JSON.stringify(phys(body))&&JSON.stringify(phys(domain))===JSON.stringify(phys(again)),width+': camera never changes physical state or scene samples');
  const bodyWidth=r=>r.b.body.right-r.b.body.left;
  check(bodyWidth(body)>bodyWidth(domain),width+': body mode increases actual projected conductor width');
  check(Math.abs(bodyWidth(again)-bodyWidth(domain))<1,width+': domain return width deterministic');
  report.e10??=[];report.e10.push({width,domain,body,again});
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-E10-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';
 browser=await chromium.launch({headless:true});
 for(const w of [1024,1440])for(const [id,preset] of [['em-capacitor-millikan','capacitor-reversed-polarity'],['stse-em-devices-suite','velocity-selector-spectrometer'],['builder-optics-ray',null]])await run(base,w,id,preset);
 for(const w of [1024,1440])await runE10(base,w);
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.camera.length!==2||report.e10?.length!==2||report.cases.filter(x=>x.key.endsWith('-stage')).length!==12)throw Error(JSON.stringify(report));
console.log('H88 title and capacitor camera cases verified');
