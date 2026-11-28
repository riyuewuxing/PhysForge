import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
if(!['base','candidate'].includes(role))throw Error('wrong role');
const out=path.resolve('evidence/h88-hit-stack');fs.mkdirSync(out,{recursive:true});
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


async function probe(page,key){
 await load(page,'stse-em-devices-suite','velocity-selector-spectrometer');
 await page.getByTestId('btn-fullscreen-speech').click();
 const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="bFieldT"]').first();
 await token.waitFor({state:'visible'});
 const data=await page.evaluate(()=>{
   const root=document.querySelector('[data-testid="live-formula-velocity-selector"]');
   const describe=n=>{const r=n.getBoundingClientRect(),c=getComputedStyle(n);return {tag:n.tagName,cl:n.className,html:n.outerHTML.slice(0,300),rect:r.toJSON(),position:c.position,zIndex:c.zIndex,pointerEvents:c.pointerEvents,display:c.display}};
   return [...root.querySelectorAll('[data-param]')].map(n=>{
     const r=n.getBoundingClientRect(),w=n.closest('.pf-live-var'),center={x:r.x+r.width/2,y:r.y+r.height/2};
     const stack=document.elementsFromPoint(center.x,center.y).slice(0,12).map(describe);
     const ancestors=[];for(let a=n;a&&a!==root;a=a.parentElement)ancestors.push(describe(a));
     return {param:n.dataset.param,center,stack,ancestors,wrapper:describe(w),hit:document.elementFromPoint(center.x,center.y)?.closest('.pf-live-var')===w};
   });
 });
 await snap(page,key+'-hit');report.cases.push({key,data});
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port+'/';browser=await chromium.launch({headless:true});
 for(const w of [1024,1440])await withPage(w,'hit',probe);
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==2)throw Error(JSON.stringify(report.issues));
