import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD;
if(!head||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('Wrong source');
const out=path.resolve('evidence/h81-s02');fs.mkdirSync(out,{recursive:true});
const report={head,cases:[],issues:[],errors:[],external:[]};
const check=(ok,msg)=>{if(!ok)report.issues.push(msg);};
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
let browser;
async function run(base,width){
 const ctx=await browser.newContext({viewport:{width,height:width===1440?900:768},deviceScaleFactor:1,serviceWorkers:'block'});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))report.external.push(r.url());});
 await page.addInitScript(()=>{
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(this.canvas.dataset.testid==='simulation-canvas'&&typeof text==='string'&&text.startsWith('速度选择器 v_sel = E/B = ')){
    window.__s02Paint=text;
   }
   return original.call(this,text,...args);
  };
 });
 try{
  await page.goto(base+'?model=stse-em-devices-suite&preset=velocity-selector-spectrometer',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.modelId==='stse-em-devices-suite');
  const slider=page.getByTestId('param-slider-eFieldVPerM'),bSlider=page.getByTestId('param-slider-bFieldT');
  const before=Number(await slider.inputValue()),B=Number(await bSlider.inputValue());
  check(Number.isFinite(before)&&Number.isFinite(B)&&B>0,width+': finite inputs');
  await page.getByTestId('btn-fullscreen-speech').click();
  const token=page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
  const hud=page.locator('[data-testid="live-formula-hud"]:visible');
  await token.waitFor({state:'visible'});await token.evaluate(n=>window.__s02Token=n);
  const rect=await token.boundingBox();if(!rect)throw Error('token missing bounds');
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  let preview,previewText;
  try{
   await page.mouse.move(x+(before>300000?-60:60),y,{steps:8});
   await hud.waitFor({state:'visible'});
   previewText=await hud.innerText();
   preview=Number(previewText.match(/E:\s*([\d.]+)\s*V\/m/)?.[1]);
   check(previewText.startsWith('预览 ·'),width+': explicit preview label');
   check(Number.isFinite(preview)&&preview!==before,width+': changed finite preview');
   check(await token.evaluate(n=>n===window.__s02Token),width+': KaTeX identity');
   await page.screenshot({path:path.join(out,width+'-drag.png')});
  }finally{await page.mouse.up();}
  await hud.waitFor({state:'hidden'});
  const expected=preview/B;
  const [mantissa,exponent]=expected.toExponential(3).split('e');
  const latex='v_s='+(Number(exponent)===0?mantissa:mantissa+'\\times10^{'+Number(exponent)+'}')+'\\text{ m/s}';
  await page.waitForFunction(({rounded,latex})=>{
   const painted=window.__s02Paint?.includes('= '+rounded+' m/s');
   const rendered=[...document.querySelectorAll('[data-testid="fullscreen-formula"] annotation')].some(n=>n.textContent===latex);
   return painted&&rendered;
  },{rounded:expected.toFixed(0),latex},{timeout:10000});
  const paint=await page.evaluate(()=>window.__s02Paint);
  await page.screenshot({path:path.join(out,width+'-released.png')});
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  const after=Number(await slider.inputValue());
  check(after===preview,width+': final slider equals final preview');
  check(Number(await bSlider.inputValue())===B,width+': B unchanged');
  report.cases.push({width,before,B,previewText,preview,after,expected,paint,latex});
 }catch(e){report.issues.push(String(e?.stack||e));await page.screenshot({path:path.join(out,width+'-failure.png')}).catch(()=>{});}
 finally{await ctx.close();}
}
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port+'/PhysForge/';browser=await chromium.launch({headless:true});await run(base,1440);await run(base,1024);}
catch(e){report.issues.push(String(e?.stack||e));}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
if(report.issues.length||report.errors.length||report.external.length||report.cases.length!==2)throw Error(JSON.stringify(report));
console.log('H81 S02 final committed values verified');
