import type {DiagramPrimitive} from '@physforge/sim-sdk';
import {bohrEnergyEv,NUCLEAR_SCALE,PHOTON_INPUT_TOLERANCE_EV,RUTHERFORD_DEMO_DURATION_S,type RutherfordBohrParams,type RutherfordBohrState,type RutherfordTrajectoryResult} from './engine.js';
type Tone='ink'|'grid'|'path'|'sample'|'nucleus'|'force'|'velocity'|'energy'|'uv'|'ir'|'visible'|'alert';
export interface AtomicMark{primitive:DiagramPrimitive;tone:Tone;hex?:string}
export const ATOMIC_BOUNDS={minX:-2.58,minY:-1.60,maxX:2.42,maxY:1.58};
export const IMPACT_RAIL_X=-160/65;
export const PROBE_RAIL={x:.43,y:-1.19,w:1.72,min:5,max:15};
export const atomicPoint=(r:RutherfordTrajectoryResult,p:{x:number;y:number})=>({x:-.64+1.37*p.x/r.viewRadiusFm,y:1.37*p.y/r.viewRadiusFm});
const fmt=(v:number,d=3)=>v.toFixed(d);
export function atomicGeometry(s:RutherfordBohrState,p:RutherfordBohrParams){
  const marks:AtomicMark[]=[];
  const push=(primitive:DiagramPrimitive,tone:Tone='ink',hex?:string)=>marks.push({primitive,tone,...(hex?{hex}:{})});
  const text=(x:number,y:number,text:string,tone:Tone='ink',align:'start'|'middle'|'end'='middle',hex?:string)=>push({kind:'text',x,y,text,align},tone,hex);
  const line=(x1:number,y1:number,x2:number,y2:number,tone:Tone='ink',dashed=false,hex?:string)=>push({kind:'line',x1,y1,x2,y2,dashed},tone,hex);
  const arrow=(x1:number,y1:number,x2:number,y2:number,tone:Tone='ink',hex?:string)=>push({kind:'arrow',x1,y1,x2,y2},tone,hex);
  const circle=(cx:number,cy:number,r:number,tone:Tone,fill=false)=>push({kind:'circle',cx,cy,r,fill},tone);
  if(s.mode==='rutherford'){
    const r=s.rutherford,O=atomicPoint(r,{x:0,y:0}),P=(q:{x:number;y:number})=>atomicPoint(r,q);
    text(-.64,1.46,'固定重靶核 · 库仑排斥散射');
    text(-.64,1.29,'实线：RK45 轨迹；虚线：解析渐近线');
    circle(O.x,O.y,1.37,'grid');
    const b=p.impactParamFm,theta=(b<0?-1:1)*r.analyticalAngleDeg*Math.PI/180,ux=Math.cos(theta),uy=b===0?0:Math.sin(theta),R=r.viewRadiusFm;
    const drawAsymptote=(a:{x:number;y:number},c:{x:number;y:number})=>{const v=P(a),w=P(c);line(v.x,v.y,w.x,w.y,'grid',true);};
    const d=Math.sqrt(Math.max(0,R*R-b*b));
    drawAsymptote({x:-d,y:b},{x:0,y:b});
    drawAsymptote({x:-b*uy,y:b*ux},{x:d*ux-b*uy,y:d*uy+b*ux});
    push({kind:'trajectory',points:r.trajectoryFm.map(P),strokeWidth:2.5},'path');
    const near=r.trajectoryFm.reduce((best,q)=>Math.hypot(q.x,q.y)<Math.hypot(best.x,best.y)?q:best),N=P(near);
    line(O.x,O.y,N.x,N.y,'force',true);circle(N.x,N.y,.027,'force');
    circle(O.x,O.y,.04,'nucleus',true);
    line(O.x-.07,O.y,O.x+.07,O.y,'nucleus');line(O.x,O.y-.07,O.x,O.y+.07,'nucleus');
    text(O.x+.11,O.y-.13,'+Ze（点核符号）','nucleus','start');
    const C=P(s.sample);circle(C.x,C.y,.036,'sample',true);
    const vmax=Math.hypot(r.trajectoryFm[0]!.vx,r.trajectoryFm[0]!.vy);
    if(vmax>0)arrow(C.x,C.y,C.x+.39*s.sample.vx/vmax,C.y+.39*s.sample.vy/vmax,'velocity');
    text(-.64,-1.45,'绘图标尺：圆半径 '+R.toFixed(1)+' fm；点核符号不按半径绘制');
    // Independent parameter rail keeps the historic impact handle contract.
    line(IMPACT_RAIL_X,-80/65,IMPACT_RAIL_X,80/65,'grid');
    for(const v of [-80,-40,0,40,80]){line(IMPACT_RAIL_X-.035,v/65,IMPACT_RAIL_X+.035,v/65);text(IMPACT_RAIL_X+.09,v/65,String(v),'ink','start');}
    text(IMPACT_RAIL_X+.07,-1.40,'b 调节轨','ink','start');
    const dist=Math.hypot(s.sample.x,s.sample.y),force=NUCLEAR_SCALE.forceUnit*r.kappaDimless/(dist*dist);
    text(1.60,1.43,'独立数值与解析核验');
    text(1.60,1.20,'K = '+fmt(p.alphaEnergyMev,2)+' MeV · Z = '+p.targetZ);
    text(1.60,.98,'b = '+fmt(b,1)+' fm');
    text(1.60,.75,'解析 θ = '+fmt(r.analyticalAngleDeg)+'°','energy');
    text(1.60,.54,'远区数值 θ = '+fmt(r.simulatedAngleDeg)+'°','path');
    text(1.60,.31,'解析 rₘᵢₙ = '+fmt(r.minDistanceFm,4)+' fm');
    text(1.60,.10,'数值最近点 = '+fmt(r.numericalClosestFm,4)+' fm');
    text(1.60,-.13,'核尺度经过 '+fmt(s.sample.time22,3)+' ×10⁻²² s');
    text(1.60,-.34,'当前 r = '+fmt(dist,3)+' fm');
    text(1.60,-.56,'库仑力 '+force.toExponential(3)+' N','force');
    text(1.60,-.79,'相对能量漂移 '+r.energyDriftRel.toExponential(2));
    text(1.60,-1.02,'演示 '+fmt(s.t,2)+' / '+RUTHERFORD_DEMO_DURATION_S+' s');
    text(1.60,-1.28,'不含核反冲、核力或量子效应');
    return {marks};
  }
  const b=s.bohr,n=Math.max(2,Math.min(8,Math.round(p.excitedLevelN)));
  const lx=-2.22,rx=-.51,y0=-1.15,y1=1.12,Y=(e:number)=>y0+(e+13.6)/13.6*(y1-y0);
  text(-1.30,1.48,'氢原子能级 · Eₙ = −13.6/n² eV');
  text(-1.30,1.29,'竖直位置按能量线性标尺');
  line(lx-.13,y0,lx-.13,y1);text(lx-.13,y1+.05,'E/eV','ink','end');
  for(const e of [-13.6,-10,-5,0]){line(lx-.17,Y(e),lx-.13,Y(e));text(lx-.19,Y(e),String(e),'ink','end');}
  line(lx,y1,rx,y1,'grid',true);text(rx+.04,y1,'连续态 E=0','ink','start');
  for(let level=1;level<=n;level++){
    const e=bohrEnergyEv(level),y=Y(e);
    line(lx,y,rx,y,'energy');
    // Leader lines preserve exact levels while labels use an explicit
    // non-overlapping column instead of distorting high-n energy spacing.
    const labelY=level===1?y0:-.56+(level-2)*1.48/Math.max(1,n-2);
    line(rx,y,rx+.12,labelY,'grid');
    text(rx+.14,labelY,'n='+level+'  '+fmt(e,3),'ink','start');
  }
  const visible=(q:{wavelengthNm:number})=>q.wavelengthNm>=380&&q.wavelengthNm<=780;
  const toneFor=(q:{wavelengthNm:number}):Tone=>visible(q)?'visible':q.wavelengthNm<380?'uv':'ir';
  const count=b.spectralLines.length;
  b.spectralLines.forEach((q,i)=>{
    const x=lx+.08+(rx-lx-.16)*(i+.5)/Math.max(1,count),tone=toneFor(q);
    arrow(x,Y(bohrEnergyEv(q.upperN)),x,Y(bohrEnergyEv(q.lowerN)),tone,q.hex);
  });
  text(-1.38,-1.37,p.populationMode==='ensemble'?'群体：全部允许的 n 对（不表示强度）':'单原子：一种逐级级联示例');
  const sx=.43,sw=1.72,sy=.78,sh=.24;
  text(1.29,1.47,'实际选中谱线 '+count+' 条');
  text(1.29,1.27,'群体上限 '+b.totalCombinationLines+'；单原子最多 '+b.maxSingleAtomLines);
  const minW=80,maxW=Math.max(20000,...b.spectralLines.map(l=>l.wavelengthNm))*1.01;
  const X=(w:number)=>sx+sw*Math.log(w/minW)/Math.log(maxW/minW);
  line(sx,sy,sx+sw,sy);
  for(const w of [100,400,1000,10000])if(w<=maxW){line(X(w),sy,X(w),sy-.035);text(X(w),sy-.10,String(w));}
  for(const q of b.spectralLines)line(X(q.wavelengthNm),sy,X(q.wavelengthNm),sy+sh,toneFor(q),false,q.hex);
  text(1.29,.58,'波长 λ / nm（对数轴）');
  const vy=.22,vh=.21,V=(w:number)=>sx+sw*(w-380)/400;
  line(sx,vy,sx+sw,vy);
  for(const w of [380,500,600,780]){line(V(w),vy,V(w),vy-.03);text(V(w),vy-.095,String(w));}
  for(const q of b.spectralLines.filter(visible))line(V(q.wavelengthNm),vy,V(q.wavelengthNm),vy+vh,'visible',false,q.hex);
  text(1.29,.46,'可见光谱线（线性 nm 轴）');
  text(1.29,-.04,'UV / IR 用示意颜色，不代表可见色');
  text(1.29,-.30,'独立基态探针：'+(p.probeKind==='photon'?'光子':'电子')+' '+fmt(p.probeEnergyEv,2)+' eV');
  text(1.29,-.52,b.ionized?'电离 · 无离散终态':b.excitationAccepted?'激发至 n='+b.reachedLevel:'未激发，仍为基态',b.excitationAccepted?'path':'alert');
  const ledger=b.ionized?(p.probeKind==='photon'?'光电子动能 '+fmt(b.residualElectronEv??0,3)+' eV':'两电子总余能 '+fmt(b.ionizationExcessEv??0,3)+' eV（分配未定）'):
    b.residualElectronEv!==undefined?'入射电子剩余动能 '+fmt(b.residualElectronEv,3)+' eV':b.transmittedPhotonEv!==undefined?'光子未吸收 '+fmt(b.transmittedPhotonEv,3)+' eV':'吸收能级差 '+fmt(b.absorbedEnergyEv??0,4)+' eV';
  text(1.29,-.75,ledger);
  text(1.29,-.95,p.probeKind==='photon'?'输入共振容差 ±'+PHOTON_INPUT_TOLERANCE_EV.toFixed(3)+' eV（非线宽）':'允许的最高已建模能级，仅示例');
  line(PROBE_RAIL.x,PROBE_RAIL.y,PROBE_RAIL.x+PROBE_RAIL.w,PROBE_RAIL.y,'grid');
  text(PROBE_RAIL.x,PROBE_RAIL.y-.13,'5');text(PROBE_RAIL.x+PROBE_RAIL.w,PROBE_RAIL.y-.13,'15 eV');
  text(1.29,-1.45,'探针与左侧发光初始 n 独立');
  return {marks};
}
