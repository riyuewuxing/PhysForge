import { CLASSROOM_GRAVITY as g,degToRad } from '@physforge/physics-core';
import type { DiagramPrimitive,DiagramExportOptions,ForceVectorItem,Viewport } from '@physforge/sim-sdk';
import { springAnchor, type SpringSepParams,type SpringSepState } from './engine.js';

export const BLOCK_WIDTH=.34,BLOCK_HEIGHT=.24;
export type SpringRole='surface'|'anchor'|'spring'|'block1'|'block2'|'axis'|'ink'|'guide'|'event'|'gravity'|'support'|'contact'|'external'|'velocity'|'gap';
type Point={x:number;y:number};
type Item={primitive:DiagramPrimitive;role:SpringRole;layer:'spring'|'eventPins'|'forces'|'construction'|'always'};
type Bounds={minX:number;maxX:number;minY:number;maxY:number};
export type SpringSafeRect={left:number;right:number;top:number;bottom:number};
export function springCoordinates(p:SpringSepParams){
  const a=degToRad(p.inclineDeg),t={x:Math.cos(a),y:Math.sin(a)},n={x:-Math.sin(a),y:Math.cos(a)};
  const point=(s:number,h=0):Point=>({x:s*t.x+h*n.x,y:s*t.y+h*n.y});
  return {t,n,point};
}
export function springForceVectors(s:SpringSepState,p:SpringSepParams):ForceVectorItem[]{
  const {t,n,point}=springCoordinates(p),a=point(s.s1,BLOCK_HEIGHT/2),b=point(s.s2+BLOCK_WIDTH,BLOCK_HEIGHT/2);
  const vec=(q:Point,k:number):Point=>({x:q.x*k,y:q.y*k});
  const c=Math.cos(degToRad(p.inclineDeg));
  const result:ForceVectorItem[]=[
    {id:'gravity-1',label:'m₁g',origin:a,force:{x:0,y:-p.mass1*g},color:'#fbbf24',category:'gravity'},
    {id:'normal-1',label:'N₁',origin:a,force:vec(n,p.mass1*g*c),color:'#38bdf8',category:'normal'},
    {id:'gravity-2',label:'m₂g',origin:b,force:{x:0,y:-p.mass2*g},color:'#fbbf24',category:'gravity'},
    {id:'normal-2',label:'N₂',origin:b,force:vec(n,p.mass2*g*c),color:'#38bdf8',category:'normal'}
  ];
  if(Math.abs(p.springK*s.s1)>1e-12)result.push({id:'spring-1',label:'F弹',origin:a,force:vec(t,-p.springK*s.s1),color:'#fbbf24',category:'other'});
  if(Math.abs(p.externalForce)>1e-12)result.push({id:'external-2',label:'F外',origin:b,force:vec(t,p.externalForce),color:'#a78bfa',category:'other'});
  if(s.normalForceN>1e-12)result.push({id:'contact-21',label:'F₂₁',origin:a,force:vec(t,-s.normalForceN),color:'#f472b6',category:'normal'},
    {id:'contact-12',label:'F₁₂',origin:b,force:vec(t,s.normalForceN),color:'#f472b6',category:'normal'});
  return result;
}
export function springDiagram(s:SpringSepState,p:SpringSepParams,opts?:DiagramExportOptions){
  const {point,t,n}=springCoordinates(p),items:Item[]=[],wall=springAnchor(p),w=BLOCK_WIDTH,h=BLOCK_HEIGHT;
  const right=Math.max(1.15,s.s2+w+.65,s.s1+.65,(s.separationPosS??0)+w+.65);
  const left=wall-.3;
  const push=(primitive:DiagramPrimitive,role:SpringRole,layer:Item['layer'])=>items.push({primitive,role,layer});
  const line=(a:Point,b:Point,role:SpringRole,layer:Item['layer'],dashed=false)=>push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role,layer);
  const text=(a:Point,value:string,role:SpringRole,layer:Item['layer'])=>push({kind:'text',x:a.x,y:a.y,text:value,align:'middle'},role,layer);
  const poly=(points:readonly Point[],role:SpringRole,layer:Item['layer'],closed=false)=>push({kind:'polyline',points,closed},role,layer);
  const arrow=(a:Point,b:Point,label:string,role:SpringRole,layer:Item['layer'])=>push({kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y,label},role,layer);
  const groundL=point(left),groundR=point(right);
  line(groundL,groundR,'surface','spring');
  // Explicit hatching in world coordinates keeps Canvas and print aligned.
  const spacing=Math.max(.15,(right-left)/120);
  for(let x=left+.04;x<=right;x+=spacing)line(point(x),point(x-.08,-.10),'surface','spring');
  line(point(wall,0),point(wall,.43),'anchor','spring');
  for(let j=0;j<4;j++)line(point(wall,j*.11),point(wall-.12,j*.11+.08),'anchor','spring');
  const end=s.s1-w/2,L=end-wall,amp=.055;
  if(L<=0)throw Error('M08 spring geometry outside analytic excursion bound');
  const pts=[point(wall,h/2),point(wall+.09*L,h/2)];
  // The rendered coils have fixed physical amplitude, and ends coincide
  // with the actual spring attachment and its fixed anchor.
  for(let j=0;j<=64;j++){const u=j/64;pts.push(point(wall+(.09+.82*u)*L,h/2+amp*Math.sin(16*Math.PI*u)));}
  pts.push(point(end,h/2));poly(pts,'spring','spring');
  function block(x:number,role:SpringRole,label:string){
    const a=point(x-w/2,0),b=point(x+w/2,0),c=point(x+w/2,h),d=point(x-w/2,h);
    poly([a,b,c,d],role,'always',true);text(point(x,h*.50),label,'ink','always');
  }
  block(s.s1,'block1','m₁');block(s.s2+w,'block2','m₂');
  line(point(0,-.16),point(0,.38),'axis','construction',true);
  text(point(0,-.28),'s=0（弹簧原长）','guide','construction');
  arrow(point(right-.75,-.18),point(right-.12,-.18),'+s','axis','construction');
  if(p.inclineDeg>0){
    const a=point(left+.14,-.17),b={x:a.x+.6,y:a.y},c={x:a.x+.6*t.x,y:a.y+.6*t.y};
    line(a,b,'guide','construction',true);line(a,c,'guide','construction',true);
    push({kind:'arc',cx:a.x,cy:a.y,r:.33,startAngle:0,endAngle:degToRad(p.inclineDeg)},'guide','construction');
    text({x:a.x+.43*Math.cos(degToRad(p.inclineDeg)/2),y:a.y+.43*Math.sin(degToRad(p.inclineDeg)/2)},'θ','guide','construction');
  }
  if(s.release){
    const at=s.release.s+w/2;
    line(point(at,-.16),point(at,.68),'event','eventPins',true);
    text(point(at,.77),'分离 '+s.release.t.toFixed(3)+' s','event','eventPins');
    text(point(at,.91),'s='+s.release.s.toFixed(3)+' m','event','eventPins');
  }
  if(s.terminal){
    const x=(s.s1+s.s2)/2+w/2;
    line(point(x,-.18),point(x,.48),'event','always',true);
    text(point(x,.58),'再接触 · 碰撞前停止','event','always');
  }else if(s.s2-s.s1>1e-8){
    const a=s.s1+w/2,b=s.s2+w/2;
    line(point(a,.31),point(b,.31),'gap','construction');
    line(point(a,.27),point(a,.37),'gap','construction');line(point(b,.27),point(b,.37),'gap','construction');
    text(point((a+b)/2,.43),'间隙 '+(s.s2-s.s1).toFixed(3)+' m','gap','construction');
  }
  if(opts?.showVelocityVectors!==false){
    const k=.42/Math.max(1,Math.abs(s.v1),Math.abs(s.v2));
    for(const [i,x,v] of [[1,s.s1,s.v1],[2,s.s2+w,s.v2]] as const){
      if(Math.abs(v)>1e-10)arrow(point(x,.34),point(x+k*v,.34),'v'+i,'velocity','construction');
    }
  }
  if(opts?.showForceLabels!==false){
    const fs=springForceVectors(s,p),k=.58/Math.max(1,...fs.map(f=>Math.hypot(f.force.x,f.force.y)));
    for(const f of fs){
      const role:SpringRole=f.id.startsWith('gravity')?'gravity':f.id.startsWith('normal')?'support':f.id.startsWith('contact')?'contact':f.id.startsWith('external')?'external':'spring';
      arrow(f.origin,{x:f.origin.x+k*f.force.x,y:f.origin.y+k*f.force.y},f.label,role,'forces');
    }
  }
  // Bounds cover the actual ideal apparatus and both blocks at the current
  // physical positions. Never clamp distances or shorten an unseen gap.
  const all=[point(left-.25,-.45),point(left-.25,1.03),point(right+.2,-.45),point(right+.2,1.03)];
  for(const a of items){const z=a.primitive;
    if(z.kind==='line'||z.kind==='arrow')all.push({x:z.x1,y:z.y1},{x:z.x2,y:z.y2});
    if(z.kind==='text')all.push({x:z.x,y:z.y});
  }
  const bounds:Bounds={minX:Math.min(...all.map(a=>a.x))-.13,maxX:Math.max(...all.map(a=>a.x))+.13,minY:Math.min(...all.map(a=>a.y))-.13,maxY:Math.max(...all.map(a=>a.y))+.13};
  return {items,bounds};
}
export function springBoundsFit(s:SpringSepState,p:SpringSepParams,v:Viewport,safe:SpringSafeRect){
  const b=springDiagram(s,p).bounds,ppm=.24*Math.min(v.width,v.height)*v.scale,ox=.45*v.width+v.offsetX,oy=.5*v.height+v.offsetY;
  return ox+b.minX*ppm>=safe.left&&ox+b.maxX*ppm<=safe.right&&oy-b.maxY*ppm>=safe.top&&oy-b.minY*ppm<=safe.bottom;
}
export function fitSpringViewport(s:SpringSepState,p:SpringSepParams,v:Viewport,safe:SpringSafeRect):Viewport|null{
  if(safe.right-safe.left<70||safe.bottom-safe.top<70)return null;
  const b=springDiagram(s,p).bounds,ppm=.92*Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function springInitialView(s:SpringSepState,p:SpringSepParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const fit=fitSpringViewport(s,p,full,{left:30,right:v.width>=1200?v.width-300:v.width-30,top:28,bottom:v.height>=650?v.height-170:v.height-30})??full;
  return {scale:fit.scale,offsetRatioX:fit.offsetX/v.width,offsetRatioY:fit.offsetY/v.height};
}
