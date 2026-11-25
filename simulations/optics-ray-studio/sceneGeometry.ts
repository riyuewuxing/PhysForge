import type { DiagramPrimitive } from '@physforge/sim-sdk';
import { prismVertices, slitIntensity, type OpticsParams, type OpticsState } from './engine.js';

type Point={x:number;y:number};
type Layer='medium'|'normalLine'|'rays';
type Tone='glass'|'clad'|'axis'|'warm'|'cool'|'image'|'virtual'|'text'|'spectral';
export type OpticalMark={layer:Layer;tone:Tone;primitive:DiagramPrimitive;color?:string;power?:number};
export interface OpticalScene { marks:OpticalMark[]; bounds:{minX:number;minY:number;maxX:number;maxY:number}; profile?:{x:number;y:number;intensity:number}[]; }

export function opticalScene(state:OpticsState,p:OpticsParams):OpticalScene {
  const marks:OpticalMark[]=[];
  const put=(layer:Layer,tone:Tone,primitive:DiagramPrimitive,color?:string,power?:number)=>marks.push({layer,tone,primitive,color,power});
  const line=(a:Point,b:Point,layer:Layer='medium',tone:Tone='axis',dashed=false,arrow=false)=>{
    if(arrow)put(layer,tone,{kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed});
    else put(layer,tone,{kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed});
  };
  const label=(text:string,x:number,y:number,layer:Layer='medium',tone:Tone='text')=>put(layer,tone,{kind:'text',x,y,text,align:'middle'});
  const poly=(points:readonly Point[],tone:Tone)=>put('medium',tone,{kind:'polyline',points,closed:true});
  const rect=(x1:number,y1:number,x2:number,y2:number,tone:Tone)=>poly([{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}],tone);
  const P=(x:number,y:number)=>({x,y});
  let bounds={minX:-3.5,maxX:3.5,minY:-2.15,maxY:2.15};
  let profile:OpticalScene['profile'];
  if(p.sceneMode==='parallel-slab'){
    const d=p.slabThickness,a=state.rays[0]!,b=state.rays.find(r=>r.label==='出射光')!;
    const left=Math.min(-2.5,a.from.x-.3),right=Math.max(2.5,b.to.x+.3);
    bounds={minX:left-.15,maxX:right+.15,minY:-d/2-2.05,maxY:d/2+1.85};
    rect(left,-d/2,right,d/2,'glass');
    label('空气',left+.55,d/2+.2);
    label('玻璃 n='+p.n1.toFixed(2),left+.9,0);
    const dx=a.to.x-a.from.x,dy=a.to.y-a.from.y,len=Math.hypot(dx,dy);
    const ux=dx/len,uy=dy/len;
    // Project the actual exit point onto the undeviated incident line.
    const dot=(b.from.x-a.to.x)*ux+(b.from.y-a.to.y)*uy;
    const q=P(a.to.x+dot*ux,a.to.y+dot*uy);
    line(a.to,q,'normalLine','axis',true);
    line(q,b.from,'normalLine','warm');
    if(state.lateralShift>1e-6)label('Δx='+state.lateralShift.toFixed(3)+' m',(q.x+b.from.x)/2,(q.y+b.from.y)/2-.2,'normalLine','warm');
    for(const hit of [a.to,b.from])line(P(hit.x,hit.y-.55),P(hit.x,hit.y+.55),'normalLine','axis',true);
    label('入射与出射方向平行', (left+right)/2,bounds.minY+.25,'normalLine');
    label('有限窗口 · 仅主透射光', (left+right)/2,bounds.maxY-.2);
    label('主透射功率 '+((state.slabDirectTransmittance??0)*100).toFixed(1)+'%', (left+right)/2,bounds.minY+.52,'normalLine','cool');
  }else if(p.sceneMode==='prism-dispersion'){
    const pts=prismVertices(p.prismApexDeg);poly(pts,'glass');
    label('A='+p.prismApexDeg.toFixed(0)+'°',0,1.22,'normalLine');
    label('示例 Cauchy 色散 · 六个波段',0,-1.85);
    label(state.prismDeviationDeg===undefined?'黄光无直接两腰出射':'黄光偏向角 '+state.prismDeviationDeg.toFixed(1)+'°',0,1.85,'normalLine','warm');
    const h=state.rays[0]?.to;
    if(h){const a=p.prismApexDeg*Math.PI/360;line(P(h.x-.42*Math.cos(a),h.y+.42*Math.sin(a)),P(h.x+.42*Math.cos(a),h.y-.42*Math.sin(a)),'normalLine','axis',true);}
  }else if(p.sceneMode==='optical-fiber'){
    const h=p.fiberHalfWidth;
    rect(-2.4,-h-.25,2.4,h+.25,'clad');rect(-2.4,-h,2.4,h,'glass');
    line(P(-3.3,0),P(3.15,0),'normalLine','axis',true);
    label('纤芯 n₁='+p.n1.toFixed(2),0,h+.55);
    label('包层 n₂='+p.n2.toFixed(2),0,-h-.55);
    label(state.fiberAcceptanceDeg===undefined?'无全反射导光条件':state.isTotalInternalReflection?(state.activeAngleDeg===0?'轴向直线传播':'满足全反射导光条件'):'超出接受角 · 主光路进入包层',0,1.55,'normalLine','warm');
    label('几何光路 · 不表示波导模式或实际光强',0,-1.8);
  }else if(p.sceneMode==='thin-lens-imaging'){
    const u=p.objectDistanceM??1.2,f=p.focalLengthM??.65;
    line(P(-2.8,0),P(2.8,0),'medium','axis',true);
    line(P(0,-1.3),P(0,1.3),'medium','cool',false,true);
    line(P(0,1.3),P(0,-1.3),'medium','cool',false,true);
    for(const sign of [-1,1])for(const multiple of [1,2]){
      const x=sign*multiple*f;if(Math.abs(x)>2.8)continue;
      put('medium','cool',{kind:'circle',cx:x,cy:0,r:.025,fill:true});
      label((multiple===2?'2':'')+'F'+(sign<0?'₁':'₂'),x,-.16,'medium','cool');
    }
    line(P(-u,0),P(-u,.55),'medium','warm',false,true);label('物',-u,.78,'medium','warm');
    const v=state.imageDistanceM,h=state.magnification===undefined?undefined:.55*state.magnification;
    if(v!==undefined&&h!==undefined&&Math.abs(v)<=2.8&&Math.abs(h)<=1.85){
      line(P(v,0),P(v,h),'medium',v>0?'image':'virtual',v<0,true);
      label(v>0?'实像':'虚像',v,h+(h<0?-.18:.18),'medium',v>0?'image':'virtual');
    }else label(state.imageAtInfinity?'u=f · 出射光平行 · 无有限像':v!==undefined?(v>0?'实像':'虚像')+'在显示窗口外':'无有限像',0,1.85,'normalLine','warm');
    label('理想薄凸透镜 · 近轴模型',0,-2);
  }else if(p.sceneMode==='double-slit'){
    // Separate schematic apparatus coordinates and a fixed physical screen scale.
    const gap=.29,barrier=-2.35,screen=.65,half=1.6,mmPerWorld=2.5,curveX=1.04,curveWidth=1.55;
    const color=p.wavelengthNm<490?'#60a5fa':p.wavelengthNm<570?'#4ade80':p.wavelengthNm<605?'#fbbf24':'#f87171';
    for(const [a,b] of [[-half,-gap-.035],[-gap+.035,gap-.035],[gap+.035,half]] as const)
      line(P(barrier,a),P(barrier,b),'medium','axis');
    line(P(screen,-half),P(screen,half),'medium','axis');
    for(const sy of [-gap,gap])line(P(barrier,sy),P(screen,0),'rays','warm',true);
    label('双缝（示意）',barrier,1.86);label('屏面',screen,1.86);
    label('I / Iₘₐₓ',curveX+curveWidth/2,1.86,'normalLine');
    line(P(curveX,-half),P(curveX,half),'normalLine','axis');
    line(P(curveX,-half),P(curveX+curveWidth,-half),'normalLine','axis');
    for(const mm of [-4,-2,0,2,4]){
      const y=mm/mmPerWorld;line(P(curveX-.045,y),P(curveX,y),'normalLine','axis');
      label(String(mm)+' mm',curveX-.35,y,'normalLine');
    }
    profile=Array.from({length:1201},(_,i)=>{const y=-half+2*half*i/1200,intensity=slitIntensity(y*mmPerWorld,state.fringeSpacingMm);return{x:curveX+curveWidth*intensity,y,intensity};});
    put('rays','spectral',{kind:'polyline',points:profile},color);
    label('Δx='+state.fringeSpacingMm.toFixed(3)+' mm',-1.15,-1.85,'normalLine','warm');
    label('屏面固定 ±4 mm · 近轴等幅窄缝',1.35,-1.9,'normalLine');
  }
  if(p.sceneMode==='prism-dispersion'||p.sceneMode==='optical-fiber')for(const r of state.rays)for(const q of [r.from,r.to]){
    bounds.minX=Math.min(bounds.minX,q.x-.15);bounds.maxX=Math.max(bounds.maxX,q.x+.15);
    bounds.minY=Math.min(bounds.minY,q.y-.15);bounds.maxY=Math.max(bounds.maxY,q.y+.15);
  }
  for(const r of state.rays){
    const tone:Tone=r.dashed?'virtual':p.sceneMode==='prism-dispersion'?'spectral':r.color==='#fbbf24'?'warm':r.color==='#4ade80'?'image':r.color==='#f87171'?'virtual':'cool';
    put('rays',tone,r.dashed?{kind:'line',x1:r.from.x,y1:r.from.y,x2:r.to.x,y2:r.to.y,dashed:true}:{kind:'arrow',x1:r.from.x,y1:r.from.y,x2:r.to.x,y2:r.to.y},r.color,r.intensity);
  }
  return {marks,bounds,profile};
}
