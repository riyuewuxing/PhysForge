import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const phase=process.env.PHASE, head=process.env.SOURCE_HEAD,candidate=process.env.CANDIDATE==='true';
if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source checkout');
if(!head||!['online','offline'].includes(phase))throw Error('Exact phase and source required');
const out=path.resolve('evidence/b2-divider');fs.mkdirSync(out,{recursive:true});
const report={head,phase,candidate,audit:process.env.AUDIT_HEAD,issues:[],errors:[],network:[],states:[]};
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

// Independent scalar solution of E = (r+Ru)(U/Rd + I_L(U)) + U.
function exact(E,r,Rd){
 const Ru=20-Rd;
 const I=u=>u===0?0:.25*u*Math.pow(u+1e-6,-.35);
 if(Rd===0)return {u:0,il:0,id:E/(r+20),is:E/(r+20),p:0};
 let a=0,b=E;
 for(let k=0;k<100;k++){const u=(a+b)/2;if(u+(r+Ru)*(u/Rd+I(u))>E)b=u;else a=u;}
 const u=(a+b)/2,il=I(u),id=u/Rd;
 return {u,il,id,is:id+il,p:u*il};
}
try{
 const url=phase==='online'?(await onlineURL())+'?model=builder-circuit-mna':(()=>{
  const file=path.join(out,'offline.html');
  execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','builder-circuit-mna','--preset','divider-lamp-measurement','--out',file],{stdio:'inherit',timeout:90000});
  return pathToFileURL(file).href;
 })();
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:phase==='offline',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const capture={labels:[],arcs:[],radial:[],frame:0,strokes:[],fills:[]};Object.defineProperty(window,'__h68B2Paint',{value:capture});
  const proto=CanvasRenderingContext2D.prototype, paths=new WeakMap(), gradients=new WeakMap();
  const active=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.dataset.testid);
  const wrap=(name,callback)=>{
   const original=proto[name];proto[name]=function(...args){if(active(this))callback(this,args);return original.apply(this,args);};
  };
  wrap('fillRect',(c,[x,y,w,h])=>{if(x===0&&y===0&&w>=c.canvas.clientWidth-1&&h>=c.canvas.clientHeight-1){
    capture.labels=[];capture.arcs=[];capture.radial=[];capture.strokes=[];capture.fills=[];capture.frame++;
  }});
  const rg=proto.createRadialGradient;
  proto.createRadialGradient=function(...a){const g=rg.apply(this,a);if(active(this)){const item={geometry:a,stops:[]};gradients.set(g,item);capture.radial.push(item);}return g;};
  const stop=CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop=function(offset,color){const g=gradients.get(this);if(g)g.stops.push([offset,color]);return stop.call(this,offset,color);};
  wrap('beginPath',c=>paths.set(c,[]));
  for(const k of ['moveTo','lineTo'])wrap(k,(c,[x,y])=>paths.get(c)?.push([k,x,y]));
  wrap('arc',(c,[x,y,r,a,b])=>{paths.get(c)?.push(['arc',x,y,r,a,b]);capture.arcs.push({x,y,r,a,b});});
  wrap('stroke',c=>{const p=paths.get(c);if(p?.length)capture.strokes.push({p,width:c.lineWidth,color:typeof c.strokeStyle==='string'?c.strokeStyle:'gradient'});});
  wrap('fill',c=>{const p=paths.get(c);if(p?.length)capture.fills.push({p,color:typeof c.fillStyle==='string'?c.fillStyle:'gradient'});});
  wrap('fillText',(c,[value,x,y])=>{const t=String(value),m=c.measureText(t);capture.labels.push({t,x,y,fill:typeof c.fillStyle==='string'?c.fillStyle:'gradient',font:c.font,
    left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});});
 });
 page=await ctx.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&(phase==='offline'||!r.url().startsWith(new URL(url).origin)))report.network.push(r.url());});
 page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url());});
 await page.goto(url,{waitUntil:'networkidle'});
 const canvas=page.getByTestId(phase==='online'?'simulation-canvas':'sf-canvas');await canvas.waitFor({state:'visible'});
 if(phase==='online'){await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='builder-circuit-mna');await page.getByTestId('preset-select').selectOption('divider-lamp-measurement');}
 const read=async()=>JSON.parse(await canvas.getAttribute('data-b2-rendered'));
 const slider=key=>page.getByTestId((phase==='online'?'param-slider-':'sf-param-')+key);
 const range=async(key,v)=>{
  const el=slider(key);const q=await el.evaluate(e=>({value:Number(e.value),step:Number(e.step),min:Number(e.min),max:Number(e.max)}));await el.focus();
  if(v===q.min)await el.press('Home');else if(v===q.max)await el.press('End');else for(let k=0,n=Math.round((v-q.value)/q.step);k<Math.abs(n);k++)await el.press(n>0?'ArrowRight':'ArrowLeft');
  check(Math.abs(Number(await el.inputValue())-v)<1e-9,'range not set '+key+' '+v);await el.blur();
 };
 async function theme(paper){
  const target=paper?'projector':'chalkboard';if(await page.evaluate(()=>document.documentElement.dataset.theme)===target)return;
  if(phase==='online'){await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();}
  else await page.getByRole('button',{name:paper?'黑板深蓝':'投影白底',exact:true}).click();
  await page.waitForFunction(t=>document.documentElement.dataset.theme===t,target);
 }
 const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
 async function record(name,E,r,Rd,paper){
  const e=exact(E,r,Rd);await page.mouse.move(10,10);await page.waitForTimeout(120);
  const data=await read(),paint=await page.evaluate(()=>window.__h68B2Paint),box=await canvas.boundingBox();
  const panel=phase==='online'?await page.getByTestId('right-control-panel').boundingBox():null;
  const right=panel?panel.x-box.x:box.width;
  for(const [k,v] of Object.entries({lampVoltage:e.u,lampCurrent:e.il,totalCurrent:e.is,branchCurrent1:e.id,outputPower:e.p}))
    check(Math.abs(data[k]-v)<1e-7,name+': wrong '+k+' actual '+data[k]+' expected '+v);
  const text=paint.labels;
  const label=(s)=>text.find(l=>l.t===s);
  const curr=label(e.il.toFixed(2)),volt=label(e.u.toFixed(2)),power=label('P灯 = '+e.p.toFixed(2)+' W');
  check(!!curr&&!!volt&&!!power,name+': missing actual meter/power readout');
  const A=text.find(l=>l.t==='A'),V=text.find(l=>l.t==='V');
  check(!!A&&!!V,name+': missing actual A/V symbols');
  // Actual source and rightmost return x coordinates in original and revised renderers.
  const ground=text.find(l=>l.t==='0.00 V'),source=text.find(l=>l.t.startsWith('E = '));
  check(!!ground&&!!source,name+': missing source/ground label');
  if(A&&V){
    // Centers of the circuit world x endpoints -2.05 and +2.20. The
    // A (x=1) and V (x=1.77) labels reveal the true isotropic scale.
    const ppm=(V.x-A.x)/.77,center=A.x+(0.075-1)*ppm;
    // The online camera has a deliberate narrow right gutter. On an isolated
    // slice the circuit must use the actual available canvas, not reserve it again.
    check(Math.abs(center-right/2)<=Math.max(24,right*.06),name+': circuit framing error '+Math.abs(center-right/2).toFixed(1)+'px');
    check(ppm>0,name+': invalid or mirrored meter placement');
  }
  for(let i=0;i<text.length;i++){
    const l=text[i];check(l.left>=-1&&l.right<=right+1&&l.top>=-1&&l.bottom<=box.height+1,name+': clipped '+l.t);
    for(let j=0;j<i;j++)check(!overlaps(l,text[j]),name+': overlap '+text[j].t+' / '+l.t);
    if(paper&&l.fill!=='gradient')check(contrast(l.fill,[255,255,255])>=4.5,name+': contrast '+l.t+' '+l.fill);
  }
  const alpha=await canvas.evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<data.length;i+=4)if(data[i]!==255)n++;return n;});
  check(alpha===0,name+': canvas alpha holes');
  if(phase==='online')check(!(await page.getByTestId('floating-scope-dock').isVisible()),name+': time scope visible by default');
  // Zero power must not draw the warm external radiance gradient. Count
  // only warm radial gradients explicitly having nonzero alpha at their center.
  const light=paint.radial.filter(g=>g.stops.some(([at,c])=>at===0&&/^rgba\(255,\s*(?:18[0-9]|19[0-9]|20[0-9]),\s*\d+,\s*[0-9.]+\)$/.test(c)&&Number(c.match(/,\s*([0-9.]+)\)$/)[1])>0));
  if(e.p===0)check(light.length===0,name+': false warm halo at zero power');
  // The two diagonals must be actual canvas strokes centered inside the
  // original lamp circle; not merely the presence of a legend or a CSS icon.
  let lampCross=null;
  if(A&&V){
    const ppm=(V.x-A.x)/.77,r=.18*ppm,cx=V.x,cy=A.y-.16*ppm*.48,d=r*.54;
    const expected=[['moveTo',cx-d,cy-d],['lineTo',cx+d,cy+d],['moveTo',cx+d,cy-d],['lineTo',cx-d,cy+d]];
    const cross=paint.strokes.filter(s=>s.p.length===4&&s.p.every((p,i)=>p[0]===expected[i][0]&&Math.abs(p[1]-expected[i][1])<1e-5&&Math.abs(p[2]-expected[i][2])<1e-5));
    lampCross={center:{x:cx,y:cy},r,strokes:cross};
    if(candidate){
      check(cross.length===(paper||e.p===0?1:2),name+': actual lamp cross stroke count '+cross.length);
      check(cross[0]?.color===(paper?(e.p>0?'#92400e':'#475569'):(e.p>0?'#ffe1a6':'#cbd5e1')),name+': lamp mark color inconsistent with actual power');
    }
  }
  report.states.push({name,data,exact:e,labels:text,light:light.length,box,right,A,V,alpha,radial:paint.radial,lampCross});
  await page.screenshot({path:path.join(out,name+'.png')});
 }
 for(const [name,E,r,Rd] of [['nominal',12,1,10],['bottom',12,1,0],['top',12,1,20],['zero-emf',0,1,10],['ideal-top',12,0,20]]){
  await theme(false);await range('emf',E);await range('internalR',r);await range('sliderR',Rd);
  await record(name+'-dark',E,r,Rd,false);
  await theme(true);await record(name+'-paper',E,r,Rd,true);
 }
 if(phase==='online'){
  await page.setViewportSize({width:1024,height:768});await theme(false);await range('emf',12);await range('internalR',1);await range('sliderR',10);
  await record('compact-dark',12,1,10,false);await theme(true);await record('compact-paper',12,1,10,true);
  fs.mkdirSync(path.join(out,'reference'),{recursive:true});fs.copyFileSync('docs/ui-benchmark/03_circuit_mna.png',path.join(out,'reference','03_circuit_mna.png'));
 }
 check(!report.errors.length,'browser errors');check(!report.network.length,'external network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(ctx)await ctx.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({head,phase,status:report.status,states:report.states.length,issues:report.issues,errors:report.errors,network:report.network}));if(report.issues.length)process.exitCode=1;
}
