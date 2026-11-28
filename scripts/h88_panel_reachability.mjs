import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||role!=='safe'||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('incorrect checkout');
const out=path.resolve('evidence/h88-panel-reachability');fs.mkdirSync(out,{recursive:true});
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
const report={head,role,cases:[],errors:[],external:[]};
const cases=[
 ['E02','em-capacitor-millikan','millikan-oil-drop-balance','capacitor','capacitorRendered'],
 ['E05','em-wireframe-rotation','disk-driven-power','wire','wireRendered']
];
const sample=({prefix,dataKey})=>{
 const panel=document.querySelector('[data-testid="right-control-panel"]'),scroller=panel?.firstElementChild;
 const canvas=document.querySelector('[data-testid="simulation-canvas"]');
 if(!scroller||!canvas)throw Error('missing stage/panel');
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}};
 const viewport=rect(scroller);
 const readouts=[...panel.querySelectorAll('[data-testid^="'+prefix+'-"]')].filter(e=>e.closest('[data-testid="'+prefix+'-readouts"]'));
 const hit=e=>{const q=e.getBoundingClientRect(),p=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return q.top>=viewport.y-1&&q.bottom<=viewport.b+1&&!!p&&e.contains(p)};
 return {top:scroller.scrollTop,height:scroller.clientHeight,scrollHeight:scroller.scrollHeight,overflow:getComputedStyle(scroller).overflowY,viewport,outer:rect(panel),canvas:rect(canvas),physical:JSON.parse(canvas.dataset[dataKey]||'null'),readouts:readouts.map(e=>({id:e.dataset.testid,text:e.textContent,visible:hit(e)})),summary:hit(panel.querySelector('summary')),detailsOpen:panel.querySelector('details').open};
};
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1024,768],[1280,720],[1440,900]])for(const [id,model,preset,prefix,dataKey] of cases){
  const key=id+'-'+width+'x'+height,ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,serviceWorkers:'block'}),page=await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>report.errors.push(key+': '+e));page.on('console',m=>{if(m.type()==='error')report.errors.push(key+': '+m.text())});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))report.external.push(r.url())});
  try{
   await page.goto(origin+'PhysForge/?model='+model+'&preset='+preset,{waitUntil:'networkidle'});
   await page.waitForFunction(({model,prefix,dataKey})=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId===model&&document.querySelector('[data-testid="'+prefix+'-readouts"]')?.querySelectorAll('[data-testid]').length>=5&&JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset[dataKey]||'null')?.t===0,{model,prefix,dataKey});
   const panel=page.getByTestId('right-control-panel'),scroller=panel.locator(':scope > div').first(),summary=panel.locator('summary').first();
   const snap=()=>page.evaluate(sample,{prefix,dataKey});
   const initial=await snap(),seen=new Set(initial.readouts.filter(r=>r.visible).map(r=>r.id));
   await page.screenshot({path:path.join(out,key+'-initial.png')});
   const box=await scroller.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
   const progression=[initial.top];let current=initial;
   for(let i=0;i<30&&current.top+current.height<current.scrollHeight-2;i++){
    await page.mouse.wheel(0,Math.max(80,Math.floor(box.height/2)));
    await page.waitForTimeout(140);current=await snap();progression.push(current.top);for(const r of current.readouts)if(r.visible)seen.add(r.id);
   }
   const bottom=current;
   await page.screenshot({path:path.join(out,key+'-bottom.png')});
   if(!bottom.summary)throw Error('summary unreachable '+JSON.stringify(bottom));
   await summary.click();await page.waitForFunction(()=>document.querySelector('[data-testid="right-control-panel"] details')?.open===true);
   const expanded=await snap();
   for(let i=0;i<30;i++){current=await snap();if(current.top+current.height>=current.scrollHeight-2)break;await page.mouse.wheel(0,Math.max(80,Math.floor(box.height/2)));await page.waitForTimeout(140)}
   const end=await snap();
   const layer=panel.locator('details input[type=checkbox]').last();
   const layerHit=await layer.evaluate(e=>{const q=e.getBoundingClientRect(),p=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return e===p});
   await page.screenshot({path:path.join(out,key+'-expanded.png')});
   const issues=[];
   if(initial.readouts.some(r=>!seen.has(r.id)))issues.push('unreachable readout');
   if(bottom.top+bottom.height<bottom.scrollHeight-2)issues.push('cannot reach bottom');
   if(!layerHit)issues.push('bottom checkbox hit-test failed');
   if(JSON.stringify(initial.physical)!==JSON.stringify(end.physical))issues.push('physical state changed during scrolling');
   if(JSON.stringify(initial.canvas)!==JSON.stringify(end.canvas))issues.push('canvas bounds changed');
   report.cases.push({key,initial,bottom,expanded,end,progression,seen:[...seen],layerHit,issues});
  }catch(e){report.errors.push(key+': '+String(e));await page.screenshot({path:path.join(out,key+'-error.png')}).catch(()=>{})}
  finally{await ctx.close()}
 }
}finally{await browser?.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
console.log(JSON.stringify(report.cases.map(c=>({key:c.key,initial:c.initial.height,scrollHeight:c.initial.scrollHeight,bottom:c.bottom.top,seen:c.seen.length,total:c.initial.readouts.length,issues:c.issues}))));
if(report.cases.length!==6||report.errors.length||report.external.length||report.cases.some(c=>c.issues.length))throw Error(JSON.stringify({cases:report.cases.length,errors:report.errors,external:report.external,issues:report.cases.map(c=>c.issues)}));
