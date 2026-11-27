import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const phase=process.env.PHASE, head=process.env.SOURCE_HEAD;
if(!head||!['online','offline'].includes(phase))throw Error('Exact phase and source required');
const out=path.resolve('evidence/b3-gold');fs.mkdirSync(out,{recursive:true});
const report={head,phase,issues:[],errors:[],network:[],states:[]};
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
 const url=phase==='online'?(await onlineURL())+'?model=builder-optics-ray':(()=>{
  const file=path.join(out,'offline.html');
  execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','builder-optics-ray','--preset','tir-water-air','--out',file],{stdio:'inherit',timeout:90000});
  return pathToFileURL(file).href;
 })();
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:phase==='offline',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const capture={labels:[],strokes:[],arcs:[],frame:0};Object.defineProperty(window,'__h67B3Paint',{value:capture});
  const proto=CanvasRenderingContext2D.prototype, paths=new WeakMap();
  const active=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.dataset.testid);
  const wrap=(name,callback)=>{
   const original=proto[name];
   proto[name]=function(...args){if(active(this))callback(this,args);return original.apply(this,args);};
  };
  wrap('fillRect',(c,[x,y,w,h])=>{
   if(x===0&&y===0&&w>=c.canvas.clientWidth-1&&h>=c.canvas.clientHeight-1){
    capture.labels=[];capture.strokes=[];capture.arcs=[];capture.frame++;
   }
  });
  wrap('beginPath',c=>paths.set(c,[]));
  wrap('moveTo',(c,[x,y])=>paths.get(c)?.push(['M',x,y]));
  wrap('lineTo',(c,[x,y])=>paths.get(c)?.push(['L',x,y]));
  wrap('arc',(c,[x,y,r,a,b])=>{
   paths.get(c)?.push(['A',x,y,r,a,b]);
   capture.arcs.push({x,y,r,a,b,color:c.strokeStyle});
  });
  wrap('stroke',(c)=>{
   const p=paths.get(c);
   if(p?.length===2&&p[0][0]==='M'&&p[1][0]==='L')capture.strokes.push({
    a:{x:p[0][1],y:p[0][2]},b:{x:p[1][1],y:p[1][2]},color:c.strokeStyle,
    alpha:c.globalAlpha,width:c.lineWidth,dash:c.getLineDash()
   });
  });
  wrap('fillText',(c,[value,x,y])=>{
   const s=String(value),m=c.measureText(s);
   capture.labels.push({text:s,x,y,font:c.font,align:c.textAlign,baseline:c.textBaseline,fill:c.fillStyle,
    left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});
  });
 });
 page=await ctx.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&(phase==='offline'||!r.url().startsWith(new URL(url).origin)))report.network.push(r.url());});
 page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url());});
 await page.goto(url,{waitUntil:'networkidle'});
 const canvas=page.getByTestId(phase==='online'?'simulation-canvas':'sf-canvas');
 await canvas.waitFor({state:'visible'});
 if(phase==='online'){
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='builder-optics-ray');
  await page.getByTestId('preset-select').selectOption('tir-water-air');
 }
 const reset=phase==='online'?page.getByTestId('btn-reset'):page.getByRole('button',{name:'复位',exact:true});
 const read=async()=>JSON.parse(await canvas.getAttribute('data-b3-rendered'));
 const slider=key=>page.getByTestId((phase==='online'?'param-slider-':'sf-param-')+key);
 const setRange=async(key,value)=>{
  const el=slider(key);const q=await el.evaluate(e=>({value:Number(e.value),step:Number(e.step)}));
  const count=Math.round((value-q.value)/q.step);
  await el.focus();
  for(let i=0;i<Math.abs(count);i++)await el.press(count>0?'ArrowRight':'ArrowLeft');
  check(Math.abs(Number(await el.inputValue())-value)<1e-8,'range not set '+key);
  await el.blur();
 };
 async function theme(paper){
  const target=paper?'projector':'chalkboard';
  if(await page.evaluate(()=>document.documentElement.dataset.theme)===target)return;
  if(phase==='online'){
   await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
   if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  }else await page.getByRole('button',{name:paper?'黑板深蓝':'投影白底',exact:true}).click();
  await page.waitForFunction(t=>document.documentElement.dataset.theme===t,target);
 }
 const rad=x=>x*Math.PI/180;
 function exact(n1,n2,theta){
  const s=n1/n2*Math.sin(rad(theta)),ci=Math.cos(rad(theta));
  if(s>=1-1e-12)return {R:1,T:0,theta2:null};
  const ct=Math.sqrt(1-s*s),rs=(n1*ci-n2*ct)/(n1*ci+n2*ct),rp=(n2*ci-n1*ct)/(n2*ci+n1*ct),R=(rs*rs+rp*rp)/2;
  return {R,T:1-R,theta2:Math.asin(s)*180/Math.PI};
 }
 const overlap=(a,b,pad=0)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>-pad&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>-pad;
 function hit(seg,rect,pad){
  let lo=0,hi=1;
  for(const axis of ['x','y']){
   const min=(axis==='x'?rect.left:rect.top)-pad,max=(axis==='x'?rect.right:rect.bottom)+pad;
   const a=seg.a[axis],d=seg.b[axis]-a;
   if(Math.abs(d)<1e-9){if(a<min||a>max)return false;}
   else {const t1=(min-a)/d,t2=(max-a)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;}
  }
  return true;
 }
 async function record(name,n1,n2,angle,paper){
  const physical=exact(n1,n2,angle),data=await read(),paint=await page.evaluate(()=>window.__h67B3Paint);
  const {labels,strokes,arcs}=paint,canvasBox=await canvas.boundingBox();
  const inspector=phase==='online'?await page.getByTestId('right-control-panel').boundingBox():null;
  const safeRight=inspector?inspector.x-canvasBox.x:canvasBox.width;
  const semantic=labels.filter(l=>/^(介质 [12]|θ[₁₂] = |入射光$|折射光$|反射光$|全反射光$)/.test(l.text));
  const rayColors=paper?['#92400e','#9a3412','#075985']:['#fcd58b','#e8ba76','#67e8f9'];
  const beam=strokes.filter(s=>rayColors.includes(s.color)&&s.width>=2.5&&Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y)>30);
  const center=arcs.find(a=>a.r>=7&&a.r<=13&&Math.abs(a.b-a.a-2*Math.PI)<1e-6);
  check(Math.abs(data.incidentAngleDeg-angle)<1e-8,name+': stale angle');
  check(Math.abs(data.interfaceReflectance-physical.R)<1e-10&&Math.abs(data.interfaceTransmittance-physical.T)<1e-10,name+': Fresnel power mismatch');
  check(!!center,name+': interface handle ring absent');
  if(center)check(Math.abs(center.x-safeRight/2)<=safeRight*.04,name+': interface not centered in actual usable canvas; error '+Math.abs(center.x-safeRight/2).toFixed(1)+'px');
  check(semantic.length===(physical.R>1e-12?1:0)+(physical.T>1e-12?2:0)+4,name+': wrong labels '+semantic.map(l=>l.text).join('|'));
  for(const [i,color] of rayColors.entries()){
   const p=i===0?1:i===1?physical.R:physical.T;
   const rays=beam.filter(s=>s.color===color);
   check(p>1e-12?rays.length>0:rays.length===0,name+': missing or false ray '+i);
   for(const s of rays){
    const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,theta=Math.atan2(Math.abs(dx),Math.abs(dy))*180/Math.PI;
    check(Math.abs(theta-(i===2?physical.theta2:angle))<.0001,name+': ray slope error '+i);
    if(center)check(Math.min(Math.hypot(s.a.x-center.x,s.a.y-center.y),Math.hypot(s.b.x-center.x,s.b.y-center.y))<1e-5,name+': ray detached from interface');
   }
  }
  for(let i=0;i<semantic.length;i++){
   const l=semantic[i];
   check(l.left>=0&&l.top>=0&&l.right<=safeRight+1&&l.bottom<=canvasBox.height,name+': clipped '+l.text);
   for(let j=0;j<i;j++)check(!overlap(l,semantic[j]),name+': label overlap '+semantic[j].text+' / '+l.text);
   // The broad halo is decorative. The readable label must clear the true
   // optical centerline and the narrow ray core, not merely another label.
   for(const s of beam.filter(s=>s.width<=6.5))check(!hit(s,l,Math.min(4,s.width/2)),name+': label crosses ray '+l.text);
   if(paper)check(contrast(l.fill,[255,255,255])>=4.5,name+': paper contrast '+l.text);
  }
  const alpha=await canvas.evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<data.length;i+=4)if(data[i]!==255)n++;return n;});
  check(alpha===0,name+': transparent canvas holes');
  if(phase==='online')check(!(await page.getByTestId('floating-scope-dock').isVisible()),name+': unwanted scope in static optics');
  report.states.push({name,data,physical,center,labels:semantic,beam,alpha,safeRight,canvasBox});
  await page.screenshot({path:path.join(out,name+'.png')});
 }
 async function setState(n1,n2,angle){
  await setRange('n1',n1);await setRange('n2',n2);await setRange('incidentAngleDeg',angle);
  await reset.click();
  await page.waitForFunction(({id,angle})=>{const c=document.querySelector('[data-testid="'+id+'"]');const s=JSON.parse(c?.dataset.b3Rendered||'null');return s?.mode==='tir-interface'&&Math.abs(s.incidentAngleDeg-angle)<1e-8;},{id:phase==='online'?'simulation-canvas':'sf-canvas',angle});
  await page.mouse.move(10,10);await page.waitForTimeout(120);
 }
 for(const [name,n1,n2,angle] of [
  ['default',1.5,1,35],['normal',1.5,1,0],['low',1.5,1,1],['near-critical',1.5,1,41],
  ['tir',1.5,1,50],['grazing-tir',1.5,1,85],['matched',1.5,1.5,35],['reverse-grazing',1,2,85]
 ]){
  await setState(n1,n2,angle);
  await record(name+'-dark',n1,n2,angle,false);
  await theme(true);await page.waitForTimeout(100);await record(name+'-paper',n1,n2,angle,true);
  await theme(false);
 }
 if(phase==='online'){
  await page.setViewportSize({width:1024,height:768});await setState(1.5,1,35);
  await record('compact-default-dark',1.5,1,35,false);
  await setState(1,2,85);await record('compact-grazing-dark',1,2,85,false);
  await theme(true);await page.waitForTimeout(100);await record('compact-grazing-paper',1,2,85,true);
  fs.mkdirSync(path.join(out,'reference'),{recursive:true});
  fs.copyFileSync('docs/ui-benchmark/02_optics_clean.png',path.join(out,'reference','02_optics_clean.png'));
 }
 check(report.errors.length===0,'browser errors');check(report.network.length===0,'external network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(ctx)await ctx.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({head,phase,status:report.status,states:report.states.length,issues:report.issues,errors:report.errors,network:report.network}));
 if(report.issues.length)process.exitCode=1;
}
