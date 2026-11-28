import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h84-s02');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],layout:[],lifecycle:[],issues:[],errors:[],external:[]};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
let browser;
async function run(base,width){
 const ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'){
    if(text.startsWith('速度选择器 v_sel = E/B = '))window.__s02Paint=text;
    if(args[1]===102||args[1]===120){
     const m=this.measureText(text),w=Math.min(m.width,args[2]??Infinity);
     window.__s02Readouts??={};
     window.__s02Readouts[args[1]]={text,x:args[0],y:args[1],width:w,naturalWidth:m.width,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent,color:this.fillStyle};
    }
   }
   return original.call(this,text,...args);
  };
 });
 try{
  await page.goto(base+'?model=stse-em-devices-suite&preset=velocity-selector-spectrometer',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='stse-em-devices-suite');
  const slider=page.getByTestId('param-slider-eFieldVPerM'),bSlider=page.getByTestId('param-slider-bFieldT');
  const before=Number(await slider.inputValue()),B=Number(await bSlider.inputValue());
  check(Number.isFinite(before)&&Number.isFinite(B)&&B>0,width+': finite inputs');
  await page.getByTestId('btn-fullscreen-speech').click();
  const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
  const hud=page.locator('[data-testid="live-formula-hud"]:visible');
  await token.waitFor({state:'visible'});await token.evaluate(n=>window.__s02Token=n);
  const rect=await token.boundingBox();if(!rect)throw Error('token missing bounds');
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  let preview,previewText;
  try{
   await page.mouse.move(x+(before>300000?-60:60),y,{steps:8});
   await hud.waitFor({state:'visible'});
   previewText=await hud.innerText();
   preview=Number(previewText.match(/E:\s*([\d.]+)\s*V\/m/)?.[1]);
   check(previewText.startsWith('预览 ·'),width+': explicit preview label');
   check(Number.isFinite(preview)&&preview!==before,width+': changed finite preview');
   check(await token.evaluate(n=>n===window.__s02Token),width+': KaTeX identity');
   await page.screenshot({path:path.join(out,width+'-drag.png')});
  }finally{await page.mouse.up();}
  await hud.waitFor({state:'hidden'});
  const expected=preview/B;
  const [mantissa,exponent]=expected.toExponential(3).split('e');
  const latex='v_s='+(Number(exponent)===0?mantissa:mantissa+'\\times10^{'+Number(exponent)+'}')+'\\text{ m/s}';
  await page.waitForFunction(({rounded,latex})=>{
   const painted=window.__s02Paint?.includes('= '+rounded+' m/s');
   const rendered=[...document.querySelectorAll('[data-testid="fullscreen-formula"] annotation')].some(n=>n.textContent===latex);
   return painted&&rendered;
  },{rounded:expected.toFixed(0),latex},{timeout:10000});
  const paint=await page.evaluate(()=>window.__s02Paint);
  await page.screenshot({path:path.join(out,width+'-released.png')});
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  const after=Number(await slider.inputValue());
  check(after===preview,width+': final slider equals final preview');
  check(Number(await bSlider.inputValue())===B,width+': B unchanged');
  report.cases.push({width,before,B,previewText,preview,after,expected,paint,latex});
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}

async function layoutCase(base,width){
 const ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.fillText;
  const stroke=CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.stroke=function(...args){
   if(this.canvas.dataset.testid==='simulation-canvas'){
    window.__s02Strokes??={};
    if(typeof this.strokeStyle==='string')window.__s02Strokes[this.strokeStyle]=true;
   }
   return stroke.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'){
    window.__s02Labels??={};
    const m=this.measureText(text);
    window.__s02Labels[text]={color:this.fillStyle,x:args[0],y:args[1],width:m.width,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent};
   }
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'&&(args[1]===102||args[1]===120)){
    const m=this.measureText(text);
    window.__s02Readouts??={};
    window.__s02Readouts[args[1]]={text,x:args[0],y:args[1],width:Math.min(m.width,args[2]??Infinity),naturalWidth:m.width,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent,color:this.fillStyle};
   }
   return original.call(this,text,...args);
  };
 });
 const devicePrefixes={'velocity-selector':'速度选择器','mass-spectrometer':'质谱仪','cyclotron':'当前 K=','hall-sensor':'霍尔电压','mhd-generator':'磁流体发电机','em-flowmeter':'电磁流量计'};
 try{
  await page.goto(base+'?model=stse-em-devices-suite&preset=velocity-selector-spectrometer',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='stse-em-devices-suite');
  for(const theme of ['chalkboard','projector']){
   if(theme==='projector'){
    await page.getByTestId('btn-tools-menu').click();
    await page.getByTestId('btn-theme').click();
    const menu=page.getByTestId('tools-menu');
    if(await menu.isVisible())await page.getByTestId('btn-tools-menu').click();
   }
   for(const [device,prefix] of Object.entries(devicePrefixes)){
    const select=page.locator('#param-device');
    if(!await select.isVisible()){
     await page.locator('summary').filter({hasText:'更多参数与图层'}).click();
    }
    await select.waitFor({state:'visible'});
    await select.selectOption(device);
    check(await select.inputValue()===device,width+'/'+theme+'/'+device+': actual selector value');
    await page.evaluate(()=>{window.__s02Readouts={};window.__s02Labels={};window.__s02Strokes={};});
    await page.getByTestId('btn-fullscreen-speech').click();
    await page.getByTestId('fullscreen-formula').waitFor({state:'visible'});
    await page.waitForFunction(({prefix,color})=>window.__s02Readouts?.[102]?.text?.startsWith(prefix)&&window.__s02Readouts?.[120]&&window.__s02Readouts?.[102]?.color===color,{prefix,color:theme==='projector'?'#0f172a':'#e2e8f0'});
    const g=await page.evaluate(()=>{
     const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
     return {canvas:rect('[data-testid="simulation-canvas"]'),title:rect('[data-testid="fullscreen-title"]'),panel:rect('[data-testid="fullscreen-formula"]'),readouts:window.__s02Readouts,labels:window.__s02Labels,strokes:Object.keys(window.__s02Strokes||{})};
    });
    for(const [key,line] of Object.entries(g.readouts)){
     const left=g.canvas.left+line.x-line.width/2,right=g.canvas.left+line.x+line.width/2,top=g.canvas.top+line.y-line.ascent,bottom=g.canvas.top+line.y+line.descent;
     const label=width+'/'+theme+'/'+device+'/'+key;
     check(left>=g.canvas.left+16&&right<=g.panel.left-8,label+': horizontal safe area');
     check(top>=g.title.bottom+8,label+': below actual title');
     check(bottom<g.canvas.bottom,label+': inside canvas');
     check(line.width/line.naturalWidth>=.85,label+': readable text width');
     check(line.color===(theme==='projector'?(key==='102'?'#0f172a':'#475569'):(key==='102'?'#e2e8f0':'#94a3b8')),label+': readout palette');
    }
    // Match semantic labels from the source geometry rather than arbitrary
    // browser text; record actual Canvas paint styles in both themes.
    const annotations={
     'velocity-selector':['正交电磁场 · 正电荷'],
     'mass-spectrometer':['入射区','偏转场 B₂','探测板'],
     'cyclotron':['D 形盒 · 理想零宽狭缝','RF'],
     'hall-sensor':['横向电势差 U_H','U_H=V下−V上 · 稳态漂移示意'],
     'mhd-generator':['外负载 R','导电流体通道','U=V下−V上 · 负载端电压'],
     'em-flowmeter':['测量电极 · 感生电压 U','圆管截面 · 体积流量 Q','U=V下−V上 · 开路测量']
    };
    const cues={
     'velocity-selector':[['E','#92400e','#fbbf24']],
     'mass-spectrometer':[['v','#047857','#a7f3d0']],
     'cyclotron':[],
     'hall-sensor':[['I','#166534','#4ade80'],['电子漂移','#047857','#a7f3d0'],['E_H','#92400e','#fbbf24'],['F洛','#be123c','#fb7185']],
     'mhd-generator':[['v','#047857','#a7f3d0'],['I外','#166534','#4ade80']],
     'em-flowmeter':[['v','#047857','#a7f3d0']]
    };
    const prefixKey=width+'/'+theme+'/'+device;
    const light=theme==='projector';
    const ratio=(hex)=>{
     if(!/^#[0-9a-f]{6}$/i.test(hex||''))return 0;
     const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
     return 1.05/(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]+.05);
    };
    for(const label of annotations[device]){
     check(g.labels[label]?.color===(light?'#334155':'#94a3b8'),prefixKey+': annotation '+label);
     if(light)check(ratio(g.labels[label]?.color)>=4.5,prefixKey+': white contrast '+label);
    }
    for(const [label,paper,dark] of cues[device]){
     check(g.labels[label]?.color===(light?paper:dark),prefixKey+': cue '+label);
     check(g.strokes.includes(light?paper:dark),prefixKey+': vector stroke '+label);
     if(light)check(ratio(g.labels[label]?.color)>=4.5,prefixKey+': cue white contrast '+label);
    }
    check(g.strokes.includes(light?'#075985':'#38bdf8'),prefixKey+': magnetic field stroke');
    if(['hall-sensor','mhd-generator','em-flowmeter'].includes(device)){
     const terminals=Object.entries(g.labels).filter(([label])=>/^(上|下) /.test(label));
     check(terminals.length===2,prefixKey+': actual terminal count');
     for(const [label,item] of terminals){
      check(item.color===(light?'#0f172a':'#f8fafc'),prefixKey+': terminal '+label);
      if(light)check(ratio(item.color)>=4.5,prefixKey+': terminal contrast '+label);
     }
    }
    report.layout.push({width,theme,device,...g});
    await page.screenshot({path:path.join(out,width+'-'+theme+'-'+device+'.png')});
    await page.getByTestId('btn-exit-fullscreen-speech').click();
   }
  }
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-layout-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
async function lifecycleCase(base){
 const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 await page.addInitScript(()=>{window.__pfPointerId=null;document.addEventListener('pointerdown',e=>{window.__pfPointerId=e.pointerId;},true);});
 try{
  await page.goto(base+'?model=stse-em-devices-suite&preset=velocity-selector-spectrometer',{waitUntil:'networkidle'});
  const slider=page.getByTestId('param-slider-eFieldVPerM');
  for(const kind of ['pointercancel','lostpointercapture','unmount']){
   const before=Number(await slider.inputValue());
   await page.getByTestId('btn-fullscreen-speech').click();
   const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
   const hud=page.locator('[data-testid="live-formula-hud"]:visible');
   await token.waitFor({state:'visible'});
   const r=await token.boundingBox();if(!r)throw Error('token missing');
   const x=r.x+r.width/2,y=r.y+r.height/2;
   await page.mouse.move(x,y);await page.mouse.down();
   let preview;
   try{
    await page.mouse.move(x+(before>300000?-60:60),y,{steps:6});
    await hud.waitFor({state:'visible'});
    preview=Number((await hud.innerText()).match(/E:\s*([\d.]+)\s*V\/m/)?.[1]);
    check(Number.isFinite(preview)&&preview!==before,kind+': changed finite preview');
    if(kind==='unmount'){
     await page.getByTestId('btn-exit-fullscreen-speech').evaluate(n=>n.click());
     await page.getByTestId('fullscreen-title').waitFor({state:'hidden'});
    }else{
     await token.evaluate((n,type)=>{const el=n.closest('.pf-live-var')??n;const id=window.__pfPointerId;if(type==='lostpointercapture'&&el.hasPointerCapture(id))el.releasePointerCapture(id);else el.dispatchEvent(new PointerEvent(type,{pointerId:id,bubbles:true}));},kind);
     await hud.waitFor({state:'hidden'});
    }
   }finally{await page.mouse.up();}
   await hud.waitFor({state:'hidden'});
   if(kind!=='unmount')await page.getByTestId('btn-exit-fullscreen-speech').click();
   const after=Number(await slider.inputValue());
   // A cancellation can commit the last pending preview; an unmount can retain
   // the last already-applied value, but neither may write after the mode change.
   if(kind!=='unmount')check(after===preview,kind+': pending preview committed on end');
   else check(Number.isFinite(after)&&after>=Math.min(before,preview)&&after<=Math.max(before,preview),kind+': only already applied drag range');
   await page.waitForTimeout(180);
   const stable=Number(await slider.inputValue());
   check(stable===after,kind+': no late write after teardown');
   report.lifecycle.push({kind,before,preview,after,stable});
   await page.screenshot({path:path.join(out,'lifecycle-'+kind+'.png')});
  }
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,'lifecycle-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';browser=await chromium.launch({headless:true});await run(base,1440);await run(base,1024);await layoutCase(base,1440);await layoutCase(base,1024);await lifecycleCase(base);}
catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==2||report.layout.length!==24||report.lifecycle.length!==3)throw Error(JSON.stringify(report));
console.log('H84 S02 readout geometry and pointer lifecycle verified');
