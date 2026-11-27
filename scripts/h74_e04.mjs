import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const phase=process.env.PHASE, head=process.env.SOURCE_HEAD;
if(!head||!['online','offline'].includes(phase))throw Error('Exact phase and source required');
if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/e04-presets');fs.mkdirSync(out,{recursive:true});
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
 const presets=[
  {id:'double-rod-momentum-conservation',double:true},
  {id:'double-rod-constant-force',double:true,external:true},
  {id:'single-rod-capacitor',load:'电容 C'},
  {id:'single-rod-battery-drive',load:'电源 E'},
  {id:'unequal-double-rod-momentum',double:true,unequal:true},
  {id:'single-rod-ideal-cap-constant-force',load:'电容 C',external:true}
 ];
 async function setTheme(projector){
  const target=projector?'projector':'chalkboard';
  if(await page.evaluate(()=>document.documentElement.dataset.theme)===target)return;
  if(phase==='online'){
   await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
   if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  }else await page.getByRole('button',{name:projector?'黑板深蓝':'投影白底',exact:true}).click();
  await page.waitForFunction(t=>document.documentElement.dataset.theme===t,target);
 }
 async function select(preset){
  if(phase==='online')await page.getByTestId('preset-select').selectOption(preset);
  else await page.locator('[data-preset-id="'+preset+'"]').click();
  await page.waitForTimeout(120);
  check(Math.abs(await clock())<.001,'preset did not reset '+preset);
 }
 async function record(preset,projector,zero=false){
  const id=preset.id+(zero?'-B0':'')+'-'+(projector?'paper':'dark');
  const paint=await page.evaluate(()=>window.__h66E04Paint.slice());
  const relevant=paint.filter(x=>/^(?:F安|I\s*=|电源 E|电阻 R|电容 C|杆2|F外|不同杆长|B\s*=|v(?:₁)?\s*=)/.test(x.text));
  // One frame's last value per semantic annotation (not stale prior preset values).
  const key=x=>x.text.startsWith('杆2')?'杆2':x.text.split(' = ')[0];
  const labels=[...new Map(relevant.map(x=>[key(x),x])).values()].map(x=>({...x,
    height:Number(x.font.match(/([\d.]+)px/)?.[1])||13,
    contrast:contrast(x.fill,projector?[255,255,255]:phase==='online'?[19,25,31]:[9,18,32])}));
  const bounds=await canvas.boundingBox();
  const panel=phase==='online'?await page.getByTestId('right-control-panel').boundingBox():null;
  const safeRight=panel?panel.x-bounds.x:bounds.width;
  const rects=labels.map(x=>({text:x.text,left:x.x-x.width/2,right:x.x+x.width/2,top:x.y-x.height/2,bottom:x.y+x.height/2}));
  for(let i=0;i<labels.length;i++){
    const l=labels[i],r=rects[i];
    check(l.contrast!==null&&l.contrast>=4.5,id+': contrast '+l.text);
    check(r.left>=0&&r.right<=safeRight+1&&r.top>=0&&r.bottom<=bounds.height,id+': label clipped '+l.text);
    for(let j=0;j<i;j++){const q=rects[j];const dx=Math.min(q.right,r.right)-Math.max(q.left,r.left),dy=Math.min(q.bottom,r.bottom)-Math.max(q.top,r.top);
      check(dx<1||dy<1,id+': label overlap '+q.text+' / '+r.text);
    }
  }
  if(preset.double)check(labels.some(x=>x.text.startsWith('杆2')),id+': rod2 label missing');
  else check(labels.some(x=>x.text===preset.load),id+': load label missing');
  if(preset.unequal)check(labels.some(x=>x.text.startsWith('不同杆长')),id+': unequal-rail disclosure missing');
  if(preset.external)check(labels.some(x=>x.text==='F外'),id+': external force label missing');
  const field=labels.find(x=>x.text.startsWith('B ='));
  const bSlider=await page.getByTestId(phase==='online'?'param-slider-magneticB':'sf-param-magneticB').inputValue();
  check(field&&Math.abs(Number(field.text.match(/=\s*([\d.]+)/)?.[1])-Math.abs(Number(bSlider)))<.005,id+': missing or wrong B magnitude');
  check(field&&(zero?field.text==='B = 0 T':field.text.includes(Number(bSlider)>0?'垂直纸面向里':'垂直纸面向外')),id+': wrong field direction');
  if(zero){
    check(!labels.some(x=>x.text.startsWith('F安')),id+': false magnetic force at B=0');
    const i=labels.find(x=>x.text.startsWith('I ='));
    check(i&&Math.abs(Number(i.text.match(/=\s*([\d.]+)/)?.[1])-3)<.011,id+': B=0 battery current must remain 3 A');
  }
  const image=await canvas.evaluate(c=>{
    const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let alphaHoles=0;for(let i=3;i<data.length;i+=4)if(data[i]!==255)alphaHoles++;
    return {width:c.width,height:c.height,alphaHoles};
  });
  check(image.alphaHoles===0,id+': canvas alpha holes');
  const t=await clock();check(Math.abs(t-.4)<.011,id+': expected 24 manual steps = .4s');
  report.states.push({name:id,t,labels,image,safeRight});
  await page.screenshot({path:path.join(out,id+'.png')});
 }
 for(const preset of presets){
  await setTheme(false);await select(preset.id);
  await page.evaluate(()=>window.__h66E04Paint.splice(0));
  for(let i=0;i<24;i++)await step.click();
  await page.waitForTimeout(140);
  await record(preset,false);
  await page.evaluate(()=>window.__h66E04Paint.splice(0));
  await setTheme(true);await page.waitForTimeout(140);
  await record(preset,true);
 }
 const battery=presets.find(x=>x.id==='single-rod-battery-drive');
 await setTheme(false);await select(battery.id);
 const b=page.getByTestId(phase==='online'?'param-slider-magneticB':'sf-param-magneticB');
 await b.focus();await b.press('Home');
 await page.waitForFunction(testid=>Number(document.querySelector('[data-testid="'+testid+'"]')?.value)===0,phase==='online'?'param-slider-magneticB':'sf-param-magneticB');
 await reset.click();await page.waitForTimeout(100);
 await page.evaluate(()=>window.__h66E04Paint.splice(0));
 for(let i=0;i<24;i++)await step.click();
 await page.waitForTimeout(140);
 await record(battery,false,true);
 check(report.errors.length===0,'browser errors');check(report.network.length===0,'external network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(ctx)await ctx.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.issues.length)process.exitCode=1;
}
