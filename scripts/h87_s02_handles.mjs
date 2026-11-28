import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h87-s02');fs.mkdirSync(out,{recursive:true});
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
  // Observe before the last input, independently of screenshot/protocol latency.
  let activePointer=null,sequence=0,lastMove=0,raf=0;
  window.__s02Frames=[];
  function frame(){
   raf=0;if(activePointer===null)return;
   const hud=[...document.querySelectorAll('[data-testid="live-formula-hud"]')].find(n=>!n.hidden);
   const hudValue=Number(hud?.textContent?.match(/E:\s*([\d.]+)\s*V\/m/)?.[1]);
   const formula=[...document.querySelectorAll('[data-testid="fullscreen-formula"] annotation')].map(n=>n.textContent);
   window.__s02Frames.push({sequence,ms:performance.now()-lastMove,hudValue,paint:window.__s02Paint??null,eHandle:window.__s02HandleE??null,formula});
   raf=requestAnimationFrame(frame);
  }
  document.addEventListener('pointerdown',e=>{
   if(e.button!==0||!(e.target instanceof Element)||!e.target.closest('.pf-live-var'))return;
   if(raf)cancelAnimationFrame(raf);
   activePointer=e.pointerId;sequence=0;lastMove=performance.now();window.__s02Frames=[];
   window.__s02Sequence=sequence;raf=requestAnimationFrame(frame);
  },true);
  document.addEventListener('pointermove',e=>{
   if(e.pointerId!==activePointer||e.buttons!==1)return;
   sequence++;lastMove=performance.now();window.__s02Sequence=sequence;
  },true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{
   if(e.pointerId!==activePointer)return;
   activePointer=null;if(raf)cancelAnimationFrame(raf);raf=0;
  },true);
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'){
    if(text.startsWith('速度选择器 v_sel = E/B = '))window.__s02Paint=text;
    if(/^E=[0-9.]+×10⁵ V\/m$/.test(text))window.__s02HandleE=text;
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
   const expected=preview/B;
   const [mantissa,exponent]=expected.toExponential(3).split('e');
   const latex='v_s='+(Number(exponent)===0?mantissa:mantissa+'\\times10^{'+Number(exponent)+'}')+'\\text{ m/s}';
   const handle='E='+(preview/1e5).toFixed(1)+'×10⁵ V/m';
   const series=await page.evaluate(({preview,rounded,latex,handle})=>new Promise(resolve=>{
    const sequence=window.__s02Sequence,start=performance.now();
    function sample(){
     const all=(window.__s02Frames??[]).filter(s=>s.sequence===sequence);
     const samples=all.map(s=>({...s,match:s.hudValue===preview&&s.paint?.includes('= '+rounded+' m/s')&&s.formula.includes(latex)&&s.eHandle===handle}));
     let stable=0,firstMatch=null,reverted=false;
     for(const s of samples){
      if(s.match){stable++;if(firstMatch===null)firstMatch=s.ms;}
      else{if(firstMatch!==null)reverted=true;stable=0;}
     }
     if(stable>=3||performance.now()-start>=400)resolve({sequence,samples,firstMatch,stable,reverted,firstSample:samples[0]?.ms??null});else requestAnimationFrame(sample);
    }sample();
   }),{preview,rounded:expected.toFixed(0),latex,handle});
   report.hold??=[];report.hold.push({width,preview,B,expected,latex,handle,...series});
   check(series.stable>=3,width+': held pointer HUD, actual Canvas E, Canvas v and formula converge for three frames');
   check(series.firstMatch!==null&&series.firstMatch<=250,width+': held preview convergence <=250 ms from last pointer move');
   check(series.sequence>0&&series.firstSample!==null&&series.firstSample<=80,width+': early frame sampling after actual pointer move');
   check(!series.reverted,width+': no held-value reversion after first matching sample');
   await page.screenshot({path:path.join(out,width+'-held.png')});
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
  const beginPath=CanvasRenderingContext2D.prototype.beginPath;
  const moveTo=CanvasRenderingContext2D.prototype.moveTo;
  const lineTo=CanvasRenderingContext2D.prototype.lineTo;
  const rect=CanvasRenderingContext2D.prototype.rect;
  const arc=CanvasRenderingContext2D.prototype.arc;
  const fill=CanvasRenderingContext2D.prototype.fill;
  const sim=c=>c.canvas.dataset.testid==='simulation-canvas';
  CanvasRenderingContext2D.prototype.beginPath=function(...args){
   if(sim(this)){this.__h86Path=[];this.__h86Rects=[];this.__h87Arc=null;}
   return beginPath.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.moveTo=function(x,y){
   if(sim(this)) (this.__h86Path??=[]).push({kind:'move',x,y});
   return moveTo.call(this,x,y);
  };
  CanvasRenderingContext2D.prototype.lineTo=function(x,y){
   if(sim(this)) (this.__h86Path??=[]).push({kind:'line',x,y});
   return lineTo.call(this,x,y);
  };
  CanvasRenderingContext2D.prototype.rect=function(x,y,w,h){
   if(sim(this)) (this.__h86Rects??=[]).push({x,y,w,h});
   return rect.call(this,x,y,w,h);
  };
  CanvasRenderingContext2D.prototype.arc=function(x,y,r,...rest){
   if(sim(this))this.__h87Arc={x,y,r};
   return arc.call(this,x,y,r,...rest);
  };
  CanvasRenderingContext2D.prototype.fill=function(...args){
   if(sim(this)&&this.__h87Arc&&[7,9].includes(this.__h87Arc.r)){
    const item={...this.__h87Arc,color:this.fillStyle};
    window.__h87Markers??={};window.__h87Markers[JSON.stringify(item)]=item;
   }
   return fill.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.stroke=function(...args){
   if(this.canvas.dataset.testid==='simulation-canvas'){
    window.__s02Strokes??={};
    if(typeof this.strokeStyle==='string')window.__s02Strokes[this.strokeStyle]=true;
    window.__h86Paths??={};
    const record={color:this.strokeStyle,points:this.__h86Path??[],rects:this.__h86Rects??[]};
    if(record.points.length||record.rects.length)window.__h86Paths[JSON.stringify(record)]=record;
   }
   return stroke.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'){
    window.__s02Labels??={};
    const m=this.measureText(text);
    window.__s02Labels[text]={color:this.fillStyle,x:args[0],y:args[1],width:m.width,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent,left:args[0]-m.actualBoundingBoxLeft,right:args[0]+m.actualBoundingBoxRight,top:args[1]-m.actualBoundingBoxAscent,bottom:args[1]+m.actualBoundingBoxDescent,align:this.textAlign};
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
    await page.evaluate(()=>{window.__s02Readouts={};window.__s02Labels={};window.__s02Strokes={};window.__h86Paths={};window.__h87Markers={};});
    await page.getByTestId('btn-fullscreen-speech').click();
    await page.getByTestId('fullscreen-formula').waitFor({state:'visible'});
    await page.waitForFunction(({prefix,color})=>window.__s02Readouts?.[102]?.text?.startsWith(prefix)&&window.__s02Readouts?.[120]&&window.__s02Readouts?.[102]?.color===color,{prefix,color:theme==='projector'?'#0f172a':'#e2e8f0'});
    const g=await page.evaluate(()=>{
     const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
     return {canvas:rect('[data-testid="simulation-canvas"]'),title:rect('[data-testid="fullscreen-title"]'),panel:rect('[data-testid="fullscreen-formula"]'),readouts:window.__s02Readouts,labels:window.__s02Labels,strokes:Object.keys(window.__s02Strokes||{}),paths:Object.values(window.__h86Paths||{}),markers:Object.values(window.__h87Markers||{})};
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
    const bHandle=Object.entries(g.labels).filter(([k])=>/^B=[0-9.]+ T$/.test(k));
    const eHandle=Object.entries(g.labels).filter(([k])=>/^E=[0-9.]+×10⁵ V\/m$/.test(k));
    check(bHandle.length===1,prefixKey+': one actual B control label');
    check(eHandle.length===(device==='velocity-selector'?1:0),prefixKey+': correct E control label count');
    for(const [label,item] of [...bHandle,...eHandle]){
     const b=label.startsWith('B='),expected=light?(b?'#075985':'#92400e'):(b?'#38bdf8':'#fbbf24');
     check(item.color===expected,prefixKey+': idle handle text '+label);
     if(light)check(ratio(item.color)>=4.5,prefixKey+': idle handle contrast '+label);
     const marker=g.markers.find(m=>Math.abs(m.x-(item.x-10))<.01&&Math.abs(m.y-(item.y-4))<.01&&m.r===7&&m.color===expected);
     check(!!marker,prefixKey+': actual filled handle marker '+label);
    }
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
    if(device==='mhd-generator'){
     const current=g.labels['I外'],load=g.labels['外负载 R'],channel=g.labels['导电流体通道'],lower=Object.entries(g.labels).find(([l])=>l.startsWith('下 '))?.[1];
     const arrow=g.paths.filter(p=>p.color===(light?'#166534':'#4ade80')&&p.points.length===5&&p.points[0].kind==='move'&&p.points[1].kind==='line'&&p.points[2].kind==='move'&&p.points[0].y===p.points[1].y).sort((a,b)=>Math.abs(b.points[1].x-b.points[0].x)-Math.abs(a.points[1].x-a.points[0].x))[0];
     const copper=g.paths.filter(p=>p.color===(light?'#b45309':'#d97706')).flatMap(p=>p.rects);
     const electrodes=copper.filter(r=>r.w>r.h*15);
     const bottomEdge=Math.max(...electrodes.map(r=>r.y+r.h));
     check(!!current&&!!lower&&!!arrow&&electrodes.length>=2,prefixKey+': captured actual arrow and electrode');
     if(current&&lower&&arrow&&electrodes.length>=2){
      const arrowRight=Math.max(arrow.points[0].x,arrow.points[1].x);
      const readoutBottom=g.readouts[120].y+g.readouts[120].descent;
      check(current.left>=arrowRight+5,prefixKey+': current label clear of arrow end');
      check(current.top>=readoutBottom+3,prefixKey+': current label clear of secondary readout');
      check(current.right<=g.panel.left-g.canvas.left-8,prefixKey+': current label before formula panel');
      check(current.right<=load.left-4||current.left>=load.right+4||current.bottom<=load.top-4||current.top>=load.bottom+4,prefixKey+': current label clear of load label');
      check(lower.top>=bottomEdge+3,prefixKey+': lower terminal below copper electrode');
      check(lower.bottom<=channel.top-3,prefixKey+': lower terminal above channel caption');
      report.clearance??=[];report.clearance.push({width,theme,current,lower,arrowRight,readoutBottom,bottomEdge,channelTop:channel.top});
     }
    }
    delete g.paths;
    report.layout.push({width,theme,device,...g});
    await page.screenshot({path:path.join(out,width+'-'+theme+'-'+device+'.png')});
    await page.getByTestId('btn-exit-fullscreen-speech').click();
   }
  }
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-layout-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}

async function handleCase(base,width){
 const ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'&&/^[BE]=[0-9.]+/.test(text)){
    const key=text[0];window.__h87Controls??={};window.__h87Controls[key]={text,x,y,color:this.fillStyle,baseline:this.textBaseline};
   }
   return original.call(this,text,x,y,...args);
  };
 });
 try{
  await page.goto(base+'?model=stse-em-devices-suite&preset=velocity-selector-spectrometer',{waitUntil:'networkidle'});
  const bSlider=page.getByTestId('param-slider-bFieldT'),eSlider=page.getByTestId('param-slider-eFieldVPerM');
  const before={B:Number(await bSlider.inputValue()),E:Number(await eSlider.inputValue())};
  await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.getByTestId('btn-fullscreen-speech').click();
  await page.waitForFunction(()=>window.__h87Controls?.B?.color==='#075985'&&window.__h87Controls?.E?.color==='#92400e');
  const canvas=page.getByTestId('simulation-canvas');
  const box=await canvas.boundingBox();if(!box)throw Error('missing canvas');
  const controls=await page.evaluate(()=>window.__h87Controls);
  const scale=Math.abs(controls.B.x-controls.E.x)/2.93;
  check(scale>0,width+': measured Canvas scale');
  const result={width,before,scale,drags:[]};
  for(const key of ['B','E']){
   const idle=await page.evaluate(k=>window.__h87Controls[k],key);
   const x=box.x+idle.x-10,y=box.y+idle.y-4;
   await page.mouse.move(x,y);
   const hoverColor=key==='B'?'#38bdf8':'#fbbf24';
   await page.waitForFunction(({key,hoverColor})=>window.__h87Controls?.[key]?.color===hoverColor&&window.__h87Controls[key].baseline==='middle',{key,hoverColor});
   await page.screenshot({path:path.join(out,width+'-projector-'+key+'-hover.png')});
   await page.mouse.down();
   try{await page.mouse.move(x,y-20,{steps:4});}finally{await page.mouse.up();}
   await page.mouse.move(box.x+30,box.y+box.height/2);
   const expected=key==='B'?Math.round((before.B+20/scale/1.2*3.8)*10)/10:Math.round((before.E+20/scale/1.2*4.9e5)/1e4)*1e4;
   const expectedText=key==='B'?'B='+expected.toFixed(1)+' T':'E='+(expected/1e5).toFixed(1)+'×10⁵ V/m';
   await page.waitForFunction(({key,expectedText})=>window.__h87Controls?.[key]?.text===expectedText&&window.__h87Controls[key].baseline==='alphabetic',{key,expectedText});
   const afterPaint=await page.evaluate(k=>window.__h87Controls[k],key);
   result.drags.push({key,expected,expectedText,afterPaint});
  }
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  const after={B:Number(await bSlider.inputValue()),E:Number(await eSlider.inputValue())};
  check(after.B===result.drags[0].expected,width+': B final actual slider matches geometric drag');
  check(after.E===result.drags[1].expected,width+': E final actual slider matches geometric drag');
  report.handles??=[];report.handles.push({...result,after});
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-handle-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
async function lifecycleCase(base){
 const ctx=await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 await page.addInitScript(()=>{
  window.__pfPointerId=null;window.__pfCaptureEvents=[];
  document.addEventListener('pointerdown',e=>{window.__pfPointerId=e.pointerId;window.__pfCaptureEvents=[];},true);
  for(const type of ['gotpointercapture','lostpointercapture','pointercancel']){
   document.addEventListener(type,e=>window.__pfCaptureEvents.push({type:e.type,pointerId:e.pointerId,trusted:e.isTrusted,target:e.target?.className?.toString()}),true);
  }
 });
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
   let preview,eventsBeforeExit=[];
   try{
    await page.mouse.move(x+(before>300000?-60:60),y,{steps:6});
    await hud.waitFor({state:'visible'});
    preview=Number((await hud.innerText()).match(/E:\s*([\d.]+)\s*V\/m/)?.[1]);
    check(Number.isFinite(preview)&&preview!==before,kind+': changed finite preview');
    if(kind==='unmount'){
     await page.getByTestId('btn-exit-fullscreen-speech').evaluate(n=>n.click());
     await page.getByTestId('fullscreen-title').waitFor({state:'hidden'});
    }else{
     if(kind==='lostpointercapture'){
      // Chromium processes pending capture changes before the next pointer
      // event. Exercise a trusted pointermove while the button is still down,
      // not pointerup (which would conceal a missing lostcapture handler).
      const capture=await token.evaluate(n=>{const el=n.closest('.pf-live-var')??n;const id=window.__pfPointerId;const held=el.hasPointerCapture(id);if(held)el.releasePointerCapture(id);return {held,id};});
      check(capture.held,kind+': actual capture held before release');
      await page.mouse.move(x+(before>300000?-61:61),y);
      await page.waitForFunction(id=>window.__pfCaptureEvents.some(e=>e.type==='lostpointercapture'&&e.trusted&&e.pointerId===id),capture.id,{timeout:3000});
     }else{
      await token.evaluate(n=>{const el=n.closest('.pf-live-var')??n;el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__pfPointerId,bubbles:true}));});
     }
     await hud.waitFor({state:'hidden'});
    }
   }finally{eventsBeforeExit=await page.evaluate(()=>window.__pfCaptureEvents);await page.mouse.up();}
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
   report.lifecycle.push({kind,before,preview,after,stable,eventsBeforeExit,eventsAfterExit:await page.evaluate(()=>window.__pfCaptureEvents)});
   await page.screenshot({path:path.join(out,'lifecycle-'+kind+'.png')});
  }
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,'lifecycle-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';browser=await chromium.launch({headless:true});await run(base,1440);await run(base,1024);await layoutCase(base,1440);await layoutCase(base,1024);await lifecycleCase(base);await handleCase(base,1440);await handleCase(base,1024);}
catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==2||report.hold?.length!==2||report.layout.length!==24||report.lifecycle.length!==3||report.clearance?.length!==4||report.handles?.length!==2)throw Error(JSON.stringify(report));
console.log('H87 S02 actual handle paint, direct drag, MHD label clearance and pointer lifecycle verified');
