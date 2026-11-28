import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
if(!['base','candidate'].includes(role))throw Error('wrong role');
const out=path.resolve('evidence/h88-painted-focus');fs.mkdirSync(out,{recursive:true});
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
 await page.addInitScript(()=>{
   const old=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(...args){
     const result=Reflect.apply(old,this,args);
     const t=String(args[0]); const m=t.match(/速度选择器 v_sel = E\/B = ([\d.-]+) m\/s/);
     if(this.canvas.dataset.testid==='simulation-canvas'&&m){
       window.__h88Paint={v:Number(m[1]),at:performance.now(),text:t};
     }
     return result;
   };
 });
 await load(page,'stse-em-devices-suite','velocity-selector-spectrometer');
 const eSlider=page.getByTestId('param-slider-eFieldVPerM'),bSlider=page.getByTestId('param-slider-bFieldT');
 const E=Number(await eSlider.inputValue()),B=Number(await bSlider.inputValue());
 check(E>0&&B>0,key+': initial positive fields');
 await page.getByTestId('btn-fullscreen-speech').click();
 const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
 await token.waitFor({state:'visible'});
 await page.waitForFunction(()=>!!window.__h88Paint&&!!document.querySelector('[data-readout-id="em-devices-law"] annotation'));
 const read=()=>page.evaluate(()=>{
   const hud=[...document.querySelectorAll('[data-testid="live-formula-hud"]')].find(n=>!n.hidden);
   const txt=hud?.textContent??'';
   const latex=document.querySelector('[data-readout-id="em-devices-law"] annotation')?.textContent??'';
   const m=latex.match(/v_s=([\d.]+)(?:\\times10\^\{(-?\d+)\})?/);
   return {at:performance.now(),hud:txt,target:Number(txt.match(/E:\s*([\d.]+)\s*V\/m/)?.[1]??NaN),
    applied: hud?.dataset.appliedValue===undefined?null:Number(hud.dataset.appliedValue),
    pending:hud?.dataset.pending,vs:m?Number(m[1])*10**Number(m[2]??0):null,paint:window.__h88Paint,
    sameToken:window.__h88Token===document.querySelector('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]')};
 });
 await token.evaluate(n=>{window.__h88Token=n;});
 const r=await token.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
 const dir=E>300000?-1:1,quant=(v)=>Math.max(10000,Math.min(500000,10000+Math.round((Math.max(10000,Math.min(500000,v))-10000)/10000)*10000));
 const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1,Math.abs(b)*0.0005);
 const samples=[],initial=await read();
 check(close(initial.vs,E/B)&&close(initial.paint?.v,E/B),key+': initial formula/paint independent oracle');
 await page.mouse.move(x,y);await page.mouse.down();
 let held;
 try {
  for(const dx of [5,10,15,20,25,30,35,40,45,50,55,60]){
    await page.mouse.move(x+dir*dx,y);
    const immediate=await read();samples.push({...immediate,phase:'event',dx,expected:quant(E+dir*dx*490000/240)});
    check(immediate.target===quant(E+dir*dx*490000/240),key+': pointer oracle '+dx);
    // Sample after a browser animation frame and a following task boundary.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
    samples.push({...await read(),phase:'frame',dx,expected:quant(E+dir*dx*490000/240)});
  }
  const target=quant(E+dir*60*490000/240);
  let streak=0;
  for(let i=0;i<100;i++){
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
    const v=await read();samples.push({...v,phase:'hold',expected:target});
    streak=v.target===target&&close(v.vs,target/B)&&close(v.paint?.v,target/B)?streak+1:0;
    if(streak>=4){held=v;break;}
  }
  check(!!held,key+': held actual paint and formula converge');
  await snap(page,key+'-held');
 }finally{await page.mouse.up();}
 await page.locator('[data-testid="live-formula-hud"]:visible').waitFor({state:'hidden'});
 const target=quant(E+dir*60*490000/240);
 await page.waitForFunction(v=>Math.abs((window.__h88Paint?.v??Infinity)-v)<1,target/B);
 const released=await read();
 check(close(released.vs,target/B)&&close(released.paint?.v,target/B),key+': release formula and paint oracle');
 check(samples.every(s=>s.sameToken)&&released.sameToken,key+': token identity');
 await snap(page,key+'-released');
 await page.getByTestId('btn-exit-fullscreen-speech').click();
 check(Number(await eSlider.inputValue())===target&&Number(await bSlider.inputValue())===B,key+': committed parameters');
 const frames=samples.filter(s=>s.phase!=='event');
 const divergences=frames.filter(s=>!close(s.vs,s.paint?.v));
 const previewGaps=frames.filter(s=>!close(s.target/B,s.paint?.v));
 if(role==='candidate'){
   check(divergences.length===0,key+': visible formula agrees with actual canvas at every sampled paint');
   check(frames.every(s=>close(s.applied/B,s.paint?.v)&&s.pending===String(s.target!==s.applied)),key+': applied HUD and pending distinction agree with actual paint');
 }
 report.cases.push({key,kind:'formula',E,B,target,initial,samples,held,released,divergences:divergences.length,previewGaps:previewGaps.length});
}
async function focusCase(page,key){
 await load(page,'em-3d-magnetic-fields','finite-solenoid-3d');
 const stage=page.getByTestId('three-stage-container');
 if(!await stage.isVisible()){
  await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-view-3d').click();
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
 }
 await stage.waitFor({state:'visible'});
 await page.getByTestId('btn-fullscreen-speech').click();
 await page.getByTestId('fullscreen-controls').waitFor({state:'visible'});
 const read=()=>stage.evaluate(n=>({w:n.clientWidth,h:n.clientHeight,auto:n.dataset.e10AutoFit,view:JSON.parse(n.dataset.e10SolenoidBounds),particle:JSON.parse(n.dataset.e10ParticleProjection)}));
 async function mode(name){
  await page.getByTestId('e10-frame-'+name).click();
  await page.waitForFunction(m=>{
    const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;
    if(!d?.e10SolenoidBounds)return false;
    const a=JSON.parse(d.e10SolenoidBounds);
    return a.mode===m&&d.e10AutoFit==='true'&&a.overlays?.length>=2;
  },name);
  await page.waitForTimeout(400);
  const value=await read();await snap(page,key+'-'+name);return value;
 }
 const domain=await mode('domain'),body=await mode('body'),back=await mode('domain');
 const inside=(b,s)=>b.left>=s.left-1&&b.right<=s.right+1&&b.top>=s.top-1&&b.bottom<=s.bottom+1;
 check(domain.view.samples===body.view.samples&&body.view.samples===back.view.samples,key+': unchanged field sample count');
 check(domain.view.bodySamples===body.view.bodySamples&&body.view.fitSamples===body.view.bodySamples,key+': body-only fitting samples');
 check(inside(domain.view.bounds,domain.view.safe)&&domain.view.fitOverlaps===0,key+': full domain geometry inside safe area');
 check(inside(body.view.body,body.view.safe)&&body.view.fitOverlaps===0,key+': body inside safe area');
 const width=v=>v.view.body.right-v.view.body.left;
 check(width(body)>width(domain),key+': body focus enlarges conductor');
 check(Math.abs(width(back)-width(domain))<1,key+': restore domain size');
 report.cases.push({key,kind:'focus',domain,body,back,ratios:{domain:width(domain)/domain.w,body:width(body)/body.w}});
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const w of [1024,1440]){await withPage(w,'s02',formulaCase);await withPage(w,'e10',focusCase);}
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==4)throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external,cases:report.cases.length}));
console.log('H88 painted selector and E10 focus:',role,head);
