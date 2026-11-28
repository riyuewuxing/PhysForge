import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
const out=path.resolve('evidence/h88-s01-paper');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],issues:[],errors:[],external:[]};
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
async function read(page,palette){
 const stage=page.getByTestId('three-stage-container');
 await page.waitForFunction(p=>{const s=document.querySelector('[data-testid="three-stage-container"]');return s?.dataset.s01Palette===p&&s.dataset.morphT==='0'&&Number(s.dataset.fieldLineCount)>0&&Number(s.dataset.conductorCount)>0&&!!s.dataset.s01Rendered;},palette,{timeout:15000});
 return await stage.evaluate(n=>{
  const d=n.dataset,r=n.getBoundingClientRect();
  return {state:JSON.parse(d.s01Rendered),bounds:JSON.parse(d.s01ScreenBounds),auto:d.s01AutoFit,palette:d.s01Palette,fieldLines:Number(d.fieldLineCount),conductors:Number(d.conductorCount),axis:n.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation'),width:r.width,height:r.height,sameCanvas:window.__s01Canvas===n.querySelector('canvas')};
 });
}
async function theme(page,palette){
 await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
 await page.waitForFunction(p=>document.documentElement.getAttribute('data-theme')===p,palette);
 if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
}
async function snap(page,key){
 await page.screenshot({path:path.join(out,key+'.png')});
 await page.locator('[data-testid="three-stage-container"] canvas').screenshot({path:path.join(out,key+'-canvas.png')});
}
async function run(base,width,preset){
 const ctx=await browser.newContext({viewport:{width,height:width===1024?768:900},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 const key=width+'-'+preset;
 try{
  await page.goto(base+'?model=stse-tokamak-magnetic-mirror&preset='+preset,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='stse-tokamak-magnetic-mirror');
  const stage=page.getByTestId('three-stage-container');
  if(!await stage.isVisible())await page.getByTestId('btn-view-3d').click();
  await stage.waitFor({state:'visible'});
  const init=await read(page,'chalkboard');
  const play=page.locator('[data-testid="btn-play-pause"]:visible');
  if(await play.getAttribute('aria-label')==='运行')await play.click();
  await page.waitForFunction(p=>{const s=JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.s01Rendered||'null');return s&&(p==='mirror-trapped-bounce'?s.reflectionCount>=1:s.t>.7);},preset,{timeout:20000});
  if(await play.getAttribute('aria-label')==='暂停')await play.click();
  await page.waitForTimeout(250);
  // Manual orbit ownership prevents an automatic refit from confusing a palette check.
  const canvas=stage.locator('canvas'),bb=await canvas.boundingBox();
  const axisBefore=(await read(page,'chalkboard')).axis;
  await page.mouse.move(bb.x+bb.width*.38,bb.y+bb.height*.44);await page.mouse.down();await page.mouse.move(bb.x+bb.width*.42,bb.y+bb.height*.47,{steps:6});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.s01AutoFit==='false');
  await page.waitForFunction(before=>document.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation')!==before,axisBefore);
  // OrbitControls damping is frame-based; wall time is not a settle criterion
  // on software WebGL. Wait for actual camera projection to stop moving.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const start=performance.now();let previous=null,streak=0;
    function tick(now){
      const n=document.querySelector('[data-testid="three-stage-container"]');
      const axis=n?.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation');
      const b=JSON.parse(n?.dataset.s01ScreenBounds||'null');
      const next=b&&axis?{axis,v:[b.left,b.right,b.top,b.bottom]}:null;
      if(next&&previous&&next.axis===previous.axis&&next.v.every((x,i)=>Math.abs(x-previous.v[i])<.001))streak++;else streak=0;
      previous=next;
      if(streak>=12)resolve(true);else if(now-start>25000)reject(Error('orbit damping never settled'));else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }));
  await page.evaluate(()=>{window.__s01Canvas=document.querySelector('[data-testid="three-stage-container"] canvas');});
  const dark=await read(page,'chalkboard');await snap(page,key+'-dark');
  await theme(page,'projector');const paper=await read(page,'projector');await snap(page,key+'-paper');
  await theme(page,'chalkboard');const back=await read(page,'chalkboard');await snap(page,key+'-restored');
  const physical=r=>JSON.stringify([r.state,r.fieldLines,r.conductors,r.auto]);
  check(dark.sameCanvas&&paper.sameCanvas&&back.sameCanvas,key+': no WebGL remount');
  check(physical(dark)===physical(paper)&&physical(dark)===physical(back),key+': no physical state/geometry count change');
  check(dark.auto==='false'&&dark.axis===paper.axis&&dark.axis===back.axis,key+': manual camera ownership and axes unchanged');
  check(['left','right','top','bottom'].every(k=>Math.abs(dark.bounds[k]-paper.bounds[k])<1&&Math.abs(dark.bounds[k]-back.bounds[k])<1),key+': projected bounds unchanged');
  await theme(page,'projector');await read(page,'projector');
  await page.getByTestId('btn-fullscreen-speech').click();
  const toggle=page.getByTestId('btn-view-3d-fullscreen');if((await toggle.innerText()).includes('3D 空间'))await toggle.click();
  const full=await read(page,'projector');
  const title=await page.getByTestId('fullscreen-title').evaluate(n=>({color:getComputedStyle(n).color,text:n.textContent}));
  check(JSON.stringify(full.state)===JSON.stringify(dark.state),key+': fullscreen preserved paused physics');
  await snap(page,key+'-full-paper');
  report.cases.push({width,preset,init,dark,paper,back,full,title});
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,key+'-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';
 browser=await chromium.launch({headless:true});
 for(const w of [1024,1440])for(const p of ['mirror-trapped-bounce','tokamak-helical-confinement'])await run(base,w,p);
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==4)throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external,cases:report.cases.length}));
console.log('S01 reversible paper palette and physical/camera invariance verified');
