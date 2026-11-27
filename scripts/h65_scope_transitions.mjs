import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Independent browser contract: controls and measured scope must describe only
// the active experiment, never a stale previous experiment's history.
const cases={
 'builder-composite-em-field':{preset:'circle-magnetic-focusing',modes:[{label:'position-pair',keys:['speed','kineticEnergy','x','y','larmorRadius'],select:['x','y'],split:'shared',axis:['m']},{label:'speed-energy',keys:['speed','kineticEnergy','x','y','larmorRadius'],select:['speed','kineticEnergy'],split:'separate',axis:['m/s','J']}]},
 'em-induction-double-rod':{preset:'double-rod-momentum-conservation',field:'rodMode',modes:[{mode:'single',keys:['v1','current','kineticEnergy','jouleHeat'],select:['v1','current'],split:'separate',axis:['m/s','A']},{mode:'double',keys:['v1','v2','current','kineticEnergy','jouleHeat'],select:['v1','v2'],split:'shared',axis:['m/s']}]},
 'stse-em-devices-suite':{preset:'hall-electron-vs-hole',field:'device',modes:[
  {mode:'hall-sensor',keys:['hallVoltageMv','hallCurrentA'],select:['hallVoltageMv','hallCurrentA'],split:'separate',axis:['mV','A']},
  {mode:'velocity-selector',keys:['particleSpeedMps','selectedSpeed'],select:['particleSpeedMps','selectedSpeed'],split:'shared',axis:['m/s']},
  {mode:'mass-spectrometer',keys:['particleSpeedMps','spectrometerRadiusM'],select:['particleSpeedMps','spectrometerRadiusM'],split:'separate',axis:['m/s','m']},
  {mode:'cyclotron',keys:['cyclotronEnergyJ','cyclotronPhaseSlipRad'],select:['cyclotronEnergyJ','cyclotronPhaseSlipRad'],split:'separate',axis:['J','rad']},
  {mode:'mhd-generator',keys:['mhdOutputWatt','mhdTerminalVoltageV','mhdLoadCurrentA'],select:['mhdOutputWatt','mhdTerminalVoltageV'],split:'separate',axis:['W','V']},
  {mode:'em-flowmeter',keys:['flowRateM3ps','flowVoltageMv'],select:['flowRateM3ps','flowVoltageMv'],split:'separate',axis:['m³/s','mV']}],demo:true},
 'stse-tokamak-magnetic-mirror':{preset:'mirror-trapped-bounce',field:'mode',modes:[{mode:'tokamak',keys:['minorRadiusM','bMagT','z','vParallel','vPerp','muCurrent','maxMuRelDev'],select:['minorRadiusM','bMagT'],split:'separate',axis:['m','T']},{mode:'magnetic-mirror',keys:['z','bMagT','muCurrent','maxMuRelDev','vParallel','vPerp'],select:['z','bMagT'],split:'separate',axis:['m','T']}]},
 'astro-orbital-mechanics':{preset:'kepler-ellipse-second-law',field:'mode',modes:[{mode:'kepler-ellipse',keys:['rNorm','speedNorm','energyNorm','angularMomNorm'],select:['rNorm','speedNorm'],split:'shared',axis:['无量纲']},{mode:'hohmann-transfer',keys:['rNorm','speedNorm','energyNorm','angularMomNorm'],select:['rNorm','speedNorm'],split:'shared',axis:['无量纲']},{mode:'binary-lagrange',keys:['jacobiConstant','rotatingSpeedNorm','rNorm','speedNorm','energyNorm','angularMomNorm'],select:['jacobiConstant','rotatingSpeedNorm'],split:'shared',axis:['无量纲']}],demo:true}
};
const model=process.env.MODEL,head=process.env.SOURCE_HEAD,c=cases[model];
assert.ok(c&&head,'exact source and model required');
const dir=path.resolve('evidence/scope-transitions');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'experiment.html');
const report={head,model,checks:[],errors:[],network:[]};
let browser,ctx,page;
try{
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model',model,'--preset',c.preset,'--out',file],{stdio:'inherit',timeout:90000});
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const ring=[];Object.defineProperty(window,'__scopeAuditPaint',{value:ring});
  const base=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...rest){
   if(this.canvas.closest?.('[data-testid="sf-uplot"]')){ring.push(String(text));if(ring.length>2000)ring.splice(0,ring.length-2000);}
   return base.call(this,text,...rest);
  };
 });
 page=await ctx.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
 await page.goto(pathToFileURL(file).href);await page.getByTestId('sf-canvas').waitFor({state:'visible'});
 const scope=page.getByTestId('sf-uplot'),empty=page.getByTestId('sf-scope-empty'),clk=page.getByTestId('sf-summary-clock');
 const play=page.getByTestId('sf-play-pause'),step=page.getByRole('button',{name:'单步',exact:true}),reset=page.getByRole('button',{name:'复位',exact:true});
 const channels=['a','b'].map(x=>page.getByTestId('sf-scope-channel-'+x));
 const clock=async()=>Number(await clk.getAttribute('data-sample-time'));
 const waitClock=async(min)=>page.waitForFunction(v=>Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)>v,min);
 const emptyContract=async()=>{
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)===0&&document.querySelector('[data-testid="sf-uplot"]')?.dataset.sampleCount==='1');
  assert.equal(await scope.isVisible(),false,'empty plot must be hidden');
  assert.equal(await empty.isVisible(),true,'empty hint must be visible');
  await page.waitForTimeout(120);
  assert.equal(await clock(),0,'reset must pause playback');
 };
 const options=async(locator)=>locator.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
 for(const m of c.modes){
  const rec={mode:m.mode??m.label};report.checks.push(rec);
  // Deliberately leave the previous run active when switching experiment.
  if(c.field){
   const selector=page.getByTestId('sf-param-'+c.field);
   if(await selector.inputValue()===m.mode)await reset.click();else{
    await play.click();await waitClock(.025);
    await selector.selectOption(m.mode);
   }
  }else await reset.click();
  await emptyContract();rec.empty=true;
  for(let j=0;j<2;j++){
   assert.deepEqual(await options(channels[j]),m.keys,'available channels must match active apparatus');
   await channels[j].selectOption(m.select[j]);
   assert.equal(await channels[j].inputValue(),m.select[j]);
  }
  rec.channels=m.select;rec.available=m.keys;
  await page.evaluate(()=>window.__scopeAuditPaint.splice(0));
  for(let i=0;i<6;i++)await step.click();
  assert.ok(Math.abs(await clock()-.1)<1e-9,'six manual steps should equal 0.1 s');
  await play.click();await waitClock(.18);await play.click();
  await page.waitForTimeout(180);
  const t=await clock(),state=await scope.evaluate(n=>({...n.dataset}));
  assert.ok(t>.18&&Number.isFinite(t),'positive finite paused time');
  assert.ok(Math.abs(Number(state.lastSampleT)-t)<1e-9,'last sample and paused clock must match');
  assert.ok(Number(state.sampleCount)>=7,'plot must contain new measurements');
  assert.ok(Math.abs(Number(state.scopeMax)-t)<1e-9,'axis endpoint must match last sample');
  assert.equal(state.scopeTimeType,'elapsed');assert.equal(state.scopeUnits,m.split);
  assert.equal(await scope.isVisible(),true);assert.equal(await empty.isVisible(),false);
  const paint=await page.evaluate(()=>window.__scopeAuditPaint.slice());
  for(const unit of m.axis)assert.ok(paint.includes(unit),'axis must actually paint unit '+unit);
  assert.ok(!paint.some(x=>/\b(?:1970|1971|1972|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|am|pm)\b|1\/1\/70/i.test(x)),'no calendar text');
  if(c.demo)assert.match(await clk.innerText(),/演示时间/);
  rec.t=t;rec.state=state;rec.paint=Array.from(new Set(paint));
  await page.screenshot({path:path.join(dir,rec.mode+'.png')});
  await reset.click();await emptyContract();rec.reset=true;
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;if(page)await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});}
finally{if(ctx)await ctx.close();if(browser)await browser.close();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
