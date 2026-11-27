import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const out=path.resolve('evidence/h69');fs.mkdirSync(out,{recursive:true});
const source=process.env.SOURCE_HEAD, audit=process.env.AUDIT_HEAD;
if(!source||!audit)throw Error('Missing provenance');
const file=path.join(out,'e10.html');
const report={source,audit,cases:[],issues:[],errors:[],network:[]};
let browser;
try {
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','em-3d-magnetic-fields','--preset','uniform-negative-charge','--out',file],{stdio:'inherit',timeout:120000});
 browser=await chromium.launch({headless:true});
 for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
  const ctx=await browser.newContext({viewport,offline:true,serviceWorkers:'block',deviceScaleFactor:1});
  try{
   await ctx.addInitScript(()=>{
    const p=CanvasRenderingContext2D.prototype;
    const original={beginPath:p.beginPath,moveTo:p.moveTo,lineTo:p.lineTo,stroke:p.stroke,clearRect:p.clearRect};
    const map=new WeakMap();
    const target=c=>c.canvas.getAttribute('data-testid')==='sf-canvas';
    const state=c=>{if(!map.has(c))map.set(c,{path:[],strokes:[]});return map.get(c);};
    Object.defineProperty(window,'__h69Paint',{value:()=>{const c=document.querySelector('[data-testid="sf-canvas"]');if(!c)return null;return {width:c.width,height:c.height,strokes:state(c.getContext('2d')).strokes.slice()};}});
    p.clearRect=function(...a){if(target(this)){state(this).strokes=[];state(this).path=[];}return original.clearRect.apply(this,a);};
    p.beginPath=function(...a){if(target(this))state(this).path=[];return original.beginPath.apply(this,a);};
    for(const method of ['moveTo','lineTo'])p[method]=function(x,y){if(target(this)){const m=this.getTransform();state(this).path.push([m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);}return original[method].call(this,x,y);};
    p.stroke=function(...a){
     if(target(this)&&['#67e8f9','#0369a1'].includes(this.strokeStyle)){
      const points=state(this).path;if(points.length>=2){const xs=points.map(q=>q[0]),ys=points.map(q=>q[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);state(this).strokes.push({minX,maxX,minY,maxY,count:points.length,alpha:this.globalAlpha});}
     }return original.stroke.apply(this,a);
    };
   });
   const page=await ctx.newPage();page.setDefaultTimeout(10000);
   page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
   await page.goto(pathToFileURL(file).href);
   const canvas=page.getByTestId('sf-canvas');await canvas.waitFor({state:'visible'});
   for(const [id,B] of [['uniform-negative-charge',4],['uniform-negative-field',-4],['uniform-zero-field',0],['uniform-parallel-only',2]]){
    if(id!=='uniform-negative-charge')await page.locator('[data-preset-id="'+id+'"]').click();
    await page.waitForFunction(B=>{const d=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.magneticRendered||'null');return d?.geometryType==='uniform-helix'&&d.uniformBz===B&&d.t===0;},B);
    await page.waitForTimeout(180);
    const paint=await page.evaluate(()=>window.__h69Paint());
    const data=JSON.parse(await canvas.getAttribute('data-magnetic-rendered'));
    const long=paint.strokes.filter(s=>s.alpha<.8&&s.maxY-s.minY<1&&s.maxX-s.minX>10);
    const span=Math.max(0,...long.map(s=>s.maxX-s.minX)),ratio=span/paint.width;
    const record={viewport,id,data,paintWidth:paint.width,paintHeight:paint.height,long,ratio};report.cases.push(record);
    if(B!==0){
     if(long.length<3)report.issues.push(id+' '+viewport.width+' missing actual field strokes');
     if(ratio<.55)report.issues.push(id+' '+viewport.width+' field extent ratio '+ratio.toFixed(4)+' < .55');
     if(long.some(s=>s.minX<20||s.maxX>paint.width-20))report.issues.push(id+' '+viewport.width+' field stroke crosses stage safe margin');
    }else if(long.length)report.issues.push('zero B drew long field strokes');
    await page.screenshot({path:path.join(out,viewport.width+'-'+id+'.png')});
   }
  }finally{await ctx.close();}
 }
 if(report.errors.length||report.network.length)report.issues.push('offline browser errors or network requests');
}catch(e){report.issues.push(String(e));}
finally{if(browser)await browser.close();report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,cases:report.cases.map(({viewport,id,ratio,long})=>({viewport,id,ratio,strokes:long.length})),errors:report.errors,network:report.network}));if(report.issues.length)process.exitCode=1;}
