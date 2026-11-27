import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;if(!head)throw Error('Missing exact source SHA');
const out=path.resolve('evidence/b3-slice-modes');fs.mkdirSync(out,{recursive:true});
const report={head,issues:[],errors:[],network:[],states:[]};
let browser,context,page;
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const rad=x=>x*Math.PI/180;
const r=Math.asin(Math.sin(rad(50))/1.5);
const prismI=rad(45),A=rad(60),r1=Math.asin(Math.sin(prismI)/1.52),r2=A-r1;
const presets=[
 ['parallel-glass-slab','parallel-slab','lateralShift',Math.sin(rad(50)-r)/Math.cos(r),['玻璃','Δx=','主透射']],
 ['prism-dispersion','prism-dispersion','prismDeviationDeg',(prismI+Math.asin(1.52*Math.sin(r2))-A)*180/Math.PI,['色散','黄光偏向角']],
 ['optical-fiber','optical-fiber','fiberAcceptanceDeg',Math.asin(Math.sqrt(1.6**2-1.4**2))*180/Math.PI,['纤芯','包层','全反射导光']],
 ['double-slit-interference','double-slit','fringeSpacingMm',1.8,['屏面','双缝','Δx=']],
 ['thin-lens-real-image','thin-lens-imaging','imageDistanceM',1.5*.65/(1.5-.65),['物','实像','近轴模型']]
];
try{
 const file=path.join(out,'slice.html');
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','builder-optics-ray','--preset','tir-water-air','--out',file],{stdio:'inherit',timeout:90000});
 browser=await chromium.launch({headless:true});
 context=await browser.newContext({viewport:{width:1440,height:900},offline:true,serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const trace={points:[],labels:[],frame:0};Object.defineProperty(window,'__h67SliceTrace',{value:trace});
  const p=CanvasRenderingContext2D.prototype,active=c=>c.canvas.dataset.testid==='sf-canvas';
  const wrap=(k,f)=>{const old=p[k];p[k]=function(...a){if(active(this))f(this,a);return old.apply(this,a);}};
  wrap('fillRect',(c,[x,y,w,h])=>{
   if(x===0&&y===0&&w>=c.canvas.clientWidth-1&&h>=c.canvas.clientHeight-1){trace.points=[];trace.labels=[];trace.frame++;}
   else {trace.points.push([x,y],[x+w,y+h]);}
  });
  for(const k of ['moveTo','lineTo'])wrap(k,(c,[x,y])=>trace.points.push([x,y]));
  wrap('arc',(c,[x,y,r])=>trace.points.push([x-r,y-r],[x+r,y+r]));
  wrap('fillText',(c,[s,x,y])=>{
   const m=c.measureText(String(s));trace.labels.push({text:String(s),x,y,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent,fill:c.fillStyle});
  });
 });
 page=await context.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
 await page.goto(pathToFileURL(file).href);
 const canvas=page.getByTestId('sf-canvas');
 const theme=async(paper)=>{
  const expected=paper?'projector':'chalkboard';
  if(await page.evaluate(()=>document.documentElement.dataset.theme)===expected)return;
  await page.getByRole('button',{name:paper?'黑板深蓝':'投影白底',exact:true}).click();
  await page.waitForFunction(x=>document.documentElement.dataset.theme===x,expected);
 };
 for(const [width,height] of [[1440,900],[1024,768]]){
  await page.setViewportSize({width,height});
  for(const [preset,mode,key,expected,required] of presets){
   await theme(false);await page.locator('[data-preset-id="'+preset+'"]').click();
   await page.waitForFunction(mode=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.b3Rendered||'null')?.mode===mode,mode);
   for(const paper of [false,true]){
    await theme(paper);await page.waitForTimeout(130);
    const name=width+'-'+mode+'-'+(paper?'paper':'dark'),data=JSON.parse(await canvas.getAttribute('data-b3-rendered'));
    const trace=await page.evaluate(()=>window.__h67SliceTrace),b=await canvas.boundingBox();
    const labels=trace.labels;
    check(Math.abs(data[key]-expected)<1e-8,name+': physical observable '+key);
    check(trace.points.length>5,name+': no actual canvas geometry');
    check(trace.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>=-1&&x<=b.width+1&&y>=-1&&y<=b.height+1),name+': geometric primitive outside canvas');
    for(const want of required)check(labels.some(x=>x.text.includes(want)),name+': missing annotation '+want);
    for(const l of labels)check(l.left>=-1&&l.right<=b.width+1&&l.top>=-1&&l.bottom<=b.height+1,name+': clipped text '+l.text);
    check(!(await page.getByTestId('sf-uplot').isVisible()),name+': unnecessary time scope');
    const extents=trace.points.reduce((a,[x,y])=>({left:Math.min(a.left,x),right:Math.max(a.right,x),top:Math.min(a.top,y),bottom:Math.max(a.bottom,y)}),{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
    report.states.push({name,data,canvas:b,extents,labels,geometryPoints:trace.points.length});
    await page.screenshot({path:path.join(out,name+'.png')});
   }
  }
 }
 check(!report.errors.length,'browser errors');check(!report.network.length,'offline network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 if(context)await context.close();if(browser)await browser.close();
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({head,status:report.status,states:report.states.length,issues:report.issues,errors:report.errors,network:report.network}));if(report.issues.length)process.exitCode=1;
}
