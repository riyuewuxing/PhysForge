import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||!['hohmann','newton','safe'].includes(role)||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('incorrect checkout');
const out=path.resolve('evidence/h88-s02-formula-sync');fs.mkdirSync(out,{recursive:true});
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
const report={head,role,cases:[],issues:[],errors:[],external:[]};
function probe(){
 const P=CanvasRenderingContext2D.prototype,original=P.fillText;
 const trace=window.__s02={label:null,draws:[],moves:[],hud:[]};
 P.fillText=function(value,...args){
   const result=Reflect.apply(original,this,[value,...args]);
   if(this.canvas.dataset.testid==='simulation-canvas'){
     const s=String(value),m=s.match(/v_sel\s*=\s*E\/B\s*=\s*(\d+)\s*m\/s/);
     if(m){const v={text:s,speed:Number(m[1]),at:performance.now()};trace.label=v;if(trace.draws.at(-1)?.speed!==v.speed)trace.draws.push(v);}
   }
   return result;
 };
 for(const type of ['pointerdown','pointermove','pointerup']){
   document.addEventListener(type,e=>{
     if(e.target instanceof Element&&e.target.closest('.pf-live-var')){
       trace.moves.push({type,x:e.clientX,y:e.clientY,trusted:e.isTrusted,at:performance.now()});
     }
   },true);
 }
 const observe=()=>{
   const h=document.querySelector('[data-testid="live-formula-hud"]:not([hidden])');
   if(h){
     const v={preview:h.firstElementChild?.textContent,pending:h.dataset.pending,applied:h.dataset.appliedValue};
     if(JSON.stringify(v)!==JSON.stringify(trace.hud.at(-1)?.value))trace.hud.push({value:v,at:performance.now()});
   }
 };
 new MutationObserver(observe).observe(document,{subtree:true,childList:true,attributes:true,characterData:true,attributeFilter:['data-pending','data-applied-value','hidden']});
}
const snap=()=>{const h=document.querySelector('[data-testid="live-formula-hud"]:not([hidden])');return {preview:h?.firstElementChild?.textContent??null,applied:h?.dataset.appliedValue??null,pending:h?.dataset.pending??null,painted:h?.querySelector('[data-testid="live-formula-painted-value"]')?.textContent??null,label:window.__s02.label};};
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1024,768],[1440,900]])for(const dpr of [1,2]){
   const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,serviceWorkers:'block'});
   await ctx.addInitScript(probe);const page=await ctx.newPage();page.setDefaultTimeout(12000);
   page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
   page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))report.external.push(r.url());});
   try{
     for(const [param,expected,expectedSpeed] of [['eFieldVPerM',320000,320000],['bFieldT',2,100000]]){
       const key=[width,dpr,param].join('-');
       await page.goto(origin+'PhysForge/?model=stse-em-devices-suite&preset=velocity-selector-spectrometer',{waitUntil:'networkidle'});
       const shell=page.getByTestId('app-shell');await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='stse-em-devices-suite');
       const slider=page.getByTestId('param-slider-'+param),before=Number(await slider.inputValue());
       if(before!==(param==='eFieldVPerM'?200000:1))throw Error('unexpected before '+before);
       await page.getByTestId('btn-fullscreen-speech').click();
       const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="'+param+'"]').first();
       await token.waitFor({state:'visible'});await page.waitForFunction(()=>window.__s02.label?.speed===200000);
       await token.evaluate(n=>{window.__s02Token=n;});
       const rect=await token.boundingBox();if(!rect)throw Error('no token rect');
       const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
       await page.mouse.move(x,y);await page.mouse.down();
       let immediate,settled,held;
       try{
         await page.mouse.move(x+60,y,{steps:8});
         const hud=page.locator('[data-testid="live-formula-hud"]:visible');await hud.waitFor({state:'visible'});
         immediate=await page.evaluate(snap);
         // Deterministic capture barrier: the preview, acknowledgement from the
         // actual drawn frame and independently captured canvas label must agree.
         await page.waitForFunction(({expected,expectedSpeed})=>{
           const h=document.querySelector('[data-testid="live-formula-hud"]:not([hidden])');
           return h?.dataset.pending==='false'&&Number(h.dataset.appliedValue)===expected&&window.__s02.label?.speed===expectedSpeed;
         },{expected,expectedSpeed},{timeout:10000});
         settled=await page.evaluate(snap);
         if(!await token.evaluate(n=>n===window.__s02Token))throw Error('token replaced');
         await page.screenshot({path:path.join(out,key+'-held.png')});
         held=await page.evaluate(snap);
         if(held.pending!=='false'||Number(held.applied)!==expected||held.label?.speed!==expectedSpeed)throw Error('barrier not stable');
       }finally{await page.mouse.up();}
       await page.getByTestId('btn-exit-fullscreen-speech').click();
       await page.waitForFunction(({param,expected,expectedSpeed})=>{
         const slider=document.querySelector('[data-testid="param-slider-'+param+'"]');
         return Number(slider?.value)===expected&&window.__s02.label?.speed===expectedSpeed;
       },{param,expected,expectedSpeed},{timeout:10000});
       const after=Number(await slider.inputValue()),trace=await page.evaluate(()=>window.__s02);
       const input=trace.moves.filter(m=>m.type==='pointermove'&&m.trusted);
       const start=trace.moves.find(m=>m.type==='pointerdown'),end=trace.moves.find(m=>m.type==='pointerup');
       if(!start||!end||!input.length||Math.abs(end.x-start.x-60)>1||Math.abs(end.y-start.y)>1)throw Error('wrong pointer trajectory');
       report.cases.push({key,width,height,dpr,param,before,expected,expectedSpeed,after,immediate,settled,held,trace});
       await page.screenshot({path:path.join(out,key+'-committed.png')});
     }
   }catch(e){report.errors.push([width,dpr,String(e)].join(':'));await page.screenshot({path:path.join(out,['error',width,dpr].join('-')+'.png')}).catch(()=>{});}
   finally{await ctx.close();}
 }
}finally{await browser?.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.cases.map(({key,immediate,settled,after})=>({key,immediate,settled,after}))));
if(report.cases.length!==8||report.errors.length||report.external.length||report.issues.length)throw Error(JSON.stringify({cases:report.cases.length,issues:report.issues,errors:report.errors,external:report.external}));
