import { bisectEvent, CLASSROOM_GRAVITY as g, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ConveyorSystemMode='conveyor'|'plank';
export type BlockConveyorParams={
  systemMode:ConveyorSystemMode;
  massBlock:number;massPlank:number;muBlockCarrier:number;muGround:number;
  inclineDeg:number;beltVelocity:number;blockInitialV:number;plankInitialV:number;externalForcePlank:number;
  /** 0 or omitted: ideal unlimited support; positive: full length centered at s=0. */
  carrierLengthM?:number;
};
export interface BlockConveyorState{
  readonly t:number;readonly xBlock:number;readonly vBlock:number;readonly xCarrier:number;readonly vCarrier:number;
  readonly relativeScratch:number;readonly scratchMinM:number;readonly scratchMaxM:number;
  readonly frictionHeat:number;readonly groundHeat:number;readonly carrierWork:number;
  readonly coMovingLocked:boolean;readonly plankStopped:boolean;
  readonly frictionOnBlockN:number;readonly groundFrictionN:number;
  readonly accelerationBlock:number;readonly accelerationCarrier:number;
  readonly terminal?:'left-edge'|'right-edge';
  readonly events:readonly PhysicsEvent[];
}
interface ContactPhase{
  readonly locked:boolean;readonly stopped:boolean;
  readonly f1:number;readonly fg:number;readonly a1:number;readonly a2:number;
}
const m1=(p:BlockConveyorParams)=>Math.max(1e-6,p.massBlock);
const m2=(p:BlockConveyorParams)=>Math.max(1e-6,p.massPlank);
const edgeHalf=(p:BlockConveyorParams)=>typeof p.carrierLengthM==='number'&&Number.isFinite(p.carrierLengthM)&&p.carrierLengthM>0?p.carrierLengthM/2:Infinity;
const EPS=1e-12;
const ground=(v:number,drive:number,limit:number)=>v!==0?-Math.sign(v)*limit:-Math.max(-limit,Math.min(limit,drive));

/** Solve the actual Coulomb contact state at the beginning of a constant-force
 * segment. The teaching model explicitly uses mu_s=mu_k at each interface. */
export function solveContactPhase(s:Pick<BlockConveyorState,'vBlock'|'vCarrier'>,p:BlockConveyorParams):ContactPhase{
  const M=m1(p),N=m2(p),rel=s.vBlock-s.vCarrier;
  const mu=Math.max(0,p.muBlockCarrier);
  if(p.systemMode==='conveyor'){
    const theta=degToRad(p.inclineDeg),weightAlong=M*g*Math.sin(theta),limit=mu*M*g*Math.cos(theta);
    const locked=Math.abs(rel)<=EPS&&Math.abs(weightAlong)<=limit+EPS;
    const f1=locked?weightAlong:Math.abs(rel)<=EPS?Math.sign(weightAlong)*limit:-Math.sign(rel)*limit;
    return {locked,stopped:false,f1,fg:0,a1:locked?0:(f1-weightAlong)/M,a2:0};
  }
  const F=p.externalForcePlank,L=mu*M*g,G=Math.max(0,p.muGround)*(M+N)*g;
  const commonFg=ground(s.vCarrier,F,G),commonA=(F+commonFg)/(M+N);
  const locked=Math.abs(rel)<=EPS&&Math.abs(M*commonA)<=L+EPS;
  if(locked)return {locked:true,stopped:s.vCarrier===0&&commonA===0,f1:M*commonA,fg:commonFg,a1:commonA,a2:commonA};
  // At equal velocity, the sign of the attempted COMMON acceleration
  // determines which way static contact fails (including F=0 and a<0).
  const f1=Math.abs(rel)<=EPS?Math.sign(commonA)*L:-Math.sign(rel)*L;
  const drive=F-f1,fg=ground(s.vCarrier,drive,G),a2=(drive+fg)/N;
  return {locked:false,stopped:s.vCarrier===0&&a2===0,f1,fg,a1:f1/M,a2};
}
function withPhase(s:BlockConveyorState,q:ContactPhase):BlockConveyorState{
  return {...s,coMovingLocked:q.locked,plankStopped:q.stopped,frictionOnBlockN:q.f1,
    groundFrictionN:q.fg,accelerationBlock:q.a1,accelerationCarrier:q.a2};
}
export function createInitialState(p:BlockConveyorParams):BlockConveyorState{
  const vCarrier=p.systemMode==='conveyor'?p.beltVelocity:p.plankInitialV;
  const s:BlockConveyorState={t:0,xBlock:0,vBlock:p.blockInitialV,xCarrier:0,vCarrier,
    relativeScratch:0,scratchMinM:0,scratchMaxM:0,frictionHeat:0,groundHeat:0,carrierWork:0,
    coMovingLocked:false,plankStopped:false,frictionOnBlockN:0,groundFrictionN:0,accelerationBlock:0,accelerationCarrier:0,events:[]};
  return withPhase(s,solveContactPhase(s,p));
}
/** Frozen phase only. A trial crossing is never accepted; the caller finds
 * its earliest guard before integrating the segment's physical work/heat. */
function advance(s:BlockConveyorState,p:BlockConveyorParams,q:ContactPhase,dt:number):BlockConveyorState{
  const dx1=s.vBlock*dt+.5*q.a1*dt*dt,dx2=s.vCarrier*dt+.5*q.a2*dt*dt;
  const ds=q.locked?0:dx1-dx2,rel=s.xBlock-s.xCarrier+dx1-dx2;
  return {...s,t:s.t+dt,xBlock:s.xBlock+dx1,xCarrier:s.xCarrier+dx2,
    vBlock:s.vBlock+q.a1*dt,vCarrier:s.vCarrier+q.a2*dt,
    relativeScratch:s.relativeScratch+Math.abs(ds),
    scratchMinM:Math.min(s.scratchMinM,rel),scratchMaxM:Math.max(s.scratchMaxM,rel),
    frictionHeat:s.frictionHeat+Math.abs(q.f1*ds),
    groundHeat:s.groundHeat+(p.systemMode==='plank'?Math.abs(q.fg*dx2):0),
    carrierWork:s.carrierWork+(p.systemMode==='conveyor'?q.f1*p.beltVelocity*dt:p.externalForcePlank*dx2)};
}
type GuardId='relative-zero'|'ground-zero'|'left-edge'|'right-edge';
type Hit={id:GuardId;dt:number};
const supportCoordinate=(s:BlockConveyorState,p:BlockConveyorParams)=>p.systemMode==='conveyor'?s.xBlock:s.xBlock-s.xCarrier;
function candidateEvents(s:BlockConveyorState,p:BlockConveyorParams,q:ContactPhase,dt:number):Hit[]{
  const result:Hit[]=[];
  const move=(state:BlockConveyorState,h:number)=>advance(state,p,q,h);
  const add=(id:GuardId,state:BlockConveyorState,h:number,fn:(z:BlockConveyorState)=>number,offset=0)=>{
    const hit=bisectEvent(state,state.t,h,move,fn,{timeTolerance:1e-13,triggerOnStartZero:false});
    if(hit)result.push({id,dt:offset+hit.timeOffset});
  };
  if(!q.locked&&Math.abs(s.vBlock-s.vCarrier)>EPS)add('relative-zero',s,dt,z=>z.vBlock-z.vCarrier);
  if(p.systemMode==='plank'&&Math.abs(s.vCarrier)>EPS)add('ground-zero',s,dt,z=>z.vCarrier);
  const half=edgeHalf(p);
  if(Number.isFinite(half)){
    const v=p.systemMode==='conveyor'?s.vBlock:s.vBlock-s.vCarrier,a=p.systemMode==='conveyor'?q.a1:q.a1-q.a2;
    // A quadratic position may hit an edge and return within a coarse dt.
    // Split at the sole stationary point before bracketing each monotonic leg.
    const turn=a!==0?-v/a:Infinity;
    const cuts=turn>0&&turn<dt?[0,turn,dt]:[0,dt];
    for(const [id,sign] of [['left-edge',-1],['right-edge',1]] as const){
      const fn=(z:BlockConveyorState)=>half-sign*supportCoordinate(z,p);
      for(let i=0;i<cuts.length-1;i++){
        const offset=cuts[i]!,h=cuts[i+1]!-offset,from=offset===0?s:move(s,offset),end=move(from,h);
        if(fn(from)<=0){
          // On an initial edge, only terminate for an outward velocity or acceleration.
          const vv=v+a*offset;if(sign*vv>0||(Math.abs(vv)<=EPS&&sign*a>0))result.push({id,dt:offset});
          break;
        }
        if(fn(end)<=0){add(id,from,h,fn,offset);break;}
      }
    }
  }
  return result.sort((a,b)=>a.dt-b.dt);
}
export function stepBlockConveyor(s:BlockConveyorState,p:BlockConveyorParams,dt:number):StepResult<BlockConveyorState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(s.terminal)return {nextState:s,events:[],advancedTime:0,halt:true};
  if(dt===0)return {nextState:s,events:[]};
  let cur=s,remaining=dt,transitions=0;
  const events:PhysicsEvent[]=[];
  while(remaining>0){
    if(++transitions>16)throw Error('M05 unresolved contact transition (no invalid fallback integration)');
    const q=solveContactPhase(cur,p);cur=withPhase(cur,q);
    const hits=candidateEvents(cur,p,q,remaining),first=hits[0];
    if(!first){cur=advance(cur,p,q,remaining);break;}
    const h=first.dt;
    cur=advance(cur,p,q,h);
    remaining=Math.max(0,remaining-h);
    const simultaneous=hits.filter(x=>Math.abs(x.dt-h)<=1e-11).map(x=>x.id);
    const co=simultaneous.includes('relative-zero'),stop=simultaneous.includes('ground-zero');
    // Exact reset maps at a localized root; conserve momentum for the
    // tiny numerical correction to common velocity, not a physical impulse.
    if(co){
      const v=p.systemMode==='conveyor'?p.beltVelocity:stop||q.stopped?0:(m1(p)*cur.vBlock+m2(p)*cur.vCarrier)/(m1(p)+m2(p));
      cur={...cur,vBlock:v,vCarrier:v};
    }else if(stop)cur={...cur,vCarrier:0,...(q.locked?{vBlock:0}:{})};
    const edge=simultaneous.find((id):id is 'left-edge'|'right-edge'=>id==='left-edge'||id==='right-edge');
    const post=solveContactPhase(cur,p);
    const label=(id:GuardId)=>id==='relative-zero'?post.locked?'达到共速 · 静摩擦锁定':'共速 · 摩擦方向切换':
      id==='ground-zero'?post.stopped?'木板停止 · 地面静摩擦':'木板速度过零 · 重新判定摩擦':'到达承载面边界 · 接触段终止';
    for(const id of simultaneous)events.push({id:'m05-'+id+'-'+cur.t.toFixed(9),time:cur.t,label:label(id),
      position:{x:cur.xBlock,y:0},metrics:{relativeScratch:cur.relativeScratch,frictionHeat:cur.frictionHeat,
        vBlock:cur.vBlock,vCarrier:cur.vCarrier,groundHeat:cur.groundHeat}});
    if(edge){
      // End at loss of support; preserve incoming contact phase and velocity.
      cur={...cur,terminal:edge,events:[...s.events,...events]};
      return {nextState:cur,events,advancedTime:cur.t-s.t,halt:true};
    }
    cur=withPhase(cur,post);
  }
  cur=withPhase(cur,solveContactPhase(cur,p));
  return {nextState:{...cur,events:[...s.events,...events]},events,advancedTime:dt};
}
export function computeObservables(s:BlockConveyorState,p:BlockConveyorParams):Record<string,number>{
  const M=m1(p),N=m2(p),theta=p.systemMode==='conveyor'?degToRad(p.inclineDeg):0,
    kineticEnergy=.5*M*s.vBlock*s.vBlock+(p.systemMode==='plank'?.5*N*s.vCarrier*s.vCarrier:0),
    potentialEnergy=M*g*s.xBlock*Math.sin(theta);
  return {vBlock:s.vBlock,vCarrier:s.vCarrier,xBlock:s.xBlock,xCarrier:s.xCarrier,
    relativeDisplacement:s.xBlock-s.xCarrier,relativeScratch:s.relativeScratch,scratchSpanM:s.scratchMaxM-s.scratchMinM,
    frictionHeat:s.frictionHeat,groundHeat:s.groundHeat,carrierWork:s.carrierWork,
    kineticEnergy,potentialEnergy,totalMechanicalEnergy:kineticEnergy+potentialEnergy,dissipatedEnergy:s.frictionHeat+s.groundHeat,
    frictionOnBlockN:s.frictionOnBlockN,groundFrictionN:s.groundFrictionN,
    accelerationBlock:s.accelerationBlock,accelerationCarrier:s.accelerationCarrier,
    coMovingLocked:s.coMovingLocked?1:0,plankStopped:s.plankStopped?1:0,terminal:s.terminal?1:0};
}
export function checkInvariants(s:BlockConveyorState,initial:BlockConveyorState,p:BlockConveyorParams):InvariantReport[]{
  const e0=computeObservables(initial,p).totalMechanicalEnergy!,e=computeObservables(s,p).totalMechanicalEnergy!;
  const residual=Math.abs(e-e0+s.frictionHeat-initial.frictionHeat+s.groundHeat-initial.groundHeat-(s.carrierWork-initial.carrierWork));
  const reports:InvariantReport[]=[{name:'系统功能关系绝对残差 ΔE+Q−W',unit:'J',measuredError:residual,tolerance:1e-7,passed:residual<1e-7}];
  if(p.systemMode==='plank'&&p.muGround===0&&p.externalForcePlank===0){
    const error=Math.abs(m1(p)*(s.vBlock-initial.vBlock)+m2(p)*(s.vCarrier-initial.vCarrier));
    reports.push({name:'光滑地面板块动量守恒',unit:'kg·m/s',measuredError:error,tolerance:1e-8,passed:error<1e-8});
  }
  return reports;
}
