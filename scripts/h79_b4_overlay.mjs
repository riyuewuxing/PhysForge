import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h79-b4');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],gestures:[],issues:[],errors:[],external:[]};
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
    const p=CanvasRenderingContext2D.prototype,draw=p.fillText,rect=p.fillRect,clear=p.clearRect,arc=p.arc;
    const rows=new WeakMap(),balls=new WeakMap();
    const target=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.getAttribute('data-testid'));
    const reset=(c,x,y,w,h)=>{if(target(c)&&x===0&&y===0&&w>=c.canvas.clientWidth-2&&h>=c.canvas.clientHeight-2){rows.set(c.canvas,[]);balls.set(c.canvas,[]);}};
    p.fillRect=function(x,y,w,h){reset(this,x,y,w,h);return rect.call(this,x,y,w,h);};
    p.clearRect=function(x,y,w,h){reset(this,x,y,w,h);return clear.call(this,x,y,w,h);};
    p.fillText=function(text,x,y,...rest){
      if(target(this)&&/^球[1-4](?:\s+\([^)]*\))?\s+vₓ=/.test(String(text))){
        const m=this.measureText(text),t=this.getTransform(),pts=[
          [x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y-m.actualBoundingBoxAscent],
          [x-m.actualBoundingBoxLeft,y+m.actualBoundingBoxDescent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]
        ].map(([a,b])=>({x:t.a*a+t.c*b+t.e,y:t.b*a+t.d*b+t.f}));
        const row={text:String(text),left:Math.min(...pts.map(p=>p.x)),right:Math.max(...pts.map(p=>p.x)),top:Math.min(...pts.map(p=>p.y)),bottom:Math.max(...pts.map(p=>p.y)),color:this.fillStyle};
        const a=rows.get(this.canvas)||[];a.push(row);rows.set(this.canvas,a);
      }
      return draw.call(this,text,x,y,...rest);
    };
    const colors=new Set(['#38bdf8','#f472b6','#fbbf24','#4ade80','#bae6fd','#fbcfe8','#fde68a','#bbf7d0']);
    p.arc=function(x,y,r,start,end,...rest){
      if(target(this)&&x===0&&y===0&&Math.abs(end-start)>=2*Math.PI-1e-6&&colors.has(this.fillStyle)){
        const t=this.getTransform(),cx=t.a*x+t.c*y+t.e,cy=t.b*x+t.d*y+t.f,rx=r*Math.hypot(t.a,t.c),ry=r*Math.hypot(t.b,t.d);
        const a=balls.get(this.canvas)||[];a.push({left:cx-rx,right:cx+rx,top:cy-ry,bottom:cy+ry,color:this.fillStyle});balls.set(this.canvas,a);
      }
      return arc.call(this,x,y,r,start,end,...rest);
    };
    window.__H79B4=()=>{
      const c=document.querySelector('[data-testid="simulation-canvas"],[data-testid="sf-canvas"]');
      if(!c)return null;
      const r=c.getBoundingClientRect();
      const overlays=[...document.querySelectorAll('[data-testid="right-control-panel"],[data-testid="floating-scope-dock"],[data-testid="fullscreen-formula"],[data-testid="fullscreen-controls"]')].map(e=>{
        const a=e.getBoundingClientRect(),s=getComputedStyle(e);
        return {name:e.getAttribute('data-testid'),left:a.left,right:a.right,top:a.top,bottom:a.bottom,visible:a.width>0&&a.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0};
      }).filter(o=>o.visible);
      const css=b=>({...b,left:r.left+b.left*r.width/c.width,right:r.left+b.right*r.width/c.width,top:r.top+b.top*r.height/c.height,bottom:r.top+b.bottom*r.height/c.height});
      return {labels:(rows.get(c)||[]).map(css),balls:(balls.get(c)||[]).map(css),canvas:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},overlays,physics:JSON.parse(c.getAttribute('data-b4-rendered')||'null'),view:JSON.parse(c.getAttribute('data-b4-viewport')||'null'),automatic:c.getAttribute('data-b4-auto-fit')};
    };
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&(offline||!r.url().startsWith('http://127.0.0.1:')))report.external.push(r.url());});
  return {ctx,page};
}
const intersects=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
async function capture(page,name,physicsRunning,expected=4){
  const d=await page.evaluate(()=>window.__H79B4());
  report.cases.push({name,...d});
  const a=d?.labels??[],balls=d?.balls??[];
  check(a.length===expected,name+': actual fillText count '+a.length);
  check(new Set(a.map(x=>x.text.slice(0,2))).size===expected,name+': unique ball ids');
  check(balls.length===expected,name+': actual dynamic circle count '+balls.length);
  for(const v of [...a,...balls]){
    check(v.left>=d.canvas.left&&v.right<=d.canvas.right&&v.top>=d.canvas.top&&v.bottom<=d.canvas.bottom,name+': object outside canvas '+JSON.stringify(v));
    for(const o of d.overlays)check(!intersects(v,o),name+': actual DOM occlusion '+o.name+' '+JSON.stringify(v));
  }
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)check(!intersects(a[i],a[j]),name+': actual text overlap '+a[i].text+' / '+a[j].text);
  if(physicsRunning){
    const s=d.physics;
    if(expected===4){
      check(s.rapierActive===1&&Math.abs(s.totalMomentumX-3)<.01&&Math.abs(s.kineticEnergy-4.5)/4.5<.02&&Math.abs(s.lastBallVx-3)<.15,name+': independent four-ball transfer');
      check(a.some(x=>x.text.startsWith('球4')&&x.text.includes('3.00')),name+': final ball painted value');
    }else{
      check(s.rapierActive===1&&Math.abs(s.totalMomentumX-2.6)<.01&&Math.abs(s.kineticEnergy-3.38)/3.38<.02&&Math.abs(s.primaryVx)<.15,name+': independent equal-mass collision');
    }
  }
  await page.screenshot({path:path.join(out,name+'.png')});
}
async function online(base,width){
  const {ctx,page}=await pageFor(width);
  try{
    await page.goto(base+'?model=builder-mechanics-lab',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='builder-mechanics-lab');
    await page.getByTestId('preset-select').selectOption('newtons-cradle-chain',{force:true});
    await page.waitForFunction(()=>window.__H79B4()?.physics?.scenario==='newtons-cradle'&&window.__H79B4()?.labels.length===4);
    await capture(page,'online-'+width+'-initial',false);
    const run=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
    await run.click();await page.waitForFunction(()=>window.__H79B4()?.physics?.t>.8,null,{timeout:15000});await run.click();
    await page.waitForTimeout(180);await capture(page,'online-'+width+'-running',true);
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    if(await page.evaluate(()=>document.documentElement.getAttribute('data-theme'))!=='projector'){
      await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
    }
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.waitForTimeout(180);await capture(page,'online-'+width+'-paper',true);
    if(width===1024){
      const canvas=page.getByTestId('simulation-canvas'),box=await canvas.boundingBox();
      const before=await page.evaluate(()=>window.__H79B4());
      await page.mouse.move(box.x+box.width*.25,box.y+box.height*.35);await page.mouse.wheel(0,-100);
      await page.waitForFunction(()=>window.__H79B4()?.automatic==='false');
      const manual=await page.evaluate(()=>window.__H79B4());
      check(manual.view.scale>before.view.scale,'manual wheel did not change scale');
      await run.click();await page.waitForFunction(()=>window.__H79B4()?.physics?.t>1.03,null,{timeout:10000});await run.click();
      const after=await page.evaluate(()=>window.__H79B4());
      check(after.automatic==='false'&&JSON.stringify(after.view)===JSON.stringify(manual.view),'automatic fit overrode manual camera');
      report.gestures.push({before:before.view,manual:manual.view,after:after.view,automatic:after.automatic});
      await page.getByTestId('btn-reset-view').click();
      await page.waitForFunction(()=>window.__H79B4()?.automatic==='true');
      await capture(page,'online-1024-reset-camera',true);
      await page.getByTestId('preset-select').selectOption('elastic-equal-mass',{force:true});
      await page.waitForFunction(()=>window.__H79B4()?.physics?.scenario==='elastic-collision'&&window.__H79B4()?.physics?.t===0);
      await run.click();await page.waitForFunction(()=>window.__H79B4()?.physics?.t>1.02,null,{timeout:15000});await run.click();
      await page.waitForTimeout(180);await capture(page,'online-1024-two-ball',true,2);
    }
  }finally{await ctx.close();}
}
async function offline(){
  const file=path.join(out,'B4.html');
  execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','builder-mechanics-lab','--preset','newtons-cradle-chain','--out',file],{stdio:'inherit',timeout:60000});
  const {ctx,page}=await pageFor(1024,true);
  try{
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(()=>window.__H79B4()?.physics?.scenario==='newtons-cradle'&&window.__H79B4()?.labels.length===4);
    await capture(page,'offline-1024-initial',false);
    const run=page.getByTestId('sf-play-pause');await run.click();await page.waitForFunction(()=>window.__H79B4()?.physics?.t>.8,null,{timeout:15000});await run.click();
    await page.waitForTimeout(180);await capture(page,'offline-1024-running',true);
    await page.locator('[data-preset-id="elastic-equal-mass"]').click();
    await page.waitForFunction(()=>window.__H79B4()?.physics?.scenario==='elastic-collision'&&window.__H79B4()?.physics?.t===0);
    await run.click();await page.waitForFunction(()=>window.__H79B4()?.physics?.t>1.02,null,{timeout:15000});await run.click();
    await page.waitForTimeout(180);await capture(page,'offline-1024-two-ball',true,2);
  }finally{await ctx.close();}
}
try{
  const base=await url();browser=await chromium.launch({headless:true});
  await online(base,1440);await online(base,1024);await offline();
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==11||report.gestures.length!==1)throw Error(JSON.stringify(report));
console.log('H79 B4 actual DOM and label paint cases '+report.cases.length);
