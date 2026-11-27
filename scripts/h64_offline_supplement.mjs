import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const config={
 'builder-composite-em-field':{presets:['circle-magnetic-focusing','halfspace-rotating-circles','circle-scaling-circles','crossed-eb-cycloid','misconception-lorentz-work'],key:'magneticFieldZ',value:3},
 'em-induction-double-rod':{presets:['double-rod-momentum-conservation','double-rod-constant-force','single-rod-capacitor','single-rod-battery-drive','unequal-double-rod-momentum','single-rod-ideal-cap-constant-force'],key:'magneticB',value:2.5},
 'stse-em-devices-suite':{presets:['hall-electron-vs-hole','cyclotron-classic-vs-rel','mhd-peak-power','velocity-selector-spectrometer','cyclotron-gap-classroom','flowmeter-open-circuit'],key:'hallCurrentA',value:5},
 'stse-tokamak-magnetic-mirror':{presets:['mirror-trapped-bounce','mirror-loss-cone-escape','tokamak-helical-confinement'],key:'pitchAngleDeg',value:64},
 'astro-orbital-mechanics':{presets:['kepler-ellipse-second-law','hohmann-geo-transfer','solar-escape-velocity','binary-lagrange-roche'],key:'v0Ratio',value:1.3}
};
const model=process.env.MODEL,sourceHead=process.env.SOURCE_HEAD,c=config[model];
if(!c||!sourceHead)throw Error('Missing exact source / requested model');
const out=path.resolve('evidence/offline');fs.mkdirSync(out,{recursive:true});
const file=path.join(out,model+'.html');
const report={sourceHead,checkout:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),model,presets:[],issues:[],network:[],errors:[],screenshots:[]};
const sha=b=>createHash('sha256').update(b).digest('hex');
let browser,context,page;
const check=(condition,message)=>{if(!condition)throw Error(message)};
try{
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model',model,'--preset',c.presets[0],'--out',file],{stdio:'inherit',timeout:90000});
 const raw=fs.readFileSync(file);report.html={bytes:raw.length,sha256:sha(raw)};
 browser=await chromium.launch({headless:true});
 context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,offline:true,serviceWorkers:'block'});
 page=await context.newPage();page.setDefaultTimeout(5000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/i.test(r.url()))report.network.push(r.url());});
 await page.goto(pathToFileURL(file).href,{waitUntil:'load',timeout:10000});
 const shell=page.getByTestId('singlefile-shell'),canvas=page.getByTestId('sf-canvas'),clk=page.getByTestId('sf-summary-clock');
 const play=page.getByTestId('sf-play-pause'),step=page.getByRole('button',{name:'单步',exact:true}),reset=page.getByRole('button',{name:'复位',exact:true});
 await canvas.waitFor({state:'visible'});check(await shell.getAttribute('data-model-id')===model,'wrong isolated model ID');
 const clock=async()=>Number(await clk.getAttribute('data-sample-time'));
 const clockAtLeast=async(t)=>page.waitForFunction(t=>Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)>=t,t,{timeout:10000});
 const clockZero=async()=>page.waitForFunction(()=>Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)===0,null,{timeout:5000});
 const fingerprint=()=>canvas.evaluate(c=>{
   const ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data;
   let h=2166136261;for(let i=0;i<data.length;i+=31){h^=data[i];h=Math.imul(h,16777619);}
   const colors=new Set();for(let i=0;i<data.length;i+=28)colors.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);
   return {hash:(h>>>0).toString(16),colors:colors.size,width:c.width,height:c.height};
 });
 const snap=async(name)=>{
   const png=await page.screenshot({path:path.join(out,name+'.png')});
   report.screenshots.push({name:name+'.png',bytes:png.length,sha256:sha(png)});
 };
 const formula=async()=>{
   const values=await page.locator('aside .katex').count(),errors=await page.locator('aside .katex-error').count();
   const overflow=await page.locator('aside .overflow-x-auto').evaluateAll(nodes=>nodes.filter(n=>n.clientWidth>0&&n.scrollWidth>n.clientWidth+2).map(n=>({width:n.clientWidth,scrollWidth:n.scrollWidth,text:n.innerText.slice(0,180)})));
   check(values>0&&errors===0,'missing / invalid formula');return {values,errors,overflow};
 };
 const declared=await page.locator('[data-preset-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.presetId));
 check(declared.length===c.presets.length&&c.presets.every(id=>declared.includes(id)),'preset list mismatch '+declared.join(','));
 for(const id of c.presets){
   try{
     await page.locator('[data-preset-id="'+id+'"]').click();await clockZero();
     const before=await fingerprint();check(before.colors>16&&before.width>100&&before.height>100,'blank / invalid canvas');
     const f=await formula();await snap(id+'_initial');
     // A genuine step must update the integration clock and visible physics.
     check(!await step.isDisabled(),'unexpected disabled step for evolving model');
     await step.click();await clockAtLeast(.001);
     const after=await fingerprint(),t=await clock();check(t>0&&Number.isFinite(t),'step did not advance physical time');
     check(after.hash!==before.hash,'no canvas change after single-step');
     await reset.click();await clockZero();
     const restored=await fingerprint();check(restored.hash===before.hash,'reset did not reproduce initial canvas');
     report.presets.push({id,initial:before,step:after,stepT:t,resetExact:true,formula:f,status:'PASS'});
   }catch(e){report.presets.push({id,status:'FAIL',message:String(e)});report.issues.push(id+': '+String(e));await snap(id+'_failure');}
 }
 await page.locator('[data-preset-id="'+c.presets[0]+'"]').click();await clockZero();
 const before=await fingerprint(),slider=page.getByTestId('sf-param-'+c.key);
 const oldValue=await slider.inputValue();await slider.fill(String(c.value));await clockZero();
 const newValue=await slider.inputValue();check(Number(newValue)!==Number(oldValue),'slider failed to change value');
 const after=await fingerprint();check(after.hash!==before.hash,'parameter did not change canvas');
 report.parameter={key:c.key,before:oldValue,after:newValue,canvasChanged:true};await snap('parameter_changed');
 await play.click();await clockAtLeast(.35);await play.click();
 const stopT=await clock(),stopImage=await fingerprint();await page.waitForTimeout(200);
 check(Math.abs(await clock()-stopT)<1e-10,'paused clock still advancing');
 check((await fingerprint()).hash===stopImage.hash,'paused canvas still changing');
 await snap('paused');await reset.click();await clockZero();report.runPause={t:stopT,pausedStable:true,resetTime:await clock()};
 if(report.network.length||report.errors.length)throw Error('offline network or browser errors');
 if(report.issues.length)throw Error(report.issues.join('; '));
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;if(page)try{const png=await page.screenshot({path:path.join(out,'failure.png')});report.screenshots.push({name:'failure.png',bytes:png.length,sha256:sha(png)});}catch{}}
finally{if(context)await context.close();if(browser)await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
