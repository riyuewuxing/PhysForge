import {
  SpatialHash2D,
  createSeededPrng,
  type DiskParticle2D
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';
import { R_GAS } from '../thermo-piston-gas-laws/engine.js';

export type ThermoCycleMdMode = 'cycle-carnot' | 'cycle-rect-pv' | 'kinetic-md-box';

export type ThermoCycleMdParams = {
  mode: ThermoCycleMdMode;
  molesN: number;
  tHotK: number;
  tColdK: number;
  compressionRatioV2OverV1: number;
  rectPressureRatio: number;
  particleCountN: number;
  seed: number;
  brownianPollen: boolean;
  mdSpeedScale: number;
};

export interface CycleSegmentMetrics {
  readonly label: string;
  readonly wJ: number;
  readonly qJ: number;
  readonly duJ: number;
  readonly points: readonly { vL: number; pKPa: number }[];
}

export interface CycleAnalysis {
  readonly valid: boolean;
  readonly reason: 'ok'|'not-cycle'|'invalid-parameters';
  readonly qInJ: number;
  readonly qOutJ: number;
  readonly minTemperatureK: number;
  readonly maxTemperatureK: number;
  readonly segments: readonly CycleSegmentMetrics[];
  readonly sumDuJ: number;
  readonly sumWJ: number;
  readonly sumQJ: number;
  readonly efficiency: number;
  readonly carnotEfficiency: number;
}

export interface ThermoCycleMdState {
  readonly t: number;
  readonly particles: readonly DiskParticle2D[];
  readonly brownianTrail: readonly { x: number; y: number }[];
  readonly boxSize: number;
  readonly wallPressure: number;
  readonly wallImpulseTotal: number;
  readonly lastStepPressure: number;
  readonly collisions: number;
  readonly maxPenetration: number;
  readonly substepsLast: number;
  readonly initialKineticEnergy: number;
  readonly kineticEnergy: number;
  readonly cycle: CycleAnalysis;
}

const BOX_SIZE = 10.0;
const GAS_RADIUS = 0.14;
const POLLEN_RADIUS = 0.32;
const MAX_MD_SUBSTEPS=10000;
const SAFE_TRAVEL=GAS_RADIUS/4;

const emptyCycle=(reason:CycleAnalysis['reason']):CycleAnalysis=>({valid:false,reason,segments:[],sumDuJ:0,sumWJ:0,sumQJ:0,qInJ:0,qOutJ:0,efficiency:0,carnotEfficiency:0,minTemperatureK:0,maxTemperatureK:0});
function summarizeCycle(segments:readonly CycleSegmentMetrics[],n:number):CycleAnalysis{
  const sum=(key:'wJ'|'qJ'|'duJ')=>segments.reduce((v,s)=>v+s[key],0);
  const qInJ=segments.reduce((v,s)=>v+Math.max(0,s.qJ),0),qOutJ=segments.reduce((v,s)=>v+Math.max(0,-s.qJ),0);
  const temperatures=segments.flatMap(s=>[s.points[0]!,s.points.at(-1)!]).map(q=>q.vL*q.pKPa/(n*R_GAS));
  const minTemperatureK=Math.min(...temperatures),maxTemperatureK=Math.max(...temperatures),sumWJ=sum('wJ');
  return {valid:true,reason:'ok',segments,sumDuJ:sum('duJ'),sumWJ,sumQJ:sum('qJ'),qInJ,qOutJ,minTemperatureK,maxTemperatureK,efficiency:sumWJ/qInJ,carnotEfficiency:1-minTemperatureK/maxTemperatureK};
}

export function evaluateClosedCycle(params: ThermoCycleMdParams): CycleAnalysis {
  if(params.mode==='kinetic-md-box')return emptyCycle('not-cycle');
  const n=params.molesN,tH=params.tHotK,tC=params.tColdK,rV=params.compressionRatioV2OverV1;
  if(![n,tC,rV].every(Number.isFinite)||n<=0||tC<=0||rV<=1)return emptyCycle('invalid-parameters');
  if(params.mode==='cycle-carnot'&&(!Number.isFinite(tH)||tH<=tC))return emptyCycle('invalid-parameters');
  if(params.mode==='cycle-rect-pv'&&(!Number.isFinite(params.rectPressureRatio)||params.rectPressureRatio<=1))return emptyCycle('invalid-parameters');
  const cv = 1.5 * R_GAS;
  const gamma = 5 / 3;
  const v1 = 0.005; // 5 L in m^3

  if (params.mode === 'cycle-rect-pv') {
    const v2 = v1 * rV;
    const pLow = (n * R_GAS * tC) / v1;
    const pHigh = pLow * params.rectPressureRatio;
    const t2 = (pHigh * v1) / (n * R_GAS);
    const t3 = (pHigh * v2) / (n * R_GAS);
    const t4 = (pLow * v2) / (n * R_GAS);

    // A(v1, pLow) -> B(v1, pHigh) -> C(v2, pHigh) -> D(v2, pLow) -> A
    const du1 = n * cv * (t2 - tC);
    const w1 = 0;
    const q1 = du1;

    const w2 = pHigh * (v2 - v1);
    const du2 = n * cv * (t3 - t2);
    const q2 = du2 + w2;

    const du3 = n * cv * (t4 - t3);
    const w3 = 0;
    const q3 = du3;

    const w4 = pLow * (v1 - v2);
    const du4 = n * cv * (tC - t4);
    const q4 = du4 + w4;

    const segs: CycleSegmentMetrics[] = [
      { label: '等容升温 A→B', wJ: w1, qJ: q1, duJ: du1, points: [{ vL: v1 * 1e3, pKPa: pLow / 1e3 }, { vL: v1 * 1e3, pKPa: pHigh / 1e3 }] },
      { label: '定压膨胀 B→C', wJ: w2, qJ: q2, duJ: du2, points: [{ vL: v1 * 1e3, pKPa: pHigh / 1e3 }, { vL: v2 * 1e3, pKPa: pHigh / 1e3 }] },
      { label: '等容降温 C→D', wJ: w3, qJ: q3, duJ: du3, points: [{ vL: v2 * 1e3, pKPa: pHigh / 1e3 }, { vL: v2 * 1e3, pKPa: pLow / 1e3 }] },
      { label: '定压压缩 D→A', wJ: w4, qJ: q4, duJ: du4, points: [{ vL: v2 * 1e3, pKPa: pLow / 1e3 }, { vL: v1 * 1e3, pKPa: pLow / 1e3 }] }
    ];
    return summarizeCycle(segs,n);
  }

  // Carnot Cycle
  const v2 = v1 * rV;
  const adiabFactor = Math.pow(tH / tC, 1 / (gamma - 1));
  const v3 = v2 * adiabFactor;
  const v4 = v1 * adiabFactor;

  const sampleCurve = (vA: number, vB: number, fn: (v: number) => number) => {
    const pts: { vL: number; pKPa: number }[] = [];
    for (let i = 0; i <= 64; i++) {
      const v = vA + (i / 64) * (vB - vA);
      pts.push({ vL: v * 1e3, pKPa: fn(v) / 1e3 });
    }
    return pts;
  };

  const w1 = n * R_GAS * tH * Math.log(v2 / v1);
  const q1 = w1;
  const du1 = 0;

  const du2 = n * cv * (tC - tH);
  const w2 = -du2;
  const q2 = 0;

  const w3 = n * R_GAS * tC * Math.log(v4 / v3);
  const q3 = w3;
  const du3 = 0;

  const du4 = n * cv * (tH - tC);
  const w4 = -du4;
  const q4 = 0;

  const segs: CycleSegmentMetrics[] = [
    { label: '等温吸热膨胀 (T_H)', wJ: w1, qJ: q1, duJ: du1, points: sampleCurve(v1, v2, (v) => (n * R_GAS * tH) / v) },
    { label: '绝热膨胀降温', wJ: w2, qJ: q2, duJ: du2, points: sampleCurve(v2, v3, (v) => (n * R_GAS * tH * Math.pow(v2, gamma - 1)) / Math.pow(v, gamma)) },
    { label: '等温放热压缩 (T_C)', wJ: w3, qJ: q3, duJ: du3, points: sampleCurve(v3, v4, (v) => (n * R_GAS * tC) / v) },
    { label: '绝热压缩升温', wJ: w4, qJ: q4, duJ: du4, points: sampleCurve(v4, v1, (v) => (n * R_GAS * tC * Math.pow(v4, gamma - 1)) / Math.pow(v, gamma)) }
  ];

  return summarizeCycle(segs,n);
}

function initMdParticles(params: ThermoCycleMdParams): DiskParticle2D[] {
  const N = Math.max(40, Math.min(400, Math.round(params.particleCountN)));
  const rng = createSeededPrng(params.seed);
  const particles: DiskParticle2D[] = [];
  // Reserve spare lattice sites only when a pollen exclusion disk is present.
  const cols = Math.ceil(Math.sqrt(N+(params.brownianPollen?16:0)));
  const step = (BOX_SIZE - 1.0) / cols;
  const speedAmp = Math.max(0.5, params.mdSpeedScale) * 2.6;

  if (params.brownianPollen) {
    particles.push({
      x: 0.5 * BOX_SIZE,
      y: 0.5 * BOX_SIZE,
      vx: 0,
      vy: 0,
      radius: POLLEN_RADIUS,
      mass: 20
    });
  }

  let placed = 0;
  for (let row = 0; row < cols && placed < N; row++) {
    for (let col = 0; col < cols && placed < N; col++) {
      const x = 0.5 + (col + 0.5) * step + rng.range(-0.08 * step, 0.08 * step);
      const y = 0.5 + (row + 0.5) * step + rng.range(-0.08 * step, 0.08 * step);
      if (params.brownianPollen && Math.hypot(x - 0.5 * BOX_SIZE, y - 0.5 * BOX_SIZE) < POLLEN_RADIUS + GAS_RADIUS + 0.1) {
        continue;
      }
      particles.push({
        x,
        y,
        vx: rng.gaussian(0, speedAmp),
        vy: rng.gaussian(0, speedAmp),
        radius: GAS_RADIUS,
        mass: 1
      });
      placed++;
    }
  }
  if(placed!==N)throw new Error('Unable to place requested non-overlapping gas population');
  return particles;
}

function totalKineticEnergy(particles: readonly DiskParticle2D[]): number {
  let ek = 0;
  for (const p of particles) {
    ek += 0.5 * p.mass * (p.vx * p.vx + p.vy * p.vy);
  }
  return ek;
}


export interface SpeedStatistics {
  count:number;meanSpeed:number;rmsSpeed:number;temperatureProxy:number;maxSpeed:number;
  binWidth:number;bins:readonly {lo:number;hi:number;count:number;fraction:number;expectedFraction:number}[];
  theoreticalTail:number;cdfDistance:number;
}
// Fitted reference, not a formal KS test with known parameters. All gas
// samples are counted; the massive tracer is explicitly excluded.
export function computeSpeedStatistics(particles:readonly DiskParticle2D[],binCount=12):SpeedStatistics{
  const speeds=particles.filter(p=>p.mass===1).map(p=>Math.hypot(p.vx,p.vy)).sort((a,b)=>a-b),N=speeds.length;
  const meanSpeed=N?speeds.reduce((a,b)=>a+b,0)/N:0,meanSq=N?speeds.reduce((a,b)=>a+b*b,0)/N:0;
  const maxSpeed=speeds.at(-1)??0,rmsSpeed=Math.sqrt(meanSq);
  const top=Math.max(maxSpeed*1.000001,3*rmsSpeed,1e-6);
  const binWidth=top/binCount;
  const counts=new Array<number>(binCount).fill(0);
  for(const v of speeds)counts[Math.min(binCount-1,Math.floor(v/binWidth))]!++;
  const cdf=(v:number)=>meanSq>0?1-Math.exp(-v*v/meanSq):v>=0?1:0;
  let cdfDistance=0;
  if(N&&meanSq>0)for(let i=0;i<N;i++){
    const F=cdf(speeds[i]!);cdfDistance=Math.max(cdfDistance,Math.abs((i+1)/N-F),Math.abs(i/N-F));
  }
  const bins=counts.map((count,i)=>({lo:i*binWidth,hi:(i+1)*binWidth,count,fraction:N?count/N:0,expectedFraction:meanSq>0?cdf((i+1)*binWidth)-cdf(i*binWidth):i===0&&N?1:0}));
  return {count:N,meanSpeed,rmsSpeed,temperatureProxy:meanSq/2,maxSpeed,binWidth,bins,theoreticalTail:meanSq>0?Math.exp(-top*top/meanSq):0,cdfDistance};
}
export function evaluateMaxwellKsStat(particles:readonly DiskParticle2D[]):number{return computeSpeedStatistics(particles).cdfDistance;}

export function createInitialState(params: ThermoCycleMdParams): ThermoCycleMdState {
  const particles=params.mode==='kinetic-md-box'?initMdParticles(params):[],ek0=totalKineticEnergy(particles);
  return {t:0,particles,brownianTrail:params.mode==='kinetic-md-box'&&params.brownianPollen?[{x:BOX_SIZE/2,y:BOX_SIZE/2}]:[],
    boxSize:BOX_SIZE,wallPressure:0,wallImpulseTotal:0,lastStepPressure:0,collisions:0,maxPenetration:0,substepsLast:0,
    initialKineticEnergy:ek0,kineticEnergy:ek0,cycle:evaluateClosedCycle(params)};
}

// Largest diameter includes the pollen. The adjacent cells then cover
// every possible overlapping disk pair; no gas-only interaction radius.
const hash=new SpatialHash2D(2*POLLEN_RADIUS);
type AxisFlight={position:number;velocity:number;impulse:number};
function flyAxis(position:number,velocity:number,radius:number,mass:number,L:number,dt:number):AxisFlight{
  let t=dt,impulse=0,x=position,v=velocity;
  // A bounded microstep ordinarily meets at most one wall. Include an
  // endpoint hit and a start-on-wall outward hit exactly once.
  while(t>0&&v!==0){
    const wall=v>0?L-radius:radius,hit=Math.max(0,(wall-x)/v);
    if(hit>t){x+=v*t;break;}
    x=wall;t=Math.max(0,t-hit);impulse+=2*mass*Math.abs(v);v=-v;
  }
  return {position:Math.max(radius,Math.min(L-radius,x)),velocity:v,impulse};
}
function keepInBox(p:DiskParticle2D,L:number):number{
  let impulse=0;
  // Position correction can move a disk through a wall. Project it back;
  // reverse only outward velocities and account for that wall impulse.
  for(const axis of ['x','y'] as const){
    const vel=axis==='x'?'vx':'vy';
    if(p[axis]<=p.radius){p[axis]=p.radius;if(p[vel]<0){impulse+=2*p.mass*Math.abs(p[vel]);p[vel]=-p[vel];}}
    if(p[axis]>=L-p.radius){p[axis]=L-p.radius;if(p[vel]>0){impulse+=2*p.mass*Math.abs(p[vel]);p[vel]=-p[vel];}}
  }
  return impulse;
}
function measurePenetration(particles:DiskParticle2D[]):number{
  hash.rebuild(particles);
  let worst=0;
  for(let i=0;i<particles.length;i++){
    const a=particles[i]!;
    for(const j of hash.queryNeighbors(a.x,a.y)){
      if(j<=i)continue;const b=particles[j]!;
      worst=Math.max(worst,a.radius+b.radius-Math.hypot(b.x-a.x,b.y-a.y));
    }
  }
  return worst;
}
export function stepThermoCycleMd(state:ThermoCycleMdState,params:ThermoCycleMdParams,dt:number):StepResult<ThermoCycleMdState>{
  if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:state,events:[]};
  if(params.mode!=='kinetic-md-box')return {nextState:createInitialState(params),events:[]};
  const particles=state.particles.map(p=>({...p})),L=state.boxSize;
  let remaining=dt,wallImpulse=0,substeps=0,collisions=state.collisions;
  while(remaining>0){
    if(++substeps>MAX_MD_SUBSTEPS)throw new Error('MD step exceeds bounded travel budget; reduce dt');
    const vmax=particles.reduce((v,p)=>Math.max(v,Math.hypot(p.vx,p.vy)),0);
    if(!Number.isFinite(vmax))throw new Error('Invalid MD velocity');
    const h=vmax>0?Math.min(remaining,SAFE_TRAVEL/vmax):remaining;
    for(const p of particles){
      const x=flyAxis(p.x,p.vx,p.radius,p.mass,L,h),y=flyAxis(p.y,p.vy,p.radius,p.mass,L,h);
      p.x=x.position;p.y=y.position;p.vx=x.velocity;p.vy=y.velocity;wallImpulse+=x.impulse+y.impulse;
    }
    // Discrete hard-disk overlap/impulse solver, not exact pair TOI.
    // A second pass is necessary if separation pushed a neighbour into
    // another disk or a reflecting boundary. Keep residual explicit.
    for(let pass=0;pass<3;pass++){
      const c=hash.resolveDiskCollisions(particles,1);
      collisions+=c;
      let correctionImpulse=0;
      for(const p of particles)correctionImpulse+=keepInBox(p,L);
      wallImpulse+=correctionImpulse;
      if(pass>=1&&c===0&&correctionImpulse===0)break;
    }
    remaining=Math.max(0,remaining-h);
  }
  const t=state.t+dt,wallImpulseTotal=state.wallImpulseTotal+wallImpulse,kineticEnergy=totalKineticEnergy(particles);
  const pollen=params.brownianPollen?particles.find(p=>p.mass>2):undefined;
  return {nextState:{...state,t,particles,brownianTrail:pollen?[...state.brownianTrail.slice(-240),{x:pollen.x,y:pollen.y}]:state.brownianTrail,
    kineticEnergy,wallImpulseTotal,wallPressure:wallImpulseTotal/(4*L*t),lastStepPressure:wallImpulse/(4*L*dt),
    collisions,maxPenetration:measurePenetration(particles),substepsLast:substeps},events:[]};
}
export function computeObservables(s:ThermoCycleMdState,p:ThermoCycleMdParams):Record<string,number>{
  if(p.mode==='kinetic-md-box'){
    const stats=computeSpeedStatistics(s.particles);
    return {t:s.t,kineticEnergy:s.kineticEnergy,wallPressure:s.wallPressure,pressureMeasured:s.t>0?1:0,
      wallImpulseTotal:s.wallImpulseTotal,lastStepPressure:s.lastStepPressure,gasCount:stats.count,particleCount:s.particles.length,
      rmsSpeed:stats.rmsSpeed,meanSpeed:stats.meanSpeed,temperatureProxy:stats.temperatureProxy,maxwellKs:stats.cdfDistance,
      energyRelativeError:Math.abs(s.kineticEnergy-s.initialKineticEnergy)/Math.max(1e-12,s.initialKineticEnergy),
      collisions:s.collisions,maxPenetration:s.maxPenetration,substepsLast:s.substepsLast};
  }
  const c=s.cycle;
  if(!c.valid)return {t:0,cycleValid:0};
  return {t:0,cycleValid:1,efficiencyPct:c.efficiency*100,carnotEfficiencyPct:c.carnotEfficiency*100,
    sumWJ:c.sumWJ,sumQJ:c.sumQJ,sumDuJ:c.sumDuJ,qInJ:c.qInJ,qOutJ:c.qOutJ,minTemperatureK:c.minTemperatureK,maxTemperatureK:c.maxTemperatureK};
}
export function checkInvariants(s:ThermoCycleMdState,initial:ThermoCycleMdState,p:ThermoCycleMdParams):InvariantReport[]{
  const inv=(name:string,error:number,tolerance=1e-8):InvariantReport=>({name,measuredError:Math.abs(error),tolerance,passed:Number.isFinite(error)&&Math.abs(error)<=tolerance});
  if(p.mode==='kinetic-md-box'){
    const wallViolation=s.particles.reduce((w,q)=>Math.max(w,q.radius-q.x,q.radius-q.y,q.x+q.radius-s.boxSize,q.y+q.radius-s.boxSize),0);
    const amount=s.particles.filter(q=>q.mass===1).length;
    return [inv('约化总动能相对守恒',Math.abs(s.kineticEnergy-s.initialKineticEnergy)/Math.max(1e-12,s.initialKineticEnergy)),
      inv('真实粒子数守恒',s.particles.length-initial.particles.length,0),inv('气体粒子数与参数一致',amount-Math.max(40,Math.min(400,Math.round(p.particleCountN))),0),
      inv('反射壁边界约束',wallViolation,1e-10),
      inv('平均壁压冲量账本',s.t>0?s.wallPressure*4*s.boxSize*s.t-s.wallImpulseTotal:0,1e-7)];
  }
  const c=s.cycle;
  if(!c.valid)return [];
  return [inv('闭合循环 ΣΔU=0',c.sumDuJ,1e-8),inv('闭合循环 ΣQ=ΣW',c.sumQJ-c.sumWJ,1e-8),
    inv('效率不超过实际温区上限',Math.max(0,c.efficiency-c.carnotEfficiency),1e-12),inv('静态解析循环无时间',s.t,0)];
}
