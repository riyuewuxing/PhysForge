import { bisectEvent, createScaleContext } from '@physforge/physics-core';
import type { PhysicsEvent } from '@physforge/sim-sdk';
import type { EmDevicesParams } from './engine.js';

export const C_LIGHT=299792458, CYCL_DISPLAY_RADIUS=0.85, CYCL_GAP_HALF=0.04;
const MAX_GAPS=50000, TAIL_POINTS=121;
type Point={x:number;y:number};
export type CyclotronStatus='running'|'wall'|'detuned'|'limit'|'inactive';
export interface CyclotronArc{
  readonly startTau:number; readonly endTau:number;
  readonly y0:number; readonly direction:1|-1; readonly radius:number;
  readonly energyJ:number; readonly gamma:number; readonly speedMps:number;
  readonly phaseSlip:number; readonly workJ:number; readonly totalWorkJ:number;
  readonly gapCount:number; readonly endAngle:number;
}
export interface CyclotronPlan{
  readonly arcs:readonly CyclotronArc[];
  readonly analyticalMaxJ:number;
  readonly status:Exclude<CyclotronStatus,'running'>;
  readonly timeUnitS:number; readonly physicalUnitS:number; readonly radiusM:number;
  readonly endTau:number; readonly completedHalfTurns:number;
}
export interface CyclotronFlight{
  readonly status:CyclotronStatus;
  readonly physicalTimeS:number; readonly timeUnitS:number;
  readonly position:Point; readonly velocityMps:Point;
  readonly energyJ:number; readonly radiusM:number; readonly phaseSlip:number;
  readonly gapCount:number; readonly totalWorkJ:number;
  readonly rfVoltageV:number; readonly arcIndex:number;
}
function arcPoint(a:CyclotronArc,theta:number):Point{
  return {x:a.direction*a.radius*Math.sin(theta),y:a.y0-a.direction*a.radius*2*Math.sin(theta/2)**2};
}
function project(p:Point):Point{
  return {x:p.x*CYCL_DISPLAY_RADIUS/0.7,y:p.y*CYCL_DISPLAY_RADIUS/0.7};
}
let cached:{key:string;plan:CyclotronPlan}|null=null;
export function getCyclotronPlan(p:EmDevicesParams):CyclotronPlan{
  const key=JSON.stringify([p.chargeC,p.massKg,p.bFieldT,p.cyclotronRadiusM,p.cyclotronVoltageV,p.relativisticDetune]);
  if(cached?.key===key)return cached.plan;
  const q=Math.abs(p.chargeC),m=p.massKg,B=p.bFieldT,R=p.cyclotronRadiusM,U=p.cyclotronVoltageV;
  const analyticalMaxJ=m>0?q*q*B*B*R*R/(2*m):0;
  if(![q,m,B,R,U].every(v=>Number.isFinite(v)&&v>0)){
    const plan:CyclotronPlan={arcs:[],analyticalMaxJ:Number.isFinite(analyticalMaxJ)?analyticalMaxJ:0,status:'inactive',timeUnitS:1,physicalUnitS:1,radiusM:Math.max(0,R)||0,endTau:0,completedHalfTurns:0};
    cached={key,plan};return plan;
  }
  const scale=createScaleContext({lengthUnit:R,timeUnit:m/(q*B),massUnit:m,chargeUnit:q});
  const mc2=m*C_LIGHT*C_LIGHT, arcs:CyclotronArc[]=[];
  let energy=0,tau=0,y=0,completedHalfTurns=0,totalWork=0;
  let status:CyclotronPlan['status']='limit';
  for(let i=0;i<MAX_GAPS;i++){
    const direction:1|-1=i%2===0?1:-1;
    const phaseSlip=tau-i*Math.PI;
    if(p.relativisticDetune&&phaseSlip>=Math.PI/2){status='detuned';break;}
    const gain=q*U*direction*Math.cos(tau);
    if(gain<=0){status='detuned';break;}
    energy+=gain;
    const gamma=p.relativisticDetune?1+energy/mc2:1;
    const momentum=p.relativisticDetune?Math.sqrt(energy*(energy+2*mc2))/C_LIGHT:Math.sqrt(2*m*energy);
    const radius=scale.toDimless(momentum/(q*B),'length');
    const speedMps=momentum/(gamma*m);
    // Independently sum RF work from the phase relative to the alternating crossing.
    totalWork+=q*U*Math.cos(phaseSlip);
    let arc:CyclotronArc={startTau:tau,endTau:tau+Math.PI*gamma,y0:y,direction,radius,energyJ:energy,gamma,speedMps,phaseSlip,workJ:gain,totalWorkJ:totalWork,gapCount:i+1,endAngle:Math.PI};
    const end=arcPoint(arc,Math.PI);
    // |position|² is affine in 1-cosθ, so the first outward wall hit is bracketed.
    if(Math.hypot(end.x,end.y)>=1){
      const hit=bisectEvent(arcPoint(arc,0),0,Math.PI,(_s,a)=>arcPoint(arc,a),v=>Math.hypot(v.x,v.y)-1,
        {timeTolerance:1e-12,biasEndpoint:'positive',triggerOnStartZero:true});
      if(!hit)throw new Error('Cyclotron wall bracket lost');
      arc={...arc,endAngle:hit.timeOffset,endTau:tau+hit.timeOffset*gamma};
      arcs.push(arc);tau=arc.endTau;status='wall';break;
    }
    arcs.push(arc);completedHalfTurns++;
    tau=p.relativisticDetune?arc.endTau:(i+1)*Math.PI;y=end.y;
  }
  const plan:CyclotronPlan={arcs,analyticalMaxJ,status,timeUnitS:Math.max(Math.PI*scale.timeUnit*1.5,tau*scale.timeUnit/8),
    physicalUnitS:scale.timeUnit,radiusM:R,endTau:tau,completedHalfTurns};
  cached={key,plan};return plan;
}
function arcIndexAt(plan:CyclotronPlan,timeS:number):number{
  let lo=0,hi=plan.arcs.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(plan.arcs[mid]!.startTau*plan.physicalUnitS<=timeS)lo=mid;else hi=mid-1;}
  return lo;
}
export function sampleCyclotron(p:EmDevicesParams,physicalTimeS:number):CyclotronFlight{
  const plan=getCyclotronPlan(p);
  const tau=Math.min(plan.endTau,Math.max(0,physicalTimeS/plan.physicalUnitS));
  const terminal=physicalTimeS>=plan.endTau*plan.physicalUnitS;
  const index=arcIndexAt(plan,Math.min(physicalTimeS,plan.endTau*plan.physicalUnitS)),a=plan.arcs[index];
  if(!a)return {status:'inactive',physicalTimeS:0,timeUnitS:plan.timeUnitS,position:{x:0,y:0},velocityMps:{x:0,y:0},
    energyJ:0,radiusM:0,phaseSlip:0,gapCount:0,totalWorkJ:0,rfVoltageV:0,arcIndex:0};
  const angle=Math.min(a.endAngle,Math.max(0,(Math.min(physicalTimeS,plan.endTau*plan.physicalUnitS)-a.startTau*plan.physicalUnitS)/(plan.physicalUnitS*a.gamma)));
  const terminalSlip=plan.status==='detuned'&&terminal?tau-plan.arcs.length*Math.PI:a.phaseSlip;
  return {status:terminal?plan.status:'running',physicalTimeS:tau*plan.physicalUnitS,timeUnitS:plan.timeUnitS,
    position:project(arcPoint(a,angle)),velocityMps:{x:a.direction*a.speedMps*Math.cos(angle),y:-a.direction*a.speedMps*Math.sin(angle)},
    energyJ:a.energyJ,radiusM:a.radius*plan.radiusM,phaseSlip:terminalSlip,gapCount:a.gapCount,totalWorkJ:a.totalWorkJ,
    rfVoltageV:p.cyclotronVoltageV*Math.cos(tau),arcIndex:index};
}
export function cyclotronDisplayVelocity(p:EmDevicesParams,f:CyclotronFlight):Point{
  if(f.status!=='running')return {x:0,y:0};
  const s=CYCL_DISPLAY_RADIUS/0.7*f.timeUnitS/p.cyclotronRadiusM;
  return {x:f.velocityMps.x*s,y:f.velocityMps.y*s};
}
export function cyclotronTrail(p:EmDevicesParams,f:CyclotronFlight):Point[]{
  const plan=getCyclotronPlan(p);
  if(plan.arcs.length===0||f.physicalTimeS===0)return [f.position];
  const points:Point[]=[];
  const start=Math.max(0,f.arcIndex-7);
  for(let i=start;i<=f.arcIndex;i++){
    const a=plan.arcs[i]!,end=i===f.arcIndex?Math.min(a.endAngle,Math.max(0,(f.physicalTimeS/plan.physicalUnitS-a.startTau)/a.gamma)):a.endAngle;
    const samples=Math.max(1,Math.ceil(14*end/Math.PI));
    for(let j=i===start?0:1;j<=samples;j++)points.push(project(arcPoint(a,end*j/samples)));
  }
  points[points.length-1]=f.position;
  return points.slice(-TAIL_POINTS);
}
export function advanceCyclotron(p:EmDevicesParams,prev:CyclotronFlight,dt:number,displayTime:number):{flight:CyclotronFlight;events:PhysicsEvent[]}{
  if(prev.status!=='running'||dt===0)return {flight:prev,events:[]};
  const flight=sampleCyclotron(p,prev.physicalTimeS+dt*prev.timeUnitS);
  // The shell retains every event; only the terminal event is published.
  // Every crossing remains in the plan records and actual live gap count.
  if(flight.status==='running')return {flight,events:[]};
  return {flight,events:[{id:'cyclotron-'+flight.status,time:displayTime+(flight.physicalTimeS-prev.physicalTimeS)/prev.timeUnitS,
    label:cyclotronStatusLabel(flight.status),position:{x:-0.25+0.7*flight.position.x,y:0.7*flight.position.y},
    metrics:{physicalTimeS:flight.physicalTimeS,energyJ:flight.energyJ,gapCount:flight.gapCount,radiusM:flight.radiusM,phaseSlip:flight.phaseSlip}}]};
}
export function cyclotronStatusLabel(s:CyclotronStatus):string{
  return ({running:'盒内回旋',wall:'到达装置外缘',detuned:'失去加速同步',limit:'达到计算上限',inactive:'未启动'})[s];
}
export function cyclotronReadout(p:EmDevicesParams,f:CyclotronFlight):string{
  const warning=!p.relativisticDetune&&Math.hypot(f.velocityMps.x,f.velocityMps.y)>0.1*C_LIGHT?' · 经典近似受限':'';
  return `${cyclotronStatusLabel(f.status)} · ${f.gapCount} 次过缝 · t=${(f.physicalTimeS*1e6).toFixed(3)} μs · R=${p.cyclotronRadiusM.toFixed(2)} m（慢放）${warning}`;
}
