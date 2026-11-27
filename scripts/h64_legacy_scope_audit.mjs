import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const cases={
 'builder-composite-em-field':{preset:'circle-magnetic-focusing',units:['m/s','J']},
 'em-induction-double-rod':{preset:'double-rod-momentum-conservation',units:['m/s','m/s']},
 'stse-em-devices-suite':{preset:'hall-electron-vs-hole',units:['m/s','mV']},
 'stse-tokamak-magnetic-mirror':{preset:'mirror-trapped-bounce',units:['m','T']},
 'astro-orbital-mechanics':{preset:'kepler-ellipse-second-law',units:['','']}
};
const model=process.env.MODEL,head=process.env.SOURCE_HEAD,c=cases[model];
if(!c||!head)throw Error('Unknown exact model');
const dir=path.resolve('evidence/scope');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,model+'.html'),report={head,model,issues:[],network:[],errors:[]};
let browser,ctx,page;
try{
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model',model,'--preset',c.preset,'--out',file],{stdio:'inherit',timeout:90000});
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:true,serviceWorkers:'block'});
 // Capture actual text painted on the plot canvas without touching application state.
 await ctx.addInitScript(()=>{
   const base=CanvasRenderingContext2D.prototype.fillText;
   const ring=[];Object.defineProperty(window,'__pfScopePaint',{value:ring});
   CanvasRenderingContext2D.prototype.fillText=function(text,...rest){
     if(this.canvas.closest?.('[data-testid="sf-uplot"]')){
       ring.push({text:String(text),x:rest[0],y:rest[1],height:this.canvas.height});
       if(ring.length>1000)ring.splice(0,ring.length-1000);
     }
     return base.call(this,text,...rest);
   };
 });
 page=await ctx.newPage();page.setDefaultTimeout(5000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
 await page.goto(pathToFileURL(file).href);await page.getByTestId('sf-canvas').waitFor({state:'visible'});
 const scope=page.getByTestId('sf-uplot'),clk=page.getByTestId('sf-summary-clock');
 const step=page.getByRole('button',{name:'单步',exact:true});
 await page.waitForTimeout(200);
 report.initial={scopeVisible:await scope.isVisible(),emptyVisible:await page.getByTestId('sf-scope-empty').isVisible(),paint:await page.evaluate(()=>window.__pfScopePaint.slice())};
 await page.screenshot({path:path.join(dir,'initial.png')});
 for(let i=0;i<24;i++)await step.click();
 await page.waitForFunction(()=>Math.abs(Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)-.4)<1e-9);
 await page.waitForTimeout(200);
 const state=await scope.evaluate(n=>({...n.dataset}));
 const paint=await page.evaluate(()=>window.__pfScopePaint.slice());
 report.running={t:Number(await clk.getAttribute('data-sample-time')),state,paint};
 await page.screenshot({path:path.join(dir,'sampled.png')});
 const calendar=/\b(?:1970|1971|1972|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|am|pm)\b|1\/1\/70/i;
 if([...report.initial.paint,...paint].some(x=>calendar.test(x.text)))report.issues.push('calendar labels were actually painted on simulation time axis');
 if(state.scopeTimeType!=='elapsed')report.issues.push('elapsed time scale not declared');
 if(state.scopeUnits!==(c.units[0]===c.units[1]?'shared':'separate'))report.issues.push('different physical units share the same vertical axis');
 if(!Number.isFinite(Number(state.lastSampleT))||Math.abs(Number(state.lastSampleT)-report.running.t)>1e-9)report.issues.push('paused plot endpoint lacks exact physical-clock evidence');
 if(report.initial.scopeVisible||!report.initial.emptyVisible)report.issues.push('unsampled initial plot is not an explicit empty state');
 if(!paint.length)report.issues.push('no actual plotted text captured');
 if(report.errors.length||report.network.length)report.issues.push('offline browser errors or network requests');
 report.status=report.issues.length?'FAIL':'PASS';
 if(report.issues.length)process.exitCode=1;
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}
finally{if(ctx)await ctx.close();if(browser)await browser.close();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,initial:{...report.initial,paint:report.initial?.paint?.map(x=>x.text)},running:{...report.running,paint:report.running?.paint?.slice(-50).map(x=>x.text)}}));}
