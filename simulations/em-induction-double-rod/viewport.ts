import {createWorldMapper,type Viewport} from '@physforge/sim-sdk';
import {inductionDiagramGeometry,inductionFieldPoints,inductionLoadDimensions} from './diagramGeometry.js';
import {getEffectiveL2,type InductionParams,type InductionState} from './engine.js';
import {inductionArrowLength,inductionFieldLabel} from './visualStyle.js';

export type InductionSafeRect={left:number;right:number;top:number;bottom:number};

/** Conservative screen extent of the actual connected circuit and its annotations.
 * Fixed-pixel annotation margins do not scale physical geometry. The decorative
 * fading wake is intentionally not a mandatory fit constraint. */
export function inductionScreenBounds(s:InductionState,p:InductionParams,v:Viewport):InductionSafeRect{
  const m=createWorldMapper(v),g=inductionDiagramGeometry(s,p),h=Math.max(g.l1,g.l2)/2;
  const r:InductionSafeRect={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
  const include=(x:number,y:number,left:number,right:number,top:number,bottom:number)=>{
    r.left=Math.min(r.left,x-left);r.right=Math.max(r.right,x+right);
    r.top=Math.min(r.top,y-top);r.bottom=Math.max(r.bottom,y+bottom);
  };
  const textWidth=(t:string,size:number)=>[...t].reduce((w,ch)=>w+(ch.charCodeAt(0)>255?size:.75*size),12);
  const label=(x:number,y:number,t:string,size=14)=>{
    const w=textWidth(t,size)/2;include(x,y,w,w,size/2+8,size/2+8);
  };
  for(const seg of g.rails)for(const q of [seg.start,seg.end])include(m.toX(q.x),m.toY(q.y),12,12,12,12);
  const rod=(x:number,l:number)=>{include(m.toX(x),m.toY(l/2),18,18,25,12);include(m.toX(x),m.toY(-l/2),18,18,12,25);};
  const x1=m.toX(g.x1),x2=m.toX(g.x2),cy=m.toY(0);
  rod(g.x1,g.l1);
  if(g.double){
    rod(g.x2,g.l2);label(x2,m.toY(-g.l2/2)+31,`杆2 v₂=${s.v2.toFixed(2)} m/s`);
  }else{
    const half=m.len(inductionLoadDimensions(g.l1).halfPlateWidth);
    include(x2,cy,half+12,half+12,12,12);
    label(x2,m.toY(-g.l1/2)+28,p.circuitLoad==='battery'?'电源 E':p.circuitLoad==='capacitor'?'电容 C':'电阻 R');
  }
  for(const q of inductionFieldPoints(p))include(m.toX(q.x),m.toY(q.y),6,6,6,6);
  label(m.toX(0),m.toY(h)-(g.schematicStep?76:44),inductionFieldLabel(p.magneticB));
  if(g.schematicStep)label(m.toX(0),m.toY(h)-26,'不同杆长 · 连接线为示意');
  const speed=inductionArrowLength(s.v1,60,135);
  if(Math.abs(speed)>=6){
    const t=`${g.double?'v₁':'v'} = ${Math.abs(s.v1).toFixed(2)} m/s`,w=textWidth(t,14);
    include(x1+speed,cy+18,15,15,15,15);
    label(x1+speed+Math.sign(speed)*(w/2+12),cy+18,t);
  }
  if(Math.abs(s.current)>.02)label((x1+x2)/2,m.toY(-h)+24,`I = ${Math.abs(s.current).toFixed(2)} A`,15);
  const amp=p.magneticB*p.railWidth*s.current;
  const force=!g.double&&p.circuitLoad==='battery'?amp:-amp;
  if(Math.abs(force)>.05){
    const length=inductionArrowLength(force,35,145),size=v.width>=1100?17:15;
    const t=`F安 = ${Math.abs(amp).toFixed(2)} N`,w=textWidth(t,size);
    include(x1+length,cy-18,15,15,15,15);
    label(x1+Math.sign(length)*(w/2+14),cy-42,t,size);
  }
  if(g.double){
    const f2=p.magneticB*getEffectiveL2(p)*s.current;
    if(Math.abs(f2)>.05){
      const length=inductionArrowLength(f2,35,145);include(x2+length,cy-18,15,15,15,15);
      label(x2+length/2,cy-42,`F安₂ = ${Math.abs(f2).toFixed(2)} N`);
    }
  }
  if(Math.abs(p.externalForce)>.05){
    const length=inductionArrowLength(p.externalForce,24,120);
    include(x1+length,cy+37,15,15,15,15);label(x1+length*.55,cy+57,'F外');
    if(p.externalForce>0)label(m.toX(g.x1+Math.max(.25,p.externalForce*.1)),cy-20,`F外=${p.externalForce.toFixed(1)}N`);
  }
  return r;
}

const inside=(b:InductionSafeRect,s:InductionSafeRect)=>[b.left,b.right,b.top,b.bottom,s.left,s.right,s.top,s.bottom].every(Number.isFinite)&&b.left>=s.left&&b.right<=s.right&&b.top>=s.top&&b.bottom<=s.bottom;
export function inductionBoundsFit(s:InductionState,p:InductionParams,v:Viewport,safe:InductionSafeRect):boolean{
  return inside(inductionScreenBounds(s,p,v),safe);
}

/** Translate first; shrink only when the actual extent cannot fit. Never
 * change state, clamp rod positions or use independent x/y scales. The
 * 10 px inner reserve avoids repeated camera corrections for tiny motions. */
export function fitInductionViewport(s:InductionState,p:InductionParams,v:Viewport,safe:InductionSafeRect):Viewport|null{
  if(![v.width,v.height,v.scale,safe.left,safe.right,safe.top,safe.bottom].every(Number.isFinite)||v.width<=0||v.height<=0||v.scale<=0)return null;
  if(inductionBoundsFit(s,p,v,safe))return v;
  const target={left:safe.left+10,right:safe.right-10,top:safe.top+10,bottom:safe.bottom-10};
  const width=target.right-target.left,height=target.bottom-target.top;
  if(width<=0||height<=0)return null;
  const bounds=(scale:number)=>inductionScreenBounds(s,p,{...v,scale});
  const canFit=(b:InductionSafeRect)=>[b.left,b.right,b.top,b.bottom].every(Number.isFinite)&&b.right-b.left<=width&&b.bottom-b.top<=height;
  let lo=Math.min(1e-6,v.scale),hi=v.scale;
  if(!canFit(bounds(lo)))return null;
  if(canFit(bounds(hi)))lo=hi;
  else for(let i=0;i<32;i++){
    const mid=(lo+hi)/2;if(canFit(bounds(mid)))lo=mid;else hi=mid;
  }
  const b=bounds(lo),next={...v,scale:lo,offsetX:v.offsetX+(target.left+target.right-b.left-b.right)/2,offsetY:v.offsetY+(target.top+target.bottom-b.top-b.bottom)/2};
  return inductionBoundsFit(s,p,next,safe)?next:null;
}
