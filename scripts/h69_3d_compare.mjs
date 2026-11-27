import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(source!==process.env.EXPECTED_SOURCE)throw Error('Wrong source '+source);
const out=path.resolve('evidence/h69-3d');fs.mkdirSync(out,{recursive:true});
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
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))report.network.push(r.url());});
 page.on('response',r=>{if(r.status()>=400)report.failedResponses.push(r.status()+' '+r.url());});
 await page.goto(origin+'/PhysForge/?model=em-3d-magnetic-fields',{waitUntil:'networkidle'});
 const stage=page.getByTestId('three-stage-container'),preset=page.getByTestId('preset-select');
 await stage.locator('canvas').waitFor({state:'visible'});
 const waitGeometry=async(n,zero=false)=>page.waitForFunction(({n,zero})=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;return Number(d?.conductorCount)===n&&(zero?d?.fieldLineCount==='0':Number(d?.fieldLineCount)>0);},{n,zero});
 const read=async()=>stage.evaluate(s=>({dataset:{...s.dataset},rect:s.getBoundingClientRect().toJSON()}));
 const shot=async(name)=>{await page.waitForTimeout(250);report.states[name]=await read();await page.screenshot({path:path.join(out,name+'.png')});};
 await preset.selectOption('finite-solenoid-3d',{force:true});await waitGeometry(10);
 await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered||'null')?.t===0);
 await shot('solenoid-initial');
 const step=page.locator('[data-testid="topbar"] [data-testid="btn-step"]');
 for(let i=1;i<=24;i++){
  await step.click();await page.waitForFunction(t=>{const d=JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered||'null');return d&&Math.abs(d.t-t)<1e-8;},i/60);
 }
 await shot('solenoid-t040');
 await page.getByTestId('btn-fullscreen-speech').click();
 await page.getByTestId('fullscreen-controls').waitFor({state:'visible'});
 await waitGeometry(10);
 await shot('solenoid-fullscreen-t040');
 const labels=await page.locator('.pf-3d-label').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>({text:n.textContent,rect:n.getBoundingClientRect().toJSON()})));
 report.labels=labels;
 if(!['v','a洛','B'].every(t=>labels.some(l=>l.text===t&&l.rect.left>=0&&l.rect.right<=1440&&l.rect.top>=0&&l.rect.bottom<=900)))report.issues.push('fullscreen vector labels missing or clipped');
 await page.getByTestId('btn-exit-fullscreen-speech').click();
 await preset.selectOption('finite-solenoid-3d',{force:true});
 const current=page.getByTestId('param-slider-currentI');await current.focus();await current.press('Home');for(let i=0;i<10;i++)await current.press('ArrowRight');
 await waitGeometry(10,true);await shot('zero-current');
 const d=report.states['zero-current'].dataset;
 if(d.renderedFieldArrow!=='false'||d.renderedForceArrow!=='false'||d.renderedVelocityArrow!=='true')report.issues.push('zero current rendered false vectors');
 await preset.selectOption('helmholtz-uniform-core-3d',{force:true});await waitGeometry(2);await preset.selectOption('finite-solenoid-3d',{force:true});await waitGeometry(10);
 const turns=page.getByTestId('param-slider-solenoidTurns');await turns.focus();await turns.press('End');
 await waitGeometry(16);await shot('solenoid-max-turns');
 if(report.errors.length||report.network.length||report.failedResponses.length)report.issues.push('browser/network errors');
}catch(e){report.issues.push(String(e));}
finally{if(ctx)await ctx.close();if(browser)await browser.close();await new Promise(r=>server.close(r));report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,errors:report.errors,network:report.network,failedResponses:report.failedResponses,states:Object.keys(report.states)}));if(report.issues.length)process.exitCode=1;}
