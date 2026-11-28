import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,w=Number(process.env.WIDTH),kind=process.env.POINTER;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head||![1024,1440].includes(w)||!['mouse','touch'].includes(kind))throw Error('wrong audit inputs');
const out=path.resolve('evidence/h88-formula-centers');fs.mkdirSync(out,{recursive:true});
const report={head,w,kind,cases:[],issues:[],errors:[],external:[],scroll:null,eDrag:null};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);return !!ok;};
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
const B1='builder-composite-em-field',B2='builder-circuit-mna',B3='builder-optics-ray',E04='em-induction-double-rod',M10='astro-orbital-mechanics',E10='em-3d-magnetic-fields',S01='stse-tokamak-magnetic-mirror',S02='stse-em-devices-suite';
// Expected multiset is manually transcribed from the exact plugin liveFormulaSpecs,
// not generated from the DOM under test. Repeated parameter occurrences count separately.
const cases=[
 [B1,'circle-magnetic-focusing',{'larmor-initial':['mass','initialSpeed','charge','magneticFieldZ']}],
 [B1,'crossed-eb-cycloid',{'crossed-field-drift':['electricFieldY','magneticFieldZ']}],
 [B2,'closed-circuit-max-power',{'linear-dc':['emf','internalR'],'closed-power':['emf','sliderR','internalR']}],
 [B2,'divider-lamp-measurement',{'linear-dc':['emf','internalR'],'resistor-network':['r1','r2','sliderR']},['topology','series-parallel-dynamic']],
 [B2,'rc-charging-curve',{'capacitor-charge':['capacitance']}],
 [B2,'nonlinear-diode-iv',{'nonlinear-kvl':['emf','internalR','sliderR']}],
 [B3,'tir-water-air',{'snell':['n1','incidentAngleDeg','n2']}],
 [B3,'parallel-glass-slab',{'slab-snell':['incidentAngleDeg','n1'],'slab-offset':['slabThickness']}],
 [B3,'prism-dispersion',{'prism-apex':['prismApexDeg']}],
 [B3,'optical-fiber',{'fiber-critical-angle':['n2','n1']}],
 [B3,'double-slit-interference',{'young-fringe-spacing':['screenDistanceM','wavelengthNm','slitSeparationMm']}],
 [B3,'thin-lens-real-image',{'thin-lens':['objectDistanceM','focalLengthM']}],
 [E04,'double-rod-momentum-conservation',{'rod-emf':['magneticB','railWidth'],'double-rod-current':['magneticB','railWidth','resistorR']}],
 [E04,'single-rod-capacitor',{'rod-emf':['magneticB','railWidth'],'single-resistor-ampere':['magneticB','railWidth','resistorR','rodResistance1']},['circuitLoad','resistor']],
 [M10,'hohmann-geo-transfer',{'hohmann-first-burn':['r2OverR1','r2OverR1'],'circular-speed':['r1Ratio']}],
 [M10,'binary-lagrange-roche',{'binary-barycenter':['massRatioQ']}],
 [E10,'finite-solenoid-3d',{'biot-savart-current':['currentI']}],
 [E10,'uniform-3d-helical-pitch',{'uniform-gyro-frequency':['qOverM','uniformBz','vPerp'],'uniform-parallel-velocity':['vParallel']}],
 [S01,'mirror-trapped-bounce',{'mirror-ratio':['coilHalfSpanM','mirrorLengthM'],'mirror-pitch':['speed0','pitchAngleDeg'],'mirror-axial-field':['b0Tesla','mirrorLengthM']}],
 [S01,'tokamak-helical-confinement',{'tokamak-toroidal-field':['b0Tesla','majorRadiusM']}],
 [S02,'velocity-selector-spectrometer',{'velocity-selector':['eFieldVPerM','bFieldT']}],
 [S02,'cyclotron-classic-vs-rel',{'cyclotron-energy':['bFieldT','cyclotronRadiusM'],'cyclotron-gap-energy':['cyclotronVoltageV']}],
 [S02,'velocity-selector-spectrometer',{'spectrometer-radius':['massKg','particleSpeedMps','chargeC','bDeflectT']},['device','mass-spectrometer']],
 [S02,'hall-electron-vs-hole',{'hall-voltage':['hallCurrentA','bFieldT','hallDensityPerM3','hallThicknessM']}],
 [S02,'mhd-peak-power',{'mhd-emf':['bFieldT','mhdDuctWidthM','particleSpeedMps'],'mhd-load-power':['mhdPlasmaResOhmM','mhdDuctWidthM','mhdDuctAreaM2','mhdLoadOhm']}],
 [S02,'flowmeter-open-circuit',{'flowmeter-rate':['flowDiameterM','particleSpeedMps','bFieldT']}]
];
let browser,origin;
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
const hud=page=>page.locator('[data-testid="live-formula-hud"]:visible');
async function snap(page,key){await page.screenshot({path:path.join(out,key+'.png')});}
async function withPage(key,fn,height=w===1024?768:900){
 const ctx=await browser.newContext({viewport:{width:w,height},deviceScaleFactor:1,hasTouch:kind==='touch',serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
   window.__h88Events=[];
   for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click','dblclick']){
    document.addEventListener(type,e=>{
      const wrap=e.target?.closest?.('.pf-live-var');
      const token=e.target?.closest?.('[data-param]')??wrap?.querySelector?.('[data-param]');
      window.__h88Events.push({type,pointerType:e.pointerType,detail:e.detail,target:e.target?.outerHTML?.slice(0,250),x:e.clientX,y:e.clientY,param:token?.dataset.param,formula:token?.closest('[data-formula-id]')?.dataset.formulaId});
      if(window.__h88Events.length>2000)window.__h88Events.shift();
    },true);
   }
   const old=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(...args){
     const result=Reflect.apply(old,this,args);
     const m=String(args[0]).match(/速度选择器 v_sel = E\/B = ([\d.-]+) m\/s/);
     if(this.canvas.dataset.testid==='simulation-canvas'&&m)window.__h88Paint={v:Number(m[1]),text:String(args[0])};
     return result;
   };
 });
 const page=await ctx.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>report.errors.push(key+': '+e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(key+': '+m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))report.external.push(key+': '+r.url());});
 try{await fn(page,kind==='touch'?await ctx.newCDPSession(page):null);}catch(e){report.issues.push(key+': '+String(e?.stack||e));await snap(page,key+'-failure').catch(()=>{});}
 finally{await ctx.close();}
}
async function load(page,model,preset,override){
 await page.goto(origin+'PhysForge/?model='+model+'&preset='+preset,{waitUntil:'networkidle'});
 await page.waitForFunction(model=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId===model,model);
 const play=page.locator('[data-testid="btn-play-pause"]:visible');
 if(await play.getAttribute('aria-label')==='暂停')await play.click();
 if(override){
  const control=page.locator('#param-'+override[0]);
  if(!await control.isVisible())await page.getByText('更多参数与图层',{exact:true}).click();
  await control.waitFor({state:'visible'});
  await control.selectOption(override[1]);
  if(await control.inputValue()!==override[1])throw Error('mode override did not apply');
 }
}
async function enter(page){await page.getByTestId('btn-fullscreen-speech').click();await page.getByTestId('live-formula-card').waitFor({state:'visible'});}
async function exit(page){await page.getByTestId('btn-exit-fullscreen-speech').click();await page.getByTestId('right-control-panel').waitFor({state:'visible'});}
const sliders=page=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('input[data-testid^="param-slider-"]')].map(n=>[n.dataset.testid,n.value])));
const tokenSelector='[data-testid="live-formula-card"] .pf-live-formula-markup [data-param]';
const describe=n=>({formula:n.closest('[data-formula-id]')?.dataset.formulaId,param:n.dataset.param});
async function center(token){
 await token.scrollIntoViewIfNeeded();
 return token.evaluate(n=>{
   const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,wrap=n.closest('.pf-live-var'),top=document.elementFromPoint(x,y);
   const hit=!!top&&(top.closest('[data-param]')===n||(!top.closest('[data-param]')&&!!wrap&&top.closest('.pf-live-var')===wrap));
   return {x,y,rect:r.toJSON(),hit,formula:n.closest('[data-formula-id]')?.dataset.formulaId,param:n.dataset.param,blockedBy:hit?null:top?.outerHTML.slice(0,400)??null};
 });
}
async function down(page,cdp,x,y){
 if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 else{await page.mouse.move(x,y);await page.mouse.down();}
}
async function up(page,cdp){
 if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
}
async function move(page,cdp,x,y){
 if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});else await page.mouse.move(x,y);
}
async function tapToken(page,cdp,hit,key,capture){
 if(!check(hit.hit,key+' center hit blocked by '+JSON.stringify(hit.blockedBy))){await snap(page,key+'-blocked');return {ok:false,hit};}
 await page.evaluate(()=>window.__h88Events=[]);
 let opened=false,txt='';
 await down(page,cdp,hit.x,hit.y);
 try{
   await hud(page).waitFor({state:'visible',timeout:1400});
   opened=true;txt=await hud(page).textContent();
   if(capture)await snap(page,key+'-held');
 }catch(e){report.issues.push(key+': HUD did not open: '+String(e));await snap(page,key+'-no-hud').catch(()=>{});}
 finally{await up(page,cdp);}
 await page.waitForFunction(()=>window.__h88Events.some(e=>e.type==='pointerup'||e.type==='pointercancel'),null,{timeout:1400});
 await frame(page);
 check(await hud(page).count()===0,key+': HUD did not close after release');
 const events=await page.evaluate(()=>window.__h88Events);
 const actual=events.find(e=>e.type==='pointerdown');
 const good=actual?.pointerType===kind&&actual?.param===hit.param&&actual?.formula===hit.formula;
 check(good,key+': wrong delivered pointer target '+JSON.stringify(actual));
 check(!events.some(e=>e.type==='pointercancel'),key+': tap cancelled');
 return {ok:opened&&good&&!events.some(e=>e.type==='pointercancel'),hit,hud:txt,events};
}
async function auditCase(page,cdp,c,index){
 const [model,preset,expected,override]=c,key='case-'+String(index+1).padStart(2,'0');
 await load(page,model,preset,override);
 const before=await sliders(page);
 await enter(page);
 const tokens=page.locator(tokenSelector);
 const found=await tokens.evaluateAll(ns=>ns.map(n=>({formula:n.closest('[data-formula-id]')?.dataset.formulaId,param:n.dataset.param})));
 const want=Object.entries(expected).flatMap(([formula,params])=>params.map(param=>formula+':'+param)).sort();
 const got=found.map(t=>t.formula+':'+t.param).sort();
 check(JSON.stringify(want)===JSON.stringify(got),key+' wrong token multiset: '+JSON.stringify({want,got}));
 const hits=[];
 for(let i=0;i<found.length;i++){
  const hit=await center(tokens.nth(i));
  hits.push(await tapToken(page,cdp,hit,key+'-token-'+i,i===0));
 }
 await exit(page);
 const after=await sliders(page);
 check(JSON.stringify(before)===JSON.stringify(after),key+': zero-distance taps mutated parameters');
 report.cases.push({key,model,preset,override,expected,want,found,hits,before,after});
}
async function dragE(page,cdp){
 const key='selector-E-drag';
 await load(page,S02,'velocity-selector-spectrometer');const before=await sliders(page);
 const e=Number(before['param-slider-eFieldVPerM']),b=Number(before['param-slider-bFieldT']);
 if(!Number.isFinite(e)||!(b>0))throw Error('missing initial E/B');
 await enter(page);
 const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
 const hit=await center(token);
 if(!check(hit.hit,key+' center hit'))return;
 const dx=e>450000?-24:24,expected=10000+Math.round((Math.max(10000,Math.min(500000,e+dx*490000/240))-10000)/10000)*10000;
 const speed=expected/b;
 const read=()=>page.evaluate(()=>{
  const hud=[...document.querySelectorAll('[data-testid="live-formula-hud"]')].find(n=>!n.hidden);
  const latex=document.querySelector('[data-readout-id="em-devices-law"] annotation')?.textContent??'';
  const m=latex.match(/v_s=([\d.]+)(?:\\times10\^\{(-?\d+)\})?/);
  return {latex,vs:m?Number(m[1])*10**Number(m[2]??0):null,paint:window.__h88Paint,applied:hud?.dataset.appliedValue,pending:hud?.dataset.pending,hud:hud?.textContent};
 });
 await page.evaluate(()=>window.__h88Events=[]);
 await down(page,cdp,hit.x,hit.y);
 try{
  await hud(page).waitFor({state:'visible',timeout:1400});
  await move(page,cdp,hit.x+dx,hit.y);
  await page.waitForFunction(x=>window.__h88Events.some(e=>e.type==='pointermove'&&Math.abs(e.x-x)<.1),hit.x+dx);
  await page.waitForFunction(({expected,speed})=>{
   const hud=[...document.querySelectorAll('[data-testid="live-formula-hud"]')].find(n=>!n.hidden);
   return Number(hud?.dataset.appliedValue)===expected&&hud?.dataset.pending==='false'&&Math.abs((window.__h88Paint?.v??Infinity)-speed)<=Math.max(1,speed*.0005);
  },{expected,speed},{timeout:4000});
  const held=await read();
  check(Number.isFinite(held.vs)&&Math.abs(held.vs-speed)<=Math.max(1,speed*.0005),key+' held formula oracle');
  await snap(page,key+'-held');
  report.eDrag={before,hit,dx,expected,speed,held};
 }finally{await up(page,cdp);}
 await hud(page).waitFor({state:'hidden'});await frame(page);
 const released=await read();check(Number.isFinite(released.vs)&&Math.abs(released.vs-speed)<=Math.max(1,speed*.0005)&&Math.abs((released.paint?.v??Infinity)-speed)<=Math.max(1,speed*.0005),key+' release oracle');
 const events=await page.evaluate(()=>window.__h88Events);
 check(!events.some(e=>e.type==='pointercancel'),key+' unexpected pointercancel');
 await exit(page);
 const after=await sliders(page);const want={...before,'param-slider-eFieldVPerM':String(expected)};
 check(JSON.stringify(want)===JSON.stringify(after),key+' committed E only');
 await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-undo').click();const undone=await sliders(page);
 check(JSON.stringify(before)===JSON.stringify(undone),key+' undo');
 await page.getByTestId('btn-redo').click();const redone=await sliders(page);
 check(JSON.stringify(want)===JSON.stringify(redone),key+' redo');
 report.eDrag={...report.eDrag,released,events,after,undone,redone};await snap(page,key+'-redo');
}
async function scrollStress(page,cdp){
 const key='touch-scroll-stress';
 await load(page,S01,'mirror-trapped-bounce');const before=await sliders(page);await enter(page);
 const panel=page.getByTestId('fullscreen-formula');
 let geometry;
 for(const height of [480,400,320]){
  await page.setViewportSize({width:w,height});await frame(page);
  geometry=await panel.evaluate(n=>({height:innerHeight,rect:n.getBoundingClientRect().toJSON(),client:n.clientHeight,scroll:n.scrollHeight,top:n.scrollTop}));
  if(geometry.scroll>geometry.client+15)break;
 }
 if(!check(geometry.scroll>geometry.client+15,key+' no natural overflow in stress view')){report.scroll={geometry};return;}
 const start=await panel.evaluate(n=>{
  const r=n.getBoundingClientRect();
  for(const y of [r.top+r.height*.75,r.top+r.height*.65]){
   for(const x of [r.left+6,r.left+9,r.left+12]){
    const top=document.elementFromPoint(x,y);
    if(top&&n.contains(top)&&!top.closest('.pf-live-formula-markup'))return {x,y,html:top.outerHTML.slice(0,150),action:getComputedStyle(top).touchAction};
   }
  }return null;
 });
 if(!check(!!start,key+' no surrounding scroll target')){report.scroll={geometry,start};return;}
 await snap(page,key+'-before');
 await page.evaluate(()=>window.__h88Events=[]);
 await down(page,cdp,start.x,start.y);
 try{
  const dy=Math.min(100,start.y-geometry.rect.top-10);
  for(let i=1;i<=6;i++){await move(page,cdp,start.x,start.y-dy*i/6);await frame(page);}
 }finally{await up(page,cdp);}
 await page.waitForFunction(top=>document.querySelector('[data-testid="fullscreen-formula"]').scrollTop>top+3,geometry.top,{timeout:3000});
 const end=await panel.evaluate(n=>({top:n.scrollTop,scroll:n.scrollHeight,client:n.clientHeight}));
 check(await hud(page).count()===0,key+' surrounding scroll opened HUD');
 const events=await page.evaluate(()=>window.__h88Events);
 await snap(page,key+'-after');
 const hit=await center(page.locator(tokenSelector).last());
 const tap=await tapToken(page,cdp,hit,key+'-after-scroll-token',true);
 await exit(page);const after=await sliders(page);
 check(JSON.stringify(before)===JSON.stringify(after),key+' scroll or tap changed params');
 report.scroll={geometry,start,end,events,tap,before,after};
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(let i=0;i<cases.length;i++)await withPage('case-'+String(i+1).padStart(2,'0'),(page,cdp)=>auditCase(page,cdp,cases[i],i));
 await withPage('selector-E-drag',dragE);
 if(kind==='touch'&&w===1024)await withPage('touch-scroll-stress',scrollStress,768);
}catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
const expectedTokens=cases.reduce((n,c)=>n+Object.values(c[2]).flat().length,0);
const observed=report.cases.reduce((n,c)=>n+c.hits.length,0);
check(report.cases.length===cases.length&&observed===expectedTokens&&report.cases.every(c=>c.hits.every(h=>h.ok)),'incomplete token audit');
check(!!report.eDrag?.redone,'incomplete E drag');
if(kind==='touch'&&w===1024)check(!!report.scroll?.end,'incomplete surrounding scroll');
report.expectedTokens=expectedTokens;report.observedTokens=observed;
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
if(report.issues.length||report.errors.length||report.external.length)throw Error(JSON.stringify({issues:report.issues,errors:report.errors,external:report.external}));
console.log('H88 exact-source formula hit targets:',head,w,kind,observed);
