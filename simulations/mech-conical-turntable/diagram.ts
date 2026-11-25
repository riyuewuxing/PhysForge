import { CLASSROOM_GRAVITY as g } from '@physforge/physics-core';
import type { DiagramPrimitive,DiagramExportOptions,ForceVectorItem,Viewport } from '@physforge/sim-sdk';
import { computeCriticalOmegas,diskRadius,staticFeasibility,type ConicalTurntableState,type ConicalTurntableParams } from './engine.js';
type Point={x:number;y:number};
type Bounds={minX:number;maxX:number;minY:number;maxY:number};
export type TurntableSafeRect={left:number;right:number;top:number;bottom:number};
export type TurntableRole='disk'|'rim'|'guide'|'rope'|'block-a'|'block-b'|'friction-a'|'friction-b'|'tension'|'velocity'|'ink'|'event'|'plot-axis'|'plot-limit'|'gravity'|'net'|'bob'|'orbit'|'top-bob'|'pivot';
type Item={primitive:DiagramPrimitive;role:TurntableRole;layer:'turntable'|'forces'|'construction'|'sweep'|'always'};
export function turntableForceVectors(s:ConicalTurntableState,p:ConicalTurntableParams):ForceVectorItem[]{
  if(p.mode==='conical-pendulum'){
    const tension={x:-s.tensionN*s.a.x/p.pendulumLength,y:s.tensionN*(1.1-s.a.y)/p.pendulumLength},gravity={x:0,y:-p.massA*g};
    return [{id:'gravity',label:'mg',origin:s.a,force:gravity,color:'#fbbf24',category:'gravity'},
      {id:'tension',label:'T',origin:s.a,force:tension,color:'#38bdf8',category:'tension'},
      {id:'net',label:'F合 (投影)',origin:s.a,force:{x:tension.x,y:tension.y+gravity.y},color:'#4ade80',category:'net'}];
  }
  const result:ForceVectorItem[]=[];
  if(Math.hypot(s.fa.x,s.fa.y)>1e-12)result.push({id:'friction-a',label:'f_A',origin:s.a,force:s.fa,color:'#4ade80',category:'friction'});
  if(Math.hypot(s.fb.x,s.fb.y)>1e-12)result.push({id:'friction-b',label:'f_B',origin:s.b,force:s.fb,color:'#f472b6',category:'friction'});
  if(s.tensionN>1e-12)result.push({id:'tension-a',label:'T_A',origin:s.a,force:{x:s.tensionN*s.direction.x,y:s.tensionN*s.direction.y},color:'#38bdf8',category:'tension'},
    {id:'tension-b',label:'T_B',origin:s.b,force:{x:-s.tensionN*s.direction.x,y:-s.tensionN*s.direction.y},color:'#38bdf8',category:'tension'});
  return result;
}
export function staticForceSweep(p:ConicalTurntableParams){
  const c=computeCriticalOmegas(p),xMax=Math.max(.6,Math.min(36,1.17*Math.max(p.omega**2,c.omega1**2,(c.omega2??0)**2,(c.omega3??0)**2)),1.08*p.omega**2);
  const feasibleMax=Math.min(xMax,c.omega3===null?xMax:c.omega3**2);
  const D=p.massB*p.radiusB-p.massA*p.radiusA;
  const switchX=D===0?null:p.mu*g*(p.massB-p.massA)/D;
  const candidates=[0,feasibleMax,c.omega1**2,c.omega2===null?null:c.omega2**2,switchX];
  const xs=candidates.filter((x):x is number=>x!==null&&x>=0&&x<=feasibleMax+1e-10).sort((a,b)=>a-b).filter((x,i,a)=>i===0||Math.abs(x-a[i-1]!)>1e-10);
  const points=xs.flatMap(w2=>{
    const s=staticFeasibility(p,Math.sqrt(w2));
    return s.feasible?[{w2,T:s.tensionN!,fa:s.frictionAN!,fb:s.frictionBN!}]:[];
  });
  const yMin=Math.min(0,...points.map(q=>Math.min(q.fa,q.fb))),yMax=Math.max(1,...points.map(q=>Math.max(q.T,q.fa,q.fb)));
  return {points,xMax,feasibleMax,yMin,yMax,critical:c,switchX};
}
function bounds(p:ConicalTurntableParams):Bounds{
  if(p.mode==='turntable-dual'){
    const R=diskRadius(p);return {minX:-1.17*R,maxX:4.0*R,minY:-1.22*R,maxY:1.22*R};
  }
  const L=p.pendulumLength;return {minX:-1.35*L,maxX:3.7*L,minY:1.1-1.43*L,maxY:1.1+.40*L};
}
export function turntableBoundsFit(_s:ConicalTurntableState,p:ConicalTurntableParams,v:Viewport,safe:TurntableSafeRect){
  const b=bounds(p),ppm=.24*Math.min(v.width,v.height)*v.scale,ox=.45*v.width+v.offsetX,oy=.5*v.height+v.offsetY;
  return ox+b.minX*ppm>=safe.left&&ox+b.maxX*ppm<=safe.right&&oy-b.maxY*ppm>=safe.top&&oy-b.minY*ppm<=safe.bottom;
}
export function fitTurntableViewport(_s:ConicalTurntableState,p:ConicalTurntableParams,v:Viewport,safe:TurntableSafeRect):Viewport|null{
  if(safe.right-safe.left<70||safe.bottom-safe.top<70)return null;
  const b=bounds(p),ppm=.93*Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function turntableInitialView(s:ConicalTurntableState,p:ConicalTurntableParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const f=fitTurntableViewport(s,p,full,{left:28,right:v.width>=1200?v.width-300:v.width-28,top:30,bottom:v.height>=650?v.height-170:v.height-28})??full;
  return {scale:f.scale,offsetRatioX:f.offsetX/v.width,offsetRatioY:f.offsetY/v.height};
}
export function turntableDiagram(s:ConicalTurntableState,p:ConicalTurntableParams,opts?:DiagramExportOptions){
  const items:Item[]=[],O={x:0,y:0};
  const push=(primitive:DiagramPrimitive,role:TurntableRole,layer:Item['layer'])=>items.push({primitive,role,layer});
  const line=(a:Point,b:Point,role:TurntableRole,layer:Item['layer'],dashed=false)=>push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role,layer);
  const txt=(a:Point,text:string,role:TurntableRole,layer:Item['layer'])=>push({kind:'text',x:a.x,y:a.y,text,align:'middle'},role,layer);
  const dot=(a:Point,r:number,role:TurntableRole,layer:Item['layer'],fill=true)=>push({kind:'circle',cx:a.x,cy:a.y,r,fill},role,layer);
  const arrow=(a:Point,f:Point,k:number,label:string,role:TurntableRole,layer:Item['layer'])=>push({kind:'arrow',x1:a.x,y1:a.y,x2:a.x+k*f.x,y2:a.y+k*f.y,label},role,layer);
  if(p.mode==='turntable-dual'){
    const R=diskRadius(p),scale=.095*R;
    push({kind:'circle',cx:0,cy:0,r:R,fill:true},'disk','turntable');
    push({kind:'circle',cx:0,cy:0,r:R},'rim','turntable');
    dot(O,.025*R,'pivot','turntable');
    line(O,{x:R*Math.cos(s.angleRad),y:R*Math.sin(s.angleRad)},'guide','turntable',true);
    txt({x:0,y:1.10*R},'圆盘俯视 · 地面系','ink','turntable');
    line(s.a,s.b,'rope','turntable',s.tensionN<=1e-12);
    line(O,s.a,'guide','construction',true);line(O,s.b,'guide','construction',true);
    push({kind:'block',cx:s.a.x,cy:s.a.y,width:scale*1.6,height:scale*1.6,label:'A'},'block-a','always');
    push({kind:'block',cx:s.b.x,cy:s.b.y,width:scale*1.8,height:scale*1.8,label:'B'},'block-b','always');
    txt({x:s.a.x,y:s.a.y+.18*R},'A','block-a','always');txt({x:s.b.x,y:s.b.y+.18*R},'B','block-b','always');
    if(s.terminal){
      const q=s.terminal==='edge-a'?s.a:s.terminal==='edge-b'?s.b:{x:(s.a.x+s.b.x)/2,y:(s.a.y+s.b.y)/2};
      dot(q,.15*R,'event','always',false);txt({x:0,y:-1.1*R},s.terminal==='slack'?'张力归零 · 停于松绳边界':'盘边事件 · 接触模型停止','event','always');
    }else txt({x:0,y:-1.1*R},s.slippingOut?'二维滑移 · 精确库仑摩擦':'共转静摩擦 · 向内为正','ink','always');
    if(opts?.showVelocityVectors!==false&&s.slippingOut){
      const u=[{x:s.va.x+p.omega*s.a.y,y:s.va.y-p.omega*s.a.x},{x:s.vb.x+p.omega*s.b.y,y:s.vb.y-p.omega*s.b.x}],k=.38*R/Math.max(.1,...u.map(q=>Math.hypot(q.x,q.y)));
      for(const [i,a] of [s.a,s.b].entries()){const f=u[i]!;if(Math.hypot(f.x,f.y)>1e-6)arrow(a,f,k,i===0?'u_A':'u_B','velocity','construction');}
    }
    const q=staticForceSweep(p),x0=1.46*R,x1=3.68*R,y0=-.72*R,y1=.72*R,yr=Math.max(1,q.yMax-q.yMin),bottom=q.yMin-.10*yr,top=q.yMax+.10*yr;
    const at=(x:number,y:number):Point=>({x:x0+(x1-x0)*x/q.xMax,y:y0+(y1-y0)*(y-bottom)/(top-bottom)});
    line({x:x0,y:y0},{x:x0,y:y1},'plot-axis','sweep');line(at(0,0),at(q.xMax,0),'plot-axis','sweep');
    txt({x:(x0+x1)/2,y:1.10*R},'静态可行域 · f,T–ω²','ink','sweep');
    txt({x:x0,y:y1+.12*R},'N','ink','sweep');txt({x:x0-.15*R,y:at(0,0).y},'0','ink','sweep');
    txt({x:x0-.15*R,y:at(0,q.yMax).y},q.yMax.toFixed(1),'ink','sweep');
    if(q.yMin<0)txt({x:x0-.15*R,y:at(0,q.yMin).y},q.yMin.toFixed(1),'ink','sweep');
    txt({x:(x0+x1)/2,y:-1.07*R},'ω² / rad²·s⁻²','ink','sweep');txt({x:x1,y:y0-.13*R},q.xMax.toFixed(1),'ink','sweep');
    for(const [key,role,dashed] of [['T','tension',false],['fa','friction-a',true],['fb','friction-b',false]] as const){
      if(q.points.length>=2){push({kind:'polyline',points:q.points.map(z=>at(z.w2,z[key])),dashed},role,'sweep');const z=q.points.at(-1)!;const pt=at(z.w2,z[key]);txt({x:pt.x+.09*R,y:pt.y+(key==='fa'?-.07:.07)*R},key==='T'?'T':key==='fa'?'fA':'fB',role,'sweep');}
    }
    for(const [index,w] of [q.critical.omega1,q.critical.omega2,q.critical.omega3].entries()){
      if(w===null||w*w>q.xMax)continue;
      const x=at(w*w,0).x;line({x,y:y0},{x,y:y1},'plot-limit','sweep',true);txt({x,y:y0-.15*R},'ω'+(index+1)+'²','plot-limit','sweep');
    }
    if(p.omega**2<=q.xMax){
      const x=at(p.omega**2,0).x;line({x,y:y0},{x,y:y1},'event','sweep',true);
    }
    const gap=q.xMax-q.feasibleMax;
    if(gap>.06*q.xMax)txt({x:at((q.xMax+q.feasibleMax)/2,0).x,y:y1-.18*R},'无静态解','event','sweep');
    for(const [i,[label,role]] of ([['T','tension'],['fA','friction-a'],['fB','friction-b']] as const).entries())txt({x:x0+.4*R+i*.67*R,y:.89*R},label,role,'sweep');
  }else{
    const L=p.pendulumLength,R=s.rA,pivot={x:0,y:1.1},top={x:2.4*L,y:1.1-.53*L},theta=s.coneAngleDeg*Math.PI/180;
    txt({x:0,y:1.1+.27*L},'固定竖直截面正投影','ink','turntable');
    line(pivot,{x:0,y:1.1-L},'guide','turntable',true);dot(pivot,.035*L,'pivot','turntable');line(pivot,s.a,'rope','turntable');
    dot(s.a,.065*L,'bob','always');
    if(s.rotatingCone){
      const radial={x:R,y:1.1-L*Math.cos(theta)};line(pivot,radial,'guide','construction',true);
      line({x:-R,y:s.a.y},{x:R,y:s.a.y},'guide','construction',true);
      if(theta>.025)push({kind:'arc',cx:pivot.x,cy:pivot.y,r:.25*L,startAngle:-Math.PI/2,endAngle:-Math.PI/2+theta},'guide','construction');
      txt({x:.40*L*Math.sin(theta/2),y:1.1-.40*L*Math.cos(theta/2)},'θ 真倾角','guide','construction');
      dot(top,R,'orbit','turntable',false);dot(top,.025*L,'pivot','turntable');
      const point={x:top.x+R*Math.cos(s.angleRad),y:top.y+R*Math.sin(s.angleRad)};
      line(top,point,'guide','construction');dot(point,.06*L,'top-bob','always');
      txt({x:top.x,y:1.1+.27*L},'水平俯视 · 同一相位','ink','turntable');
      txt({x:top.x,y:top.y-R-.12*L},'r=L sinθ','guide','construction');
      if(opts?.showVelocityVectors!==false)arrow(point,{x:-Math.sin(s.angleRad),y:Math.cos(s.angleRad)},.30*L,'v','velocity','construction');
    }else{dot(top,.035*L,'pivot','turntable');txt({x:top.x,y:top.y+.18*L},'竖直静止 · 无圆周轨道','ink','turntable');}
  }
  if(opts?.showForceLabels!==false){
    const forces=turntableForceVectors(s,p),R=p.mode==='turntable-dual'?diskRadius(p):p.pendulumLength;
    const k=.39*R/Math.max(1,...forces.map(f=>Math.hypot(f.force.x,f.force.y)));
    for(const f of forces){
      if(Math.hypot(f.force.x,f.force.y)<1e-10)continue;
      const role:TurntableRole=f.id==='friction-a'?'friction-a':f.id==='friction-b'?'friction-b':f.id==='gravity'?'gravity':f.id==='net'?'net':'tension';
      arrow(f.origin,f.force,k,f.label,role,'forces');
    }
  }
  return {items,bounds:bounds(p)};
}
