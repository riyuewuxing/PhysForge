import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import type { DiagramIR, DiagramPrimitive } from '@physforge/sim-sdk';
import { rollingQuantities, SHAPE_INERTIA_COEFF, type RigidBodyShape, type RigidRollingParams, type RigidRollingState } from './engine.js';

type Point={x:number;y:number};
export type RollingRole='ink'|'muted'|'velocity'|'rotation'|'contact'|'rolling'|'slipping'|'energy'|'heat';
export type RollingItem={role:RollingRole;primitive:DiagramPrimitive};
const pt=(x:number,y:number):Point=>({x,y});
const fmt=(n:number,d=2)=>Number(n.toFixed(d)).toString();
export const SPEED_SCALE=.030;
export const V_LANE=1.24,W_LANE=.91,U_LANE=.58;
export const SHAPES:readonly RigidBodyShape[]=['solid-sphere','solid-cylinder','hollow-sphere','thin-ring'];
const names:Record<RigidBodyShape,string>={'solid-sphere':'实心球','solid-cylinder':'实心圆柱','hollow-sphere':'空心薄球壳','thin-ring':'薄圆环'};

export interface RollingBodyGeometry {
  shape:RigidBodyShape; center:Point; contact:Point; radius:number; angle:number;
  trackStart:Point;trackEnd:Point;distance:number;velocity:number;
}
export function rollingScene(s:RigidRollingState,p:RigidRollingParams){
  const R=Math.max(.05,p.radiusM),race=p.scenario==='incline-race';
  const theta=race?degToRad(p.inclineDeg):0,tangent=pt(Math.cos(theta),-Math.sin(theta)),normal=pt(Math.sin(theta),Math.cos(theta));
  const xLocal=Math.max(-1.05,Math.min(1.05,s.x)),windowOrigin=s.x-xLocal;
  const raceExtent=Math.max(8,...Object.values(s.inclinePositions));
  const bodies:RollingBodyGeometry[]=race?SHAPES.map((shape,i)=>{
    const x=i%2===0?-1.10:1.10,y=i<2?1.02:-1.03;
    const base=pt(x,y),L=.78,c=SHAPE_INERTIA_COEFF[shape];
    const dist=s.inclinePositions[shape],along=-L+2*L*dist/raceExtent;
    const contact=pt(base.x+along*tangent.x,base.y+along*tangent.y);
    const radius=Math.min(.22,Math.max(.085,R*.82));
    return {shape,contact,center:pt(contact.x+radius*normal.x,contact.y+radius*normal.y),
      radius,angle:-dist/R,trackStart:pt(base.x-L*tangent.x,base.y-L*tangent.y),trackEnd:pt(base.x+L*tangent.x,base.y+L*tangent.y),
      distance:dist,velocity:CLASSROOM_GRAVITY*Math.sin(theta)*s.t/(1+c)};
  }):[{shape:p.shape,contact:pt(xLocal,0),center:pt(xLocal,R),radius:R,angle:-s.theta,trackStart:pt(-2.03,0),trackEnd:pt(2.03,0),distance:s.x,velocity:s.v}];
  const selected=bodies.find(b=>b.shape===p.shape)!;
  return {bodies,selected,tangent,normal,windowOrigin,raceExtent,race};
}

export function rollingItems(s:RigidRollingState,p:RigidRollingParams):RollingItem[]{
  const sc=rollingScene(s,p),q=rollingQuantities(s,p),items:RollingItem[]=[];
  const add=(primitive:DiagramPrimitive,role:RollingRole='ink')=>items.push({role,primitive});
  const line=(x1:number,y1:number,x2:number,y2:number,role:RollingRole='ink',dashed=false)=>add({kind:'line',x1,y1,x2,y2,dashed},role);
  const text=(x:number,y:number,value:string,role:RollingRole='ink',align:'start'|'middle'|'end'='middle')=>add({kind:'text',x,y,text:value,align},role);
  const circle=(c:Point,r:number,role:RollingRole='ink',fill=false)=>add({kind:'circle',cx:c.x,cy:c.y,r,fill},role);
  const arrow=(x1:number,y1:number,x2:number,y2:number,role:RollingRole,label?:string)=>add({kind:'arrow',x1,y1,x2,y2,...(label===undefined?{}:{label})},role);
  for(const b of sc.bodies){
    const chosen=b.shape===p.shape,role:RollingRole=sc.race?(chosen?'velocity':'muted'):(s.mode==='pure-rolling'?'rolling':'slipping');
    add({kind:'hatchedGround',x1:b.trackStart.x,y1:b.trackStart.y,x2:b.trackEnd.x,y2:b.trackEnd.y,depth:.065},'muted');
    circle(b.center,b.radius,role);
    if(b.shape==='hollow-sphere'||b.shape==='thin-ring')circle(b.center,b.radius*(b.shape==='thin-ring'?.82:.66),role);
    if(b.shape==='solid-cylinder')circle(b.center,b.radius*.20,role);
    const dx=b.radius*Math.cos(b.angle),dy=b.radius*Math.sin(b.angle);
    line(b.center.x,b.center.y,b.center.x+dx,b.center.y+dy,role);
    circle(pt(b.center.x+dx,b.center.y+dy),Math.min(.017,b.radius*.10),role,true);
    circle(b.contact,.013,'ink',true);
  }
  if(sc.race){
    text(0,2.26,'四刚体理想纯滚动 · 同时静止释放','ink');
    text(0,2.08,'静摩擦充足；各轨道共用位移比例，圆形图标半径仅示意','muted');
    sc.bodies.forEach((b,i)=>{
      const x=i%2===0?-1.10:1.10,y=i<2?1.02:-1.03;
      const c=SHAPE_INERTIA_COEFF[b.shape],a=CLASSROOM_GRAVITY*Math.sin(q.theta)/(1+c);
      text(x,y+.82,names[b.shape]+' · c='+fmt(c,3)+(b.shape===p.shape?' 〔选中〕':''),b.shape===p.shape?'velocity':'ink');
      text(x,y-.69,'s='+fmt(b.distance)+' m  v='+fmt(b.velocity)+' m/s','ink');
      text(x,y-.85,'a='+fmt(a)+' m/s²  μs≥'+fmt(c/(1+c)*Math.tan(q.theta),3),'muted');
    });
    text(0,-2.19,'共同位移范围 0—'+fmt(sc.raceExtent)+' m  ·  t='+fmt(s.t,3)+' s','muted');
  }else{
    const b=sc.selected;
    text(0,1.63,(s.mode==='pure-rolling'?'纯滚动 · 接触点瞬时静止':'滑动 · 摩擦反抗接触点相对速度')+'  |  '+names[p.shape],s.mode==='pure-rolling'?'rolling':'slipping');
    // Signed vectors share one visual scale and common origin in a dedicated lane.
    // They are velocity components, not force arrows or spatial displacements.
    const vectors=[{y:V_LANE,value:s.v,label:'v',caption:'质心 v',role:'velocity'},
      {y:W_LANE,value:-s.omega*q.R,label:'−ωR',caption:'接触点转动分量 −ωR',role:'rotation'},
      {y:U_LANE,value:q.u,label:'u',caption:'接触点合速度 u',role:'contact'}] as const;
    for(const v of vectors){
      text(-2.02,v.y+.11,v.caption+' = '+fmt(v.value,3)+' m/s',v.role,'start');
      line(-1.95,v.y-.09,1.95,v.y-.09,'muted',true);
      if(Math.abs(v.value)>1e-12)arrow(0,v.y-.09,v.value*SPEED_SCALE,v.y-.09,v.role,v.label);
      else circle(pt(0,v.y-.09),.018,v.role,true);
    }
    const min=sc.windowOrigin-2.03,max=sc.windowOrigin+2.03;
    for(let n=Math.ceil(min/.5);n<=Math.floor(max/.5);n++){
      const x=n*.5-sc.windowOrigin;
      line(x,-.045,x,-.13,'muted');text(x,-.24,fmt(n*.5,1),'muted');
    }
    text(0,-.43,'地面位置 x='+fmt(s.x,3)+' m  ·  t='+fmt(s.t,3)+' s','ink');
    text(0,-.59,'局部显示窗口原点 '+fmt(sc.windowOrigin,3)+' m；圆半径 R='+fmt(q.R,3)+' m','muted');
    const energy=[{name:'平动动能',value:q.vEnergy,role:'velocity'},{name:'转动动能',value:q.wEnergy,role:'rotation'},{name:'滑动耗散 Q',value:q.heat,role:'heat'}] as const;
    const denom=Math.max(1e-12,s.initialEnergyJ,q.vEnergy+q.wEnergy+q.heat);
    let left=-1.95;
    for(const e of energy){
      const width=3.9*e.value/denom;
      if(width>1e-10)add({kind:'rect',x:left,y:-.98,width,height:.20},e.role);
      left+=width;
    }
    add({kind:'rect',x:-1.95,y:-.98,width:3.9,height:.20},'ink');
    energy.forEach((e,i)=>text(-1.96+i*1.36,-1.16,e.name+' '+fmt(e.value,3)+' J',e.role,'start'));
    text(0,-1.38,'f='+fmt(q.f,4)+' N；L='+fmt(q.angularMomentum,4)+' kg·m²/s；机械能 '+fmt(s.currentEnergyJ,3)+' J');
    const end=s.transitionTimeS!==null?'已进入纯滚 t_c='+fmt(s.transitionTimeS,5)+' s':q.predictedTime===null?'μk=0：不会由摩擦锁定':'预测 t_c='+fmt(q.predictedTime,5)+' s';
    text(0,-1.58,end+'  ·  顺滚方向 ω 为正','muted');
  }
  return items;
}
export function rollingDiagram(s:RigidRollingState,p:RigidRollingParams):DiagramIR {
  const race=p.scenario==='incline-race';
  return {width:900,height:race?980:680,viewBox:{minX:-2.28,minY:race?-2.37:-1.76,maxX:2.28,maxY:race?2.43:1.82},
    title:race?'四刚体斜面理想纯滚动竞速':'水平刚体滑滚转换与接触点速度',primitives:rollingItems(s,p).map(x=>x.primitive)};
}
