import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(source!==process.env.EXPECTED_SOURCE)throw Error('Wrong source '+source);
const out=path.resolve('evidence/h71-solenoid');fs.mkdirSync(out,{recursive:true});
const report={source,audit:process.env.AUDIT_HEAD,states:{},issues:[],errors:[],network:[],failedResponses:[]};
const dist=path.resolve('apps/web/dist');
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const q=path.resolve(dist,u.pathname.replace(/^\/PhysForge\/|^\//,'')+(u.pathname.endsWith('/')?'index.html':''));
 if(!q.startsWith(dist+path.sep)||!fs.existsSync(q)||!fs.statSync(q).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':mime[path.extname(q)]||'application/octet-stream'});fs.createReadStream(q).pipe(res);
});
let browser,ctx;
const candidate=process.env.CANDIDATE==='true';
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});
 const setup=async viewport=>{
  const c=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
  const p=await c.newPage();p.setDefaultTimeout(15000);
  p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  p.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))report.network.push(r.url());});
  p.on('response',r=>{if(r.status()>=400)report.failedResponses.push(r.status()+' '+r.url());});
  await p.goto(origin+'/PhysForge/?model=em-3d-magnetic-fields',{waitUntil:'networkidle'});
  await p.getByTestId('three-stage-container').locator('canvas').waitFor({state:'visible'});
  return [c,p];
 };
 const assert=(ok,msg)=>{if(!ok)report.issues.push(msg);};
 let page,stage;
 const read=async()=>stage.evaluate(s=>{
  const ring=s.querySelector('[data-testid="e10-occlusion-ring"]'),legend=s.querySelector('[data-testid="e10-focus-legend"]');
  const rect=s.getBoundingClientRect().toJSON(),r=ring?.getBoundingClientRect().toJSON(),style=ring?getComputedStyle(ring):null;
  const panel=document.querySelector('[data-testid="right-control-panel"]')?.getBoundingClientRect().toJSON();
  const scope=document.querySelector('[data-testid="floating-scope-dock"]')?.getBoundingClientRect().toJSON();
  const formula=document.querySelector('[data-testid="fullscreen-formula"]')?.getBoundingClientRect().toJSON(),controls=document.querySelector('[data-testid="fullscreen-controls"]')?.getBoundingClientRect().toJSON();
  return {formula,controls,dataset:{...s.dataset},rect,ring:r,ringVisible:!!r&&r.width>0&&r.height>0&&style.display!=='none',ringStyle:style?.borderTopStyle,ringWidth:style?.borderTopWidth,ringFilter:style?.filter,legend:legend?.textContent,legendSize:legend?getComputedStyle(legend).fontSize:null,panel,scope};
 });
 const waitState=async(t,n=10,I=null)=>page.waitForFunction(({t,n,I})=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset,m=JSON.parse(d?.magneticRendered||'null');return m?.geometryType==='finite-solenoid'&&Math.abs(m.t-t)<1e-8&&Number(d?.conductorCount)===n&&(I===null||m.currentI===I);},{t,n,I});
 const checkFrame=(d,name,automatic=true)=>{
  if(!candidate)return;
  const b=JSON.parse(d.dataset.e10SolenoidBounds||'null');
  assert(b!==null,'missing complete scene bounds '+name);if(!b)return;
  if(automatic){
    const {bounds:q,body,safe}=b;
    assert(q.visible&&q.left>=safe.left+15&&q.right<=safe.right-15&&q.top>=safe.top+15&&q.bottom<=safe.bottom-15,'static scene outside safe rectangle '+name+' '+JSON.stringify(b));
    assert(body.visible&&body.left>=q.left-1e-6&&body.right<=q.right+1e-6&&body.top>=q.top-1e-6&&body.bottom<=q.bottom+1e-6,'body outside full projected geometry '+name);
    assert(d.dataset.e10AutoFit==='true','automatic framing unexpectedly disabled '+name);
    if(d.panel&&d.panel.width>0)assert(q.right+12<=d.panel.left-d.rect.left,'scene overlaps inspector '+name);
    assert(b.samples>=b.bodySamples&&b.bodySamples>0,'invalid scene samples '+name);
    assert(b.overlaps===0,'projected actual geometry overlaps a measured floating overlay '+name);
  }
  const q=JSON.parse(d.dataset.e10ParticleProjection||'null');
  if(q&&Number(d.dataset.morphT)===0){
    assert(d.ringVisible===(q.visible&&q.occluded),'ring disagrees with actual mesh projection '+name);
    if(d.ringVisible){
      assert(q.hitDistance<q.centerDistance,'occluder behind particle '+name);
      assert(d.ringStyle==='dashed'&&d.ringWidth==='2px'&&d.ringFilter.includes('drop-shadow'),'locator contrast cues missing '+name);
      assert(Math.abs(d.ring.left+d.ring.width/2-d.rect.left-q.x)<1.1&&Math.abs(d.ring.top+d.ring.height/2-d.rect.top-q.y)<1.1,'ring not at real projected center '+name);
    }
  }
  assert(parseFloat(d.legendSize)>=11,'legend too small '+name);
 };
 // Coordinates are in CSS pixels. Compare mathematically meaningful numeric
 // precision, not JSON serialization of floating roundoff (~2e-13 px in v1).
 const sameRect=(a,b)=>['left','right','top','bottom'].every(k=>Math.abs(a[k]-b[k])<=1e-7)&&a.visible===b.visible;
 const shot=async(name,automatic=true)=>{
  await page.waitForTimeout(220);const d=await read();report.states[name]=d;checkFrame(d,name,automatic);await page.screenshot({path:path.join(out,name+'.png')});return d;
 };
 for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
  [ctx,page]=await setup(viewport);stage=page.getByTestId('three-stage-container');
  const prefix=String(viewport.width);
  await page.getByTestId('preset-select').selectOption('finite-solenoid-3d',{force:true});await waitState(0);
  if(candidate)await page.waitForFunction(()=>!!document.querySelector('[data-testid="three-stage-container"]')?.dataset.e10SolenoidBounds);
  const initial=await shot(prefix+'-initial');
  assert(initial.dataset.fieldLineCount==='33','all original field samples must remain '+prefix);
  const step=page.locator('[data-testid="topbar"] [data-testid="btn-step"]');
  let visibleOccluded=0,visibleClear=0;
  for(let i=1;i<=24;i++){
   await step.click();await waitState(i/60);const d=await read();const p=JSON.parse(d.dataset.e10ParticleProjection||'null');
   if(p?.visible){if(p.occluded){visibleOccluded++;if(visibleOccluded===1){report.states[prefix+'-first-occlusion']=d;await page.screenshot({path:path.join(out,prefix+'-first-occlusion.png')});}}else visibleClear++;}
   if(candidate)checkFrame(d,prefix+'-step-'+i);
  }
  report[prefix+'OcclusionFrames']={visibleOccluded,visibleClear};
  const t040=await shot(prefix+'-t040');
  if(candidate){const a=JSON.parse(initial.dataset.e10SolenoidBounds),b=JSON.parse(t040.dataset.e10SolenoidBounds);assert(sameRect(a.bounds,b.bounds)&&sameRect(a.body,b.body)&&JSON.stringify(a.safe)===JSON.stringify(b.safe)&&a.samples===b.samples&&a.bodySamples===b.bodySamples,'automatic framing followed particle time '+prefix);}
  await page.getByTestId('btn-fullscreen-speech').click();await page.getByTestId('fullscreen-controls').waitFor({state:'visible'});await waitState(.4);
  if(candidate)await page.waitForFunction(()=>!!document.querySelector('[data-testid="three-stage-container"]')?.dataset.e10SolenoidBounds);
  const fullscreen=await shot(prefix+'-fullscreen-t040');
  assert(fullscreen.dataset.magneticRendered===t040.dataset.magneticRendered,'fullscreen changed actual paused physical state '+prefix);
  if(viewport.width===1440){
    // Actual WebGL morph and disposal, same fixed physical t.
    const toggle=page.getByTestId('btn-view-3d-fullscreen');
    const gl=await stage.locator('canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2')??canvas.getContext('webgl');window.__H71_GL=gl;return !!gl&&!gl.isContextLost();});assert(gl,'no live WebGL context');
    await toggle.click();await page.waitForFunction(()=>{const t=Number(document.querySelector('[data-testid="three-stage-container"]')?.dataset.morphT);return t>0&&t<1;});
    await stage.waitFor({state:'detached',timeout:15000});await page.getByTestId('simulation-canvas').waitFor({state:'visible'});
    await page.waitForFunction(()=>window.__H71_GL?.isContextLost()===true,null,{timeout:10000});
    await page.screenshot({path:path.join(out,prefix+'-flat-t040.png')});
    await toggle.click();await stage.waitFor({state:'visible'});await waitState(.4);
    await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.morphT==='0');
    const roundtrip=await shot(prefix+'-roundtrip-t040',false);assert(roundtrip.dataset.magneticRendered===t040.dataset.magneticRendered,'morph roundtrip changed paused physics');
  }
  await page.getByTestId('btn-exit-fullscreen-speech').click();await waitState(.4);
  await page.getByTestId('preset-select').selectOption('helmholtz-uniform-core-3d',{force:true});await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.conductorCount==='2');
  await page.getByTestId('preset-select').selectOption('finite-solenoid-3d',{force:true});await waitState(0);
  const current=page.getByTestId('param-slider-currentI');await current.focus();await current.press('Home');for(let i=0;i<9;i++)await current.press('ArrowRight');
  await waitState(0,10,-.5);const beforeZero=await shot(prefix+'-before-zero');await current.press('ArrowRight');
  await waitState(0,10,0);await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.fieldLineCount==='0');
  const zero=await shot(prefix+'-zero');assert(zero.dataset.renderedFieldArrow==='false'&&zero.dataset.renderedForceArrow==='false','zero current retained field/force arrows');
  if(candidate){const a=JSON.parse(beforeZero.dataset.e10SolenoidBounds),b=JSON.parse(zero.dataset.e10SolenoidBounds);assert(sameRect(a.body,b.body),'current zero unexpectedly moved camera '+prefix);assert(b.samples===b.bodySamples,'zero current framing claims nonexistent field points');}
  await page.getByTestId('preset-select').selectOption('finite-solenoid-3d',{force:true});await waitState(0,10,2);
  const turns=page.getByTestId('param-slider-solenoidTurns'),radius=page.getByTestId('param-slider-radiusR');
  await turns.focus();await turns.press('End');await waitState(0,16,2);await radius.focus();await radius.press('End');
  await page.waitForFunction(()=>{const m=JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered||'null');return m?.t===0&&m?.radiusR===1.6;});
  const maximum=await shot(prefix+'-maximum');assert(maximum.dataset.fieldLineCount==='33','maximum turns/radius lost field geometry');
  // Explicit user camera ownership during orbit and extreme zoom.
  const box=await stage.locator('canvas').boundingBox(),widget=page.locator('[data-magnetic-axis-widget]'),axis=await widget.getAttribute('data-axis-orientation');
  await page.mouse.move(box.x+box.width*.42,box.y+box.height*.35);await page.mouse.down();await page.mouse.move(box.x+box.width*.34,box.y+box.height*.3,{steps:8});await page.mouse.up();
  await page.waitForFunction(axis=>document.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation')!==axis,axis);
  await page.waitForTimeout(600);const orbit=await shot(prefix+'-manual-orbit',false);
  assert(orbit.dataset.e10AutoFit==='false','manual orbit failed to take ownership');
  assert(orbit.dataset.magneticRendered===maximum.dataset.magneticRendered,'manual orbit altered physics');
  await page.mouse.move(box.x+box.width*.42,box.y+box.height*.35);await page.mouse.wheel(0,-1200);await page.waitForTimeout(600);
  const zoom=await shot(prefix+'-manual-zoom',false);assert(zoom.dataset.e10AutoFit==='false','zoom gave automatic camera ownership back');assert(zoom.dataset.magneticRendered===maximum.dataset.magneticRendered,'zoom altered paused physical state');
  await page.getByTestId('btn-reset-view').click();await page.waitForTimeout(600);
  const reset=await shot(prefix+'-reset');
  if(candidate)assert(reset.dataset.e10AutoFit==='true','explicit view reset did not restore automatic framing');
  assert(reset.dataset.magneticRendered===maximum.dataset.magneticRendered,'view reset altered physics');
  await ctx.close();ctx=null;
 }
 if(report.errors.length||report.network.length||report.failedResponses.length)report.issues.push('browser/network errors');
}catch(e){report.issues.push(String(e));}
finally{if(ctx)await ctx.close();if(browser)await browser.close();await new Promise(r=>server.close(r));report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,errors:report.errors,network:report.network,failedResponses:report.failedResponses,states:Object.keys(report.states)}));if(report.issues.length)process.exitCode=1;}
