import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
const out=path.resolve('evidence/h88-zoom');fs.mkdirSync(out,{recursive:true});
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
async function stable(page,kind,auto,expected){
 const trace=await page.evaluate(({kind,auto,expected})=>new Promise(resolve=>{
  const started=performance.now(),samples=[];let streak=0;
  function sample(now){
   const c=document.querySelector('[data-testid="simulation-canvas"]');
   const v=JSON.parse(c?.dataset[kind==='E02'?'capacitorView':'chaseViewport']||'null');
   const automatic=kind==='E02'?v?.automatic:c?.dataset.chaseAutoFit==='true';
   const badge=document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent?.trim();
   const s={ms:now-started,v:v?{scale:v.scale,offsetX:v.offsetX,offsetY:v.offsetY,width:v.width,height:v.height}:null,automatic,badge};
   const prev=samples.at(-1);samples.push(s);
   const good=!!s.v&&automatic===auto&&(!expected||badge===expected)&&(!prev||JSON.stringify(s.v)===JSON.stringify(prev.v));
   streak=good?streak+1:0;
   if(streak>=4||now-started>=1500)resolve({samples,streak,last:s});else requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
 }),{kind,auto,expected});
 return trace;
}
async function run(base,width,kind){
 const context=await browser.newContext({viewport:{width,height:width===1024?768:900},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 try{
  const id=kind==='E02'?'em-capacitor-millikan':'mech-kinematics-chase',preset=kind==='E02'?'capacitor-reversed-polarity':'catchup-acceleration';
  await page.goto(base+'?model='+id+'&preset='+preset,{waitUntil:'networkidle'});
  await page.waitForFunction(id=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId===id,id);
  const canvas=page.getByTestId('simulation-canvas');
  if(kind==='M01'){
   await page.locator('[data-testid="topbar"]').getByLabel('播放倍速').selectOption('2');
   const play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
   await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.chaseRendered||'null')?.t>12.1,null,{timeout:20000});await play.click();
  }else{
   await page.getByTestId('param-slider-distanceMm').fill('40');
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===40);
   const scope=page.getByTestId('btn-toggle-oscilloscope');if(await scope.isVisible())await scope.click();
  }
  const before=await stable(page,kind,true,null);
  check(before.streak>=4,width+' '+kind+': pre-input stable');
  const bb=await canvas.boundingBox();
  await page.mouse.move(bb.x+bb.width*.30,bb.y+bb.height*.42);await page.mouse.wheel(0,-100);
  const manual=await stable(page,kind,false,null);
  check(manual.streak>=4&&manual.last.v.scale>before.last.v.scale,width+' '+kind+': manual zoom works');
  const priorBadge=Number.parseInt(before.last.badge),manualBadge=Number.parseInt(manual.last.badge);
  check(Math.abs(manualBadge-priorBadge*manual.last.v.scale/before.last.v.scale)<=2,width+' '+kind+': badge proportional to actual zoom');
  if(kind==='E02'){
   await page.getByTestId('param-slider-distanceMm').fill('8');
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===8);
  }
  const retained=await stable(page,kind,false,manual.last.badge);
  check(retained.streak>=4&&JSON.stringify(retained.last.v)===JSON.stringify(manual.last.v),width+' '+kind+': manual view and badge retained');
  const resets=[];
  for(let k=0;k<4;k++){
   await page.getByTestId('btn-reset-view').click();
   const reset=await stable(page,kind,true,'100%');
   check(reset.streak>=4,width+' '+kind+': reset '+k+' converges to 100% for four frames');
   resets.push(reset);
   await page.screenshot({path:path.join(out,width+'-'+kind+'-reset-'+k+'.png')});
  }
  check(resets.every(x=>JSON.stringify(x.last.v)===JSON.stringify(resets[0].last.v)),width+' '+kind+': repeated reset fixed-state geometry');
  report.cases.push({width,kind,before,manual,retained,resets});
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-'+kind+'-failure.png')}).catch(()=>{});}
 finally{await context.close();}
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';
 browser=await chromium.launch({headless:true});
 for(const w of [1024,1440])for(const kind of ['E02','M01'])await run(base,w,kind);
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==4)throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external,cases:report.cases.length}));
console.log('H88 fixed-state zoom badge and repeat reset verified');
