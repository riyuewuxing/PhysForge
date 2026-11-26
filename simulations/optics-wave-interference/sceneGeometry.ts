import {computeKeyOpticsMetrics,evalThinFilmIntensity,evalNewtonRingIntensity,evalFraunhoferGratingIntensity,type WaveOpticsParams,type WaveOpticsState} from './engine.js';
type Sample={u:number;intensity:number};
type Profile={min:number;max:number;axis:string;points:Sample[];ticks:{u:number;label:string}[];marks:{u:number}[]};
let profileCache:{key:string;value:Profile}|undefined;
export function makeOpticsProfile(p:WaveOpticsParams):Profile{
  const key=JSON.stringify(p);if(profileCache?.key===key)return profileCache.value;
  const m=computeKeyOpticsMetrics(p),lambda=p.wavelengthNm*1e-3;
  const wedge=p.mode==='thin-film-wedge',ring=p.mode==='newtons-rings';
  const max=wedge?20:ring?Math.min(5,p.lensRadiusR*100):Math.min(1,Math.max(.25,2.2*lambda/p.slitWidthMicron));
  const min=wedge?0:-max,span=max-min;
  const evaluator=(x:number)=>wedge?evalThinFilmIntensity(x,p):ring?evalNewtonRingIntensity(x,p):evalFraunhoferGratingIntensity(x,p);
  const points:Sample[]=[],marks:{u:number}[]=[];
  // Maximum physical phase cycles per horizontal unit; never let a fixed
  // sample count alias the dense outer Newton fringes on legal extrema.
  const r=max*1e-3,R=p.lensRadiusR;
  const ringCycles=ring?2*p.refractiveIndexN2*r/(lambda*1e-6*Math.sqrt((R-r)*(R+r)))*1e-3:0;
  const gratingCycles=p.mode==='single-slit-grating'?Math.max(p.slitWidthMicron,p.slitCountN>1?p.slitCountN*p.gratingPitchMicron:0)/lambda:0;
  const wedgeCycles=wedge?2*p.refractiveIndexN2*(Math.abs(Math.tan(p.wedgeAngleDeg*Math.PI/180))*1000+(p.defectMode==='flat'?0:.18))/lambda:0;
  const count=Math.max(1200,Math.min(16000,Math.ceil(12*span*Math.max(ringCycles,gratingCycles,wedgeCycles,1))));
  for(let i=0;i<=count;i++){const u=i/count,v=evaluator(min+span*u);if(v!==undefined&&Number.isFinite(v))points.push({u,intensity:v});}
  if(ring&&m.newtonR1Mm!==undefined&&m.newtonR1Mm<=max){marks.push({u:(-m.newtonR1Mm-min)/span},{u:(m.newtonR1Mm-min)/span});}
  if(!wedge&&!ring&&m.gratingValid&&p.slitCountN>1)for(const k of m.missingOrders){
    const q=k*lambda/p.gratingPitchMicron;if(q<=max){marks.push({u:(-q-min)/span},{u:(q-min)/span});}
  }
  for(const mark of marks){const v=evaluator(min+span*mark.u);if(v!==undefined)points.push({u:mark.u,intensity:v});}
  points.sort((a,b)=>a.u-b.u);
  const ticks=Array.from({length:5},(_,i)=>{const u=i/4,v=min+span*u;return {u,label:wedge||ring?v.toFixed(1):v.toFixed(2)}});
  const value={min,max,axis:wedge?'x / mm':ring?'径向截面 / mm':'sin θ',points,ticks,marks};
  profileCache={key,value};return value;
}
export function opticsReadout(s:WaveOpticsState,p:WaveOpticsParams):string{
  const m=s.metrics;
  if(p.mode==='thin-film-wedge')return m.wedgeSpacingMm===undefined?'无有限周期间距':'理想 Δx = '+m.wedgeSpacingMm.toFixed(3)+' mm';
  if(p.mode==='newtons-rings')return m.newtonR1Mm===undefined?'无有效第一正暗环':'第一正暗环 r₁ = '+m.newtonR1Mm.toFixed(3)+' mm';
  if(!m.gratingValid)return 'd < a · 无效几何';
  if(p.slitCountN===1)return '单缝 · 无光栅级次';
  const listed=m.missingOrders.slice(0,4).join('、');
  return '缺级 |k|：'+(listed||'无')+(m.missingOrders.length>4?'…（共 '+m.missingOrders.length+' 个正级）':'');
}
// For a displayed pixel, integrate the locally linear interference phase
// across its square/rectangular footprint. This suppresses unresolved outer
// rings rather than drawing a spurious aliased fringe. The phase curvature
// error is O(pixel size squared); optical point intensity remains untouched.
export function averageNewtonPixel(p:WaveOpticsParams,xMm:number,yMm:number,dxMm:number,dyMm:number):number|undefined{
  const rMm=Math.hypot(xMm,yMm),I=evalNewtonRingIntensity(rMm,p);
  if(I===undefined)return undefined;
  const r=rMm*1e-3,R=p.lensRadiusR,den=Math.sqrt((R-r)*(R+r));
  const factor=4*Math.PI*p.refractiveIndexN2/(p.wavelengthNm*1e-9*den)*1e-6;
  const sinc=(z:number)=>z===0?1:Math.sin(z)/z;
  return Math.max(0,Math.min(1,.5+(I-.5)*sinc(factor*xMm*dxMm/2)*sinc(factor*yMm*dyMm/2)));
}
let patternCache:{key:string;canvas:HTMLCanvasElement}|undefined;
export function makePattern(p:WaveOpticsParams,hex:string,widthPx:number,heightPx:number):HTMLCanvasElement|undefined{
  const profile=makeOpticsProfile(p);if(!profile.points.length||typeof document==='undefined')return undefined;
  const ring=p.mode==='newtons-rings',wedge=p.mode==='thin-film-wedge';
  const w=Math.max(32,Math.min(1600,Math.ceil(widthPx))),h=Math.max(32,Math.min(1200,Math.ceil(heightPx)));
  const key=JSON.stringify(p)+hex+':'+w+':'+h;if(patternCache?.key===key)return patternCache.canvas;
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d');if(!ctx)return undefined;
  const data=ctx.createImageData(w,h),rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const span=profile.max-profile.min,dx=span/w,dy=(ring?span:8)/h,lambda=p.wavelengthNm*1e-3;
  const samplesX=Math.max(1,Math.min(48,Math.ceil(8*dx*(wedge?2*p.refractiveIndexN2*(1000*Math.abs(Math.tan(p.wedgeAngleDeg*Math.PI/180))+.18)/lambda:Math.max(p.slitWidthMicron,p.slitCountN>1?p.slitCountN*p.gratingPitchMicron:0)/lambda))));
  const samplesY=wedge&&p.defectMode!=='flat'?Math.max(1,Math.min(12,Math.ceil(8*dy*2*p.refractiveIndexN2*.18/lambda))):1;
  const column=(x:number,yMm:number)=>{
    let sum=0;
    for(let j=0;j<samplesY;j++)for(let i=0;i<samplesX;i++){
      const q=profile.min+dx*(x+(i+.5)/samplesX),yy=yMm+dy*((j+.5)/samplesY-.5);
      sum+=(wedge?evalThinFilmIntensity(q,p,yy):evalFraunhoferGratingIntensity(q,p))??0;
    }
    return sum/(samplesX*samplesY);
  };
  const columnValues=!ring&&(!wedge||p.defectMode==='flat')?Array.from({length:w},(_,x)=>column(x,0)):undefined;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=(x+.5)/w,v=(y+.5)/h;
    const xx=profile.min+span*u,yy=profile.min+span*v;
    const value=ring?(Math.hypot(xx,yy)<=profile.max?averageNewtonPixel(p,xx,yy,dx,dy):undefined):(columnValues?.[x]??column(x,8*(v-.5)));
    const idx=4*(y*w+x);
    if(value===undefined){data.data[idx+3]=0;continue;}
    for(let j=0;j<3;j++)data.data[idx+j]=Math.round((rgb[j]??0)*value);
    data.data[idx+3]=255;
  }
  ctx.putImageData(data,0,0);patternCache={key,canvas:c};return c;
}
