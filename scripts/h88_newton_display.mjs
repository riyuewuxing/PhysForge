import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const head=process.env.SOURCE_HEAD,role=process.env.SOURCE_ROLE;
if(!head||!['parent','candidate'].includes(role)||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)throw Error('incorrect source checkout');
const out=path.resolve('evidence/h88-newton-display');fs.mkdirSync(out,{recursive:true});
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
const expected={
 'newtons-rings-standard':{wavelengthNm:589,refractiveIndexN2:1,lensRadiusR:2,halfWaveLoss:true,centerIntensity:0},
 'newton-bright-center':{halfWaveLoss:false,centerIntensity:1},
 'newton-dense-outer-rings':{wavelengthNm:400,refractiveIndexN2:1.8,lensRadiusR:.5,halfWaveLoss:true,centerIntensity:0}
};
function probe(){
 const P=CanvasRenderingContext2D.prototype,draw=P.drawImage,begin=P.beginPath,move=P.moveTo,line=P.lineTo,stroke=P.stroke,text=P.fillText;
 const paths=new WeakMap(),cache=new WeakMap();
 const target=c=>['simulation-canvas','sf-canvas'].includes(c.canvas.dataset.testid);
 window.__newton={pattern:null,curve:null,labels:[]};
 P.drawImage=function(source,...args){
   if(target(this)&&source instanceof HTMLCanvasElement&&source.width>=32&&source.height>=32&&Math.abs(source.width/source.height-1)<.025){
     let stats=cache.get(source);
     if(!stats){
       const g=source.getContext('2d'),w=source.width,h=source.height;
       const d=g?.getImageData(0,0,w,h).data;
       if(d&&d[3]===0&&d[(Math.floor(h/2)*w+Math.floor(w/2))*4+3]===255){
         let max=0,hash=2166136261,outerSum=0,outerSum2=0,n=0,innerPeak=0,centerPeak=0;
         for(let y=0;y<h;y++)for(let x=0;x<w;x++){
           const i=(y*w+x)*4;if(!d[i+3])continue;
           const rr=Math.hypot((x+.5-w/2)/(w/2),(y+.5-h/2)/(h/2));
           const v=Math.max(d[i],d[i+1],d[i+2]);max=Math.max(max,v);
           if(rr<.04){for(let k=0;k<4;k++)hash=Math.imul(hash^d[i+k],16777619);}
           if(rr<.15)innerPeak=Math.max(innerPeak,v);
           if(rr<.01)centerPeak=Math.max(centerPeak,v);
           if(rr>.8&&rr<.95){outerSum+=v;outerSum2+=v*v;n++;}
         }
         if(max>0&&n>0)stats={w,h,max,innerHash:hash>>>0,innerPeak:innerPeak/max,centerPeak:centerPeak/max,outerMean:outerSum/n/max,outerStd:Math.sqrt(Math.max(0,outerSum2/n-(outerSum/n)**2))/max,n};
       }
       if(stats)cache.set(source,stats);
     }
     if(stats)window.__newton.pattern=stats;
   }
   return Reflect.apply(draw,this,[source,...args]);
 };
 P.beginPath=function(...args){if(target(this))paths.set(this,[]);return Reflect.apply(begin,this,args);};
 P.moveTo=function(x,y){if(target(this))paths.get(this)?.push([x,y]);return Reflect.apply(move,this,[x,y]);};
 P.lineTo=function(x,y){if(target(this))paths.get(this)?.push([x,y]);return Reflect.apply(line,this,[x,y]);};
 P.stroke=function(...args){
   const p=paths.get(this);
   if(target(this)&&p?.length>=40&&Math.abs(this.lineWidth-1.6)<1e-6&&this.getLineDash().length===0){
     const a=p[0][0],b=p.at(-1)[0],span=b-a,monotonic=p.every((q,i)=>i===0||q[0]>=p[i-1][0]-1e-8);
     if(span>30&&monotonic){
       const h=.76/4*span,outer=p.filter(q=>{const f=Math.abs(2*(q[0]-a)/span-1);return f>.8&&f<.98;}).map(q=>q[1]/h);
       const mean=outer.reduce((s,v)=>s+v,0)/outer.length;
       window.__newton.curve={count:p.length,span,outerStd:Math.sqrt(outer.reduce((s,v)=>s+(v-mean)**2,0)/outer.length),outerCount:outer.length};
     }
   }
   return Reflect.apply(stroke,this,args);
 };
 P.fillText=function(value,...args){
   if(target(this)){const s=String(value);if(/显示滤波|物理极值|像素均值|中心截面|中心暗|中心亮/.test(s)&&!window.__newton.labels.includes(s))window.__newton.labels.push(s);}
   return Reflect.apply(text,this,[value,...args]);
 };
}
let browser;
try{
 const offlineFile=path.join(out,'O01-offline.html');
 execFileSync(process.execPath,['apps/singlefile-exporter/export.mjs','--model','optics-wave-interference','--preset','newtons-rings-standard','--out',offlineFile],{stdio:'inherit',timeout:90000});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1024,768],[1440,900]])for(const dpr of [1,2])for(const offline of [false,true]){
   const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,offline,serviceWorkers:'block'});
   await ctx.addInitScript(probe);
   const page=await ctx.newPage();page.setDefaultTimeout(10000);
   page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
   page.on('request',r=>{if(/^https?:/.test(r.url())&&(offline||!r.url().startsWith(origin)))report.external.push(r.url());});
   try{
     for(const [preset,want] of Object.entries(expected)){
       const key=[offline?'offline':'online',width,dpr,preset].join('-'),canvasId=offline?'sf-canvas':'simulation-canvas';
       await page.goto(offline?pathToFileURL(offlineFile).href:origin+'PhysForge/?model=optics-wave-interference&preset='+preset,{waitUntil:'load'});
       if(offline&&preset!=='newtons-rings-standard'){
         await page.waitForFunction(()=>window.__newton?.pattern&&window.__newton?.curve);
         await page.evaluate(()=>{window.__newton={pattern:null,curve:null,labels:[]};});
         await page.getByTestId('sf-o01-presets').selectOption(preset);
       }
       await page.waitForFunction(({canvasId,want})=>{
         const canvas=document.querySelector('[data-testid="'+canvasId+'"]');
         const s=JSON.parse(canvas?.dataset.waveOpticsRendered||'null');
         return s&&s.mode==='newtons-rings'&&s.outerTime===0&&Object.entries(want).every(([k,v])=>s[k]===v)&&window.__newton?.pattern&&window.__newton?.curve;
       },{canvasId,want});
       const data=await page.evaluate(canvasId=>({state:JSON.parse(document.querySelector('[data-testid="'+canvasId+'"]').dataset.waveOpticsRendered),...window.__newton}),canvasId);
       const p=data.state,h=p.wavelengthNm*1e-9/(p.halfWaveLoss?2*p.refractiveIndexN2:4*p.refractiveIndexN2),r=1000*Math.sqrt(h*(2*p.lensRadiusR-h));
       if(Math.abs(p.newtonFirstDarkMm-r)>1e-8||p.centerIntensity!==want.centerIntensity)report.issues.push(key+' physical radius/phase');
       if(!data.pattern||!data.curve||!Number.isFinite(data.pattern.outerStd)||!Number.isFinite(data.curve.outerStd))report.issues.push(key+' missing actual draw evidence');
       if(role==='candidate'&&preset==='newton-dense-outer-rings'){
         // At the rendered outer annulus the local fringe frequency is high.
         // The curve and image must not produce strong low-frequency aliases.
         if(data.pattern.outerStd>.012||Math.abs(data.pattern.outerMean-.5)>.035||data.curve.outerStd>.012)report.issues.push(key+' residual dense contrast '+JSON.stringify({pattern:data.pattern,curve:data.curve}));
         if(!data.labels.some(s=>s.includes('显示滤波'))||!data.labels.some(s=>s.includes('物理极值')))report.issues.push(key+' missing display semantics');
       }
       report.cases.push({key,width,height,dpr,offline,preset,...data});
       await page.screenshot({path:path.join(out,key+'.png')});
     }
   }catch(e){report.errors.push([offline,width,dpr,String(e)].join(':'));await page.screenshot({path:path.join(out,['error',offline,width,dpr].join('-')+'.png')}).catch(()=>{});}
   finally{await ctx.close();}
 }
}finally{await browser?.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.cases.map(({key,pattern,curve})=>({key,pattern,curve}))));
if(report.cases.length!==24||report.errors.length||report.external.length||report.issues.length)throw Error(JSON.stringify({cases:report.cases.length,issues:report.issues,errors:report.errors,external:report.external}));
