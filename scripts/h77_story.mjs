import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const phase='online', head=process.env.SOURCE_HEAD, width=Number(process.env.WIDTH);
if(![1024,1440].includes(width))throw Error('explicit viewport required');
if(!head||!['online','offline'].includes(phase))throw Error('Exact phase and source required');
if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h77-story');fs.mkdirSync(out,{recursive:true});
const report={head,phase,width,issues:[],errors:[],network:[],states:[],gestures:[],openings:[],spatialGestures:[],forces:[]};
let server,browser,ctx,page;
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
async function onlineURL(){
 const dist=path.resolve('apps/web/dist');
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const relative=decodeURIComponent(url.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html';
  const file=path.resolve(dist,relative);
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return 'http://127.0.0.1:'+server.address().port+'/PhysForge/';
}
const parseRGB=(s)=>{
 if(/^#[0-9a-f]{6}$/i.test(s))return [1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
 if(/^#[0-9a-f]{3}$/i.test(s))return [1,2,3].map(i=>parseInt(s[i]+s[i],16));
 const m=s.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
 if(m&&(!m[4]||Number(m[4])===1))return m.slice(1,4).map(Number);
 return null;
};
const lum=(rgb)=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const contrast=(color,bg)=>{const rgb=parseRGB(color);if(!rgb)return null;const a=lum(rgb),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
try{
 const url=(await onlineURL())+'?model=em-induction-double-rod';
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,offline:phase==='offline',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const ring=[];Object.defineProperty(window,'__h66E04Paint',{value:ring});
  const rods=[],rails=[],paths=new WeakMap();Object.defineProperty(window,'__h75Paint',{value:{rods,rails}});
  const isStage=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.dataset.testid);
  const proto=CanvasRenderingContext2D.prototype,begin=proto.beginPath,rect=proto.fillRect;
  proto.beginPath=function(...args){if(isStage(this))paths.set(this,[]);return begin.apply(this,args);};
  proto.fillRect=function(x,y,w,h){if(isStage(this)&&x===0&&y===0&&w>=this.canvas.width-1&&h>=this.canvas.height-1){rods.length=0;rails.length=0;ring.length=0;}return rect.call(this,x,y,w,h);};
  for(const key of ['moveTo','lineTo','quadraticCurveTo','bezierCurveTo']){
    const orig=proto[key];proto[key]=function(...args){if(isStage(this)){const pts=paths.get(this);if(pts)for(let i=0;i+1<args.length;i+=2)pts.push([args[i],args[i+1]]);}return orig.apply(this,args);};
  }
  const extent=ctx=>{const p=paths.get(ctx)||[];if(!p.length)return null;return {left:Math.min(...p.map(a=>a[0])),right:Math.max(...p.map(a=>a[0])),top:Math.min(...p.map(a=>a[1])),bottom:Math.max(...p.map(a=>a[1]))};};
  const fill=proto.fill,stroke=proto.stroke;
  proto.fill=function(...args){
    if(isStage(this)){
      const b=extent(this),color=this.shadowColor.replace(/\s/g,'').toLowerCase();
      if(b&&this.shadowBlur===18){
        let id;
        if(['#38bdf8','#0369a1','rgba(56,189,248,1)','rgba(3,105,161,1)','rgb(56,189,248)','rgb(3,105,161)'].includes(color))id='rod1';
        if(['#f472b6','#86198f','rgba(244,114,182,1)','rgba(134,25,143,1)','rgb(244,114,182)','rgb(134,25,143)'].includes(color))id='rod2';
        if(id)rods.push({id,...b});
      }else if(b&&this.shadowBlur===8&&color==='rgba(196,221,247,0.24)')rails.push(b);
    }
    return fill.apply(this,args);
  };
  proto.stroke=function(...args){if(isStage(this)&&this.lineWidth===8&&['#64748b','#475569'].includes(this.strokeStyle)){const b=extent(this);if(b)rails.push(b);}return stroke.apply(this,args);};
  const base=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
   if(['simulation-canvas','sf-canvas'].includes(this.canvas.dataset.testid)){
    ring.push({text:String(text),x,y,fill:typeof this.fillStyle==='string'?this.fillStyle:'gradient',font:this.font,align:this.textAlign,width:this.measureText(String(text)).width});
    if(ring.length>1200)ring.splice(0,ring.length-1200);
   }
   return base.call(this,text,x,y,...rest);
  };
 });
 page=await ctx.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&(phase==='offline'||!r.url().startsWith(new URL(url).origin)))report.network.push(r.url());});
 page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url());});

 const canvas=page.getByTestId('simulation-canvas'), spatial=page.getByTestId('three-stage-container');
 async function openStory(){
   await page.goto(url,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='em-induction-double-rod');
   await page.getByTestId('btn-fullscreen-speech').click();
   await page.getByTestId('btn-toggle-story').click();
   await page.getByTestId('story-caption').waitFor();
   await spatial.waitFor({state:'visible',timeout:20000});
   await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.morphT==='0',null,{timeout:15000});
   await spatial.locator('canvas').evaluate(c=>{const gl=c.getContext('webgl2')??c.getContext('webgl');if(!gl||gl.isContextLost())throw Error('No live 3D opening');window.__h76GL=gl;});
   await page.waitForFunction(()=>{const el=document.querySelector('[data-testid="three-stage-container"]');const d=JSON.parse(el?.dataset.inductionSpatialBounds||'null');return d?.automatic&&!d.animating&&d.safe&&d.bounds.visible;},null,{timeout:15000});
   const data=await spatial.evaluate(el=>{
     const c=el.querySelector('canvas'),box=c.getBoundingClientRect();
     const rect=t=>{const r=document.querySelector('[data-testid="'+t+'"]')?.getBoundingClientRect();return r?{left:r.left-box.left,right:r.right-box.left,top:r.top-box.top,bottom:r.bottom-box.top}:null;};
     return {...JSON.parse(el.dataset.inductionSpatialBounds),width:box.width,height:box.height,overlays:['fullscreen-formula','fullscreen-controls','story-hud'].map(rect)};
   });
   const b=data.bounds, safe=data.safe;
   const hit=(r,q)=>q&&Math.min(r.right,q.right)-Math.max(r.left,q.left)>.5&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>.5;
   check(data.points>=100,'opening actual geometry sample missing');
   check(b.visible&&b.left>=safe.left&&b.right<=safe.right&&b.top>=safe.top&&b.bottom<=safe.bottom,'opening outside safe bounds '+JSON.stringify(data));
   check(!data.overlays.some(q=>hit(b,q)),'opening overlaps actual UI '+JSON.stringify(data));
   check((b.right-b.left)/(safe.right-safe.left)>.55,'opening unnecessarily tiny');
   report.openings.push(data);
 }
 async function enterFlat(beat){
   if(beat===2)await page.getByTestId('btn-story-next').click();
   else await page.getByRole('button',{name:/第 3 镜/}).click();
   await page.waitForFunction(()=>{const v=Number(document.querySelector('[data-testid="three-stage-container"]')?.dataset.morphT);return v>0&&v<1;},null,{timeout:10000});
   await spatial.waitFor({state:'detached',timeout:15000});
   await canvas.waitFor({state:'visible'});
   await page.waitForFunction(()=>window.__h76GL?.isContextLost()===true,null,{timeout:10000});
   await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.inductionAutoFit==='true',null,{timeout:10000});
 }
 async function inspect(name,freeze=false,beat=2){
   const data=await canvas.evaluate(c=>{
     const box=c.getBoundingClientRect(),rect=t=>{const b=document.querySelector('[data-testid="'+t+'"]')?.getBoundingClientRect();return b?{left:b.left-box.left,right:b.right-box.left,top:b.top-box.top,bottom:b.bottom-box.top}:null;};
     return {state:JSON.parse(c.dataset.inductionRendered||'null'),view:JSON.parse(c.dataset.inductionView||'null'),auto:c.dataset.inductionAutoFit,paint:structuredClone(window.__h75Paint),labels:structuredClone(window.__h66E04Paint),overlays:['fullscreen-formula','fullscreen-controls','story-hud'].map(rect),width:box.width,height:box.height};
   });
   const {state,view,paint,overlays}=data;
   check(data.auto==='true',name+': camera not automatic');
   if(!state||!view){check(false,name+': missing actual frame');return;}
   const ppm=.24*Math.min(view.width,view.height)*view.scale,originX=.45*view.width+view.offsetX,originY=.5*view.height+view.offsetY;
   const x1=state.x1-(1.2+Math.max(0,state.x1-1.6)),x2=state.x2-(1.2+Math.max(0,state.x1-1.6));
   const hit=(r,q)=>q&&Math.min(r.right,q.right)-Math.max(r.left,q.left)>.5&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>.5;
   const fits=r=>r.left>=0&&r.top>=0&&r.right<=data.width&&r.bottom<=data.height&&!overlays.some(q=>hit(r,q));
   check(paint.rods.length===2,name+': must paint two rods, got '+JSON.stringify(paint.rods));
   check(paint.rails.length===2,name+': must paint both rails');
   for(const [id,x] of [['rod1',x1],['rod2',x2]]){
     const rod=paint.rods.find(r=>r.id===id);
     check(rod&&fits(rod),name+': '+id+' clipped/occluded '+JSON.stringify(rod));
     if(rod)check(Math.abs((rod.left+rod.right)/2-(originX+x*ppm))<.25&&Math.abs(rod.top-(originY-ppm/2-12))<.25&&Math.abs(rod.bottom-(originY+ppm/2+12))<.25,name+': incorrect actual rod paint');
   }
   for(const rail of paint.rails)check(fits(rail),name+': clipped/occluded rail '+JSON.stringify(rail));
   const t=state.t,k=1.35,e=Math.exp(-k*t),Q=36-state.v1**2-.5*state.v2**2;
   for(const [key,expected] of Object.entries({v1:4+2*e,v2:4-4*e,x1:1.5+4*t+2/k*(1-e),x2:.3+4*t-4/k*(1-e),current:3.6*e}))check(Math.abs(state[key]-expected)<.001,name+': analytical '+key+' mismatch');
   if(freeze){
     const expected=beat===2?Math.log(3.6/.05)/1.35:Math.log(12/.1)/2.7;
     check(Math.abs(t-expected)<.025,name+': incorrect freeze time '+t+' expected '+expected);
     check(beat===2?state.current<=.05001:Q>=11.8999,name+': threshold not reached');
     check(await page.locator('[data-testid="fullscreen-controls"] [aria-label="运行"]').count()===1,name+': not paused');
   }
   const forces=data.labels.filter(l=>/^F安/.test(l.text));
   check(forces.length===2&&forces.some(l=>/^F安 =/.test(l.text))&&forces.some(l=>/^F安₂ =/.test(l.text))&&forces.every(l=>l.align==='center'),name+': duplicate or missing physical force labels '+JSON.stringify(forces));
   report.forces.push({name,forces});
   const labels=data.labels.filter(l=>/^(?:F安|I\s*=|杆2|B\s*=|v(?:₁)?\s*=)/.test(l.text));
   const by=new Map(labels.map(l=>[l.text.split(' = ')[0],l]));
   for(const l of by.values()){
     const h=Number(l.font.match(/([\d.]+)px/)?.[1])||13;
     const r={left:l.x-l.width/2,right:l.x+l.width/2,top:l.y-h/2,bottom:l.y+h/2};
     check(fits(r),name+': label hidden '+l.text);
   }
   report.states.push({name,...data,Q});
   await page.screenshot({path:path.join(out,name+'.png')});
 }
 async function freeze(beat){
   const label=beat===2?'接近共速':'累计焦耳热';
   await page.getByTestId('story-freeze-badge').waitFor({state:'visible',timeout:45000});
   check((await page.getByTestId('story-freeze-badge').innerText()).includes(label),'wrong freeze badge '+beat);
   await page.waitForTimeout(180);
   await inspect('beat'+beat+'-freeze',true,beat);
   const t=await canvas.evaluate(c=>JSON.parse(c.dataset.inductionRendered).t);
   await page.waitForTimeout(250);
   check(await canvas.evaluate(c=>JSON.parse(c.dataset.inductionRendered).t)===t,'clock advanced while frozen');
 }
 await openStory();await page.screenshot({path:path.join(out,'beat1-opening.png')});
 const read3d=()=>spatial.evaluate(el=>JSON.parse(el.dataset.inductionSpatialBounds));
 const start3d=await read3d(),cb=await spatial.locator('canvas').boundingBox();
 const x=cb.x+(start3d.bounds.left+start3d.bounds.right)/2,y=cb.y+(start3d.bounds.top+start3d.bounds.bottom)/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+65,y+30,{steps:8});await page.mouse.up();
 // OrbitControls intentionally has damping. Sample convergence rather than
 // treating residual inertia during the first 800ms as automatic camera takeover.
 const delta=(a,b)=>['left','right','top','bottom'].reduce((sum,k)=>sum+Math.abs(a.bounds[k]-b.bounds[k]),0);
 let manual3d=await read3d(),stable=0;const settleStart=Date.now();
 while(Date.now()-settleStart<7000&&stable<3){
   await page.waitForTimeout(200);const sample=await read3d();
   check(!sample.automatic,'teacher 3D orbit lock lost while damping');
   stable=delta(manual3d,sample)<.4?stable+1:0;manual3d=sample;
 }
 check(stable===3,'teacher orbit failed to settle within bounded watchdog');
 await page.waitForTimeout(500);const held3d=await read3d();
 check(!manual3d.automatic&&!held3d.automatic,'teacher 3D orbit did not lock auto framing');
 check(Math.abs(start3d.bounds.left-manual3d.bounds.left)+Math.abs(start3d.bounds.top-manual3d.bounds.top)>5,'teacher 3D orbit did not move visible geometry');
 check(Math.abs(held3d.bounds.left-manual3d.bounds.left)+Math.abs(held3d.bounds.top-manual3d.bounds.top)<3,'settled teacher orbit was overridden');
 report.spatialGestures.push({start3d,manual3d,held3d});
 await page.screenshot({path:path.join(out,'beat1-manual-orbit.png')});
 await enterFlat(2);await inspect('beat2-running');await freeze(2);
 const readForces=()=>canvas.evaluate(()=>structuredClone(window.__h66E04Paint.filter(l=>/^F安/.test(l.text))));
 const fbd=page.getByTestId('btn-stage-fbd');
 check(await fbd.getAttribute('aria-pressed')==='true','authored FBD not enabled');
 const both=await readForces();await fbd.click();await page.waitForTimeout(150);const nativeOnly=await readForces();
 check(await fbd.getAttribute('aria-pressed')==='false'&&JSON.stringify(both)===JSON.stringify(nativeOnly),'native force layer changed when duplicate overlay disabled');
 await fbd.click();await page.waitForTimeout(150);
 check(JSON.stringify(await readForces())===JSON.stringify(nativeOnly),'FBD reenabled duplicate paint');
 report.forces.push({name:'toggle-native-visible',both,nativeOnly});
 const get=()=>canvas.evaluate(c=>({view:JSON.parse(c.dataset.inductionView),auto:c.dataset.inductionAutoFit,t:JSON.parse(c.dataset.inductionRendered).t}));
 const before=await get(),box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width*.32,box.y+box.height*.35);await page.mouse.wheel(0,-240);await page.waitForTimeout(200);
 const manual=await get();
 check(manual.auto==='false'&&manual.view.scale>before.view.scale,'manual zoom failed to own camera');
 await page.waitForTimeout(350);const held=await get();
 check(held.auto==='false'&&held.t===manual.t&&['scale','offsetX','offsetY'].every(k=>held.view[k]===manual.view[k]),'auto fit overrode teacher after freeze');
 report.gestures.push({before,manual,held});
 // Navigate again from a manual view, as well as directly from the spatial opening.
 await page.getByTestId('btn-story-next').click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.inductionAutoFit==='true',null,{timeout:10000});
 await freeze(3);
 await openStory();await enterFlat(3);await freeze(3);
 await page.screenshot({path:path.join(out,'beat3-direct-freeze.png')});
 // In the actual workbench, the independent FBD path must still work
 // when the native force layer is disabled. All combinations use the same preset.
 await page.goto(url+'&preset=double-rod-momentum-conservation',{waitUntil:'networkidle'});
 await canvas.waitFor({state:'visible'});
 await page.getByText('更多参数与图层',{exact:false}).first().click();
 const layer=page.getByRole('checkbox',{name:'安培力与外力矢量'}),autoButton=page.getByTestId('btn-auto-fbd');
 await layer.waitFor({state:'visible'});
 const wbForces=()=>canvas.evaluate(()=>structuredClone(window.__h66E04Paint.filter(l=>/^F安/.test(l.text))));
 await layer.uncheck();await page.waitForTimeout(150);
 if((await wbForces()).length===0){await autoButton.click();await page.waitForTimeout(150);}
 const fallback=await wbForces();
 check(fallback.length===2&&fallback.every(l=>l.align==='left')&&fallback.some(l=>/^F安₁ =/.test(l.text))&&fallback.some(l=>/^F安₂ =/.test(l.text)),'independent FBD fallback not visible '+JSON.stringify(fallback));
 await page.screenshot({path:path.join(out,'workbench-fbd-only.png')});
 await autoButton.click();await page.waitForTimeout(150);const neither=await wbForces();
 check(neither.length===0,'forces still shown with both switches off');
 await layer.check();await page.waitForTimeout(150);const native=await wbForces();
 check(native.length===2&&native.every(l=>l.align==='center'),'native force paint missing '+JSON.stringify(native));
 await autoButton.click();await page.waitForTimeout(150);const bothWb=await wbForces();
 check(JSON.stringify(native)===JSON.stringify(bothWb),'duplicate FBD in workbench');
 report.forces.push({name:'four-workbench-layer-combinations',fallback,neither,native,bothWb});
 await page.screenshot({path:path.join(out,'workbench-both.png')});
 check(report.errors.length===0,'browser errors');check(report.network.length===0,'external network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(ctx)await ctx.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({head,width,status:report.status,issues:report.issues,errors:report.errors,states:report.states.map(x=>({name:x.name,t:x.state.t,Q:x.Q,current:x.state.current,auto:x.auto}))}));if(report.issues.length)process.exitCode=1;
}
