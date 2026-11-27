import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const phase=process.env.PHASE, head=process.env.SOURCE_HEAD;
if(!head||!['online','offline'].includes(phase))throw Error('Exact phase and source required');
const out=path.resolve('evidence/e04-gold');fs.mkdirSync(out,{recursive:true});
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
 const url=phase==='online'?await onlineURL():(()=>{
  const file=path.join(out,'offline.html');
  execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','em-induction-double-rod','--preset','single-rod-battery-drive','--out',file],{stdio:'inherit',timeout:90000});
  return pathToFileURL(file).href;
 })();
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:phase==='offline',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const ring=[];Object.defineProperty(window,'__h66E04Paint',{value:ring});
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
 await page.goto(url,{waitUntil:'networkidle'});
 const canvas=page.getByTestId(phase==='online'?'simulation-canvas':'sf-canvas');
 await canvas.waitFor({state:'visible'});
 if(phase==='online'){
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='em-induction-double-rod');
  check(await page.getByTestId('preset-select').inputValue()==='single-rod-battery-drive','wrong default preset');
 }
 const step=phase==='online'?page.getByTestId('btn-step'):page.getByRole('button',{name:'单步',exact:true});
 const reset=phase==='online'?page.getByTestId('btn-reset'):page.getByRole('button',{name:'复位',exact:true});
 const clock=async()=>{
  if(phase==='offline')return Number(await page.getByTestId('sf-summary-clock').getAttribute('data-sample-time'));
  const s=await page.getByTestId('topbar').innerText();
  return Number(s.match(/t\s*=\s*([\d.]+)\s*s/i)?.[1]);
 };
 async function record(name,projector){
  const paint=await page.evaluate(()=>window.__h66E04Paint.slice());
  const picked=paint.filter(x=>/^(?:F安|I\s*=|电源 E|电阻 R|电容 C|杆2|F外|不同杆长)/.test(x.text));
  const last=[...new Map(picked.map(x=>[x.text.split(' = ')[0],x])).values()];
  const background=projector?[255,255,255]:phase==='online'?[19,25,31]:[9,18,32];
  const labels=last.map(x=>({...x,contrast:contrast(x.fill,background)}));
  const image=await canvas.evaluate(c=>{
   const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let alphaHoles=0;for(let i=3;i<data.length;i+=4)if(data[i]!==255)alphaHoles++;
   return {width:c.width,height:c.height,alphaHoles};
  });
  const t=await clock();
  check(image.alphaHoles===0,name+': canvas alpha holes');
  check(Number.isFinite(t),name+': invalid clock');
  check(labels.some(x=>x.text.startsWith('电源 E')),name+': load label not painted');
  if(t>0.5){
   const v=4*(1-Math.exp(-.25*t)),I=(6-1.5*v)/2,F=1.5*I;
   const i=labels.find(x=>/^I\s*=/.test(x.text)),f=labels.find(x=>/^F安\s*=/.test(x.text));
   check(i&&Math.abs(Number(i.text.match(/=\s*([\d.]+)/)?.[1])-I)<.025,name+': painted current inconsistent with analytical RL-free motional EMF model');
   check(f&&Math.abs(Number(f.text.match(/=\s*([\d.]+)/)?.[1])-F)<.025,name+': painted force inconsistent with actual current');
  }
  for(const l of labels)check(l.contrast!==null&&l.contrast>=4.5,name+': contrast '+l.text+' '+l.fill+' '+l.contrast);
  report.states.push({name,t,labels,image});
  await page.screenshot({path:path.join(out,name+'.png')});
 }
 await reset.click();await page.waitForTimeout(160);
 await record('initial-dark',false);
 for(let i=0;i<90;i++)await step.click();
 await page.waitForTimeout(200);
 check(Math.abs(await clock()-1.5)<.015,'90 deterministic manual steps not 1.5 s');
 await record('sampled-dark',false);
 await page.evaluate(()=>window.__h66E04Paint.splice(0));
 if(phase==='online'){
  await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='projector');
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
 }else await page.getByRole('button',{name:'黑板深蓝',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='projector');
 await page.waitForTimeout(200);
 await record('sampled-projector',true);
 if(phase==='online'){
  await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(300);
  const panel=await page.getByTestId('right-control-panel').boundingBox(),scope=await page.getByTestId('floating-scope-dock').boundingBox();
  check(panel&&scope&&scope.x+scope.width<=panel.x+.5,'compact scope overlaps inspector');
  await record('compact-projector',true);
  fs.mkdirSync(path.join(out,'reference'),{recursive:true});
  for(const f of fs.readdirSync('docs/ui-benchmark').filter(n=>n.endsWith('.png')))fs.copyFileSync(path.join('docs/ui-benchmark',f),path.join(out,'reference',f));
 }
 check(report.errors.length===0,'browser errors');check(report.network.length===0,'external network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(ctx)await ctx.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.issues.length)process.exitCode=1;
}
