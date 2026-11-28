import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
const out=path.resolve('evidence/h88-hohmann');fs.mkdirSync(out,{recursive:true});
const dist=path.resolve('apps/web/dist'),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
const report={head,cases:[],errors:[],external:[],issues:[]};
function intersection(c,b){
 if(!b||!b.width||!b.height)return false;
 const near=Math.hypot(c.x-Math.max(b.left,Math.min(b.right,c.x)),c.y-Math.max(b.top,Math.min(b.bottom,c.y)));
 const far=Math.max(...[b.left,b.right].flatMap(x=>[b.top,b.bottom].map(y=>Math.hypot(c.x-x,c.y-y))));
 return near<=c.r&&far>=c.r;
}
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1024,768],[1440,900]]){
  const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{
   const P=CanvasRenderingContext2D.prototype,arc=P.arc,begin=P.beginPath,stroke=P.stroke;
   const paths=new WeakMap();
   P.beginPath=function(...a){paths.set(this,[]);return Reflect.apply(begin,this,a);};
   P.arc=function(x,y,r,start,end,...a){let list=paths.get(this);if(!list){list=[];paths.set(this,list);}list.push({x,y,r,start,end});return Reflect.apply(arc,this,[x,y,r,start,end,...a]);};
   P.stroke=function(...a){
    if(this.canvas.dataset.testid==='simulation-canvas'&&this.getLineDash().join(',')==='4,4'){
     const q=paths.get(this)??[];
     const arcs=q.filter(c=>Math.abs(c.end-c.start-2*Math.PI)<1e-6);
     if(arcs.length===1){window.__orbitArcs??=[];window.__orbitArcs.push({...arcs[0],style:this.strokeStyle});if(window.__orbitArcs.length>30)window.__orbitArcs.shift();}
    }
    return Reflect.apply(stroke,this,a);
   };
  });
  const page=await ctx.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))report.external.push(r.url());});
  try{
   await page.goto(origin+'PhysForge/?model=astro-orbital-mechanics&preset=hohmann-geo-transfer',{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='astro-orbital-mechanics');
   const play=page.locator('[data-testid="btn-play-pause"]:visible');
   if(await play.getAttribute('aria-label')==='暂停')await play.click();
   const read=async(stage)=>{
    await page.waitForFunction(()=>window.__orbitArcs?.length>=2);
    const d=await page.evaluate((stage)=>{
     const box=n=>{const el=document.querySelector('[data-testid="'+n+'"]');if(!el)return null;const r=el.getBoundingClientRect();return r.width&&r.height?r.toJSON():null;};
     const canvas=box('simulation-canvas'),a=window.__orbitArcs.slice(-2).sort((x,y)=>x.r-y.r);
     return {canvas,inner:a[0],outer:{...a[1],x:a[1].x+canvas.left,y:a[1].y+canvas.top},panel:box(stage==='fullscreen'?'fullscreen-formula':'right-control-panel'),dock:box(stage==='fullscreen'?'fullscreen-controls':'floating-scope-dock'),state:JSON.parse(document.querySelector('[data-testid="simulation-canvas"]').dataset.m10Rendered)};
    },stage);
    const o=d.outer;
    const c={width,height,stage,...d,ratio:o.r/d.inner.r,overlapsPanel:intersection(o,d.panel),overlapsDock:intersection(o,d.dock),clipped:o.x-o.r<d.canvas.left||o.x+o.r>d.canvas.right||o.y-o.r<d.canvas.top||o.y+o.r>d.canvas.bottom};
    report.cases.push(c);
    if(Math.abs(c.ratio-2.4)>1e-7)report.issues.push(width+' '+stage+' expected physical ratio 2.4, observed '+c.ratio);
    if(c.overlapsPanel||c.overlapsDock||c.clipped)report.issues.push(width+' '+stage+' outer orbit intersects overlay or canvas boundary');
    await page.screenshot({path:path.join(out,width+'-'+stage+'.png')});
   };
   await read('workbench');
   // Independent gesture check: the teacher's pan must not be overwritten by auto-fit.
   const camera=()=>page.evaluate(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]').dataset.m10HohmannView));
   const before=await camera(),box=await page.getByTestId('simulation-canvas').boundingBox();
   await page.mouse.move(box.x+65,box.y+150);await page.mouse.down();await page.mouse.move(box.x+105,box.y+175,{steps:4});await page.mouse.up();
   const after=await camera();
   if(after.automatic!==false||Math.abs(after.offsetX-before.offsetX-40)>.5||Math.abs(after.offsetY-before.offsetY-25)>.5)report.issues.push(width+' manual camera ownership');
   await page.getByTestId('btn-reset-view').click();
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]').dataset.m10HohmannView).automatic===true);
   const reset=await camera();
   if(Math.abs(reset.offsetX-before.offsetX)>.5||Math.abs(reset.offsetY-before.offsetY)>.5||Math.abs(reset.scale-before.scale)>1e-7)report.issues.push(width+' reset did not restore automatic fit');
   report.cases.at(-1).gesture={before,after,reset};
   await page.evaluate(()=>window.__orbitArcs=[]);
   await page.getByTestId('btn-fullscreen-speech').click();
   await page.getByTestId('fullscreen-formula').waitFor({state:'visible'});
   await read('fullscreen');
  }catch(e){report.errors.push(width+': '+String(e));await page.screenshot({path:path.join(out,width+'-error.png')}).catch(()=>{});}
  finally{await ctx.close();}
 }
}finally{await browser?.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.cases.map(({width,stage,ratio,overlapsPanel,overlapsDock,clipped})=>({width,stage,ratio,overlapsPanel,overlapsDock,clipped}))));
if(report.cases.length!==4||report.errors.length||report.external.length||report.issues.length)throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external}));
