import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(source!==process.env.EXPECTED_SOURCE)throw Error('Wrong source '+source);
const out=path.resolve('evidence/h70-focus');fs.mkdirSync(out,{recursive:true});
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
 let page;[ctx,page]=await setup({width:1440,height:900});
 let stage=page.getByTestId('three-stage-container'),preset=page.getByTestId('preset-select');
 const read=async()=>stage.evaluate(s=>{
  const ring=s.querySelector('[data-testid="e10-occlusion-ring"]'),legend=s.querySelector('[data-testid="e10-focus-legend"]');
  const rect=s.getBoundingClientRect().toJSON(),r=ring?.getBoundingClientRect().toJSON();
  const panel=document.querySelector('[data-testid="right-control-panel"]')?.getBoundingClientRect().toJSON();
  return {dataset:{...s.dataset},rect,ring:r,ringVisible:!!r&&r.width>0&&r.height>0&&getComputedStyle(ring).display!=='none',ringStyle:ring?getComputedStyle(ring).borderTopStyle:null,legend:legend?.textContent,panel};
 });
 const shot=async name=>{await page.waitForTimeout(160);report.states[name]=await read();await page.screenshot({path:path.join(out,name+'.png')});return report.states[name];};
 const waitState=async (geometry,t,n)=>page.waitForFunction(({geometry,t,n})=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset,m=JSON.parse(d?.magneticRendered||'null');return m?.geometryType===geometry&&Math.abs(m.t-t)<1e-8&&Number(d?.conductorCount)===n;},{geometry,t,n});
 await preset.selectOption('finite-solenoid-3d',{force:true});await waitState('finite-solenoid',0,10);
 const assert=(ok,msg)=>{if(!ok)report.issues.push(msg);};
 const seen={occluded:0,clear:0};
 const ringCheck=async(name,write=false)=>{
   const d=await read();if(!candidate)return d;
   const q=JSON.parse(d.dataset.e10ParticleProjection||'null');
   assert(q!==null,'missing real projection '+name);if(!q)return d;
   const should=q.visible&&q.occluded;assert(d.ringVisible===should,'ring visibility disagrees with conductor ray '+name);
   if(should){
    seen.occluded++;
    assert(q.hitDistance<q.centerDistance,'ray hit not nearer '+name);
    assert(d.ringStyle==='dashed','locator is not explicitly dashed '+name);
    assert(Math.abs(d.ring.left+d.ring.width/2-d.rect.left-q.x)<1.1&&Math.abs(d.ring.top+d.ring.height/2-d.rect.top-q.y)<1.1,'actual ring center differs from projected physical center '+name);
    if(write&&seen.occluded===1){report.states['first-occlusion']=d;await page.screenshot({path:path.join(out,'first-occlusion.png')});}
   }else if(q.visible){seen.clear++;if(write&&seen.clear===1){report.states['first-clear']=d;await page.screenshot({path:path.join(out,'first-clear.png')});}}
   return d;
 };
 let initial=await shot('solenoid-initial');
 assert(initial.dataset.fieldLineCount==='33','solenoid actual line count changed');
 if(candidate){assert(initial.dataset.e10MeridianCount==='11'&&initial.dataset.e10ContextCount==='22','meridian/context actual mesh counts');assert(initial.legend?.includes('非场强'),'missing hierarchy teaching legend');}
 await ringCheck('initial',true);
 const step=page.locator('[data-testid="topbar"] [data-testid="btn-step"]');
 for(let i=1;i<=48;i++){
  await step.click();await waitState('finite-solenoid',i/60,10);
  await ringCheck('step-'+i,true);
  if(i===24){
   await shot('solenoid-t040');
   await page.getByTestId('btn-fullscreen-speech').click();
   await page.getByTestId('fullscreen-controls').waitFor({state:'visible'});await waitState('finite-solenoid',i/60,10);
   await shot('solenoid-fullscreen-t040');await ringCheck('fullscreen-t040');
   await page.getByTestId('btn-exit-fullscreen-speech').click();await waitState('finite-solenoid',i/60,10);
  }
 }
 report.occlusionFrames=seen;
 if(candidate)assert(seen.occluded>0&&seen.clear>0,'did not independently observe both occluded and clear real frames');
 const conductor=page.getByLabel('3D 载流线圈/导线',{exact:true});
 if(!await conductor.isVisible())await page.getByText('更多参数与图层',{exact:false}).first().click();
 await conductor.uncheck();await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.conductorCount==='0');
 const hidden=await shot('conductors-hidden');if(candidate){const q=JSON.parse(hidden.dataset.e10ParticleProjection);assert(!q.occluded&&!hidden.ringVisible,'hidden conductor left false occlusion');}
 await conductor.check();await waitState('finite-solenoid',.8,10);
 await ctx.close();ctx=null;
 report.wires=[];
 for(const viewport of [{width:1440,height:900},{width:1024,height:768}]){
  [ctx,page]=await setup(viewport);stage=page.getByTestId('three-stage-container');preset=page.getByTestId('preset-select');
  await preset.selectOption('finite-wire-reverse',{force:true});await waitState('straight-wire',0,1);
  for(const geometry of ['straight-wire','parallel-wires']){
   if(geometry==='parallel-wires'){await page.locator('#param-geometryType').selectOption(geometry);await waitState(geometry,0,2);}
   const d=await shot(viewport.width+'-'+geometry);
   const item={viewport,geometry,state:d};
   if(candidate){
    const b=JSON.parse(d.dataset.e10WireBounds||'null');assert(b!==null,'missing real wire projection');
    if(b){const {bounds:q,safe}=b;assert(q.visible&&q.left>=safe.left+15&&q.right<=safe.right-15&&q.top>=safe.top+15&&q.bottom<=safe.bottom-15,'wire physical geometry crosses safety rect '+geometry+' '+viewport.width+' '+JSON.stringify(b));if(d.panel)assert(q.right+12<=d.panel.left-d.rect.left,'wire overlaps actual inspector '+geometry+' '+viewport.width);item.bounds=b;}
    assert(d.dataset.e10AutoFit==='true','automatic initial wire view not enabled');
   }
   report.wires.push(item);
  }
  if(candidate){
   const before=await read();const box=await stage.locator('canvas').boundingBox();
   const widget=page.locator('[data-magnetic-axis-widget]'),axis=await widget.getAttribute('data-axis-orientation');
   await page.mouse.move(box.x+box.width*.45,box.y+box.height*.38);await page.mouse.down();await page.mouse.move(box.x+box.width*.37,box.y+box.height*.32,{steps:8});await page.mouse.up();
   await page.waitForFunction(axis=>document.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation')!==axis,axis);
   await page.waitForTimeout(800);const moved=await shot(viewport.width+'-manual-orbit');
   assert(moved.dataset.e10AutoFit==='false','manual orbit did not take ownership');
   assert(moved.dataset.magneticRendered===before.dataset.magneticRendered,'manual orbit altered physical frame');
  }
  await ctx.close();ctx=null;
 }
 if(report.errors.length||report.network.length||report.failedResponses.length)report.issues.push('browser/network errors');
}catch(e){report.issues.push(String(e));}
finally{if(ctx)await ctx.close();if(browser)await browser.close();await new Promise(r=>server.close(r));report.status=report.issues.length?'FAIL':'PASS';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,issues:report.issues,errors:report.errors,network:report.network,failedResponses:report.failedResponses,states:Object.keys(report.states),occlusionFrames:report.occlusionFrames,wires:report.wires?.map(x=>({viewport:x.viewport,geometry:x.geometry,bounds:x.bounds}))}));if(report.issues.length)process.exitCode=1;}
