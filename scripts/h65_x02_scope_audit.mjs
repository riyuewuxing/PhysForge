import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const model='exp-electrical-error-lab',head=process.env.SOURCE_HEAD;
const dir=path.resolve('evidence/x02-scope');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'x02.html');
const report={head,model,checks:[],issues:[],errors:[],network:[]};
const cases=[
 ['emf-inner-outer',['eFittedV','rFittedOhm'],'separate'],
 ['bulb-iv-curve',['bulbVoltageV','bulbCurrentA'],'separate'],
 ['half-bias-rg',['rgMeasuredOhm'],'shared'],
 ['caliper-micrometer',['vernierReadoutMm','microReadoutMm'],'shared'],
 ['emf-inner-outer',['eFittedV','rFittedOhm'],'separate']
];
let browser,ctx,page;
try{
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model',model,'--preset','emf-voltmeter-across-source','--out',file],{stdio:'inherit',timeout:90000});
 browser=await chromium.launch({headless:true});
 ctx=await browser.newContext({viewport:{width:1440,height:900},offline:true,serviceWorkers:'block'});
 page=await ctx.newPage();page.setDefaultTimeout(7000);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
 await page.goto(pathToFileURL(file).href);
 await page.getByTestId('sf-canvas').waitFor({state:'visible'});
 const mode=page.getByTestId('sf-param-mode'),a=page.getByTestId('sf-scope-channel-a'),b=page.getByTestId('sf-scope-channel-b'),scope=page.getByTestId('sf-uplot'),clk=page.getByTestId('sf-summary-clock'),empty=page.getByTestId('sf-scope-empty');
 const step=page.getByRole('button',{name:'单步',exact:true});
 const reset=page.getByRole('button',{name:'复位',exact:true});
 for(let i=0;i<cases.length;i++){
  const [value,expected,split]=cases[i];
  if(await mode.inputValue()!==value)await mode.selectOption(value);else await reset.click();
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)===0);
  await page.waitForTimeout(140);
  const initial={clock:Number(await clk.getAttribute('data-sample-time')),empty:await empty.isVisible(),hidden:!(await scope.isVisible())};
  const aa=await a.locator('option').evaluateAll(n=>n.map(o=>o.value)),bb=await b.locator('option').evaluateAll(n=>n.map(o=>o.value));
  const actual=[await a.inputValue(),await b.inputValue()];
  for(let j=0;j<3;j++)await step.click();
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime)-.05)<1e-9);
  await page.waitForTimeout(100);
  const state=await scope.evaluate(n=>({...n.dataset}));
  const record={mode:value,expected,optionsA:aa,optionsB:bb,selected:actual,initial,state};report.checks.push(record);
  if(JSON.stringify(aa)!==JSON.stringify(expected)||JSON.stringify(bb)!==JSON.stringify(expected))report.issues.push(value+': stale or unrelated channels');
  if(actual[0]!==expected[0]||actual[1]!==(expected[1]??expected[0]))report.issues.push(value+': stale channel selection');
  if(!initial.empty||!initial.hidden||initial.clock!==0)report.issues.push(value+': reset state incorrect');
  if(state.scopeUnits!==split)report.issues.push(value+': wrong axis unit separation');
  if(state.scopeTimeType!=='elapsed'||Math.abs(Number(state.lastSampleT)-.05)>1e-9)report.issues.push(value+': clock mismatch');
  await page.screenshot({path:path.join(dir,i+'-'+value+'.png')});
 }
 if(report.errors.length||report.network.length)report.issues.push('offline browser errors or network requests');
 report.status=report.issues.length?'FAIL':'PASS';if(report.issues.length)process.exitCode=1;
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}
finally{if(ctx)await ctx.close();if(browser)await browser.close();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
