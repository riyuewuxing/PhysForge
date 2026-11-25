import { degToRad } from '@physforge/physics-core';
import type { DiagramPrimitive,Viewport } from '@physforge/sim-sdk';
import type { BlockConveyorState,BlockConveyorParams } from './engine.js';
type Point={x:number;y:number};
export type ContactRole='support'|'block'|'trace'|'velocity'|'friction'|'ink'|'event';
type Layer='carrier'|'block'|'scratchTrack'|'forceAndVelocity'|'eventPins';
type Item={primitive:DiagramPrimitive;role:ContactRole;layer:Layer};
export const incline=(p:BlockConveyorParams)=>p.systemMode==='conveyor'?degToRad(p.inclineDeg):0;
export const world=(p:BlockConveyorParams,s:number,n=0):Point=>{const a=incline(p);return {x:s*Math.cos(a)-n*Math.sin(a),y:s*Math.sin(a)+n*Math.cos(a)};};
export function contactSupport(s:BlockConveyorState,p:BlockConveyorParams){
  const center=p.systemMode==='plank'?s.xCarrier:0,L=p.carrierLengthM??0,finite=Number.isFinite(L)&&L>0;
  return {finite,left:finite?center-L/2:Math.min(center,s.xBlock)-3,right:finite?center+L/2:Math.max(center,s.xBlock)+3,center};
}
export const blockCenter=(s:BlockConveyorState,p:BlockConveyorParams)=>world(p,s.xBlock,.21);
export function contactDiagram(s:BlockConveyorState,p:BlockConveyorParams){
  const items:Item[]=[],sup=contactSupport(s,p),a=incline(p),B=blockCenter(s,p);
  const push=(primitive:DiagramPrimitive,role:ContactRole,layer:Layer)=>items.push({primitive,role,layer});
  const line=(a:Point,b:Point,role:ContactRole,layer:Layer,dashed=false)=>push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role,layer);
  const label=(x:Point,text:string,role:ContactRole,layer:Layer)=>push({kind:'text',...x,text,align:'middle'},role,layer);
  const arrow=(from:Point,to:Point,label:string,role:ContactRole)=>push({kind:'arrow',x1:from.x,y1:from.y,x2:to.x,y2:to.y,label},role,'forceAndVelocity');
  const depth=p.systemMode==='conveyor'?.52:.3;
  line(world(p,sup.left),world(p,sup.right),'support','carrier');
  push({kind:'polyline',points:[world(p,sup.left),world(p,sup.left,-depth),world(p,sup.right,-depth),world(p,sup.right)],closed:sup.finite,dashed:!sup.finite},'support','carrier');
  if(p.systemMode==='conveyor'){
    const shift=((s.xCarrier% .8)+.8)% .8;
    const first=Math.ceil((sup.left-shift)/.8)*.8+shift;
    const stride=Math.max(.8,(sup.right-sup.left)/120);
    for(let x=first;x<=sup.right;x+=stride){const q=world(p,x,-.10);push({kind:'circle',cx:q.x,cy:q.y,r:.035,fill:true},'support','carrier');}
  }
  label(world(p,(sup.left+sup.right)/2,-depth-.26),sup.finite?'有限承载面 L='+((p.carrierLengthM??0).toFixed(1))+' m':'理想无限支撑（示意段）','ink','carrier');
  push({kind:'block',cx:B.x,cy:B.y,width:.55,height:.42,angleDeg:a*180/Math.PI,label:'m₁'},'block','block');
  // The material interval is distinct from the accumulated slip path;
  // only its intersection with this visible, unwrapped support is drawn.
  const left=Math.max(sup.left,s.xCarrier+s.scratchMinM),right=Math.min(sup.right,s.xCarrier+s.scratchMaxM);
  if(right>left+1e-10)line(world(p,left,.035),world(p,right,.035),'trace','scratchTrack');
  const vK=.3,fK=.55/Math.max(1,Math.abs(s.frictionOnBlockN),Math.abs(s.groundFrictionN));
  if(Math.abs(s.vBlock)>1e-10)arrow(world(p,s.xBlock,.63),world(p,s.xBlock+vK*s.vBlock,.63),'v₁='+s.vBlock.toFixed(2),'velocity');
  if(Math.abs(s.vCarrier)>1e-10)arrow(world(p,sup.center,-depth-.62),world(p,sup.center+vK*s.vCarrier,-depth-.62),'v₂='+s.vCarrier.toFixed(2),'velocity');
  if(Math.abs(s.frictionOnBlockN)>1e-10)arrow(B,world(p,s.xBlock+fK*s.frictionOnBlockN,.21),'f₁='+s.frictionOnBlockN.toFixed(2)+' N','friction');
  if(p.systemMode==='plank'&&Math.abs(s.groundFrictionN)>1e-10)arrow(world(p,s.xCarrier,-depth),world(p,s.xCarrier+fK*s.groundFrictionN,-depth),'f地='+s.groundFrictionN.toFixed(2)+' N','friction');
  if(s.terminal)label(world(p,s.xBlock,1.0),'边界 · 接触段结束','event','eventPins');
  const phase=s.coMovingLocked?'共速锁定':'相对滑动';
  label(world(p,s.xBlock,.99+(s.terminal?.4:0)),phase+(s.plankStopped?' · 木板静止':''),'ink','forceAndVelocity');
  const points:Point[]=[world(p,sup.left,-depth-1),world(p,sup.right,1.5),world(p,sup.left,1.5),world(p,sup.right,-depth-1),B];
  for(const {primitive:q} of items){
    if(q.kind==='line'||q.kind==='arrow')points.push({x:q.x1,y:q.y1},{x:q.x2,y:q.y2});
    if(q.kind==='text')points.push({x:q.x,y:q.y});
  }
  const xs=points.map(q=>q.x),ys=points.map(q=>q.y),span=Math.max(3,Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
  const bounds={minX:Math.min(...xs)-.1*span,maxX:Math.max(...xs)+.1*span,minY:Math.min(...ys)-.12*span,maxY:Math.max(...ys)+.12*span};
  return {items,bounds};
}
export function contactInitialView(s:BlockConveyorState,p:BlockConveyorParams,v:{width:number;height:number}){
  const b=contactDiagram(s,p).bounds,left=26,right=v.width>=1200?v.width-300:v.width-26,top=28,bottom=v.height>=650?v.height-175:v.height-28;
  const ppm=Math.min((right-left)/(b.maxX-b.minX),(bottom-top)/(b.maxY-b.minY));
  return {scale:ppm/(.24*Math.min(v.width,v.height)),offsetRatioX:((left+right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width)/v.width,offsetRatioY:((top+bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height)/v.height};
}
