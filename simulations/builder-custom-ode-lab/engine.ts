import { stepRK4, stepVelocityVerlet, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';
import { compileSafeFormula, type CompiledSafeFormula } from './safeAstCompiler.js';

export type OdeTemplateMode='harmonic-custom'|'lagrangian-pendulum'|'kepler-2d'|'custom-expr';
export type CustomOdeParams={template:OdeTemplateMode;exprText:string;mass:number;stiffness:number;damping:number;driveAmp:number;driveOmega:number;initialPos:number;initialVel:number};
export interface CustomOdeState {
  readonly t:number;
  readonly x:number;readonly y:number;readonly vx:number;readonly vy:number;
  readonly initialEnergy:number;readonly initialAngularMom:number;
  readonly formulaError:string|null;
  readonly terminal?:boolean;
  readonly trail:readonly Vec2[];
  readonly events:readonly PhysicsEvent[];
}
const formulaCache=new Map<string,CompiledSafeFormula>();
function getCompiledFormula(exprText:string):CompiledSafeFormula {
  const key=exprText.trim(),hit=formulaCache.get(key);
  if(hit)return hit;
  const result=compileSafeFormula(key);
  if(formulaCache.size>=64)formulaCache.delete(formulaCache.keys().next().value!);
  formulaCache.set(key,result);return result;
}
export const KEPLER_CORE_RADIUS=.2;
export const pendulumLength=(p:CustomOdeParams)=>Math.max(.3,p.stiffness*.1);
const mass=(p:CustomOdeParams)=>Math.max(.1,p.mass);
const mu=(p:CustomOdeParams)=>Math.max(.5,p.stiffness);
/** Exterior point-mass field; interior uniform sphere, continuous force and potential. */
export function keplerAcceleration(x:number,y:number,p:CustomOdeParams):Vec2 {
  const r=Math.max(KEPLER_CORE_RADIUS,Math.hypot(x,y)),factor=-mu(p)/r**3;
  return {x:factor*x,y:factor*y};
}
export function keplerPotential(r:number,p:CustomOdeParams):number {
  const R=KEPLER_CORE_RADIUS,u=mu(p);
  return mass(p)*(r>=R?-u/r:-u/R+u*(r*r-R*R)/(2*R**3));
}
function energyOf(s:Pick<CustomOdeState,'x'|'y'|'vx'|'vy'>,p:CustomOdeParams):number {
  const m=mass(p),L=pendulumLength(p);
  if(p.template==='kepler-2d')return .5*m*(s.vx**2+s.vy**2)+keplerPotential(Math.hypot(s.x,s.y),p);
  if(p.template==='lagrangian-pendulum')return .5*m*L*L*s.vx**2+m*9.8*L*(1-Math.cos(s.x));
  if(p.template==='harmonic-custom')return .5*m*s.vx**2+.5*p.stiffness*s.x**2;
  return .5*m*s.vx**2;
}
function angularMomentum(s:Pick<CustomOdeState,'x'|'y'|'vx'|'vy'>,p:CustomOdeParams):number{return mass(p)*(s.x*s.vy-s.y*s.vx);}
function scalarAcceleration(p:CustomOdeParams):(x:number,v:number,t:number)=>number {
  if(p.template==='lagrangian-pendulum')return (x,v,t)=>-(9.8/pendulumLength(p))*Math.sin(x)-p.damping*v+p.driveAmp*Math.cos(p.driveOmega*t);
  if(p.template==='custom-expr'){
    const f=getCompiledFormula(p.exprText);
    return (x,v,t)=>f.evaluate({x,v,vx:v,theta:x,omega:v,t,k:p.stiffness,m:mass(p),g:9.8,A:p.driveAmp,w:p.driveOmega,gamma:p.damping,mu:p.stiffness});
  }
  return (x,v,t)=>(-p.stiffness*x-p.damping*v+p.driveAmp*Math.cos(p.driveOmega*t))/mass(p);
}
export function createInitialState(p:CustomOdeParams):CustomOdeState {
  const orbit=p.template==='kepler-2d';
  const x=orbit?Math.max(.4,Math.abs(p.initialPos)):p.initialPos;
  const y=orbit?0:p.initialVel,vx=orbit?0:p.initialVel,vy=orbit?p.initialVel:0;
  let formulaError:string|null=null;
  if(p.template==='custom-expr')try{scalarAcceleration(p)(x,vx,0);}catch(e){formulaError=e instanceof Error?e.message:String(e);}
  const s={x,y,vx,vy};
  return {...s,t:0,initialEnergy:energyOf(s,p),initialAngularMom:orbit?angularMomentum(s,p):0,formulaError,trail:[{x,y}],events:[]};
}
function failure(s:CustomOdeState,message:string):StepResult<CustomOdeState> {
  const event:PhysicsEvent={id:'ode-domain-error',time:s.t,label:'方程未定义或积分失败：'+message};
  return {nextState:{...s,formulaError:message,terminal:true,events:[...s.events,event]},events:[event],advancedTime:0,halt:true};
}
export function stepCustomOde(s:CustomOdeState,p:CustomOdeParams,dt:number):StepResult<CustomOdeState> {
  if(!Number.isFinite(dt)||dt<0)throw new Error('Time step must be non-negative finite.');
  if(s.terminal)return {nextState:s,events:[],advancedTime:0,halt:true};
  if(dt===0)return {nextState:s,events:[]};
  if(s.formulaError)return failure(s,s.formulaError);
  try{
    let x=s.x,y=s.y,vx=s.vx,vy=s.vy;
    const maxStep=p.template==='kepler-2d'?Math.min(1/240,.05*Math.sqrt(KEPLER_CORE_RADIUS**3/mu(p))):1/240;
    const n=Math.ceil(dt/maxStep);
    if(n>4096)throw new Error('Requested time step exceeds the integration work limit.');
    const h=dt/n;
    if(p.template==='kepler-2d'){
      for(let i=0;i<n;i++){
        const q=stepVelocityVerlet({positions:[x,y],velocities:[vx,vy],t:s.t+i*h},h,positions=>{
          const a=keplerAcceleration(positions[0]!,positions[1]!,p);return [a.x,a.y];
        });
        x=q.positions[0]!;y=q.positions[1]!;vx=q.velocities[0]!;vy=q.velocities[1]!;
      }
    }else{
      const accel=scalarAcceleration(p);
      for(let i=0;i<n;i++){
        const q=stepRK4([x,vx],s.t+i*h,h,(t,z)=>{
          const a=accel(z[0]!,z[1]!,t);
          if(![z[0],z[1],a].every(Number.isFinite))throw new Error('Non-finite RK4 stage.');
          return [z[1]!,a];
        });
        x=q[0]!;vx=q[1]!;
      }
      y=vx;
    }
    if(![x,y,vx,vy,s.t+dt,energyOf({x,y,vx,vy},p)].every(Number.isFinite))throw new Error('Non-finite integrated state.');
    const next={x,y};
    return {nextState:{...s,x,y,vx,vy,t:s.t+dt,trail:[...s.trail.slice(-899),next]},events:[]};
  }catch(e){return failure(s,e instanceof Error?e.message:String(e));}
}
export function computeObservables(s:CustomOdeState,p:CustomOdeParams):Record<string,number> {
  const common={solverValid:s.formulaError?0:1};
  if(p.template==='kepler-2d')return {...common,x:s.x,y:s.y,vx:s.vx,vy:s.vy,speed:Math.hypot(s.vx,s.vy),energy:energyOf(s,p),angularMomentum:angularMomentum(s,p),insideCore:Math.hypot(s.x,s.y)<KEPLER_CORE_RADIUS?1:0};
  if(p.template==='lagrangian-pendulum')return {...common,theta:s.x,omega:s.vx,energy:energyOf(s,p)};
  const kineticEnergy=.5*mass(p)*s.vx*s.vx;
  return {...common,x:s.x,v:s.vx,kineticEnergy,...(p.template==='harmonic-custom'?{energy:energyOf(s,p)}:{})};
}
export function checkInvariants(s:CustomOdeState,_init:CustomOdeState,p:CustomOdeParams):InvariantReport[]{
  if(s.formulaError)return [{name:'方程定义域与求解状态',measuredError:1,tolerance:0,passed:false}];
  if(p.template==='kepler-2d'){
    const eErr=Math.abs(energyOf(s,p)-s.initialEnergy)/Math.max(Math.abs(s.initialEnergy),1e-9);
    const lErr=Math.abs(angularMomentum(s,p)-s.initialAngularMom)/Math.max(Math.abs(s.initialAngularMom),1e-9);
    return [{name:'轨道机械能守恒 (ΔE/|E₀|)',measuredError:eErr,tolerance:1e-4,passed:eErr<1e-4},{name:'角动量守恒 (ΔL/|L₀|)',measuredError:lErr,tolerance:1e-6,passed:lErr<1e-6}];
  }
  if((p.template==='harmonic-custom'||p.template==='lagrangian-pendulum')&&p.damping===0&&p.driveAmp===0){
    const err=Math.abs(energyOf(s,p)-s.initialEnergy)/Math.max(Math.abs(s.initialEnergy),1e-9);
    return [{name:'无驱动无阻尼机械能守恒',measuredError:err,tolerance:1e-5,passed:err<1e-5}];
  }
  return [];
}
