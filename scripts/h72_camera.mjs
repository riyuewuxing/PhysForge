import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(source!==process.env.EXPECTED_SOURCE)throw Error('Wrong source '+source);
const out=path.resolve('evidence/h72-camera');fs.mkdirSync(out,{recursive:true});
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
const candidate=process.env.CANDIDATE==='true';
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});
 const assert=(ok,msg)=>{if(!ok)report.issues.push(msg);};
 for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
  ctx=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await ctx.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))report.network.push(r.url());});
  page.on('response',r=>{if(r.status()>=400)report.failedResponses.push(r.status()+' '+r.url());});
  await page.goto(origin+'/PhysForge/?model=em-3d-magnetic-fields',{waitUntil:'networkidle'});
  const stage=page.getByTestId('three-stage-container');
  await stage.locator('canvas').waitFor({state:'visible'});
  await page.getByTestId('preset-select').selectOption('finite-solenoid-3d',{force:true});
  const waitState=async t=>page.waitForFunction(t=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset,m=JSON.parse(d?.magneticRendered||'null');return m?.geometryType==='finite-solenoid'&&Math.abs(m.t-t)<1e-8&&Number(d?.conductorCount)===10;},t);
  await waitState(0);
  await page.waitForFunction(()=>!!document.querySelector('[data-testid="three-stage-container"]')?.dataset.e10SolenoidBounds);
  const pre=String(viewport.width);
  const read=async()=>stage.evaluate(s=>{
   const legend=s.querySelector('[data-testid="e10-focus-legend"]');
   return {dataset:{...s.dataset},rect:s.getBoundingClientRect().toJSON(),legend:legend?.textContent,buttons:[...s.querySelectorAll('[data-testid^="e10-frame-"]')].filter(x=>x.tagName==='BUTTON').map(x=>({id:x.dataset.testid,pressed:x.getAttribute('aria-pressed'),disabled:x.disabled,rect:x.getBoundingClientRect().toJSON()}))};
  });
  const shot=async(name)=>{await page.waitForTimeout(600);const d=await read();report.states[pre+'-'+name]=d;await page.screenshot({path:path.join(out,pre+'-'+name+'.png')});return d;};
  const bounds=d=>JSON.parse(d.dataset.e10SolenoidBounds||'null');
  const bodyHeight=d=>bounds(d).body.bottom-bounds(d).body.top;
  const sameState=(a,b,label)=>{assert(a.dataset.magneticRendered===b.dataset.magneticRendered,label+' physics changed');for(const k of ['fieldLineCount','conductorCount','currentArrowCount','currentArrowDirection','e10MeridianCount','e10ContextCount'])assert(a.dataset[k]===b.dataset[k],label+' changed '+k);};
  const checkFit=(d,mode,label)=>{
   const b=bounds(d);assert(!!b,label+' no projection');if(!b)return;
   const q=mode==='body'?b.body:b.bounds,s=b.safe;
   assert(q.visible&&q.left>=s.left+15&&q.right<=s.right-15&&q.top>=s.top+15&&q.bottom<=s.bottom-15,label+' camera safety failed '+JSON.stringify(b));
   assert(b.mode===mode&&b.fitOverlaps===0&&d.dataset.e10AutoFit==='true',label+' invalid actual fit '+JSON.stringify(b));
   assert(b.fitSamples===(mode==='body'?b.bodySamples:b.samples),label+' wrong camera sample selection');
   assert(d.buttons.find(x=>x.id==='e10-frame-'+mode)?.pressed==='true',label+' wrong selected button');
   assert(d.dataset.fieldLineCount==='33'&&d.dataset.conductorCount==='10',label+' actual scene geometry removed');
  };
  const choose=async mode=>{await page.getByTestId('e10-frame-'+mode).click();await page.waitForFunction(mode=>JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.e10SolenoidBounds||'null')?.mode===mode,mode);};
  const initial=await shot('domain-initial');
  if(candidate){
    checkFit(initial,'domain',pre+' initial');
    await choose('body');const close=await shot('body-initial');checkFit(close,'body',pre+' close');sameState(initial,close,pre+' mode switch');
    assert(bodyHeight(close)>=1.4*bodyHeight(initial),pre+' close-up insufficient actual body enlargement');
    assert(close.legend.includes('外围场线可出画'),pre+' missing crop disclosure');
    assert(bounds(close).samples===bounds(initial).samples,pre+' field sampling removed');
    // Manual orbit preserves the selected view but does not auto-fit.
    const box=await stage.locator('canvas').boundingBox();
    await page.mouse.move(box.x+box.width*.42,box.y+box.height*.38);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.31,{steps:8});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.e10AutoFit==='false');
    const manual=await shot('body-manual');sameState(close,manual,pre+' manual');
    await choose('body');const reselect=await shot('body-reselect');checkFit(reselect,'body',pre+' reselect');sameState(manual,reselect,pre+' reselect');
    await choose('domain');const domain=await shot('domain-reselect');checkFit(domain,'domain',pre+' return domain');sameState(initial,domain,pre+' return');
    await page.getByTestId('btn-reset-view').click();await page.waitForTimeout(400);
    // Re-enter through the same preset to compare both branches at matched t.
  }
  const step=page.locator('[data-testid="topbar"] [data-testid="btn-step"]');
  for(let i=1;i<=24;i++){await step.click();await waitState(i/60);}
  const t040=await shot('domain-t040');
  await page.getByTestId('btn-fullscreen-speech').click();await page.getByTestId('fullscreen-controls').waitFor({state:'visible'});await waitState(.4);
  const full=await shot('domain-fullscreen');sameState(t040,full,pre+' enter fullscreen');
  if(candidate){
   checkFit(full,'domain',pre+' fullscreen domain');await choose('body');
   const close=await shot('body-fullscreen');checkFit(close,'body',pre+' fullscreen close');sameState(full,close,pre+' fullscreen close');
   assert(bodyHeight(close)>=1.4*bodyHeight(full),pre+' fullscreen close-up not enlarged');
   assert(bounds(close).samples===bounds(full).samples,pre+' fullscreen sample loss');
   await choose('domain');const back=await shot('domain-fullscreen-return');checkFit(back,'domain',pre+' fullscreen return');sameState(full,back,pre+' fullscreen return');
  }
  await ctx.close();ctx=null;
 }
 if(report.errors.length||report.network.length||report.failedResponses.length)report.issues.push('browser/network errors');
}catch(e){report.issues.push(String(e));}
finally{if(ctx)await ctx.close();if(browser)await browser.close();await new Promise(r=>server.close(r));report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,errors:report.errors,network:report.network,failedResponses:report.failedResponses,states:Object.keys(report.states)}));if(report.issues.length)process.exitCode=1;}
