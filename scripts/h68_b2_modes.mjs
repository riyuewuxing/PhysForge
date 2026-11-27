import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const phase=process.env.PHASE, head=process.env.SOURCE_HEAD;
if(!head||!['online','offline'].includes(phase))throw Error('Exact phase and source required');
const out=path.resolve('evidence/b2-modes');fs.mkdirSync(out,{recursive:true});
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


const near=(a,b,t=1e-7)=>typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<=t;
const modes=[
 ['divider-lamp-measurement','divider-lamp'],
 ['rc-charging-curve','rc-transient'],
 ['rc-discharging-curve','rc-transient'],
 ['closed-circuit-max-power','closed-power'],
 ['bridge-capacitor-polarity','rc-bridge-charge'],
 ['nonlinear-diode-iv','nonlinear-lamp-diode'],
 ['closed-power-short-circuit','closed-power'],
 ['series-parallel-branches','series-parallel-dynamic'],
 ['nonlinear-lamp-iv','nonlinear-lamp-diode']
];
function physical(preset,d,name){
 if(preset==='divider-lamp-measurement'){
  check(near(d.lampVoltage,3.0252044622671557)&&near(d.lampCurrent,.5133700572035432),name+': divider independent solution');
 }else if(preset==='rc-charging-curve')check(near(d.capVoltage,10*(-Math.expm1(-d.t/.5)))&&near(d.capCurrent,(10-d.capVoltage)/10),name+': charge law');
 else if(preset==='rc-discharging-curve')check(near(d.capVoltage,10*Math.exp(-d.t/.45))&&near(d.capCurrent,-d.capVoltage/9),name+': discharge law');
 else if(preset==='closed-circuit-max-power')check(near(d.totalCurrent,3)&&near(d.outputPower,18),name+': maximum power');
 else if(preset==='bridge-capacitor-polarity'){
  const u=12/(1+.5*(1/10+1/8));check(near(d.capVoltage,u*(6/10-6/8)),name+': bridge steady-state voltage');
 }else if(preset==='nonlinear-diode-iv'){
  check(near(5,10.5*d.totalCurrent+d.terminalVoltage)&&near(d.totalCurrent,1e-12*Math.expm1(d.terminalVoltage/.026),1e-6),name+': diode load law');
 }else if(preset==='closed-power-short-circuit'){
  check(d.solutionDefined===0&&!('totalCurrent' in d)&&!('outputPower' in d),name+': false finite short solution');
 }else if(preset==='series-parallel-branches')check(near(d.totalCurrent,1.5)&&near(d.branchCurrent1,.5)&&near(d.branchCurrent2,1),name+': mixed KCL');
 else if(preset==='nonlinear-lamp-iv')check(near(5,10.5*d.totalCurrent+d.terminalVoltage)&&near(d.totalCurrent,.25*d.terminalVoltage*Math.pow(d.terminalVoltage+1e-6,-.35),1e-6),name+': series lamp law');
}
try{
 const url=phase==='online'?(await onlineURL())+'?model=builder-circuit-mna':(()=>{
  const file=path.join(out,'offline.html');execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','builder-circuit-mna','--preset','divider-lamp-measurement','--out',file],{stdio:'inherit',timeout:90000});return pathToFileURL(file).href;
 })();
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:phase==='offline',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const trace={points:[],labels:[],frame:0};Object.defineProperty(window,'__h68B2Modes',{value:trace});
  const p=CanvasRenderingContext2D.prototype,active=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.dataset.testid);
  const wrap=(k,f)=>{const old=p[k];p[k]=function(...a){if(active(this))f(this,a);return old.apply(this,a);}};
  wrap('fillRect',(c,[x,y,w,h])=>{if(x===0&&y===0&&w>=c.canvas.clientWidth-1&&h>=c.canvas.clientHeight-1){trace.points=[];trace.labels=[];trace.frame++;}});
  function point(c,x,y){const p=c.getTransform(),d=window.devicePixelRatio||1;trace.points.push([(p.a*x+p.c*y+p.e)/d,(p.b*x+p.d*y+p.f)/d]);}
  for(const k of ['moveTo','lineTo'])wrap(k,(c,[x,y])=>point(c,x,y));
  wrap('arc',(c,[x,y,r])=>{point(c,x-r,y-r);point(c,x+r,y+r);});
  wrap('fillText',(c,[s,x,y])=>{const m=c.measureText(String(s));trace.labels.push({text:String(s),x,y,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent,fill:c.fillStyle});});
 });
 page=await ctx.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&(phase==='offline'||!r.url().startsWith(new URL(url).origin)))report.network.push(r.url());});
 page.on('response',r=>{if(r.status()>=400)report.errors.push(r.status()+' '+r.url());});
 await page.goto(url,{waitUntil:'networkidle'});
 const canvas=page.getByTestId(phase==='online'?'simulation-canvas':'sf-canvas');await canvas.waitFor({state:'visible'});
 if(phase==='online')await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='builder-circuit-mna');
 const read=async()=>JSON.parse(await canvas.getAttribute('data-b2-rendered'));
 const select=async(preset,topology)=>{
  if(phase==='online')await page.getByTestId('preset-select').selectOption(preset);
  else await page.locator('[data-preset-id="'+preset+'"]').click();
  await page.waitForFunction(({id,topology})=>{const d=JSON.parse(document.querySelector('[data-testid="'+id+'"]')?.dataset.b2Rendered||'null');return d?.topology===topology&&d.t===0;},{id:phase==='online'?'simulation-canvas':'sf-canvas',topology});await page.mouse.move(10,10);await page.waitForTimeout(140);
 };
 async function theme(paper){
  const target=paper?'projector':'chalkboard';if(await page.evaluate(()=>document.documentElement.dataset.theme)===target)return;
  if(phase==='online'){await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();}
  else await page.getByRole('button',{name:paper?'黑板深蓝':'投影白底',exact:true}).click();
  await page.waitForFunction(t=>document.documentElement.dataset.theme===t,target);await page.waitForTimeout(120);
 }
 async function record(name,preset,paper){
  const d=await read(),trace=await page.evaluate(()=>window.__h68B2Modes),b=await canvas.boundingBox();
  const panel=phase==='online'?await page.getByTestId('right-control-panel').boundingBox():null;
  const right=panel?panel.x-b.x:b.width;
  physical(preset,d,name);
  check(trace.points.length>3,name+': no actual circuit geometry');
  check(trace.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>=-2&&x<=right+2&&y>=-2&&y<=b.height+2),name+': geometry outside canvas or under inspector');
  // Scope overlap is audited separately because dynamic diagrams deliberately
  // keep the floating scope in a reserved bottom lane online.
  for(const l of trace.labels){
    check(l.left>=-2&&l.right<=right+2&&l.top>=-2&&l.bottom<=b.height+2,name+': clipped text '+l.text);
  }
  if(preset==='divider-lamp-measurement'&&phase==='offline')check(!await page.getByTestId('sf-scope-channel-a').isVisible(),name+': static scope consumes canvas by default');
  report.states.push({name,data:d,canvas:b,right,labels:trace.labels,geometryPoints:trace.points.length,extent:trace.points.reduce((a,[x,y])=>({left:Math.min(a.left,x),right:Math.max(a.right,x),top:Math.min(a.top,y),bottom:Math.max(a.bottom,y)}),{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity})});
  await page.screenshot({path:path.join(out,name+'.png')});
 }
 if(phase==='offline'){
  for(const [width,height] of [[1440,900],[1024,768]]){
   await page.setViewportSize({width,height});
   for(const [preset,topology] of modes){
    await theme(false);await select(preset,topology);await record(width+'-'+preset+'-dark',preset,false);
    await theme(true);await record(width+'-'+preset+'-paper',preset,true);
   }
  }
  await page.setViewportSize({width:1440,height:900});await theme(false);await select('divider-lamp-measurement','divider-lamp');
  const toggle=page.getByTestId('sf-b2-scope-toggle'),scope=page.getByTestId('sf-uplot'),channel=page.getByTestId('sf-scope-channel-a');
  check(await toggle.count()===1,'missing optional static scope toggle');
  if(await toggle.count()===1){
    const initial=await canvas.boundingBox();
    check(await toggle.getAttribute('aria-expanded')==='false'&&!await channel.isVisible(),'static scope not initially collapsed');
    for(let k=0;k<24;k++)await page.getByRole('button',{name:'单步',exact:true}).click();
    const t=(await read()).t;check(near(t,.4,1e-9),'hidden scope changed fixed clock');
    await toggle.click();await channel.waitFor({state:'visible'});await scope.waitFor({state:'visible'});
    await page.waitForFunction(t=>Math.abs(Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT)-t)<1e-9,t);
    check(near((await read()).t,t,1e-9),'opening scope reset physics');
    check(await toggle.getAttribute('aria-expanded')==='true','wrong expanded semantics');
    const expanded=await canvas.boundingBox();check(initial.height-expanded.height>120,'collapsed layout did not recover meaningful canvas area');
    report.scope={t,collapsed:initial.height,expanded:expanded.height,lastSampleT:Number(await scope.getAttribute('data-last-sample-t'))};
    await page.screenshot({path:path.join(out,'scope-open-with-samples.png')});
    await toggle.click();check(!await channel.isVisible()&&near((await read()).t,t,1e-9),'collapse reset or retained scope');
    await page.screenshot({path:path.join(out,'scope-closed-with-samples.png')});
  }
  await select('rc-charging-curve','rc-transient');await channel.waitFor({state:'visible'});
  check(await channel.inputValue()==='capVoltage','RC inherited wrong channel');
  for(let k=0;k<30;k++)await page.getByRole('button',{name:'单步',exact:true}).click();
  const rc=await read();physical('rc-charging-curve',rc,'RC sampled');check(near(rc.t,.5,1e-9),'wrong RC clock');
  check(near(Number(await scope.getAttribute('data-last-sample-t')),rc.t,1e-9),'RC scope endpoint mismatch');
  await page.screenshot({path:path.join(out,'rc-sampled.png')});
  await select('divider-lamp-measurement','divider-lamp');check(!await channel.isVisible(),'re-entered divider did not collapse');
 }else{
  await select('divider-lamp-measurement','divider-lamp');
  for(const topology of ['closed-power','rc-transient','rc-bridge-charge','divider-lamp']){
    const button=page.getByTestId('b2-topology-'+topology);
    check(await button.locator('svg').count()===1,'missing symbol glyph '+topology);
    await button.click();
    await page.waitForFunction(topology=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.b2Rendered||'null')?.topology===topology,topology);
    check(await button.getAttribute('aria-pressed')==='true','wrong selected topology '+topology);
    await page.screenshot({path:path.join(out,'toolbar-'+topology+'.png')});
    report.states.push({name:'toolbar-'+topology,topology:(await read()).topology,pressed:await button.getAttribute('aria-pressed')});
  }
 }
 check(!report.errors.length,'browser errors');check(!report.network.length,'network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(ctx)await ctx.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({head,phase,status:report.status,states:report.states.length,issues:report.issues,errors:report.errors,network:report.network,scope:report.scope}));if(report.issues.length)process.exitCode=1;
}
