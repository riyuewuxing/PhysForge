import { CLASSROOM_GRAVITY as g,degToRad } from '@physforge/physics-core';
import type { DiagramPrimitive, DiagramExportOptions, Viewport } from '@physforge/sim-sdk';
import type { ProjectileCouplingParams,ProjectileCouplingState } from './engine.js';

type Point={x:number;y:number};
export type ProjectileRole='surface'|'envelope'|'trajectory'|'vacuum'|'velocity'|'construction'|'event'|'ink';
export interface ProjectileItem {primitive:DiagramPrimitive;role:ProjectileRole;layer:'surface'|'trajectory'|'construction'|'always'}
export type Bounds={minX:number;maxX:number;minY:number;maxY:number};
export type SafeRect={left:number;right:number;top:number;bottom:number};
const alpha=(p:ProjectileCouplingParams)=>p.mode==='incline-flat'?0:degToRad(p.launchAngleDeg);
const theta=(p:ProjectileCouplingParams)=>degToRad(p.inclineDeg);
export function vacuumFarthest(p:ProjectileCouplingParams){
  if(p.mode!=='incline-flat'||p.dragCoeff!==0)return null;
  const th=theta(p),t=p.v0*Math.tan(th)/g,point={x:p.v0*t,y:-.5*g*t*t},normal={x:Math.sin(th),y:Math.cos(th)};
  const distance=point.x*normal.x+point.y*normal.y;
  const foot={x:point.x-distance*normal.x,y:point.y-distance*normal.y};
  return {t,point,foot,distance,normal};
}
export function vacuumEnvelopeY(p:ProjectileCouplingParams,x:number){
  return p.v0*p.v0/(2*g)-g*x*x/(2*p.v0*p.v0);
}
/** A conservative vacuum-based initial domain. For a real sample extend it
 * to the last physical point and simultaneous analytic reference point.
 * Under the prescribed force law x is nondecreasing and y has at most one
 * turning point, whose height is bounded by the vacuum apex. */
export function projectileBounds(p:ProjectileCouplingParams,s?:ProjectileCouplingState):Bounds{
  const a=alpha(p),R=Math.max(.5,p.troughRadius),range=p.v0*p.v0/g;
  let maxX:number,minY:number,maxY:number;
  if(p.mode==='incline-flat'){
    maxX=2*range*Math.tan(theta(p));minY=-maxX*Math.tan(theta(p));maxY=0;
  }else if(p.mode==='semicircle-trough'){
    maxX=2*R;minY=-R;maxY=p.v0*p.v0*Math.sin(a)**2/(2*g);
  }else{maxX=range;minY=0;maxY=range/2;}
  if(s){
    maxX=Math.max(maxX,s.x);minY=Math.min(minY,s.y);maxY=Math.max(maxY,s.y);
    if(p.dragCoeff>0){
      const vac=s.vacuumTrail.at(-1);
      if(vac){maxX=Math.max(maxX,vac.x);minY=Math.min(minY,vac.y);maxY=Math.max(maxY,vac.y);}
    }
  }
  const span=Math.max(.8,maxX,maxY-minY);
  return {minX:-.17*span,maxX:maxX+.17*span,minY:minY-.17*span,maxY:maxY+.20*span};
}
export function fitProjectileViewport(p:ProjectileCouplingParams,s:ProjectileCouplingState|undefined,v:Viewport,safe:SafeRect):Viewport|null{
  if(safe.right-safe.left<100||safe.bottom-safe.top<100)return null;
  const b=projectileBounds(p,s),ppm=Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!(ppm>0&&Number.isFinite(ppm)))return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function projectileBoundsFit(p:ProjectileCouplingParams,s:ProjectileCouplingState,v:Viewport,safe:SafeRect){
  const b=projectileBounds(p,s),ppm=.24*Math.min(v.width,v.height)*v.scale,ox=.45*v.width+v.offsetX,oy=.5*v.height+v.offsetY;
  return ox+b.minX*ppm>=safe.left-1&&ox+b.maxX*ppm<=safe.right+1&&oy-b.maxY*ppm>=safe.top-1&&oy-b.minY*ppm<=safe.bottom+1;
}
export function projectileInitialView(p:ProjectileCouplingParams,v:{width:number;height:number}){
  const full:Viewport={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const f=fitProjectileViewport(p,undefined,full,{left:28,right:v.width>=1200?v.width-300:v.width-28,top:30,bottom:v.height>=650?v.height-170:v.height-28})??full;
  return {scale:f.scale,offsetRatioX:f.offsetX/v.width,offsetRatioY:f.offsetY/v.height};
}
export function projectileVelocityScale(s:ProjectileCouplingState,p:ProjectileCouplingParams){
  const b=projectileBounds(p,s),span=Math.max(.8,(b.maxX-b.minX)/1.34,(b.maxY-b.minY)/1.37);
  return .13*span/Math.max(p.v0,Math.hypot(s.vx,s.vy),1e-12);
}
export function projectileDiagram(s:ProjectileCouplingState,p:ProjectileCouplingParams,options?:DiagramExportOptions){
  const items:ProjectileItem[]=[];
  const push=(primitive:DiagramPrimitive,role:ProjectileRole,layer:ProjectileItem['layer'])=>items.push({primitive,role,layer});
  const line=(a:Point,b:Point,role:ProjectileRole,layer:ProjectileItem['layer'],dashed=false)=>push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role,layer);
  const text=(a:Point,value:string,role:ProjectileRole,layer:ProjectileItem['layer'])=>push({kind:'text',x:a.x,y:a.y,text:value,align:'middle'},role,layer);
  const dot=(a:Point,r:number,role:ProjectileRole,layer:ProjectileItem['layer'],fill=true)=>push({kind:'circle',cx:a.x,cy:a.y,r,fill},role,layer);
  const b=projectileBounds(p,s),span=Math.max(.8,(b.maxX-b.minX)/1.34,(b.maxY-b.minY)/1.37),r=.012*span;
  const P={x:s.x,y:s.y},O={x:0,y:0},a=alpha(p),th=theta(p),R=Math.max(.5,p.troughRadius);
  const v0={x:p.v0*Math.cos(a),y:p.v0*Math.sin(a)};
  // The same instantaneous velocity scale is used for v0 and v.
  const k=projectileVelocityScale(s,p);
  const arrow=(from:Point,v:Point,label:string)=>push({kind:'arrow',x1:from.x,y1:from.y,x2:from.x+k*v.x,y2:from.y+k*v.y,label},'velocity','construction');
  if(p.mode==='incline-flat'){
    const endX=Math.max(2*p.v0*p.v0*Math.tan(th)/g,s.x);
    line(O,{x:endX,y:-endX*Math.tan(th)},'surface','surface');
    text({x:.72*endX,y:-.72*endX*Math.tan(th)-.045*span},'斜面 θ='+p.inclineDeg+'°','surface','surface');
  }else if(p.mode==='semicircle-trough'){
    push({kind:'arc',cx:R,cy:0,r:R,startAngle:Math.PI,endAngle:2*Math.PI},'surface','surface');
    dot({x:R,y:0},r*.5,'ink','surface');
    line({x:R,y:0},{x:R,y:-R},'construction','surface',true);
    text({x:R+.07*span,y:-R*.5},'R='+R.toFixed(1)+' m','ink','surface');
  }else{
    const range=p.v0*p.v0/g;
    line(O,{x:range,y:0},'surface','surface');
    const points=Array.from({length:101},(_,i)=>{const x=range*i/100;return {x,y:vacuumEnvelopeY(p,x)};});
    push({kind:'polyline',points,dashed:true},'envelope','surface');
    text({x:.37*range,y:vacuumEnvelopeY(p,.37*range)+.045*span},'真空安全包络','envelope','surface');
  }
  if(options?.showTrajectory!==false){
    if(p.dragCoeff>0&&s.vacuumTrail.length>=2){
      push({kind:'trajectory',points:s.vacuumTrail,dashed:true},'vacuum','trajectory');
      const q=s.vacuumTrail.at(-1)!;
      text({x:q.x,y:q.y-.05*span},'同刻真空对照','vacuum','trajectory');
    }
    if(s.trail.length>=2)push({kind:'trajectory',points:s.trail},'trajectory','trajectory');
  }
  if(options?.showVelocityVectors!==false){
    arrow(O,v0,'v₀');
    if(s.t>1e-10)arrow(P,{x:s.vx,y:s.vy},'v');
  }
  if(p.dragCoeff===0&&Math.abs(a)<1e-12&&s.t>1e-10){
    const mid={x:s.x/2,y:0};
    line(O,{x:s.x,y:0},'construction','construction',true);
    line(mid,P,'construction','construction',true);
    dot(mid,r*.5,'construction','construction');
    text({x:mid.x,y:.04*span},'中点 x/2','construction','construction');
  }
  const far=vacuumFarthest(p);
  if(far){
    line(far.point,far.foot,'construction','construction',true);
    dot(far.point,r*.65,'construction','construction',false);
    const tangent={x:Math.cos(th),y:-Math.sin(th)},d=.024*span;
    const q={x:far.foot.x+d*tangent.x,y:far.foot.y+d*tangent.y};
    const z={x:far.foot.x+d*far.normal.x,y:far.foot.y+d*far.normal.y};
    const corner={x:q.x+d*far.normal.x,y:q.y+d*far.normal.y};
    line(q,corner,'construction','construction');line(corner,z,'construction','construction');
    text({x:(far.point.x+far.foot.x)/2+.05*span,y:(far.point.y+far.foot.y)/2},'dₘₐₓ','construction','construction');
    text({x:far.point.x,y:far.point.y+.065*span},'理论最远点','construction','construction');
  }
  dot(P,r,'event','always');
  if(s.termination){
    dot(P,r*1.6,'event','always',false);
    text({x:P.x,y:P.y+.055*span},(s.landed?'撞击':'飞出槽口')+' · '+s.t.toFixed(3)+' s','event','always');
  }
  return {items,bounds:b};
}
