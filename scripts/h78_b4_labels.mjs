import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h78-b4');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],issues:[],errors:[],external:[]};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
let server,browser;
const dist=path.resolve('apps/web/dist');
async function url(){
  server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
    if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return 'http://127.0.0.1:'+server.address().port+'/PhysForge/';
}
async function pageFor(width,offline=false){
  const ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,offline,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{
    const p=CanvasRenderingContext2D.prototype,draw=p.fillText,rect=p.fillRect,clear=p.clearRect;
    const rows=new WeakMap();
    const target=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.getAttribute('data-testid'));
    const reset=(c,x,y,w,h)=>{if(target(c)&&x===0&&y===0&&w>=c.canvas.clientWidth-2&&h>=c.canvas.clientHeight-2)rows.set(c.canvas,[]);};
    p.fillRect=function(x,y,w,h){reset(this,x,y,w,h);return rect.call(this,x,y,w,h);};
    p.clearRect=function(x,y,w,h){reset(this,x,y,w,h);return clear.call(this,x,y,w,h);};
    p.fillText=function(text,x,y,...rest){
      if(target(this)&&/^球[1-4]\s+vₓ=/.test(String(text))){
        const m=this.measureText(text),t=this.getTransform(),pts=[
          [x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y-m.actualBoundingBoxAscent],
          [x-m.actualBoundingBoxLeft,y+m.actualBoundingBoxDescent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]
        ].map(([a,b])=>({x:t.a*a+t.c*b+t.e,y:t.b*a+t.d*b+t.f}));
        const row={text:String(text),left:Math.min(...pts.map(p=>p.x)),right:Math.max(...pts.map(p=>p.x)),top:Math.min(...pts.map(p=>p.y)),bottom:Math.max(...pts.map(p=>p.y)),color:this.fillStyle};
        const a=rows.get(this.canvas)||[];a.push(row);rows.set(this.canvas,a);
      }
      return draw.call(this,text,x,y,...rest);
    };
    window.__H78B4=()=>{const c=document.querySelector('[data-testid="simulation-canvas"],[data-testid="sf-canvas"]');return c?{labels:(rows.get(c)||[]).slice(),width:c.width,height:c.height,physics:JSON.parse(c.getAttribute('data-b4-rendered')||'null')}:null;};
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&(offline||!r.url().startsWith('http://127.0.0.1:')))report.external.push(r.url());});
  return {ctx,page};
}
async function capture(page,name,physicsRunning){
  const d=await page.evaluate(()=>window.__H78B4());
  report.cases.push({name,...d});
  const a=d?.labels??[];
  check(a.length===4,name+': actual fillText count '+a.length);
  check(new Set(a.map(x=>x.text.slice(0,2))).size===4,name+': unique ball ids');
  for(const b of a)check(b.left>=0&&b.right<=d.width&&b.top>=0&&b.bottom<=d.height,name+': label outside '+b.text);
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){
    const x=a[i],y=a[j];check(x.right<=y.left||y.right<=x.left||x.bottom<=y.top||y.bottom<=x.top,name+': actual text overlap '+x.text+' / '+y.text);
  }
  if(physicsRunning){
    const s=d.physics;
    check(s.rapierActive===1&&Math.abs(s.totalMomentumX-3)<.01&&Math.abs(s.kineticEnergy-4.5)/4.5<.02&&Math.abs(s.lastBallVx-3)<.15,name+': independent four-ball transfer');
    check(a.some(x=>x.text.startsWith('球4')&&x.text.includes('3.00')),name+': final ball painted value');
  }
  await page.screenshot({path:path.join(out,name+'.png')});
}
async function online(base,width){
  const {ctx,page}=await pageFor(width);
  try{
    await page.goto(base+'?model=builder-mechanics-lab',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='builder-mechanics-lab');
    await page.getByTestId('preset-select').selectOption('newtons-cradle-chain',{force:true});
    await page.waitForFunction(()=>window.__H78B4()?.physics?.scenario==='newtons-cradle'&&window.__H78B4()?.labels.length===4);
    await capture(page,'online-'+width+'-initial',false);
    const run=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
    await run.click();await page.waitForFunction(()=>window.__H78B4()?.physics?.t>.8,null,{timeout:15000});await run.click();
    await page.waitForTimeout(180);await capture(page,'online-'+width+'-running',true);
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    if(await page.evaluate(()=>document.documentElement.getAttribute('data-theme'))!=='projector'){
      await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
    }
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.waitForTimeout(180);await capture(page,'online-'+width+'-paper',true);
  }finally{await ctx.close();}
}
async function offline(){
  const file=path.join(out,'B4.html');
  execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','builder-mechanics-lab','--preset','newtons-cradle-chain','--out',file],{stdio:'inherit',timeout:60000});
  const {ctx,page}=await pageFor(1024,true);
  try{
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(()=>window.__H78B4()?.physics?.scenario==='newtons-cradle'&&window.__H78B4()?.labels.length===4);
    await capture(page,'offline-1024-initial',false);
    const run=page.getByTestId('sf-play-pause');await run.click();await page.waitForFunction(()=>window.__H78B4()?.physics?.t>.8,null,{timeout:15000});await run.click();
    await page.waitForTimeout(180);await capture(page,'offline-1024-running',true);
  }finally{await ctx.close();}
}
try{
  const base=await url();browser=await chromium.launch({headless:true});
  await online(base,1440);await online(base,1024);await offline();
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==8)throw Error(JSON.stringify(report));
console.log('H78 B4 actual label paint cases '+report.cases.length);
