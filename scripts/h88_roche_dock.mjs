import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
if(!['base','candidate'].includes(role))throw Error('wrong role');
const out=path.resolve('evidence/h88-roche-dock');fs.mkdirSync(out,{recursive:true});
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


async function roche(page,key){
 await page.addInitScript(()=>{
  const P=CanvasRenderingContext2D.prototype, paths=new WeakMap();
  const orig={beginPath:P.beginPath,moveTo:P.moveTo,lineTo:P.lineTo,stroke:P.stroke,fillRect:P.fillRect};
  const stage=c=>c.canvas.dataset.testid==='simulation-canvas';
  P.fillRect=function(x,y,w,h){
   const r=Reflect.apply(orig.fillRect,this,arguments);
   if(stage(this)&&x===0&&y===0&&w>=this.canvas.clientWidth-1&&h>=this.canvas.clientHeight-1)window.__rochePaint=[];
   return r;
  };
  P.beginPath=function(){const r=Reflect.apply(orig.beginPath,this,arguments);if(stage(this))paths.set(this,{last:null,segments:[]});return r;};
  P.moveTo=function(x,y){const r=Reflect.apply(orig.moveTo,this,arguments);const p=paths.get(this);if(p)p.last=[x,y];return r;};
  P.lineTo=function(x,y){const r=Reflect.apply(orig.lineTo,this,arguments);const p=paths.get(this);if(p){if(p.last)p.segments.push([p.last[0],p.last[1],x,y]);p.last=[x,y];}return r;};
  P.stroke=function(){const r=Reflect.apply(orig.stroke,this,arguments);const p=paths.get(this),style=String(this.strokeStyle).replace(/\s/g,'');
   if(stage(this)&&p&&['rgba(125,211,252,0.45)','rgba(51,65,85,0.6)'].includes(style)){
    (window.__rochePaint??=[]).push(...p.segments);
   }return r;};
 });
 await load(page,'astro-orbital-mechanics','binary-lagrange-roche');
 const canvas=page.getByTestId('simulation-canvas');
 await canvas.waitFor({state:'visible'});
 await page.waitForFunction(()=>window.__rochePaint?.length>100);
 const read=()=>page.evaluate(()=>{
   const c=document.querySelector('[data-testid="simulation-canvas"]'),r=c.getBoundingClientRect();
   const rect=(id)=>{
    const n=document.querySelector('[data-testid="'+id+'"]'),p=n?.getBoundingClientRect();
    return p&&p.width>0&&p.height>0?{left:p.left-r.left,right:p.right-r.left,top:p.top-r.top,bottom:p.bottom-r.top}:null;
   };
   const segments=window.__rochePaint??[];
   function crosses(s,b){
    if(!b)return false;
    let lo=0,hi=1;
    const [x,y,X,Y]=s;
    for(const [p,q] of [[-(X-x),x-b.left],[X-x,b.right-x],[-(Y-y),y-b.top],[Y-y,b.bottom-y]]){
     if(p===0){if(q<0)return false;continue;}
     const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
     if(lo>hi)return false;
    }
    return true;
   }
   const panel=rect('right-control-panel'),dock=rect('floating-scope-dock');
   const xs=segments.flatMap(s=>[s[0],s[2]]),ys=segments.flatMap(s=>[s[1],s[3]]);
   return {n:segments.length,bounds:{left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)},
    panel,dock,panelHits:segments.filter(s=>crosses(s,panel)).length,dockHits:segments.filter(s=>crosses(s,dock)).length,
    state:JSON.parse(c.dataset.m10Rendered??'null'),view: c.dataset.m10BinaryView?JSON.parse(c.dataset.m10BinaryView):null};
 });
 const frame=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));return read();};
 const initial=await frame();await snap(page,key+'-initial');
 const play=page.getByTestId('btn-play-pause');
 await play.click();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.m10Rendered??'{}').tSim>.3);
 if(await play.getAttribute('aria-label')==='暂停')await play.click();
 const running=await frame();await snap(page,key+'-running');
 const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);
 await page.mouse.wheel(0,-120);await page.waitForTimeout(120);const manual=await frame();
 await page.mouse.wheel(0,-120);await page.waitForTimeout(120);const manual2=await frame();await snap(page,key+'-manual');
 check(manual2.bounds.right-manual2.bounds.left>running.bounds.right-running.bounds.left,key+': manual zoom is real');
 await page.getByTestId('btn-reset-view').click();await page.waitForTimeout(200);
 const reset=await frame();await snap(page,key+'-reset');
 check(initial.n===running.n&&running.n===manual.n&&manual.n===manual2.n&&manual2.n===reset.n,key+': all contours retained');
 check(JSON.stringify(running.state)===JSON.stringify(reset.state),key+': view operations preserve physical state');
 if(role==='candidate'){
   check([initial,running,reset].every(s=>s.dockHits===0&&s.panelHits===0),key+': automatic views no actual contour/overlay intersections');
   check([initial,running,reset].every(s=>s.view?.automatic===true),key+': automatic ownership');
   check([manual,manual2].every(s=>s.view?.automatic===false),key+': manual ownership');
 }
 report.cases.push({key,initial,running,manual,manual2,reset});
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port+'/';browser=await chromium.launch({headless:true});
 for(const w of [1024,1440])await withPage(w,'m10',roche);
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==2)throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external,cases:report.cases.length}));
console.log('H88 Roche paint and manual camera:',role,head);
