import type {DiagramPrimitive} from '@physforge/sim-sdk';
import {computeKeyOpticsMetrics,evalWedgeThicknessMeters,evalThinFilmIntensity,evalNewtonRingIntensity,evalFraunhoferGratingIntensity,type WaveOpticsParams,type WaveOpticsState} from './engine.js';
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
// Pixel-footprint integration above is a physical display average, but a
// rectangular reconstruction has sidelobes beyond Nyquist. Apply a separate,
// explicitly display-only local Gaussian attenuation there. It is a locally
// linear phase approximation, not a change to the optical point intensity,
// geometry, physical bin extrema or exported profile.
// The transition preserves resolved fringes (<= 1/4 cycle per pixel) exactly.
export function newtonDisplayGain(p:WaveOpticsParams,xMm:number,yMm:number,dxMm:number,dyMm:number):number{
  const r=Math.hypot(xMm,yMm)*1e-3,R=p.lensRadiusR,lambda=p.wavelengthNm*1e-9;
  if(![r,R,lambda,p.refractiveIndexN2,dxMm,dyMm].every(Number.isFinite)||
    R<=r||lambda<=0||p.refractiveIndexN2<=0||dxMm<0||dyMm<0)return 1;
  const factor=4*Math.PI*p.refractiveIndexN2/(lambda*Math.sqrt((R-r)*(R+r)))*1e-6;
  const phaseStep=Math.hypot(factor*xMm*dxMm,factor*yMm*dyMm);
  const f=phaseStep/(2*Math.PI),t=Math.max(0,Math.min(1,(f-.25)/.25));
  if(t===0)return 1;
  const weight=t*t*(3-2*t);
  // Sigma is 0.65 display pixels; smooth onset reaches full filtering at
  // Nyquist. Unlike a sinc, this has no high-frequency contrast revival.
  return 1+weight*Math.expm1(-.5*(.65*phaseStep)**2);
}
export function filterNewtonDisplayMean(p:WaveOpticsParams,mean:number,xMm:number,yMm:number,dxMm:number,dyMm:number):number{
  return Math.max(0,Math.min(1,.5+(mean-.5)*newtonDisplayGain(p,xMm,yMm,dxMm,dyMm)));
}
export function averageNewtonDisplayPixel(p:WaveOpticsParams,xMm:number,yMm:number,dxMm:number,dyMm:number):number|undefined{
  const mean=averageNewtonPixel(p,xMm,yMm,dxMm,dyMm);
  return mean===undefined?undefined:filterNewtonDisplayMean(p,mean,xMm,yMm,dxMm,dyMm);
}
export function newtonDisplayNeedsFilter(p:WaveOpticsParams,rMm:number,dxMm:number,dyMm:number):boolean{
  return newtonDisplayGain(p,rMm,0,Math.max(dxMm,dyMm),0)<1;
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
    const value=ring?(Math.hypot(xx,yy)<=profile.max?averageNewtonDisplayPixel(p,xx,yy,dx,dy):undefined):(columnValues?.[x]??column(x,8*(v-.5)));
    const idx=4*(y*w+x);
    if(value===undefined){data.data[idx+3]=0;continue;}
    for(let j=0;j<3;j++)data.data[idx+j]=Math.round((rgb[j]??0)*value);
    data.data[idx+3]=255;
  }
  ctx.putImageData(data,0,0);patternCache={key,canvas:c};return c;
}

// Shared physical apparatus cross-sections. Coordinates are display-world
// units; horizontal scales are explicit, vertical film gaps exaggerated.
export type OpticsApparatus={primitives:DiagramPrimitive[];kind:WaveOpticsParams['mode'];gapSamples?:{xMm:number;gapM:number;upperY:number;lowerY:number}[];slits?:{left:number;right:number}[];valid:boolean};
export function makeOpticsApparatus(p:WaveOpticsParams):OpticsApparatus{
  const primitives:DiagramPrimitive[]=[];
  const text=(x:number,y:number,label:string)=>primitives.push({kind:'text',x,y,text:label,align:'middle'});
  const line=(x1:number,y1:number,x2:number,y2:number,dashed=false)=>primitives.push({kind:'line',x1,y1,x2,y2,dashed});
  const left=-2.18,right=-.12,cx=(left+right)/2,base=.78;
  if(p.mode==='thin-film-wedge'){
    const samples=[];
    for(let i=0;i<=100;i++){
      const xMm=i/5,h=evalWedgeThicknessMeters(xMm,p);
      if(h===undefined){text(cx,1.8,'无有效薄膜几何');return {kind:p.mode,primitives,valid:false};}
      const upperY=base+45000*xMm*1e-3*Math.tan(p.wedgeAngleDeg*Math.PI/180);
      samples.push({xMm,gapM:h,upperY,lowerY:upperY-45000*h});
    }
    const x=(v:number)=>left+(right-left)*v/20;
    const upper=samples.map(s=>({x:x(s.xMm),y:s.upperY})),lower=samples.map(s=>({x:x(s.xMm),y:s.lowerY}));
    primitives.push({kind:'polyline',points:upper},{kind:'polyline',points:lower});
    primitives.push({kind:'polyline',points:upper.map(v=>({...v,y:v.y+.10}))},{kind:'polyline',points:lower.map(v=>({...v,y:v.y-.10}))});
    const mid=samples[50]!;
    line(cx,mid.lowerY,cx,mid.upperY,true);
    text(cx,1.83,'劈尖剖面 · 厚度夸大');
    text(cx,1.52,'α='+p.wedgeAngleDeg.toFixed(3)+'°  n='+p.refractiveIndexN2.toFixed(2));
    text(cx,.46,'h(10 mm) = '+(mid.gapM*1e6).toFixed(2)+' μm');
    text(left+.18,.25,'薄端');text(right-.18,.25,'厚端');
    return {kind:p.mode,primitives,gapSamples:samples,valid:true};
  }
  if(p.mode==='newtons-rings'){
    const max=makeOpticsProfile(p).max,R=p.lensRadiusR,samples=[];
    for(let i=0;i<=100;i++){
      const xMm=max*(2*i/100-1),r=Math.abs(xMm)*1e-3;
      if(!Number.isFinite(R)||R<=r){text(cx,1.8,'无有效球面几何');return {kind:p.mode,primitives,valid:false};}
      const h=r*r/(R+Math.sqrt((R-r)*(R+r)));
      samples.push({xMm,gapM:h,lowerY:base,upperY:base+22000*h});
    }
    const x=(v:number)=>cx+(right-left)*v/(2*max);
    const upper=samples.map(s=>({x:x(s.xMm),y:s.upperY}));
    primitives.push({kind:'polyline',points:upper});
    line(left,base,right,base);line(left,base-.12,right,base-.12);
    const top=base+.67;line(left,top,right,top);line(left,upper[0]!.y,left,top);line(right,upper.at(-1)!.y,right,top);
    const probe=samples[80]!;line(x(probe.xMm),probe.lowerY,x(probe.xMm),probe.upperY,true);
    text(cx,1.83,'平凸透镜 / 平板 · 厚度夸大');
    text(cx,1.61,'R='+p.lensRadiusR.toFixed(2)+' m');
    text(cx,.46,'h('+Math.abs(probe.xMm).toFixed(1)+' mm) = '+(probe.gapM*1e6).toFixed(2)+' μm');
    text(cx,.25,'接触点 r=0 · '+(p.halfWaveLoss?'反射相移 π':'反射相移 0'));
    return {kind:p.mode,primitives,gapSamples:samples,valid:true};
  }
  const m=computeKeyOpticsMetrics(p);
  text(cx,1.83,'狭缝开口平面 · 比例示意');
  if(!m.gratingValid){
    text(cx,1.27,'请求重叠：d < a');text(cx,.78,'不生成有效开口');
    return {kind:p.mode,primitives,valid:false,slits:[]};
  }
  const N=p.slitCountN,a=p.slitWidthMicron,d=N===1?0:p.gratingPitchMicron;
  const scale=1.76/((N-1)*d+a),slits=Array.from({length:N},(_,i)=>{
    const center=cx+(i-(N-1)/2)*d*scale;return {left:center-a*scale/2,right:center+a*scale/2};
  });
  const y=.98;
  let previous=left;
  for(const slit of slits){
    if(slit.left>previous+1e-10)primitives.push({kind:'rect',x:previous,y:y-.065,width:slit.left-previous,height:.13,hatch:true});
    line(slit.left,y-.12,slit.left,y+.12);line(slit.right,y-.12,slit.right,y+.12);
    previous=slit.right;
  }
  if(right>previous+1e-10)primitives.push({kind:'rect',x:previous,y:y-.065,width:right-previous,height:.13,hatch:true});
  text(cx,1.47,'N = '+N+'，a = '+a.toFixed(1)+' μm');
  text(cx,.55,N===1?'单缝 · 无节距': 'd = '+d.toFixed(1)+' μm · d/a = '+(d/a).toFixed(2));
  text(cx,.25,'正入射 · 远场角分布');
  return {kind:p.mode,primitives,slits,valid:true};
}
// Conservative display reduction: integrate the piecewise-linear physical
// profile over equal bins. Keep the sampled min/max separately from mean.
export type ProfileBin={u:number;mean:number;min:number;max:number};
export function binOpticsProfile(points:readonly Sample[],count:number):ProfileBin[]{
  if(points.length<2||!Number.isFinite(count)||count<1)return [];
  const n=Math.max(1,Math.min(4096,Math.floor(count))),out:ProfileBin[]=[];
  let j=0;
  for(let i=0;i<n;i++){
    const lo=i/n,hi=(i+1)/n;let area=0,mn=Infinity,mx=-Infinity,covered=0;
    while(j+1<points.length&&points[j+1]!.u<=lo)j++;
    let k=j;
    while(k+1<points.length&&points[k]!.u<hi){
      const a=points[k]!,b=points[k+1]!,l=Math.max(lo,a.u),r=Math.min(hi,b.u),span=b.u-a.u;
      if(r>l&&span>0){
        const v=a.intensity+(b.intensity-a.intensity)*(l-a.u)/span,w=a.intensity+(b.intensity-a.intensity)*(r-a.u)/span;
        area+=(r-l)*(v+w)/2;covered+=r-l;mn=Math.min(mn,v,w);mx=Math.max(mx,v,w);
      }
      if(b.u>=hi)break;k++;
    }
    if(covered>0)out.push({u:(lo+hi)/2,mean:area/covered,min:mn,max:mx});
    j=k;
  }
  return out;
}
