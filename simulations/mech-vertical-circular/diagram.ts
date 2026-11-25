import { CLASSROOM_GRAVITY as g } from '@physforge/physics-core';
import type { DiagramPrimitive,DiagramExportOptions,ForceVectorItem,Viewport } from '@physforge/sim-sdk';
import type { VerticalCircularParams,VerticalCircularState } from './engine.js';
type Point={x:number;y:number};
type Bounds={minX:number;minY:number;maxX:number;maxY:number};
export type VerticalSafeRect={left:number;right:number;top:number;bottom:number};
export type VerticalRole='track'|'contact'|'free'|'velocity'|'guide'|'event'|'ball'|'gravity'|'reaction'|'ink';
type Item={primitive:DiagramPrimitive;role:VerticalRole;layer:'track'|'trajectory'|'construction'|'forces'|'always'};
const radius=(p:VerticalCircularParams)=>Math.max(.4,p.radius);
export function verticalForceVectors(s:VerticalCircularState,p:VerticalCircularParams):ForceVectorItem[]{
  const origin={x:s.x,y:s.y},r=Math.max(1e-12,Math.hypot(s.x,s.y));
  const f=p.trackMode==='outer-dome'?s.normalForceN:-s.normalForceN;
  return [{id:'mg',label:'mg',origin,force:{x:0,y:-p.mass*g},category:'gravity',color:'#fbbf24',unit:'N'},
    ...(!s.derailed&&Math.abs(f)>1e-12?[{id:'fn',label:p.trackMode==='light-rod'?'Fᵣ':'N',origin,force:{x:f*s.x/r,y:f*s.y/r},category:'normal' as const,color:'#38bdf8',unit:'N'}]:[])];
}
function baseBounds(p:VerticalCircularParams,s:VerticalCircularState,local:boolean):Bounds{
  const R=radius(p),far=s.derailed&&Math.hypot(s.x,s.y)>6*R;
  if(local&&far)return {minX:s.x-2.6*R,maxX:s.x+2.6*R,minY:s.y-2.2*R,maxY:s.y+2.2*R};
  let minX=Math.min(-R,s.x),maxX=Math.max(R,s.x),minY=Math.min(p.trackMode==='outer-dome'?0:-R,s.y),maxY=Math.max(R,s.y);
  for(const q of s.trail){minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minY=Math.min(minY,q.y);maxY=Math.max(maxY,q.y);}
  if(s.release){minX=Math.min(minX,s.release.x);maxX=Math.max(maxX,s.release.x);minY=Math.min(minY,s.release.y);maxY=Math.max(maxY,s.release.y);}
  return {minX:minX-.85*R,maxX:maxX+.85*R,minY:minY-.85*R,maxY:maxY+.85*R};
}
export function verticalBoundsFit(s:VerticalCircularState,p:VerticalCircularParams,v:Viewport,safe:VerticalSafeRect){
  const b=baseBounds(p,s,true),ppm=.24*Math.min(v.width,v.height)*v.scale,ox=.45*v.width+v.offsetX,oy=.5*v.height+v.offsetY;
  return ox+b.minX*ppm>=safe.left&&ox+b.maxX*ppm<=safe.right&&oy-b.maxY*ppm>=safe.top&&oy-b.minY*ppm<=safe.bottom;
}
export function fitVerticalViewport(s:VerticalCircularState,p:VerticalCircularParams,v:Viewport,safe:VerticalSafeRect):Viewport|null{
  if(safe.right-safe.left<70||safe.bottom-safe.top<70)return null;
  const b=baseBounds(p,s,true),ppm=.88*Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function verticalInitialView(s:VerticalCircularState,p:VerticalCircularParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const fit=fitVerticalViewport(s,p,full,{left:28,right:v.width>=1200?v.width-300:v.width-28,top:30,bottom:v.height>=650?v.height-170:v.height-28})??full;
  return {scale:fit.scale,offsetRatioX:fit.offsetX/v.width,offsetRatioY:fit.offsetY/v.height};
}
export function verticalDiagram(s:VerticalCircularState,p:VerticalCircularParams,opts?:DiagramExportOptions){
  const R=radius(p),items:Item[]=[],O={x:0,y:0},P={x:s.x,y:s.y};
  const push=(primitive:DiagramPrimitive,role:VerticalRole,layer:Item['layer'])=>items.push({primitive,role,layer});
  const line=(a:Point,b:Point,role:VerticalRole,layer:Item['layer'],dashed=false)=>push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role,layer);
  const text=(a:Point,value:string,role:VerticalRole,layer:Item['layer'])=>push({kind:'text',x:a.x,y:a.y,text:value,align:'middle'},role,layer);
  const dot=(a:Point,r:number,role:VerticalRole,layer:Item['layer'],fill=true)=>push({kind:'circle',cx:a.x,cy:a.y,r,fill},role,layer);
  const arrow=(a:Point,b:Point,label:string,role:VerticalRole,layer:Item['layer'])=>push({kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y,label},role,layer);
  if(p.trackMode==='outer-dome'){
    push({kind:'arc',cx:0,cy:0,r:R,startAngle:0,endAngle:Math.PI},'track','track');
    line({x:-R,y:0},{x:R,y:0},'guide','track',true);
  }else push({kind:'circle',cx:0,cy:0,r:R,dashed:p.trackMode==='light-rod'},'track','track');
  if(p.trackMode==='light-rod')line(O,P,'track','track');
  dot(O,.027*R,'ink','track');
  text({x:-.13*R,y:-.12*R},'O','ink','track');
  const q=s.release??s;
  line(O,{x:q.x,y:q.y},'guide','construction',true);
  line(O,{x:0,y:R},'guide','construction',true);
  const theta=Math.atan2(q.x,q.y);
  if(Math.abs(theta)>.035){
    const a=Math.PI/2-theta,b=Math.PI/2;
    push({kind:'arc',cx:0,cy:0,r:.29*R,startAngle:Math.min(a,b),endAngle:Math.max(a,b)},'guide','construction');
    text({x:.4*R*Math.sin(theta/2),y:.4*R*Math.cos(theta/2)},s.release?'θd':'θ','guide','construction');
  }
  text({x:q.x*.57-.12*R,y:q.y*.57-.10*R},'R','guide','construction');
  if(opts?.showTrajectory!==false){
    const contact=s.trail.slice(0,s.trailContactCount),free=s.trail.slice(Math.max(0,s.trailContactCount-1));
    if(contact.length>1)push({kind:'trajectory',points:contact},'contact','trajectory');
    if(s.derailed&&free.length>1)push({kind:'trajectory',points:free,dashed:true},'free','trajectory');
  }
  if(opts?.showVelocityVectors!==false){
    const v=Math.hypot(s.vx,s.vy),k=.55*R/Math.max(1,Math.sqrt(g*R),v,p.vLaunch);
    if(v>1e-12)arrow(P,{x:P.x+k*s.vx,y:P.y+k*s.vy},'v','velocity','construction');
  }
  if(opts?.showForceLabels!==false){
    const forces=verticalForceVectors(s,p),k=.55*R/Math.max(1,...forces.map(f=>Math.hypot(f.force.x,f.force.y)));
    for(const f of forces)arrow(P,{x:P.x+k*f.force.x,y:P.y+k*f.force.y},f.label,f.id==='mg'?'gravity':'reaction','forces');
  }
  if(s.release){
    const b=s.release;dot(b,.060*R,'event','always',false);
    text({x:b.x+.18*R,y:b.y+.18*R},'脱轨 '+b.t.toFixed(3)+' s','event','always');
    text({x:b.x+.18*R,y:b.y+.34*R},'θd='+s.derailAngleDeg!.toFixed(2)+'°','event','always');
  }
  dot(P,.047*R,'ball','always');
  return {items,bounds:baseBounds(p,s,false)};
}
