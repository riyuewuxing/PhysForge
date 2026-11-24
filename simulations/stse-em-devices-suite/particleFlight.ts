import { bisectEvent, createScaleContext } from '@physforge/physics-core';
import type { PhysicsEvent } from '@physforge/sim-sdk';
import type { EmDevicesParams } from './engine.js';

// Fixed spatial scale for both beam devices; display time is slowed separately.
export const BEAM_LENGTH_M=0.02, ENTRY_X=-1.5, RIGHT_X=1.5;
export const SELECTOR_HALF_GAP=0.5625/0.7, SELECTOR_SLIT_HALF=0.10/0.7;
export const SPECTROMETER_DEPTH=1.6, SPECTROMETER_SLIT_HALF=0.14;
type Point={x:number;y:number};
export type FlightStatus='flying'|'transmitted'|'blocked'|'detected'|'missed';
export interface ParticleFlight{
  readonly physicalTimeS:number;
  readonly timeUnitS:number;
  readonly status:FlightStatus;
  readonly region:'selector'|'entry'|'analyzer';
  readonly position:Point;
  readonly velocityMps:Point;
}
export function isBeamDevice(p:EmDevicesParams):boolean{
  return p.device==='velocity-selector'||p.device==='mass-spectrometer';
}
function coeff(p:EmDevicesParams){
  const q=Math.abs(p.chargeC),m=Math.max(1e-30,p.massKg),v=Math.max(1e-9,p.particleSpeedMps);
  const B=Math.max(0,p.device==='mass-spectrometer'?p.bDeflectT:p.bFieldT);
  return {q,m,v,B,omega:q*B/m};
}
export function beamScale(p:EmDevicesParams){
  const {q,m,v,omega}=coeff(p),a=q*Math.abs(p.eFieldVPerM)/m;
  const timeUnit=p.device==='mass-spectrometer'?2*BEAM_LENGTH_M/v:
    Math.min(3*BEAM_LENGTH_M/v,omega>0?8/omega:Infinity,a>0?Math.sqrt(4*BEAM_LENGTH_M/a):Infinity);
  return createScaleContext({lengthUnit:BEAM_LENGTH_M,timeUnit,massUnit:m,chargeUnit:q||1.602176634e-19});
}
// Stable constant-field solution kernels, including the zero-field limit.
const sinc=(x:number)=>Math.abs(x)<1e-4?1-x*x/6:Math.sin(x)/x;
const cosc=(x:number)=>Math.abs(x)<1e-4?x/2-x*x*x/24:2*Math.sin(x/2)**2/x;
const cosc2=(x:number)=>Math.abs(x)<1e-4?0.5-x*x/24:2*(Math.sin(x/2)/x)**2;
const sincc2=(x:number)=>Math.abs(x)<1e-4?x/6-x*x*x/120:(x-Math.sin(x))/(x*x);

export function sampleBeamFlight(p:EmDevicesParams,t:number,timeUnitS=beamScale(p).timeUnit):ParticleFlight{
  const {q,m,v,B,omega}=coeff(p);
  if(p.device==='velocity-selector'){
    // E=+Ey, B=+Bz, initial v=+vx; dvx/dt=omega*vy, dvy/dt=qE/m-omega*vx.
    const a=q*(p.eFieldVPerM-v*B)/m,theta=omega*t;
    return {physicalTimeS:t,timeUnitS,status:'flying',region:'selector',
      position:{x:ENTRY_X+(v*t+a*t*t*sincc2(theta))/BEAM_LENGTH_M,y:a*t*t*cosc2(theta)/BEAM_LENGTH_M},
      velocityMps:{x:v+a*t*cosc(theta),y:a*t*sinc(theta)}};
  }
  const entryTime=-ENTRY_X*BEAM_LENGTH_M/v;
  if(t<entryTime)return {physicalTimeS:t,timeUnitS,status:'flying',region:'entry',
    position:{x:ENTRY_X+v*t/BEAM_LENGTH_M,y:0},velocityMps:{x:v,y:0}};
  const u=t-entryTime,theta=omega*u;
  return {physicalTimeS:t,timeUnitS,status:'flying',region:'analyzer',
    position:{x:v*u*sinc(theta)/BEAM_LENGTH_M,y:-v*u*cosc(theta)/BEAM_LENGTH_M},
    velocityMps:{x:v*Math.cos(theta),y:-v*Math.sin(theta)}};
}
function massEnd(p:EmDevicesParams):{time:number;status:FlightStatus}{
  const {v,omega}=coeff(p),entry=-ENTRY_X*BEAM_LENGTH_M/v;
  if(omega===0)return {time:entry+RIGHT_X*BEAM_LENGTH_M/v,status:'missed'};
  const radius=v/(omega*BEAM_LENGTH_M);
  const side=radius>=RIGHT_X?Math.asin(RIGHT_X/radius):Infinity;
  const bottom=2*radius>=SPECTROMETER_DEPTH?Math.acos(Math.max(-1,1-SPECTROMETER_DEPTH/radius)):Infinity;
  const angle=Math.min(Math.PI,side,bottom);
  return {time:entry+angle/omega,status:angle===Math.PI&&2*radius>=SPECTROMETER_SLIT_HALF?'detected':'missed'};
}
type Boundary={g:(s:ParticleFlight)=>number;status:(s:ParticleFlight)=>FlightStatus};
const boundaries:readonly Boundary[]=[
  {g:s=>s.position.x-RIGHT_X,status:s=>Math.abs(s.position.y)<=SELECTOR_SLIT_HALF?'transmitted':'blocked'},
  {g:s=>ENTRY_X-s.position.x,status:()=> 'blocked'},
  {g:s=>s.position.y-SELECTOR_HALF_GAP,status:()=> 'blocked'},
  {g:s=>-s.position.y-SELECTOR_HALF_GAP,status:()=> 'blocked'}
];
export function advanceBeamFlight(p:EmDevicesParams,previous:ParticleFlight,dt:number,displayTime:number):{flight:ParticleFlight;events:PhysicsEvent[]}{
  if(previous.status!=='flying'||dt===0)return {flight:previous,events:[]};
  const unit=previous.timeUnitS,end=previous.physicalTimeS+dt*unit;
  let flight=sampleBeamFlight(p,end,unit);
  if(p.device==='mass-spectrometer'){
    const terminal=massEnd(p);
    if(end>=terminal.time)flight={...sampleBeamFlight(p,terminal.time,unit),status:terminal.status};
  }else{
    // Bound phase increments and split at analytic velocity zeros. Each
    // coordinate is monotone between adjacent critical points.
    const {q,m,v,B,omega}=coeff(p),a=q*(p.eFieldVPerM-v*B)/m;
    let t=previous.physicalTimeS;
    const limit=Math.min(0.02*unit,omega>0?0.05/omega:Infinity);
    while(t<end){
      let next=Math.min(end,t+limit);
      if(omega>0){
        const phase=omega*t,roots=[0,Math.PI];
        if(a!==0){
          const cos=1+v*omega/a;
          if(cos>=-1&&cos<=1){const alpha=Math.acos(cos);roots.push(alpha,2*Math.PI-alpha);}
        }
        for(const root of roots){
          const n=Math.floor((phase-root)/(2*Math.PI))+1,critical=(root+n*2*Math.PI)/omega;
          if(critical>t+unit*1e-12&&critical<next)next=critical;
        }
      }
      const first=sampleBeamFlight(p,t,unit),last=sampleBeamFlight(p,next,unit);
      let earliest:{sample:ParticleFlight;boundary:Boundary}|null=null;
      for(const boundary of boundaries){
        const g0=boundary.g(first),g1=boundary.g(last);
        if(g1< -1e-12 || (g0>=0&&g1<=g0))continue;
        const hit=g0<0&&g1>=0?bisectEvent(first,t,next-t,(_s,h)=>sampleBeamFlight(p,t+h,unit),boundary.g,
          {timeTolerance:unit*1e-10,biasEndpoint:'positive'}):null;
        const sample=hit?.state??last;
        if(!earliest||sample.physicalTimeS<earliest.sample.physicalTimeS)earliest={sample,boundary};
      }
      if(earliest){flight={...earliest.sample,status:earliest.boundary.status(earliest.sample)};break;}
      t=next;
    }
  }
  if(flight.status==='flying')return {flight,events:[]};
  return {flight,events:[{id:'beam-'+flight.status,time:displayTime+(flight.physicalTimeS-previous.physicalTimeS)/unit,
    label:flightStatusLabel(flight.status),position:{x:-0.25+0.7*flight.position.x,y:0.7*flight.position.y},
    metrics:{physicalTimeS:flight.physicalTimeS,xM:flight.position.x*BEAM_LENGTH_M,yM:flight.position.y*BEAM_LENGTH_M}}]};
}
export function beamDisplayVelocity(f:ParticleFlight):Point{
  if(f.status!=='flying')return {x:0,y:0};
  const s=f.timeUnitS/BEAM_LENGTH_M;
  return {x:f.velocityMps.x*s,y:f.velocityMps.y*s};
}
export function beamTrail(p:EmDevicesParams,f:ParticleFlight):Point[]{
  const t=f.physicalTimeS;
  if(t===0)return [f.position];
  const {v,omega}=coeff(p),entry=-ENTRY_X*BEAM_LENGTH_M/v;
  const at=(s:number)=>sampleBeamFlight(p,s,f.timeUnitS).position;
  if(p.device==='mass-spectrometer'&&t>entry){
    // Preserve both the entrance and the real circular arc, even if the
    // latter is completed between two rendered frames.
    return [...Array.from({length:40},(_,i)=>at(entry*i/40)),...Array.from({length:81},(_,i)=>at(entry+(t-entry)*i/80))];
  }
  const start=p.device==='velocity-selector'&&Math.abs(p.eFieldVPerM-v*p.bFieldT)>1e-9&&omega>0?Math.max(0,t-12*Math.PI/omega):0;
  return Array.from({length:121},(_,i)=>at(start+(t-start)*i/120));
}
export function flightStatusLabel(s:FlightStatus):string{
  return ({flying:'飞行中',transmitted:'通过出射狭缝',blocked:'被极板或狭缝阻挡',detected:'到达探测板',missed:'未到达有效探测面'})[s];
}
export function flightReadout(f:ParticleFlight):string{
  return `真实洛伦兹轨迹 · ${flightStatusLabel(f.status)} · t=${(f.physicalTimeS*1e6).toFixed(3)} μs · 1坐标单位=2 cm`;
}
