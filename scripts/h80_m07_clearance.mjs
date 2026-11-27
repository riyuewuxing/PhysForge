import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h80-m07');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],issues:[],errors:[],external:[]};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const dist=path.resolve('apps/web/dist');
let server,browser;
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
    const p=CanvasRenderingContext2D.prototype,draw=p.fillText,rect=p.fillRect,clear=p.clearRect,arc=p.arc,begin=p.beginPath,fill=p.fill,stroke=p.stroke;
    const frames=new WeakMap(),paths=new WeakMap();
    const target=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.getAttribute('data-testid'));
    const frame=c=>{let a=frames.get(c.canvas);if(!a){a={labels:[],circles:[]};frames.set(c.canvas,a);}return a;};
    const reset=(c,x,y,w,h)=>{if(target(c)&&x===0&&y===0&&w>=c.canvas.clientWidth-2&&h>=c.canvas.clientHeight-2){frames.set(c.canvas,{labels:[],circles:[]});paths.delete(c);}};
    p.fillRect=function(x,y,w,h){reset(this,x,y,w,h);return rect.call(this,x,y,w,h);};
    p.clearRect=function(x,y,w,h){reset(this,x,y,w,h);return clear.call(this,x,y,w,h);};
    p.beginPath=function(){paths.delete(this);return begin.call(this);};
    p.arc=function(x,y,r,start,end,...rest){
      if(target(this)&&Math.abs(end-start)>=2*Math.PI-1e-6){
        const t=this.getTransform(),cx=t.a*x+t.c*y+t.e,cy=t.b*x+t.d*y+t.f,rx=r*Math.hypot(t.a,t.c),ry=r*Math.hypot(t.b,t.d);
        paths.set(this,{left:cx-rx,right:cx+rx,top:cy-ry,bottom:cy+ry,cx,cy,rx,ry});
      }
      return arc.call(this,x,y,r,start,end,...rest);
    };
    p.fill=function(...args){
      const a=paths.get(this);
      if(target(this)&&a&&['#fbbf24','#b45309','#0f172a','#cbd5e1'].includes(this.fillStyle)&&this.fillStyle===this.strokeStyle){
        frame(this).circles.push({...a,role:['#fbbf24','#b45309'].includes(this.fillStyle)?'bob':'pivot',color:this.fillStyle});
      }
      return fill.apply(this,args);
    };
    p.stroke=function(...args){
      const a=paths.get(this);
      if(target(this)&&a&&['#94a3b8','#475569'].includes(this.strokeStyle)&&this.fillStyle===this.strokeStyle){
        frame(this).circles.push({...a,role:'orbit',color:this.strokeStyle});
      }
      return stroke.apply(this,args);
    };
    p.fillText=function(text,x,y,...rest){
      if(target(this)&&['固定竖直截面正投影','水平俯视 · 同一相位','竖直静止 · 无圆周轨道','θ 真倾角','r=L sinθ','T','mg','F合 (投影)','v'].includes(String(text))){
        const m=this.measureText(text),t=this.getTransform(),pts=[
          [x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y-m.actualBoundingBoxAscent],
          [x-m.actualBoundingBoxLeft,y+m.actualBoundingBoxDescent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]
        ].map(([a,b])=>({x:t.a*a+t.c*b+t.e,y:t.b*a+t.d*b+t.f}));
        frame(this).labels.push({text:String(text),left:Math.min(...pts.map(p=>p.x)),right:Math.max(...pts.map(p=>p.x)),top:Math.min(...pts.map(p=>p.y)),bottom:Math.max(...pts.map(p=>p.y)),color:this.fillStyle});
      }
      return draw.call(this,text,x,y,...rest);
    };
    window.__H80M07=()=>{
      const c=document.querySelector('[data-testid="simulation-canvas"],[data-testid="sf-canvas"]');
      if(!c)return null;
      const f=frames.get(c)||{labels:[],circles:[]},r=c.getBoundingClientRect();
      const overlays=[...document.querySelectorAll('[data-testid="right-control-panel"],[data-testid="floating-scope-dock"],[data-testid="fullscreen-formula"],[data-testid="fullscreen-controls"]')].map(e=>{
        const a=e.getBoundingClientRect(),s=getComputedStyle(e);
        return {name:e.getAttribute('data-testid'),left:a.left,right:a.right,top:a.top,bottom:a.bottom,visible:a.width>0&&a.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0};
      }).filter(o=>o.visible);
      const css=b=>({...b,left:r.left+b.left*r.width/c.width,right:r.left+b.right*r.width/c.width,top:r.top+b.top*r.height/c.height,bottom:r.top+b.bottom*r.height/c.height});
      return {labels:f.labels.map(css),circles:f.circles.map(css),canvas:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},overlays,physics:JSON.parse(c.getAttribute('data-turntable-rendered')||'null')};
    };
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&(offline||!r.url().startsWith('http://127.0.0.1:')))report.external.push(r.url());});
  return {ctx,page};
}
const intersects=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
async function capture(page,name,rest=false){
  const d=await page.evaluate(()=>window.__H80M07());
  report.cases.push({name,...d});
  const labels=d?.labels??[],circles=d?.circles??[],orbit=circles.filter(o=>o.role==='orbit'),balls=circles.filter(o=>o.role==='bob'),pivots=circles.filter(o=>o.role==='pivot');
  const s=d.physics;
  check(s?.mode==='conical-pendulum',name+': cone state missing');
  check(labels.some(x=>x.text==='固定竖直截面正投影'),name+': fixed side heading missing');
  check(orbit.length===(rest?0:1)&&balls.length===(rest?1:2),name+': actual cone circle counts '+JSON.stringify({orbit:orbit.length,balls:balls.length}));
  check(labels.some(x=>x.text==='T')&&labels.some(x=>x.text==='mg'),name+': true force labels missing');
  if(!rest){
    const title=labels.find(l=>l.text==='水平俯视 · 同一相位');
    check(title&&orbit[0]&&title.bottom+3<=orbit[0].top,name+': heading overlaps orbit');
    check(labels.some(x=>x.text==='v'),name+': tangent velocity label missing');
    check(Math.abs(s.tensionN-19.44)<1e-7&&Math.abs(s.coneTensionY-9.8)<1e-7&&Math.abs(s.xA-s.rA*Math.cos(3.6*s.t))<1e-7,name+': independent cone physical state');
  }else{
    check(labels.some(x=>x.text==='竖直静止 · 无圆周轨道'),name+': rest heading missing');
    check(s.rA===0&&Math.abs(s.tensionN-9.8)<1e-7&&!('period' in s),name+': stationary branch physics');
  }
  for(const l of labels){
    check(l.left>=d.canvas.left&&l.right<=d.canvas.right&&l.top>=d.canvas.top&&l.bottom<=d.canvas.bottom,name+': clipped label '+l.text);
    for(const ball of [...balls,...pivots])check(!intersects(l,ball),name+': actual label/body intersection '+l.text);
    for(const o of d.overlays)check(!intersects(l,o),name+': actual DOM occlusion '+o.name+' '+l.text);
  }
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)check(!intersects(labels[i],labels[j]),name+': actual label overlap '+labels[i].text+' / '+labels[j].text);
  await page.screenshot({path:path.join(out,name+'.png')});
}
async function select(page,id,offline){
  if(offline)await page.locator('[data-preset-id="'+id+'"]').click();
  else await page.getByTestId('preset-select').selectOption(id,{force:true});
  await page.waitForFunction(()=>window.__H80M07()?.physics?.mode==='conical-pendulum'&&window.__H80M07()?.physics?.t===0&&window.__H80M07()?.labels.length>=4);
  await page.waitForTimeout(180);
}
async function runTo(page,run,t){
  await run.click();
  await page.waitForFunction(t=>window.__H80M07()?.physics?.t>=t,t,{timeout:12000});
  await run.click();await page.waitForTimeout(150);
}
async function online(base,width){
  const {ctx,page}=await pageFor(width);
  try{
    await page.goto(base+'?model=mech-conical-turntable',{waitUntil:'networkidle'});
    await select(page,'conical-pendulum-steady',false);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    const run=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
    await capture(page,'online-'+width+'-initial');
    await runTo(page,run,.40);await capture(page,'online-'+width+'-quarter');
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    if(await page.evaluate(()=>document.documentElement.getAttribute('data-theme'))!=='projector'){
      await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
    }
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.waitForTimeout(180);await capture(page,'online-'+width+'-quarter-paper');
    await runTo(page,run,.85);await capture(page,'online-'+width+'-half-paper');
    await runTo(page,run,1.28);await capture(page,'online-'+width+'-three-quarter-paper');
    await select(page,'conical-pendulum-rest',false);await capture(page,'online-'+width+'-rest-paper',true);
  }finally{await ctx.close();}
}
async function offline(){
  const file=path.join(out,'M07.html');
  execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','mech-conical-turntable','--preset','conical-pendulum-steady','--out',file],{stdio:'inherit',timeout:60000});
  const {ctx,page}=await pageFor(1024,true);
  try{
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(()=>window.__H80M07()?.physics?.mode==='conical-pendulum'&&window.__H80M07()?.labels.length>=4);
    await capture(page,'offline-1024-initial');
    const run=page.getByTestId('sf-play-pause');
    await runTo(page,run,.40);await capture(page,'offline-1024-quarter');
    await runTo(page,run,1.28);await capture(page,'offline-1024-three-quarter');
    await select(page,'conical-pendulum-rest',true);await capture(page,'offline-1024-rest',true);
  }finally{await ctx.close();}
}
try{
  const base=await url();browser=await chromium.launch({headless:true});
  await online(base,1440);await online(base,1024);await offline();
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==16)throw Error(JSON.stringify(report));
console.log('H80 M07 actual clearance cases '+report.cases.length);
