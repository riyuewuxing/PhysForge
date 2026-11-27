import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright';
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(source!==process.env.EXPECTED_SOURCE)throw Error('Wrong source');
const out=path.resolve('evidence/h69-offline-geometry');fs.mkdirSync(out,{recursive:true});
const report={source,audit:process.env.AUDIT_HEAD,cases:[],issues:[],errors:[],network:[]};
const html=path.join(out,'normal.html'),custom=path.join(out,'parallel.html'),preset=path.join(out,'parallel.json');
fs.writeFileSync(preset,JSON.stringify({modelId:'em-3d-magnetic-fields',presetId:'h69-parallel-custom',title:'Parallel wires',params:{geometryType:'parallel-wires',radiusR:.7,currentI:2,solenoidTurns:10,qOverM:1.5,vPerp:1.2,vParallel:.7,uniformBz:2}}));
let browser;
try{
 for(const [file,args] of [[html,['--preset','finite-solenoid-3d']],[custom,['--preset-file',preset]]])execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','em-3d-magnetic-fields',...args,'--out',file],{stdio:'inherit',timeout:90000});
 browser=await chromium.launch({headless:true});
 for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
  const ctx=await browser.newContext({viewport,offline:true,serviceWorkers:'block',deviceScaleFactor:1});
  try{
   await ctx.addInitScript(()=>{
    const p=CanvasRenderingContext2D.prototype,old={beginPath:p.beginPath,moveTo:p.moveTo,lineTo:p.lineTo,arc:p.arc,stroke:p.stroke,fillRect:p.fillRect,clearRect:p.clearRect};
    const map=new WeakMap(),target=c=>c.canvas.getAttribute('data-testid')==='sf-canvas',state=c=>{if(!map.has(c))map.set(c,{path:[],bounds:[]});return map.get(c);};
    const push=(c,x,y)=>{const m=c.getTransform();state(c).path.push([m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);};
    Object.defineProperty(window,'__h69Geometry',{value:()=>{const c=document.querySelector('[data-testid="sf-canvas"]');return {width:c.width,height:c.height,strokes:state(c.getContext('2d')).bounds.slice()};}});
    p.fillRect=function(x,y,w,h){if(target(this)&&x===0&&y===0&&w>=this.canvas.width&&h>=this.canvas.height){state(this).bounds=[];state(this).path=[];}return old.fillRect.call(this,x,y,w,h);};
    p.clearRect=function(...a){if(target(this)){state(this).bounds=[];state(this).path=[];}return old.clearRect.apply(this,a);};
    p.beginPath=function(...a){if(target(this))state(this).path=[];return old.beginPath.apply(this,a);};
    for(const k of ['moveTo','lineTo'])p[k]=function(x,y){if(target(this))push(this,x,y);return old[k].call(this,x,y);};
    p.arc=function(x,y,r,...a){if(target(this))for(const [dx,dy] of [[-r,0],[r,0],[0,-r],[0,r]])push(this,x+dx,y+dy);return old.arc.call(this,x,y,r,...a);};
    p.stroke=function(...a){if(target(this)&&['#eabf94','#67e8f9','#92400e','#0369a1'].includes(this.strokeStyle)&&state(this).path.length){const pts=state(this).path;state(this).bounds.push({color:this.strokeStyle,minX:Math.min(...pts.map(v=>v[0])),maxX:Math.max(...pts.map(v=>v[0])),minY:Math.min(...pts.map(v=>v[1])),maxY:Math.max(...pts.map(v=>v[1]))});}return old.stroke.apply(this,a);};
   });
   const page=await ctx.newPage();page.setDefaultTimeout(10000);
   page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
   await page.goto(pathToFileURL(html).href);const canvas=page.getByTestId('sf-canvas');await canvas.waitFor({state:'visible'});
   for(const [id,geometry] of [['finite-solenoid-3d','finite-solenoid'],['helmholtz-uniform-core-3d','helmholtz-coil'],['single-loop-biot-savart','single-loop'],['finite-wire-reverse','straight-wire'],['uniform-3d-helical-pitch','uniform-helix'],['custom','parallel-wires']]){
    if(id==='custom')await page.goto(pathToFileURL(custom).href);
    else if(id!=='finite-solenoid-3d')await page.locator('[data-preset-id="'+id+'"]').click();
    await page.waitForFunction(geometry=>{const d=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.magneticRendered||'null');return d?.geometryType===geometry&&d.t===0;},geometry);
    await page.waitForTimeout(180);
    const paint=await page.evaluate(()=>window.__h69Geometry());const state=JSON.parse(await canvas.getAttribute('data-magnetic-rendered'));
    const {width,height,strokes}=paint,wire=strokes.filter(s=>['#eabf94','#92400e'].includes(s.color)),field=strokes.filter(s=>['#67e8f9','#0369a1'].includes(s.color));
    const all=strokes.length?{minX:Math.min(...strokes.map(s=>s.minX)),maxX:Math.max(...strokes.map(s=>s.maxX)),minY:Math.min(...strokes.map(s=>s.minY)),maxY:Math.max(...strokes.map(s=>s.maxY))}:null;
    report.cases.push({viewport,id,geometry,state,width,height,wire:wire.length,field:field.length,all});
    if(!all||!field.length||(geometry!=='uniform-helix'&&!wire.length))report.issues.push(id+' missing actual field/conductor strokes');
    if(all&&(all.minX<15||all.maxX>width-15||all.minY<15||all.maxY>height-15))report.issues.push(id+' geometry crossed safe margin '+JSON.stringify(all));
    await page.screenshot({path:path.join(out,viewport.width+'-'+geometry+'.png')});
   }
  }finally{await ctx.close();}
 }
 if(report.errors.length||report.network.length)report.issues.push('browser or offline network error');
}catch(e){report.issues.push(String(e));}
finally{if(browser)await browser.close();report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,cases:report.cases.map(({viewport,geometry,width,height,wire,field,all})=>({viewport,geometry,width,height,wire,field,all})),network:report.network,errors:report.errors}));if(report.issues.length)process.exitCode=1;}
