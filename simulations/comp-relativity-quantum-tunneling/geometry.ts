import {createWorldMapper,type DiagramIR,type DiagramPrimitive,type Viewport} from '@physforge/sim-sdk';
import {TDSE_GRID_N,TDSE_DX,TDSE_X_MIN,TDSE_X_MAX,potentialSupport,solveLorentzInterval,type RelativityQuantumParams as Params,type RelativityQuantumState as State} from './engine.js';

type Point={x:number;y:number};
type Role='ink'|'muted'|'main'|'imag'|'warm'|'green';
export type RelativityItem={primitive:DiagramPrimitive;role:Role};
const pt=(x:number,y:number):Point=>({x,y});
const fmt=(v:number,n=3)=>Number(v.toFixed(n)).toString();
const QLEFT=-3.6,QRIGHT=3.6,VB=-1.10,VS=.10;
const X0=-2.1,SR_SCALE=.225,L=8.7;
const qx=(x:number)=>QLEFT+(x-TDSE_X_MIN)/(TDSE_X_MAX-TDSE_X_MIN)*(QRIGHT-QLEFT);
const sx=(x:number,ct:number)=>pt(X0+SR_SCALE*x,SR_SCALE*ct);
export function relativityBounds(p:Params):DiagramIR['viewBox']{
  return p.mode==='tdse-tunneling'?{minX:-4.4,minY:-2.65,maxX:4.1,maxY:2.66}:{minX:-4.55,minY:-2.66,maxX:4.55,maxY:2.66};
}
export function relativityViewBounds(p:Params,v:Viewport){
  const b=relativityBounds(p),m=createWorldMapper(v),a=m.toScreen(b.minX,b.maxY),z=m.toScreen(b.maxX,b.minY);
  return {left:a.x,right:z.x,top:a.y,bottom:z.y};
}
export function fitRelativityViewport(p:Params,v:Viewport,safe:{left:number;right:number;top:number;bottom:number}):Viewport|null{
  const b=relativityBounds(p),base=.24*Math.min(v.width,v.height),ppm=Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0||base<=0)return null;
  return {...v,scale:ppm/base,offsetX:(safe.left+safe.right)/2-.45*v.width-(b.minX+b.maxX)*ppm/2,offsetY:(safe.top+safe.bottom)/2-.5*v.height+(b.minY+b.maxY)*ppm/2};
}
export function relativityEventPoint(p:Params){return sx(p.eventX,p.eventCt);}
export function potentialHandle(s:State,p:Params){
  const support=potentialSupport(s.potential);
  const index=support.empty?Math.ceil(TDSE_GRID_N/2):support.first;
  return {point:pt(qx(TDSE_X_MIN+index*TDSE_DX),VB+VS*s.potential[index]!),onHeight:(y:number)=>Math.max(.5,Math.min(5,Math.round(Math.abs((y-VB)/VS)*10)/10)),support,p};
}
function visibleProjection(a:Point,b:Point){
  // a is inside the fixed metric frame; clip the segment without altering its slope.
  let u=1;const dx=b.x-a.x,dy=b.y-a.y;
  if(dx>0)u=Math.min(u,(L-a.x)/dx);if(dx<0)u=Math.min(u,(-L-a.x)/dx);
  if(dy>0)u=Math.min(u,(L-a.y)/dy);if(dy<0)u=Math.min(u,(-L-a.y)/dy);
  return {point:pt(a.x+u*dx,a.y+u*dy),inside:u>=1-1e-10};
}
export function relativityItems(s:State,p:Params):RelativityItem[]{
  const a:RelativityItem[]=[];
  const add=(primitive:DiagramPrimitive,role:Role='ink')=>a.push({primitive,role});
  const line=(u:Point,v:Point,role:Role='ink',dashed=false)=>add({kind:'line',x1:u.x,y1:u.y,x2:v.x,y2:v.y,dashed},role);
  const arrow=(u:Point,v:Point,role:Role='ink')=>add({kind:'arrow',x1:u.x,y1:u.y,x2:v.x,y2:v.y},role);
  const text=(x:number,y:number,t:string,role:Role='ink',align:'start'|'middle'|'end'='middle')=>add({kind:'text',x,y,text:t,align},role);
  const path=(points:Point[],role:Role,dashed=false)=>{if(points.length>1)add({kind:'polyline',points,dashed},role);};
  const dot=(u:Point,r:number,role:Role,fill=true)=>add({kind:'circle',cx:u.x,cy:u.y,r,fill},role);
  if(p.mode==='tdse-tunneling'){
    const support=potentialSupport(s.potential),density=Array.from(s.psiRe,(v,j)=>v*v+s.psiIm[j]!**2);
    const densityMax=Math.max(.10,...density)*1.10,ampMax=Math.max(.20,...Array.from(s.psiRe,Math.abs),...Array.from(s.psiIm,Math.abs))*1.10;
    const db=1.15,dt=2.05,wb=.22,wa=.48;
    const xAt=(j:number)=>qx(TDSE_X_MIN+j*TDSE_DX);
    text(0,2.48,'一维含时薛定谔演化 · 512 节点 · ℏ=m=1（约化单位）');
    for(const [y1,y2] of [[db,dt],[wb-wa,wb+wa],[VB-.5,VB+.5]] as const){
      add({kind:'rect',x:QLEFT,y:y1,width:QRIGHT-QLEFT,height:y2-y1},'muted');
    }
    for(const edge of [support.left,support.right]){
      if(!support.empty)line(pt(qx(edge),VB-.5),pt(qx(edge),dt),'muted',true);
    }
    line(pt(QLEFT,wb),pt(QRIGHT,wb),'muted',true);
    line(pt(QLEFT,VB),pt(QRIGHT,VB),'muted',true);
    path(density.map((v,j)=>pt(xAt(j),db+(dt-db)*v/densityMax)),'main');
    path(Array.from(s.psiRe,(v,j)=>pt(xAt(j),wb+wa*v/ampMax)),'main');
    path(Array.from(s.psiIm,(v,j)=>pt(xAt(j),wb+wa*v/ampMax)),'imag',true);
    const potential:Point[]=[];
    for(let j=0;j<TDSE_GRID_N;j++){
      const x=TDSE_X_MIN+j*TDSE_DX,y=VB+VS*s.potential[j]!;
      potential.push(pt(qx(Math.max(TDSE_X_MIN,x-TDSE_DX/2)),y),pt(qx(Math.min(TDSE_X_MAX,x+TDSE_DX/2)),y));
    }
    path(potential,'warm');
    text(QLEFT,2.22,'概率密度 |ψ|²（独立纵轴）','main','start');
    text(QLEFT-.10,dt,fmt(densityMax,4),'muted','end');text(QLEFT-.10,db,'0','muted','end');
    text(QLEFT,.87,'波函数：Re ψ 实线 · Im ψ 虚线','main','start');
    text(QLEFT-.10,wb+wa,fmt(ampMax,4),'muted','end');text(QLEFT-.10,wb,'0','muted','end');text(QLEFT-.10,wb-wa,'−'+fmt(ampMax,4),'muted','end');
    text(QLEFT,-.44,'V(x) 势能（独立纵轴）','warm','start');
    text(QLEFT-.10,VB+.5,'+5','muted','end');text(QLEFT-.10,VB,'0','muted','end');text(QLEFT-.10,VB-.5,'−5','muted','end');
    for(const x of [-50,-25,0,25,50]){const u=qx(x);line(pt(u,VB-.50),pt(u,VB-.55),'muted');text(u,-1.76,fmt(x),'muted');}
    text(0,-1.92,'x（约化长度）','muted');
    const E0=.5*p.waveMomentumK0**2;
    text(0,-2.12,'中心 E₀='+fmt(E0)+' · ⟨H离散⟩='+fmt(s.energyExpectation,5)+' · σ='+fmt(p.packetSigma)+' · 势场外缘 '+fmt(support.left,2)+' / '+fmt(support.right,2));
    text(0,-2.32,'左区 '+fmt(100*s.reflectionProb,2)+'%   中区 '+fmt(100*s.middleProb,2)+'%   右区 '+fmt(100*s.transmissionProb,2)+'%（占据概率，非即时 R/T）','green');
    text(0,-2.50,'有限盒反射边界；波包有动量展宽；边缘占据历史峰值 '+s.maxBoundaryProb.toExponential(2),'muted');
  }else{
    const lor=solveLorentzInterval(p.lorentzBeta,p.eventX,p.eventCt),beta=Math.max(-.98,Math.min(.98,p.lorentzBeta));
    const E=pt(p.eventX,p.eventCt),O=sx(0,0),T=pt(p.eventX,p.eventCt);
    const s2=lor.s2,causal=Math.abs(s2)<1e-10?'类光':s2>0?'类时':'类空';
    text(X0,2.46,'闵可夫斯基图 · x 与 ct 等比例');
    text(2.44,2.46,'理想折返 · 同出发与重逢事件');
    add({kind:'rect',x:X0-L*SR_SCALE,y:-L*SR_SCALE,width:2*L*SR_SCALE,height:2*L*SR_SCALE},'muted');
    line(sx(-L,-L),sx(L,L),'warm',true);line(sx(-L,L),sx(L,-L),'warm',true);
    arrow(sx(-L,0),sx(L,0),'muted');arrow(sx(0,-L),sx(0,L),'muted');
    text(X0+L*SR_SCALE-.08,.13,beta===0?'x=x′':'x','muted','end');
    text(X0+.09,L*SR_SCALE+.14,beta===0?'ct=ct′':'ct','muted','start');
    if(beta!==0){
      arrow(sx(-L,-beta*L),sx(L,beta*L),'main');
      arrow(sx(-beta*L,-L),sx(beta*L,L),'main');
      text(X0+L*SR_SCALE-.08,beta*L*SR_SCALE+(beta>0?.12:-.12),'x′','main','end');
      text(X0+beta*L*SR_SCALE,L*SR_SCALE+.14,'ct′','main',beta>0?'end':'start');
    }
    // Draw only the invariant branch through the selected event, at equal x,ct scale.
    if(Math.abs(s2)>=1e-10){
      const max=Math.sqrt(Math.max(0,L*L-Math.abs(s2))),points:Point[]=[];
      for(let i=0;i<=160;i++){
        const v=-max+2*max*i/160;
        if(s2>0)points.push(sx(v,Math.sign(E.y)*Math.sqrt(s2+v*v)));
        else points.push(sx(Math.sign(E.x)*Math.sqrt(-s2+v*v),v));
      }
      path(points,'green',true);
    }
    const px=pt(lor.gamma*lor.xPrime,lor.gamma*beta*lor.xPrime);
    const pc=pt(lor.gamma*beta*lor.ctPrime,lor.gamma*lor.ctPrime);
    let clipped=false;
    if(beta!==0){
      for(const z of [px,pc]){const c=visibleProjection(E,z);line(sx(E.x,E.y),sx(c.point.x,c.point.y),'main',true);if(c.inside)dot(sx(z.x,z.y),.026,'main',false);else clipped=true;}
    }
    line(sx(E.x,0),sx(E.x,E.y),'muted',true);line(sx(0,E.y),sx(E.x,E.y),'muted',true);
    dot(O,.028,'ink');dot(sx(E.x,E.y),.055,'green');text(X0+E.x*SR_SCALE-.10,E.y*SR_SCALE+.11,'E','green','end');
    text(X0,-2.17,'E=('+fmt(T.x)+', '+fmt(T.y)+')  →  E′=('+fmt(lor.xPrime)+', '+fmt(lor.ctPrime)+')','ink');
    text(X0,-2.36,causal+' · s²='+fmt(s2)+' · 跨系误差 '+lor.err.toExponential(2),'green');
    text(X0,-2.53,clipped?'部分 S′ 投影超出显示窗，数值仍为精确变换':'光锥斜率 ±1 · 虚线为等坐标投影/不变曲线','muted');
    // Proper-time comparison on an explicitly joined two-leg path, c=1 units.
    const C=2.44,B=-1.47,tx=(x:number,ct:number)=>pt(C+SR_SCALE*x,B+SR_SCALE*ct);
    arrow(tx(-5.8,0),tx(5.8,0),'muted');arrow(tx(0,0),tx(0,11.3),'muted');
    text(C+5.8*SR_SCALE,-1.30,'x','muted','end');text(C+.12,B+11.3*SR_SCALE,'ct','muted','start');
    const start=tx(0,0),turn=tx(5*beta,5),end=tx(0,10);
    line(start,end,'green');path([start,turn,end],'main',true);
    dot(start,.042,'ink');dot(end,.042,'ink');dot(turn,.047,'main');
    text(start.x-.08,start.y-.14,'O','ink','end');text(end.x+.10,end.y+.10,'B','ink','start');
    text(turn.x+(beta>=0?.10:-.10),turn.y+.08,'A（折返）','main',beta>=0?'start':'end');
    text(C,1.98,'留守（实线） 远行（虚线）','ink');
    text(C,1.78,'β='+fmt(beta,2)+' · γ='+fmt(lor.gamma,4));
    text(C,1.58,'留守 cτ='+fmt(s.twinStayProperTime,3)+' · 远行 cτ='+fmt(s.twinTravelerProperTime,3),'green');
    text(C,1.38,'瞬时反向，忽略加速段；c=1 约化单位','muted');
    text(C,-1.84,'O(0,0) · A('+fmt(5*beta,2)+',5) · B(0,10)','ink');
    text(C,-2.07,'每段惯性运动长度/时间单位相同','muted');
    text(C,-2.30,'两条世界线比较的是相同出发/重逢事件','muted');
  }
  return a;
}
export function relativityDiagram(s:State,p:Params):DiagramIR{
  const b=relativityBounds(p),width=1120,height=Math.round(width*(b.maxY-b.minY)/(b.maxX-b.minX));
  return {width,height,viewBox:b,title:p.mode==='tdse-tunneling'?'量子波包：概率密度、波函数、势能与分区':'洛伦兹时空图与双生子世界线',primitives:relativityItems(s,p).map(i=>i.primitive)};
}
