import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||!['parent','candidate'].includes(role)||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('incorrect checkout');
const out=path.resolve('evidence/h88-o01-safe-view');fs.mkdirSync(out,{recursive:true});
const dist=path.resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const f=path.resolve(dist,decodeURIComponent(u.pathname.replace(/^\/PhysForge\//,'').replace(/^\/+/,''))||'index.html');
 if(!f.startsWith(dist+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(f)]??'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
const report={head,role,cases:[],manual:[],errors:[],issues:[],external:[]};
const presets={
 'newtons-rings-standard':'newtons-rings',
 'newton-dense-outer-rings':'newtons-rings',
 'air-wedge-flat-fringes':'thin-film-wedge',
 'grating-single-slit':'single-slit-grating'
};
function probe(){
 const P=CanvasRenderingContext2D.prototype,draw=P.drawImage,begin=P.beginPath,move=P.moveTo,line=P.lineTo,stroke=P.stroke;
 const paths=new WeakMap();
 const target=c=>c.canvas.dataset.testid==='simulation-canvas';
 window.__o01={pattern:null,curve:null};
 const css=(c,x,y)=>{const p=new DOMPoint(x,y).matrixTransform(c.getTransform()),r=c.canvas.getBoundingClientRect();return [r.left+p.x*r.width/c.canvas.width,r.top+p.y*r.height/c.canvas.height];};
 const rect=(c,x,y,w,h)=>{const a=css(c,x,y),b=css(c,x+w,y+h);return {left:Math.min(a[0],b[0]),right:Math.max(a[0],b[0]),top:Math.min(a[1],b[1]),bottom:Math.max(a[1],b[1])};};
 P.drawImage=function(source,...args){
   if(target(this)&&source instanceof HTMLCanvasElement&&source.width>=32&&source.height>=32&&args.length===4&&args[2]>40&&args[3]>40){
     window.__o01.pattern=rect(this,...args);
   }
   return Reflect.apply(draw,this,[source,...args]);
 };
 P.beginPath=function(...args){if(target(this))paths.set(this,[]);return Reflect.apply(begin,this,args);};
 P.moveTo=function(x,y){if(target(this))paths.get(this)?.push([x,y]);return Reflect.apply(move,this,[x,y]);};
 P.lineTo=function(x,y){if(target(this))paths.get(this)?.push([x,y]);return Reflect.apply(line,this,[x,y]);};
 P.stroke=function(...args){
   const p=paths.get(this);
   if(target(this)&&p?.length>=40&&Math.abs(this.lineWidth-1.6)<1e-6&&this.getLineDash().length===0){
     const a=p[0][0],b=p.at(-1)[0];
     if(b-a>30&&p.every((q,i)=>i===0||q[0]>=p[i-1][0]-1e-8)){
       const y=p.map(q=>q[1]),lo=Math.min(...y),hi=Math.max(...y);
       window.__o01.curve=rect(this,a,lo,b-a,hi-lo);
     }
   }
   return Reflect.apply(stroke,this,args);
 };
}
const snap=()=>{const c=document.querySelector('[data-testid="simulation-canvas"]'),p=document.querySelector('[data-testid="right-control-panel"]'),box=c.getBoundingClientRect(),panel=p?.getBoundingClientRect();return {state:JSON.parse(c.dataset.waveOpticsRendered),canvas:box.toJSON(),panel:panel?.toJSON(),...window.__o01};};
const gaps=d=>({pattern:d.panel.left-d.pattern.right,curve:d.panel.left-d.curve.right,patternLeft:d.pattern.left-d.canvas.left,curveLeft:d.curve.left-d.canvas.left});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1024,768],[1280,800],[1440,900]])for(const dpr of [1,2]){
   const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,serviceWorkers:'block'});
   await ctx.addInitScript(probe);
   const page=await ctx.newPage();page.setDefaultTimeout(10000);
   page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
   page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))report.external.push(r.url());});
   try{
     for(const [preset,mode] of Object.entries(presets)){
       const key=[width,dpr,preset].join('-');
       await page.goto(origin+'PhysForge/?model=optics-wave-interference&preset='+preset,{waitUntil:'load'});
       await page.waitForFunction(mode=>{const c=document.querySelector('[data-testid="simulation-canvas"]');const s=JSON.parse(c?.dataset.waveOpticsRendered||'null');return s?.mode===mode&&s.outerTime===0&&window.__o01?.pattern&&window.__o01?.curve&&document.querySelector('[data-testid="right-control-panel"]')?.getBoundingClientRect().width>0;},mode);
       await page.waitForTimeout(250);
       const data=await page.evaluate(snap),gap=gaps(data);
       if(role==='candidate'&&(gap.pattern<12||gap.curve<12||gap.patternLeft<12||gap.curveLeft<12))report.issues.push(key+' geometry '+JSON.stringify(gap));
       report.cases.push({key,width,height,dpr,preset,...data,gap});
       await page.screenshot({path:path.join(out,key+'.png')});
       if(preset==='newtons-rings-standard'&&dpr===1&&width!==1280){
         const x=data.canvas.left+70,y=data.canvas.bottom-105;
         await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y+15,{steps:6});await page.mouse.up();
         await page.waitForFunction(before=>Math.abs(window.__o01.pattern.left-before)>40,data.pattern.left);
         const manual=await page.evaluate(snap);
         await page.waitForTimeout(250);
         const retained=await page.evaluate(snap);
         await page.mouse.dblclick(x,y);
         await page.waitForFunction(before=>Math.abs(window.__o01.pattern.left-before)<2,data.pattern.left);
         const reset=await page.evaluate(snap);
         if(Math.abs(manual.pattern.left-retained.pattern.left)>2||Math.abs(reset.pattern.left-data.pattern.left)>2)report.issues.push(key+' manual ownership/reset');
         if(role==='candidate'&&gaps(reset).pattern<12)report.issues.push(key+' reset occlusion');
         report.manual.push({key,before:data.pattern,manual:manual.pattern,retained:retained.pattern,reset:reset.pattern});
         await page.screenshot({path:path.join(out,key+'-reset.png')});
       }
     }
   }catch(e){report.errors.push([width,dpr,String(e)].join(':'));await page.screenshot({path:path.join(out,['error',width,dpr].join('-')+'.png')}).catch(()=>{});}
   finally{await ctx.close();}
 }
}finally{await browser?.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.cases.map(({key,gap})=>({key,gap}))));
if(report.cases.length!==24||report.manual.length!==2||report.errors.length||report.external.length||report.issues.length)throw Error(JSON.stringify({cases:report.cases.length,manual:report.manual.length,issues:report.issues,errors:report.errors,external:report.external}));
