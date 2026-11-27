import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(source!==process.env.EXPECTED_SOURCE)throw Error('Wrong source '+source);
const out=path.resolve('evidence/h72-morph');fs.mkdirSync(out,{recursive:true});
const report={source,audit:process.env.AUDIT_HEAD,states:{},issues:[],errors:[],network:[],failedResponses:[]};
const dist=path.resolve('apps/web/dist');
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const q=path.resolve(dist,u.pathname.replace(/^\/PhysForge\/|^\//,'')+(u.pathname.endsWith('/')?'index.html':''));
 if(!q.startsWith(dist+path.sep)||!fs.existsSync(q)||!fs.statSync(q).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':mime[path.extname(q)]||'application/octet-stream'});fs.createReadStream(q).pipe(res);
});
let browser,ctx;
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});
 const assert=(ok,msg)=>{if(!ok)report.issues.push(msg);};
 for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
  ctx=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await ctx.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))report.network.push(r.url());});
  page.on('response',r=>{if(r.status()>=400)report.failedResponses.push(r.status()+' '+r.url());});
  await page.goto(origin+'/PhysForge/?model=em-3d-magnetic-fields',{waitUntil:'networkidle'});
  const stage=page.getByTestId('three-stage-container');await stage.locator('canvas').waitFor({state:'visible'});
  await page.getByTestId('preset-select').selectOption('finite-solenoid-3d',{force:true});
  const waitState=async(t,I=null)=>page.waitForFunction(({t,I})=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset,m=JSON.parse(d?.magneticRendered||'null');return m?.geometryType==='finite-solenoid'&&Math.abs(m.t-t)<1e-8&&(I===null||m.currentI===I)&&Number(d?.conductorCount)===10;},{t,I});
  await waitState(0);const pre=String(viewport.width);
  const read=async()=>stage.evaluate(s=>({dataset:{...s.dataset},rect:s.getBoundingClientRect().toJSON(),caption:s.querySelector('[data-testid="e10-frame-caption"]')?.textContent,buttons:[...s.querySelectorAll('[data-testid^="e10-frame-"]')].filter(x=>x.tagName==='BUTTON').map(x=>({id:x.dataset.testid,pressed:x.getAttribute('aria-pressed'),disabled:x.disabled}))}));
  const shot=async name=>{await page.waitForTimeout(500);const d=await read();report.states[pre+'-'+name]=d;await page.screenshot({path:path.join(out,pre+'-'+name+'.png')});return d;};
  const choose=async mode=>{await page.getByTestId('e10-frame-'+mode).click();await page.waitForFunction(mode=>JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.e10SolenoidBounds||'null')?.mode===mode,mode);};
  const same=(a,b,name)=>assert(a.dataset.magneticRendered===b.dataset.magneticRendered,name+' physical state changed');
  const step=page.locator('[data-testid="topbar"] [data-testid="btn-step"]');
  for(let i=1;i<=24;i++){await step.click();await waitState(i/60);}
  await page.getByTestId('btn-fullscreen-speech').click();await page.getByTestId('fullscreen-controls').waitFor({state:'visible'});await waitState(.4);
  const domain=await shot('default-domain-gold');await choose('body');const body=await shot('default-body-gold');same(domain,body,pre+' default mode');
  assert(body.dataset.fieldLineCount==='33',pre+' field lines removed');
  const toggle=page.getByTestId('btn-view-3d-fullscreen');
  const gl=await stage.locator('canvas').evaluate(canvas=>{window.__H72GL=canvas.getContext('webgl2')??canvas.getContext('webgl');return !!window.__H72GL&&!window.__H72GL.isContextLost();});assert(gl,'missing real WebGL');
  await toggle.click();await page.waitForFunction(()=>{const t=Number(document.querySelector('[data-testid="three-stage-container"]')?.dataset.morphT);return t>0&&t<1;});
  await stage.waitFor({state:'detached',timeout:15000});await page.getByTestId('simulation-canvas').waitFor({state:'visible'});
  await page.waitForFunction(()=>window.__H72GL?.isContextLost()===true,null,{timeout:10000});
  await page.screenshot({path:path.join(out,pre+'-flat.png')});
  await toggle.click();await stage.waitFor({state:'visible'});await waitState(.4);await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.morphT==='0');
  const returned=await shot('after-morph');same(body,returned,pre+' morph');
  assert(returned.dataset.e10AutoFit==='false'&&returned.caption.includes('手动视角')&&returned.buttons.every(b=>b.pressed==='false'),pre+' morph remount falsely claims automatic full domain');
  // Report actual ownership and mode after remount rather than assume it.
  await choose('domain');const restored=await shot('after-morph-domain');same(body,restored,pre+' explicit restore');
  assert(restored.dataset.e10AutoFit==='true'&&JSON.parse(restored.dataset.e10SolenoidBounds).fitOverlaps===0,pre+' explicit auto domain failed after morph');
  await page.getByTestId('btn-exit-fullscreen-speech').click();await waitState(.4);
  await page.getByTestId('preset-select').selectOption('helmholtz-uniform-core-3d',{force:true});await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.conductorCount==='2');
  await page.getByTestId('preset-select').selectOption('finite-solenoid-3d',{force:true});await waitState(0,2);await choose('body');
  const current=page.getByTestId('param-slider-currentI');await current.focus();await current.press('Home');for(let i=0;i<9;i++)await current.press('ArrowRight');await waitState(0,-.5);
  const before=await shot('body-before-zero');await current.press('ArrowRight');await waitState(0,0);await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.fieldLineCount==='0');
  const zero=await shot('body-zero');const a=JSON.parse(before.dataset.e10SolenoidBounds),b=JSON.parse(zero.dataset.e10SolenoidBounds);
  assert(['left','right','top','bottom'].every(k=>Math.abs(a.body[k]-b.body[k])<1e-7),pre+' current zero moved close-up camera');
  assert(zero.dataset.renderedFieldArrow==='false'&&zero.dataset.renderedForceArrow==='false'&&zero.dataset.renderedVelocityArrow==='true',pre+' zero current wrong vectors');
  assert(b.samples===b.bodySamples&&b.fitSamples===b.bodySamples,pre+' zero field claimed geometry');
  await ctx.close();ctx=null;
 }
 if(report.errors.length||report.network.length||report.failedResponses.length)report.issues.push('browser/network errors');
}catch(e){report.issues.push(String(e));}
finally{if(ctx)await ctx.close();if(browser)await browser.close();await new Promise(r=>server.close(r));report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,errors:report.errors,network:report.network,failedResponses:report.failedResponses,states:Object.keys(report.states)}));if(report.issues.length)process.exitCode=1;}
