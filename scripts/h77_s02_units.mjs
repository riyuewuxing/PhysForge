import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('wrong source');
const dir=path.resolve('evidence/h77-s02-units');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'s02.html'),report={head,model:'stse-em-devices-suite',cases:[],issues:[],errors:[],network:[]};
const expected={
 'velocity-selector':[['particleSpeedMps','m/s'],['selectedSpeed','m/s']],
 'mass-spectrometer':[['particleSpeedMps','m/s'],['spectrometerRadiusM','m']],
 'cyclotron':[['cyclotronEnergyJ','J'],['cyclotronPhaseSlipRad','rad']],
 'hall-sensor':[['hallVoltageMv','mV'],['hallCurrentA','A']],
 'mhd-generator':[['mhdOutputWatt','W'],['mhdTerminalVoltageV','V'],['mhdLoadCurrentA','A']],
 'em-flowmeter':[['flowRateM3ps','m³/s'],['flowVoltageMv','mV']]
};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
let browser,context,page;
try{
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','stse-em-devices-suite','--preset','hall-electron-vs-hole','--out',file],{stdio:'inherit',timeout:90000});
 browser=await chromium.launch({headless:true});
 context=await browser.newContext({viewport:{width:1440,height:900},offline:true,serviceWorkers:'block',deviceScaleFactor:1});
 await context.addInitScript(()=>{
  const ring=[];Object.defineProperty(window,'__h77ScopePaint',{value:ring});
  const base=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...rest){
   if(this.canvas.closest?.('[data-testid="sf-uplot"]')){
    ring.push({text:String(text),x:rest[0],y:rest[1]});
    if(ring.length>1500)ring.splice(0,ring.length-1500);
   }
   return base.call(this,text,...rest);
  };
 });
 page=await context.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
 await page.goto(pathToFileURL(file).href);
 await page.getByTestId('sf-canvas').waitFor({state:'visible'});
 const device=page.getByTestId('sf-param-device'),a=page.getByTestId('sf-scope-channel-a'),b=page.getByTestId('sf-scope-channel-b'),scope=page.getByTestId('sf-uplot'),clock=page.getByTestId('sf-summary-clock');
 const step=page.getByRole('button',{name:'单步',exact:true});
 const options=sel=>sel.evaluate(el=>[...el.options].map(o=>[o.value,o.textContent.trim()]));
 const paint=()=>page.evaluate(()=>structuredClone(window.__h77ScopePaint));
 const clear=()=>page.evaluate(()=>window.__h77ScopePaint.length=0);
 async function readPair(mode,chs,i,j){
  const name=mode+'-'+i+'-'+j;
  await clear();
  await a.selectOption(chs[i][0]);await b.selectOption(chs[j][0]);
  await step.click();await page.waitForTimeout(180);
  const texts=(await paint()).map(x=>x.text);
  const ds=await scope.evaluate(el=>({...el.dataset})),t=Number(await clock.getAttribute('data-sample-time'));
  check(await a.inputValue()===chs[i][0]&&await b.inputValue()===chs[j][0],name+': wrong selection');
  check(ds.scopeUnits===(chs[i][1]===chs[j][1]?'shared':'separate'),name+': wrong dimension split');
  for(const unit of new Set([chs[i][1],chs[j][1]]))check(texts.includes(unit),name+': actual axis omitted '+unit+' '+JSON.stringify(texts.slice(-70)));
  check(texts.includes('演示时间（非物理飞行时间）'),name+': missing actual demo clock label');
  check(ds.scopeTimeType==='elapsed'&&Math.abs(Number(ds.lastSampleT)-t)<1e-9&&t>0,name+': wrong physical sample clock');
  check(!texts.some(x=>/\b(?:1970|1971|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|am|pm)\b/i.test(x)),name+': calendar axis');
  report.cases.push({name,channels:[chs[i],chs[j]],dataset:ds,t,paint:texts});
  await page.screenshot({path:path.join(dir,name+'.png')});
 }
 // Start in a different mode than the exported Hall preset, then revisit
 // Hall and each other mode without reloading. Catch stale selections/data.
 for(const [mode,chs] of Object.entries(expected)){
  await device.selectOption(mode);
  await page.waitForTimeout(200);
  const ao=await options(a),bo=await options(b);
  check(JSON.stringify(ao.map(x=>x[0]))===JSON.stringify(chs.map(x=>x[0]))&&JSON.stringify(ao)===JSON.stringify(bo),mode+': wrong allowed channel list '+JSON.stringify({ao,bo}));
  for(const [key,unit] of chs){const opt=ao.find(x=>x[0]===key);check(opt?.[1].endsWith('('+unit+')'),mode+': option has wrong unit '+JSON.stringify(opt));}
  check(await a.inputValue()===chs[0][0]&&await b.inputValue()===chs[1][0],mode+': stale selected channel');
  check(await page.getByTestId('sf-scope-empty').isVisible()&&Number(await clock.getAttribute('data-sample-time'))===0,mode+': mode switch did not reset sample/empty state');
  await clear();for(let i=0;i<24;i++)await step.click();
  await page.waitForTimeout(200);
  const ds=await scope.evaluate(el=>({...el.dataset}));
  const texts=(await paint()).map(x=>x.text);
  check(ds.scopeTimeType==='elapsed'&&Number(ds.sampleCount)===25&&Math.abs(Number(ds.lastSampleT)-.4)<1e-9,mode+': incorrect fixed-time sample count '+JSON.stringify(ds));
  for(const unit of new Set([chs[0][1],chs[1][1]]))check(texts.includes(unit),mode+': default actual axis unit absent '+unit);
  check(ds.scopeUnits===(chs[0][1]===chs[1][1]?'shared':'separate'),mode+': default dimension split');
  check(texts.includes('演示时间（非物理飞行时间）'),mode+': default actual demo clock label absent');
  report.cases.push({name:mode+'-default',channels:chs,options:ao,dataset:ds,t:Number(await clock.getAttribute('data-sample-time')),paint:texts.slice(-100)});
  await page.screenshot({path:path.join(dir,mode+'-default.png')});
  // Every selectable unit is checked in actual axis paint, not just the
  // selector option. Test reversed order and MHD third channel.
  await readPair(mode,chs,1,0);
  if(chs.length===3){await readPair(mode,chs,2,0);await readPair(mode,chs,1,2);}
 }
 check(report.errors.length===0,'browser errors');check(report.network.length===0,'external network');
}catch(e){report.issues.push(String(e));if(page)await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});}
finally{
 if(context)await context.close();if(browser)await browser.close();
 report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({head,status:report.status,cases:report.cases.length,issues:report.issues,errors:report.errors,network:report.network}));if(report.issues.length)process.exitCode=1;
}