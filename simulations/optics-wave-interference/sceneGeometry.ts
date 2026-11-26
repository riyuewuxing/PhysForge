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
  const count=Math.max(1200,Math.min(12000,Math.ceil(16*span*(p.mode==='single-slit-grating'&&p.slitCountN>1?p.slitCountN*p.gratingPitchMicron/lambda:1))));
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
let patternCache:{key:string;canvas:HTMLCanvasElement}|undefined;
export function makePattern(p:WaveOpticsParams,hex:string):HTMLCanvasElement|undefined{
  const profile=makeOpticsProfile(p);if(!profile.points.length||typeof document==='undefined')return undefined;
  const key=JSON.stringify(p)+hex;if(patternCache?.key===key)return patternCache.canvas;
  const ring=p.mode==='newtons-rings',wedge=p.mode==='thin-film-wedge';
  const c=document.createElement('canvas');c.width=ring?512:1024;c.height=ring?512:256;
  const ctx=c.getContext('2d');if(!ctx)return undefined;
  const data=ctx.createImageData(c.width,c.height),rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
    const u=(x+.5)/c.width,v=(y+.5)/c.height;
    const q=profile.min+u*(profile.max-profile.min),r=Math.hypot(2*u-1,2*v-1);
    const value=ring?(r<=1?evalNewtonRingIntensity(r*profile.max,p):undefined):wedge?evalThinFilmIntensity(q,p,8*(v-.5)):evalFraunhoferGratingIntensity(q,p);
    const idx=4*(y*c.width+x);
    if(value===undefined){data.data[idx+3]=0;continue;}
    for(let j=0;j<3;j++)data.data[idx+j]=Math.round((rgb[j]??0)*value);
    data.data[idx+3]=255;
  }
  ctx.putImageData(data,0,0);patternCache={key,canvas:c};return c;
}
