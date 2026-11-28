import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
if(!['base','candidate'].includes(role))throw Error('wrong role');
const out=path.resolve('evidence/h88-transition');fs.mkdirSync(out,{recursive:true});
const report={head,role,cases:[],issues:[],errors:[],external:[]};
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
let browser,origin;
async function withPage(width,kind,fn){
 const ctx=await browser.newContext({viewport:{width,height:width===1024?768:900},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(18000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))report.external.push(r.url());});
 const key=width+'-'+kind;
 try{await fn(page,key);}catch(e){report.issues.push(key+': '+String(e?.stack||e));await page.screenshot({path:path.join(out,key+'-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
async function snap(page,key){await page.screenshot({path:path.join(out,key+'.png')});}
async function load(page,model,preset){
 await page.goto(origin+'PhysForge/?model='+model+'&preset='+preset,{waitUntil:'networkidle'});
 await page.waitForFunction(model=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId===model,model);
 const play=page.locator('[data-testid="btn-play-pause"]:visible');
 if(await play.getAttribute('aria-label')==='暂停')await play.click();
}
async function formulaCase(page,key){
 await load(page,'stse-em-devices-suite','velocity-selector-spectrometer');
 const eSlider=page.getByTestId('param-slider-eFieldVPerM');
 const before=Number(await eSlider.inputValue());
 const bSlider=page.getByTestId('param-slider-bFieldT');
 const B=Number(await bSlider.inputValue());
 if(!(B>0)||!Number.isFinite(before))throw Error('invalid initial params');
 await page.getByTestId('btn-fullscreen-speech').click();
 const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
 await token.waitFor({state:'visible'});
 const readout=page.locator('[data-testid="stage-formula-values"] [data-readout-id="em-devices-law"]');
 await readout.waitFor({state:'visible'});
 // Track the actual accessible KaTeX annotation, not screenshot OCR or
 // a fabricated state. Compare against independent E/B and pointer oracle.
 const read=()=>page.evaluate(()=>{
   const hud=[...document.querySelectorAll('[data-testid="live-formula-hud"]')].find(n=>!n.hidden);
   const txt=hud?.textContent??'';
   const latex=document.querySelector('[data-readout-id="em-devices-law"] annotation')?.textContent??'';
   const m=latex.match(/v_s=([\d.]+)(?:\\times10\^\{(-?\d+)\})?/);
   return {at:performance.now(),hud:txt,hudE:Number(txt.match(/E:\s*([\d.]+)\s*V\/m/)?.[1]??NaN),latex,vs:m?Number(m[1])*10**Number(m[2]??0):null,tokenSame:window.__h88Token===document.querySelector('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]')};
 });
 await token.evaluate(n=>{window.__h88Token=n;});
 const r=await token.boundingBox();if(!r)throw Error('missing token bounds');
 const x=r.x+r.width/2,y=r.y+r.height/2;
 const delta=before>300000?-60:60;
 const quant=(v)=>Math.max(10000,Math.min(500000,10000+Math.round((Math.max(10000,Math.min(500000,v))-10000)/10000)*10000));
 const target=quant(before+delta*(490000/240));
 const close=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=Math.max(1,Math.abs(b)*0.0005);
 const initial=await read();
 check(close(initial.vs,before/B),key+': initial independent E/B');
 const samples=[];
 await page.mouse.move(x,y);await page.mouse.down();
 let finalHold,after;
 try{
   await page.mouse.move(x+delta,y,{steps:8});
   const first=await read();samples.push(first);
   check(first.hudE===target,key+': HUD final pointer oracle');
   const t0=first.at;
   let streak=0;
   // Real rAF samples: while input is held still, both channels must
   // converge. Log mismatch duration, do not demand zero latency.
   for(let i=0;i<100;i++){
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
     const s=await read();samples.push(s);
     const ok=s.hudE===target&&close(s.vs,target/B)&&s.tokenSame;
     streak=ok?streak+1:0;
     if(streak>=4){finalHold=s;break;}
     if(s.at-t0>2000)break;
   }
   check(!!finalHold,key+': held pointer converges to independent E/B within 2 seconds, 4 samples');
   await snap(page,key+'-held');
 }finally{await page.mouse.up();}
 await page.locator('[data-testid="live-formula-hud"]:visible').waitFor({state:'hidden'});
 await page.waitForFunction(expected=>{
   const s=document.querySelector('[data-readout-id="em-devices-law"] annotation')?.textContent??'';
   const m=s.match(/v_s=([\d.]+)(?:\\times10\^\{(-?\d+)\})?/);
   return !!m&&Math.abs(Number(m[1])*10**Number(m[2]??0)-expected)<=Math.max(1,Math.abs(expected)*.0005);
 },target/B);
 after=await read();
 check(after.tokenSame,key+': token identity retained through release');
 await snap(page,key+'-released');
 await page.getByTestId('btn-exit-fullscreen-speech').click();
 check(Number(await eSlider.inputValue())===target,key+': final slider equals pointer oracle');
 check(Number(await bSlider.inputValue())===B,key+': magnetic field unchanged');
 report.cases.push({key,kind:'formula',before,B,target,initial,samples,finalHold,after});
}
async function cameraCase(page,key,preset){
 await load(page,'stse-tokamak-magnetic-mirror',preset);
 const stage=page.getByTestId('three-stage-container');
 if(!await stage.isVisible())await page.getByTestId('btn-view-3d').click();
 const read=async()=>{
   await page.waitForFunction(()=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;return d?.morphT==='0'&&d.s01OrbitPhase==='idle'&&!!d.s01CameraPose&&!!d.s01Rendered;},null,{timeout:25000});
   return stage.evaluate(n=>({state:JSON.parse(n.dataset.s01Rendered),pose:JSON.parse(n.dataset.s01CameraPose),auto:n.dataset.s01AutoFit,axis:n.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation'),bounds:JSON.parse(n.dataset.s01ScreenBounds),width:n.clientWidth,height:n.clientHeight,palette:n.dataset.s01Palette}));
 };
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const initial=await read();
 const play=page.locator('[data-testid="btn-play-pause"]:visible');
 await play.click();
 await page.waitForFunction(()=>Number(JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.s01Rendered||'{}').t)>.5);
 if(await play.getAttribute('aria-label')==='暂停')await play.click();
 const paused=await read();
 async function orbit(){
   const b=await stage.locator('canvas').boundingBox();if(!b)throw Error('missing canvas');
   const prev=await read();
   await page.mouse.move(b.x+b.width*.38,b.y+b.height*.40);
   await page.mouse.down();await page.mouse.move(b.x+b.width*.43,b.y+b.height*.44,{steps:8});await page.mouse.up();
   await page.waitForFunction(p=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;return d?.s01OrbitPhase==='idle'&&d.s01AutoFit==='false'&&d.s01CameraPose!==p;},JSON.stringify(prev.pose),{timeout:25000});
   const next=await read();check(!same(prev.pose,next.pose)&&next.auto==='false',key+': actual new manual gesture');
   return next;
 }
 async function theme(){
   await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
   const expected=(await page.locator('html').getAttribute('data-theme'));
   if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
   await page.waitForFunction(p=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.s01Palette===p,expected);
   return read();
 }
 const manual=await orbit();
 await snap(page,key+'-manual');
 const vp=page.viewportSize();
 await page.setViewportSize({width:vp.width===1024?1280:1100,height:vp.height+35});
 await page.waitForFunction(old=>document.querySelector('[data-testid="three-stage-container"]')?.clientWidth!==old,manual.width);
 const resized=await read();
 // Resizing is allowed to change projection; after real new render it must
 // still preserve physical state, manual ownership, and permit a gesture.
 await page.waitForFunction(p=>{const n=document.querySelector('[data-testid="three-stage-container"]');return !!n?.dataset.s01CameraPose&&n.dataset.s01CameraPose!==p;},JSON.stringify(manual.pose));
 const moved=await orbit();
 const changedTheme=await theme(),restored=await theme();
 check(same(moved.pose,changedTheme.pose)&&same(moved.pose,restored.pose)&&moved.axis===changedTheme.axis&&moved.axis===restored.axis,key+': resized manual camera theme invariant');
 await snap(page,key+'-resized');
 const btn=page.getByTestId('btn-view-3d');
 await btn.click();
 await stage.waitFor({state:'detached',timeout:25000});
 const flat=page.getByTestId('simulation-canvas');
 await flat.waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.s01AutoFit==='false');
 const flatEvidence=await flat.evaluate(n=>({auto:n.dataset.s01AutoFit,time:n.dataset.s01Time,bounds:JSON.parse(n.dataset.s01ScreenBounds||'null')}));
 check(Math.abs(Number(flatEvidence.time)-moved.state.t)<1e-9,key+': manual 3D to flat preserves physical clock');
 await snap(page,key+'-flat');
 await btn.click();
 await stage.waitFor({state:'visible'});
 const reentered=await read();
 check(reentered.auto==='false',key+': flat to spatial preserves manual ownership');
 const newGesture=await orbit();
 const paper=await theme(),back=await theme();
 check(same(newGesture.pose,paper.pose)&&same(newGesture.pose,back.pose)&&newGesture.axis===paper.axis&&newGesture.axis===back.axis,key+': reopened camera theme invariant');
 for(const s of [manual,resized,moved,changedTheme,restored,reentered,newGesture,paper,back])check(same(s.state,manual.state),key+': physical state invariant across camera transitions');
 await snap(page,key+'-returned');
 const reset=page.getByTestId('btn-reset-view');
 await reset.click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.s01AutoFit==='true');
 const resetState=await read();
 check(same(resetState.state,manual.state),key+': reset retains physics');
 await snap(page,key+'-reset');
 report.cases.push({key,kind:'camera',preset,initial,paused,manual,resized,moved,changedTheme,restored,flatEvidence,reentered,newGesture,paper,back,resetState});
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const w of [1024,1440])await withPage(w,'s02',formulaCase);
 if(role==='candidate'){
  await withPage(1024,'s01-mirror',(p,k)=>cameraCase(p,k,'mirror-trapped-bounce'));
  await withPage(1440,'s01-tokamak',(p,k)=>cameraCase(p,k,'tokamak-helical-confinement'));
 }
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==(role==='base'?2:4))throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external,cases:report.cases.length}));
console.log('H88 formula convergence and camera transitions: PASS',role,head);
