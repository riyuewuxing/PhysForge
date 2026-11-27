import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h81-title');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],issues:[],errors:[],external:[]};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const dist=path.resolve('apps/web/dist');
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
const rgb=s=>s.match(/[\d.]+/g)?.slice(0,3).map(Number); // only CSS rgb() surface; title is converted by browser to sRGB below
const lum=a=>a.map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((p,x,i)=>p+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const v=[lum(a),lum(b)].sort((x,y)=>y-x);return (v[0]+.05)/(v[1]+.05);};
let browser;
async function capture(page,name,paper,three){
 await page.getByTestId('fullscreen-title').waitFor({state:'visible'});
 const d=await page.evaluate(()=>{
  const t=document.querySelector('[data-testid="fullscreen-title"]');
  const stage=document.querySelector('[data-testid="stage-canvas-box"]');
  const c=stage.querySelector('canvas');
  const card=document.querySelector('[data-testid="fullscreen-formula"]');
  const r=t.getBoundingClientRect(),s=stage.getBoundingClientRect();
  const rgbAt=[];
  const colorProbe=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const asRGB=color=>{colorProbe.clearRect(0,0,1,1);colorProbe.fillStyle=color;colorProbe.fillRect(0,0,1,1);return [...colorProbe.getImageData(0,0,1,1).data].slice(0,3);};
  if(c?.dataset.testid==='simulation-canvas'){
   const ctx=c.getContext('2d'),cr=c.getBoundingClientRect();
   for(const [x,y] of [[r.left+2,r.top+2],[r.left+2,r.top+r.height/2],[r.left+2,r.bottom-2]]){
    const px=Math.round((x-cr.left)*c.width/cr.width),py=Math.round((y-cr.top)*c.height/cr.height);
    if(px>=0&&py>=0&&px<c.width&&py<c.height){const p=[...ctx.getImageData(px,py,1,1).data];if(p[3]===255)rgbAt.push(p.slice(0,3));}
   }
  }
  return {theme:document.documentElement.dataset.theme,three:!!stage.querySelector('[data-testid="three-stage-container"] canvas'),has2d:!!stage.querySelector('[data-testid="simulation-canvas"]'),title:getComputedStyle(t.children[0]).color,subtitle:getComputedStyle(t.children[1]).color,titleRGB:asRGB(getComputedStyle(t.children[0]).color),subtitleRGB:asRGB(getComputedStyle(t.children[1]).color),filter:getComputedStyle(t).filter,bg:getComputedStyle(stage).backgroundColor,sample:rgbAt,text:t.innerText,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},stage:{left:s.left,right:s.right,top:s.top,bottom:s.bottom},formula:card?{text:card.innerText.slice(0,200),left:card.getBoundingClientRect().left}:null};
 });
 report.cases.push({name,...d});
 check(d.theme===(paper?'projector':'chalkboard'),name+': wrong theme');
 check(d.three===three,name+': wrong mounted stage');
 check(d.text.trim().length>8,name+': missing title');
 check(d.rect.left>=d.stage.left&&d.rect.right<=d.stage.right&&d.rect.top>=d.stage.top&&d.rect.bottom<=d.stage.bottom,name+': title outside stage');
 if(d.formula)check(d.rect.right<=d.formula.left,name+': title/formula overlap');
 const bg=three?[11,15,23]:rgb(d.bg);
 for(const [k,color] of [['title',d.titleRGB],['subtitle',d.subtitleRGB]]){
  check(color?.length===3&&contrast(color,bg)>=4.5,name+': '+k+' contrast vs reference surface '+color+' / '+bg);
  for(const actual of d.sample)check(contrast(color,actual)>=4.5,name+': '+k+' contrast vs actual 2D canvas sample '+actual);
 }
 if(paper&&!three){check(d.filter==='none',name+': paper shadow');check(d.title==='rgb(15, 23, 42)'&&d.subtitle==='rgb(71, 85, 105)',name+': wrong paper color');}
 else{check(d.filter!=='none',name+': dark shadow lost');check(lum(d.titleRGB)>.6&&lum(d.subtitleRGB)>.25,name+': dark-stage text not bright');}
 await page.screenshot({path:path.join(out,name+'.png')});
}
async function theme(page,target){
 if(await page.locator('html').getAttribute('data-theme')===target)return;
 const menu=page.getByTestId('tools-menu'),btn=page.getByTestId('btn-tools-menu');
 if(!await menu.isVisible())await btn.click();await page.getByTestId('btn-theme').click();
 await page.waitForFunction(t=>document.documentElement.dataset.theme===t,target);
 if(await menu.isVisible())await btn.click();
}
async function openModel(page,base,id){await page.goto(base+'?model='+id,{waitUntil:'networkidle'});await page.waitForFunction(id=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId===id,id);}
async function fullscreen(page){await page.getByTestId('btn-fullscreen-speech').click();await page.getByTestId('fullscreen-title').waitFor();}
async function exit(page){await page.getByTestId('btn-exit-fullscreen-speech').click();}
async function run(base,width){
 const ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 try{
  await openModel(page,base,'em-capacitor-millikan');await theme(page,'projector');
  await page.getByTestId('preset-select').selectOption('capacitor-reference-double-gap',{force:true});
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.switchMode==='open-const-q');
  await fullscreen(page);await page.waitForTimeout(300);
  await capture(page,width+'-e02-paper',true,false);
  const p=await page.getByTestId('simulation-canvas').getAttribute('data-capacitor-rendered');
  const s=JSON.parse(p);check(Math.abs(s.capacitancePF-8.8541878128)<1e-7&&Math.abs(s.voltageV-400)<1e-7&&Math.abs(s.fieldEy+10000)<1e-7,width+': E02 physics');
  await exit(page);await theme(page,'chalkboard');await fullscreen(page);await capture(page,width+'-e02-dark',false,false);await exit(page);
  await openModel(page,base,'em-3d-magnetic-fields');await theme(page,'projector');
  await page.locator('[data-testid="three-stage-container"] canvas').waitFor({state:'visible',timeout:20000});
  await fullscreen(page);await page.waitForFunction(()=>!!document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered);
  await capture(page,width+'-e10-paper-three',true,true);
  await page.getByTestId('btn-view-3d-fullscreen').click();await page.getByTestId('simulation-canvas').waitFor({state:'visible',timeout:20000});
  await capture(page,width+'-e10-paper-flat',true,false);
  await page.getByTestId('btn-view-3d-fullscreen').click();await page.locator('[data-testid="three-stage-container"] canvas').waitFor({state:'visible',timeout:20000});
  await capture(page,width+'-e10-paper-three-again',true,true);
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';browser=await chromium.launch({headless:true});await run(base,1440);await run(base,1024);}
catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==10)throw Error(JSON.stringify(report));
console.log('H81 title contrast cases '+report.cases.length);
