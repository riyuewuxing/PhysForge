import { createWorldMapper, type DiagramIR,type DiagramPrimitive,type Viewport } from '@physforge/sim-sdk';
import { normalQuantities,coriolisQuantities,computeObservables,type ChaosNormalCoriolisState as State,type ChaosNormalCoriolisParams as Params } from './engine.js';
type Point={x:number;y:number};
export type Role='ink'|'muted'|'main'|'shadow'|'green'|'warm';
type Item={role:Role;primitive:DiagramPrimitive};
const pt=(x:number,y:number):Point=>({x,y});
const fmt=(n:number,k=3)=>Number(n.toFixed(k)).toString();
export function pendulumBobs(y:State['dpState'],p:Params){
  const b1=pt(p.l1M*Math.sin(y[0]),-p.l1M*Math.cos(y[0]));
  return [b1,pt(b1.x+p.l2M*Math.sin(y[1]),b1.y-p.l2M*Math.cos(y[1]))] as const;
}
export function normalCenters(s:State,p:Params){
  const q=normalQuantities(s,p);
  return [pt(-1.4+q.x1,.70),pt(1.4+q.x2,.70)] as const;
}
export function coriolisFrames(s:State,p:Params){
  const q=coriolisQuantities(s,p);
  // Equal physical scale in the two panels; reference rings expand only as a
  // display window. No finite disk boundary or collision is part of this model.
  const r=Math.max(1,Math.ceil(2*(Math.max(q.r,q.labR,...s.coriolisTrail.map(z=>Math.max(Math.hypot(z.lx,z.ly),Math.hypot(z.rx,z.ry))))+.12))/2);
  const d=r+Math.max(.26,.10*r);
  return {r,left:pt(-d,0),right:pt(d,0),lab:pt(-d+s.labPos.x,s.labPos.y),rot:pt(d+q.x,q.y)};
}
export function advancedBounds(s:State,p:Params):DiagramIR['viewBox']{
  if(p.mode==='double-pendulum'){
    const r=p.l1M+p.l2M;
    return {minX:-r-.30,minY:-r-.50,maxX:2.65*r+.30,maxY:r+.70};
  }
  if(p.mode==='normal-modes')return {minX:-3.1,minY:-1.96,maxX:3.1,maxY:1.76};
  const {r,right}=coriolisFrames(s,p),pad=Math.max(.39,.09*r),u=Math.max(.18,.05*r);
  return {minX:-right.x-r-pad,minY:-r-3*u,maxX:right.x+r+pad,maxY:r+3.5*u};
}
export function advancedViewBounds(s:State,p:Params,v:Viewport){
  const b=advancedBounds(s,p),m=createWorldMapper(v),a=m.toScreen(b.minX,b.maxY),z=m.toScreen(b.maxX,b.minY);
  return {left:a.x,right:z.x,top:a.y,bottom:z.y};
}
export function fitAdvancedViewport(s:State,p:Params,v:Viewport,safe:{left:number;right:number;top:number;bottom:number}):Viewport|null{
  const b=advancedBounds(s,p),base=.24*Math.min(v.width,v.height);
  const ppm=Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0||base<=0)return null;
  return {...v,scale:ppm/base,offsetX:(safe.left+safe.right)/2-.45*v.width-(b.minX+b.maxX)*ppm/2,offsetY:(safe.top+safe.bottom)/2-.5*v.height+(b.minY+b.maxY)*ppm/2};
}
export function advancedItems(s:State,p:Params):Item[]{
  const out:Item[]=[];
  const add=(primitive:DiagramPrimitive,role:Role='ink')=>out.push({primitive,role});
  const line=(a:Point,b:Point,role:Role='ink',dashed=false)=>add({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role);
  const circle=(a:Point,r:number,role:Role='ink',fill=false,dashed=false)=>add({kind:'circle',cx:a.x,cy:a.y,r,fill,dashed},role);
  const label=(x:number,y:number,text:string,role:Role='ink',align:'start'|'middle'|'end'='middle')=>add({kind:'text',x,y,text,align},role);
  const trajectory=(points:Point[],role:Role,dashed=false)=>{if(points.length>1)add({kind:'trajectory',points,dashed},role);};
  const bounds=advancedBounds(s,p);
  if(p.mode==='double-pendulum'){
    const r=p.l1M+p.l2M,pivot=pt(0,0),main=pendulumBobs(s.dpState,p),shadow=pendulumBobs(s.dpShadow,p);
    label((bounds.minX+bounds.maxX)/2,r+.48,'双摆 · 绝对角相对铅直向下 · 相邻初角差 10⁻⁴ rad');
    label(0,r+.22,'主摆实线 · 邻近摆虚线','muted');
    for(const [b,role,dashed] of [[shadow,'shadow',true],[main,'main',false]] as const){
      line(pivot,b[0],role,dashed);line(b[0],b[1],role,dashed);
      circle(b[0],.045*Math.sqrt(p.m1Kg),role,true);circle(b[1],.045*Math.sqrt(p.m2Kg),role,true);
    }
    circle(pivot,.04,'ink',true);line(pivot,pt(0,-r),'muted',true);
    const x0=r+.28,x1=2.52*r,y0=-.62*r,y1=.62*r;
    const wc=Math.max(1,Math.ceil(Math.max(...s.poincarePts.map(z=>Math.abs(z.w2)),0)));
    label((x0+x1)/2,y1+.27,'庞加莱截面 θ₁=2πk，ω₁>0','warm');
    add({kind:'rect',x:x0,y:y0,width:x1-x0,height:y1-y0},'muted');
    line(pt((x0+x1)/2,y0),pt((x0+x1)/2,y1),'muted',true);
    line(pt(x0,0),pt(x1,0),'muted',true);
    for(const z of s.poincarePts)circle(pt(x0+(z.th2+Math.PI)/(2*Math.PI)*(x1-x0),(y1/wc)*z.w2),.020*r,'warm',true);
    label(x0,y0-.13,'−π','muted');label(x1,y0-.13,'π','muted');label((x0+x1)/2,y0-.26,'θ₂ / rad','muted');
    label(x0-.07,y1,fmt(wc)+'','muted','end');label(x0-.07,y0,'−'+fmt(wc),'muted','end');
    label(x0,y1+.12,'ω₂ / rad·s⁻¹','muted','start');
    label((x0+x1)/2,y0-.45,'保留截面点 '+s.poincarePts.length+' / 120','muted');
    const obs=computeObservables(s,p);
    label(0,-r-.17,'L₁='+fmt(p.l1M)+' m  L₂='+fmt(p.l2M)+' m','ink');
    label((bounds.minX+bounds.maxX)/2,-r-.37,'主值角距 '+obs.dpDivergenceRad!.toExponential(2)+' rad；主轨能量最大相对漂移 '+s.dpMaxRelDrift.toExponential(2),'ink');
  }else if(p.mode==='normal-modes'){
    const q=normalQuantities(s,p),[a,b]=normalCenters(s,p),half=.16;
    label(0,1.55,'等质量双振子 · 同一位移比例 · 真实时间波形');
    for(const x of [-2.8,2.8])line(pt(x,.34),pt(x,1.06),'muted');
    for(const [l,r,role] of [[-2.8,a.x-half,'muted'],[a.x+half,b.x-half,'warm'],[b.x+half,2.8,'muted']] as const)
      add({kind:'spring',x1:l,y1:a.y,x2:r,y2:a.y,coils:12,amplitude:.075},role);
    add({kind:'block',cx:a.x,cy:a.y,width:.32,height:.32,label:'m₁'},'main');
    add({kind:'block',cx:b.x,cy:b.y,width:.32,height:.32,label:'m₂'},'warm');
    label(-2.8,1.18,'k_w','muted','start');label(0,1.18,'k_c','warm');label(2.8,1.18,'k_w','muted','end');
    const left=-2.8,right=2.8,top=.05,bottom=-1.07,mid=(top+bottom)/2;
    add({kind:'rect',x:left,y:bottom,width:right-left,height:top-bottom},'muted');
    line(pt(left,mid),pt(right,mid),'muted',true);
    const start=s.nmTrail[0]?.t??0,end=Math.max(start+1,s.nmTrail.at(-1)?.t??0),span=end-start;
    const amax=Math.max(1,...s.nmTrail.map(z=>Math.max(Math.abs(z.x1),Math.abs(z.x2))));
    for(const [key,role] of [['x1','main'],['x2','warm']] as const)trajectory(s.nmTrail.map(z=>pt(left+(z.t-start)/span*(right-left),mid+(top-bottom)*.44*z[key]/amax)),role,key==='x2');
    label(left,bottom-.12,fmt(start)+' s','muted','start');label(right,bottom-.12,fmt(end)+' s','muted','end');
    label(0,.18,'x₁ 实线='+fmt(q.x1)+' m · x₂ 虚线='+fmt(q.x2)+' m');
    label(left+.10,mid+(top-bottom)*.44,fmt(amax)+' m','muted','start');
    label(left+.10,mid-(top-bottom)*.44,'−'+fmt(amax)+' m','muted','start');
    label(0,-1.37,'K='+fmt(q.K)+' J · U墙='+fmt(q.Uwall)+' J · U耦合='+fmt(q.Ucoupling)+' J');
    label(0,-1.58,'E同相='+fmt(q.Es)+' J · E反相='+fmt(q.Ea)+' J · E总='+fmt(q.E)+' J','green');
    label(0,-1.79,'ω₁='+fmt(q.w1)+' rad/s；ω₂='+fmt(q.w2)+' rad/s','muted');
  }else{
    const sc=coriolisFrames(s,p),q=coriolisQuantities(s,p),r=sc.r,u=Math.max(.18,.05*r);
    label(0,r+2.6*u,'无界旋转坐标平面 · 参考圆不是物理边界');
    for(const [center,head,trail,title,role] of [
      [sc.left,sc.lab,s.coriolisTrail.map(z=>pt(sc.left.x+z.lx,z.ly)),'地面惯性系','green'],
      [sc.right,sc.rot,s.coriolisTrail.map(z=>pt(sc.right.x+z.rx,z.ry)),'旋转坐标系','main']
    ] as const){
      circle(center,r,'muted',false,true);
      line(pt(center.x-r,0),pt(center.x+r,0),'muted',true);
      line(pt(center.x,-r),pt(center.x,r),'muted',true);
      trajectory(trail,role);
      circle(head,Math.max(.035,r*.025),role,true);
      label(center.x,r+.9*u,title,role);
      label(center.x,-r-1.25*u,'r='+fmt(Math.hypot(head.x-center.x,head.y-center.y))+' m','muted');
    }
    label(0,-r-2.1*u,'同一长度比例 · 参考圆半径 '+fmt(r)+' m · 双系位置偏差 '+q.positionError.toExponential(2)+' m','ink');
  }
  return out;
}
export function advancedDiagram(s:State,p:Params):DiagramIR{
  const b=advancedBounds(s,p),width=1040,height=Math.max(360,Math.round(width*(b.maxY-b.minY)/(b.maxX-b.minX)));
  return {width,height,viewBox:b,title:p.mode==='double-pendulum'?'混沌双摆与庞加莱截面':p.mode==='normal-modes'?'等质量耦合振子与简正模':'无界平面惯性与旋转坐标系对照',primitives:advancedItems(s,p).map(i=>i.primitive)};
}
