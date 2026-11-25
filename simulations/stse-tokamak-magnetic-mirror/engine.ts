import { bisectEvent, stepBorisPusher, type ChargedParticleState, type Vec3 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type FusionFieldMode = 'magnetic-mirror' | 'tokamak';

export type TokamakMirrorParams = {
  mode: FusionFieldMode;
  b0Tesla: number;
  mirrorLengthM: number;
  coilHalfSpanM: number;
  pitchAngleDeg: number;
  speed0: number;
  qOverM: number;
  majorRadiusM: number;
  safetyFactorQ: number;
};

export interface TokamakMirrorState {
  readonly t: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly bField: Vec3;
  readonly mu0: number;
  readonly muCurrent: number;
  readonly maxMuRelDev: number;
  readonly initialKineticJ: number;
  readonly currentKineticJ: number;
  readonly escaped: boolean;
  readonly reflectionCount: number;
  /** Sign of the velocity parallel to the local total B (legacy field name retained). */
  readonly lastVzSign: number;
  readonly escapeEvent?:PhysicsEvent;
  readonly lastReflection?:PhysicsEvent;
  readonly trail: readonly Vec3[];
}

export function evaluateTokamakMirrorField(pos: Vec3, params: TokamakMirrorParams): Vec3 {
  const B0 = Math.max(0.2, params.b0Tesla);
  if (params.mode === 'tokamak') {
    const R0 = Math.max(0.8, params.majorRadiusM);
    const R = Math.max(0.15, Math.hypot(pos.x, pos.y));
    const qSafe = Math.max(0.8, params.safetyFactorQ);
    const phi = Math.atan2(pos.y, pos.x);
    const bTorMag = (B0 * R0) / R;
    const bxTor = -bTorMag * Math.sin(phi);
    const byTor = bTorMag * Math.cos(phi);

    // Poloidal field tangent around minor cross section center (R0 cos phi, R0 sin phi, 0)
    const dR = R - R0;
    const dZ = pos.z;
    const scalePol = B0 / (qSafe * R);
    const bxPol = -scalePol * dZ * Math.cos(phi);
    const byPol = -scalePol * dZ * Math.sin(phi);
    const bzPol = scalePol * dR;
    return { x: bxTor + bxPol, y: byTor + byPol, z: bzPol };
  }

  const L = Math.max(0.4, params.mirrorLengthM);
  const L2 = L * L;
  return {
    x: (-B0 * pos.x * pos.z) / L2,
    y: (-B0 * pos.y * pos.z) / L2,
    z: B0 * (1 + (pos.z * pos.z) / L2)
  };
}

export const TOKAMAK_MINOR_RADIUS_M=.55;
export function fusionMinorRadius(pos:Vec3,params:TokamakMirrorParams):number{
  return Math.hypot(Math.hypot(pos.x,pos.y)-Math.max(.8,params.majorRadiusM),pos.z);
}
export function fusionBoundaryDistance(pos:Vec3,params:TokamakMirrorParams):number{
  return params.mode==='tokamak'?fusionMinorRadius(pos,params)-TOKAMAK_MINOR_RADIUS_M:Math.abs(pos.z)-params.coilHalfSpanM;
}
export function fusionParallelVelocity(v:Vec3,B:Vec3):number{
  return (v.x*B.x+v.y*B.y+v.z*B.z)/Math.max(1e-12,Math.hypot(B.x,B.y,B.z));
}
/** Actual mean toroidal turns per poloidal turn on a given circular flux
 * surface. safetyFactorQ is the field-strength parameter, not an exact q profile. */
export function fusionSurfaceWinding(params:TokamakMirrorParams,rho:number):number{
  const R0=Math.max(.8,params.majorRadiusM),q=Math.max(.8,params.safetyFactorQ);
  if(rho<0||rho>=R0)throw new RangeError('Surface winding is defined for 0<=rho<R0');
  return q*R0/Math.sqrt(R0*R0-rho*rho);
}

export function computeMirrorLossConeDeg(params: TokamakMirrorParams): number {
  const L = Math.max(0.4, params.mirrorLengthM);
  const zc = Math.max(0.5, params.coilHalfSpanM);
  const Rm = 1 + (zc * zc) / (L * L);
  return (Math.asin(Math.sqrt(1 / Rm)) * 180) / Math.PI;
}

function computeMuAndKinetic(v: Vec3, B: Vec3): { mu: number; ke: number; bMag: number } {
  const vSq = v.x * v.x + v.y * v.y + v.z * v.z;
  const bMag = Math.max(1e-12, Math.hypot(B.x, B.y, B.z));
  const vPar=fusionParallelVelocity(v,B);
  const vPerpSq = Math.max(0, vSq - vPar * vPar);
  return {
    mu: (0.5 * vPerpSq) / bMag,
    ke: 0.5 * vSq,
    bMag
  };
}

export function createInitialState(params: TokamakMirrorParams): TokamakMirrorState {
  const theta = (Math.max(1, Math.min(89, params.pitchAngleDeg)) * Math.PI) / 180;
  const v0 = Math.max(0.2, params.speed0);
  const vPerp = v0 * Math.sin(theta);
  const vPar = v0 * Math.cos(theta);

  const pos0: Vec3 =
    params.mode === 'tokamak'
      ? { x: params.majorRadiusM + 0.28, y: 0, z: 0 }
      : { x: 0.04, y: 0, z: 0 };
  const b0 = evaluateTokamakMirrorField(pos0, params);

  let vel0: Vec3;
  if (params.mode === 'tokamak') {
    const bMag=Math.hypot(b0.x,b0.y,b0.z);
    // At phi=0, e_R is perpendicular to total B. Complete an orthonormal
    // basis using e_R × b; do not mistake e_phi for the local field.
    const by=b0.y/bMag,bz=b0.z/bMag,c=Math.sqrt(1-.7*.7);
    vel0={x:.7*vPerp,y:vPar*by-c*vPerp*bz,z:vPar*bz+c*vPerp*by};
  } else {
    vel0 = { x: 0, y: vPerp, z: vPar };
  }

  const { mu, ke } = computeMuAndKinetic(vel0, b0);
  return {
    t: 0,
    position: pos0,
    velocity: vel0,
    bField: b0,
    mu0: mu,
    muCurrent: mu,
    maxMuRelDev: 0,
    initialKineticJ: ke,
    currentKineticJ: ke,
    escaped: false,
    reflectionCount: 0,
    lastVzSign: Math.sign(fusionParallelVelocity(vel0,b0)) || 1,
    trail: [pos0]
  };
}

export function stepTokamakMirror(
  state: TokamakMirrorState,
  params: TokamakMirrorParams,
  dt: number
): StepResult<TokamakMirrorState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const qOverM = Math.max(2, params.qOverM);
  const nominalDt=Math.min(dt/8,.0008);
  const fieldFn = (pos: Vec3) => ({ E: { x: 0, y: 0, z: 0 }, B: evaluateTokamakMirrorField(pos, params) });

  let particle: ChargedParticleState = {
    position: state.position,
    velocity: state.velocity,
    t: state.t
  };

  let reflections = state.reflectionCount;
  let lastSign = state.lastVzSign;
  let escaped = state.escaped;
  let maxMuDev = state.maxMuRelDev;
  let lastMu = state.muCurrent;
  let lastKe = state.currentKineticJ;
  let lastB = state.bField;

  const events:PhysicsEvent[]=[];
  let escapeEvent=state.escapeEvent,lastReflection=state.lastReflection;
  const advance=(p:ChargedParticleState,h:number)=>stepBorisPusher(p,fieldFn,qOverM,1,h);
  const boundary=(p:ChargedParticleState)=>fusionBoundaryDistance(p.position,params);
  const parallel=(p:ChargedParticleState)=>fusionParallelVelocity(p.velocity,evaluateTokamakMirrorField(p.position,params));
  const endTime=state.t+dt;
  // Bound local gyro phase even at the high-field end of the legal parameter
  // range; retain the original nominal step for weak fields.
  while(particle.t<endTime){
    const subDt=Math.min(nominalDt,endTime-particle.t,.12/Math.max(1e-12,Math.abs(qOverM)*Math.hypot(lastB.x,lastB.y,lastB.z)));
    if(!(subDt>0)||particle.t+subDt===particle.t)throw new RangeError('S01 substep below time resolution');
    const prev=particle;
    particle=advance(prev,subDt);
    if(!escaped){
      const g0=boundary(prev),g1=boundary(particle);
      const exit=g0<=0&&g1>0?bisectEvent(prev,prev.t,subDt,advance,boundary,{timeTolerance:1e-10,triggerOnStartZero:true}):null;
      const par0=parallel(prev),par1=parallel(particle),sign=Math.sign(par1);
      if(params.mode==='magnetic-mirror'&&sign!==0&&sign!==lastSign){
        const hit=par0*par1<=0?bisectEvent(prev,prev.t,subDt,advance,parallel,{timeTolerance:1e-10,triggerOnStartZero:true}):null;
        if(hit&&boundary(hit.state)<0&&(!exit||hit.time<exit.time)){
          reflections++;
          lastReflection={id:'fusion-reflection',label:'沿局部磁场平行速度过零',time:hit.time,position:hit.state.position,
            metrics:{vParallel:parallel(hit.state),bracketWidth:hit.bracketWidth}};
          events.push(lastReflection);
        }
        lastSign=sign;
      }
      if(exit){
        escaped=true;
        escapeEvent={id:'fusion-escape',label:params.mode==='tokamak'?'首次越过示意真空室边界':'首次穿过磁喉',time:exit.time,position:exit.state.position,
          metrics:{boundaryDistance:boundary(exit.state),bracketWidth:exit.bracketWidth}};
        events.push(escapeEvent);
      }
    }
    lastB = evaluateTokamakMirrorField(particle.position, params);
    const diag = computeMuAndKinetic(particle.velocity, lastB);
    lastMu = diag.mu;
    lastKe = diag.ke;
    if (state.mu0 > 1e-12 && !escaped) {
      const dev = Math.abs(diag.mu - state.mu0) / state.mu0;
      if (dev > maxMuDev) maxMuDev = dev;
    }

  }

  return {
    nextState: {
      t: endTime,
      position: particle.position,
      velocity: particle.velocity,
      bField: lastB,
      mu0: state.mu0,
      muCurrent: lastMu,
      maxMuRelDev: maxMuDev,
      initialKineticJ: state.initialKineticJ,
      currentKineticJ: lastKe,
      escaped,
      reflectionCount: reflections,
      lastVzSign: lastSign,
      ...(escapeEvent?{escapeEvent}:{}),...(lastReflection?{lastReflection}:{}),
      trail: [...state.trail,...events.map(e=>e.position!).filter((p):p is Vec3=>p.z!==undefined),particle.position].slice(-261)
    },
    events
  };
}

export function buildTokamakMirrorSegments(params: TokamakMirrorParams): { a: Vec3; b: Vec3 }[] {
  const segs: { a: Vec3; b: Vec3 }[] = [];
  if (params.mode === 'magnetic-mirror') {
    for (const zCoil of [-params.coilHalfSpanM, params.coilHalfSpanM]) {
      const R = 0.7;
      for (let i = 0; i < 32; i++) {
        const a1 = (i / 32) * 2 * Math.PI;
        const a2 = ((i + 1) / 32) * 2 * Math.PI;
        segs.push({
          a: { x: R * Math.cos(a1), y: R * Math.sin(a1), z: zCoil },
          b: { x: R * Math.cos(a2), y: R * Math.sin(a2), z: zCoil }
        });
      }
    }
  } else {
    const R0 = Math.max(0.8, params.majorRadiusM);
    const rMin=TOKAMAK_MINOR_RADIUS_M;
    for (let j = 0; j < 12; j++) {
      const phi = (j / 12) * 2 * Math.PI;
      const cx = R0 * Math.cos(phi);
      const cy = R0 * Math.sin(phi);
      for (let i = 0; i < 24; i++) {
        const t1 = (i / 24) * 2 * Math.PI;
        const t2 = ((i + 1) / 24) * 2 * Math.PI;
        segs.push({
          a: { x: cx + rMin * Math.cos(t1) * Math.cos(phi), y: cy + rMin * Math.cos(t1) * Math.sin(phi), z: rMin * Math.sin(t1) },
          b: { x: cx + rMin * Math.cos(t2) * Math.cos(phi), y: cy + rMin * Math.cos(t2) * Math.sin(phi), z: rMin * Math.sin(t2) }
        });
      }
    }
  }
  return segs;
}

/** Sample the integral curves of the very same analytic field used by
 * Boris. The mirror flux invariant is exact; toroidal theta is integrated
 * with RK4 in phi while rho stays exactly on its physical flux surface. */
export function traceTokamakMirrorLines(params:TokamakMirrorParams):Vec3[][]{
  const lines:Vec3[][]=[];
  if(params.mode==='magnetic-mirror'){
    const L=Math.max(.4,params.mirrorLengthM),half=params.coilHalfSpanM*1.1;
    for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2])for(const centerRadius of [.28,.55]){
      const points:Vec3[]=[];
      for(let i=0;i<=128;i++){
        const z=half*(2*i/128-1),r=centerRadius/Math.sqrt(1+z*z/(L*L));
        points.push({x:r*Math.cos(angle),y:r*Math.sin(angle),z});
      }
      lines.push(points);
    }
  }else{
    const R0=Math.max(.8,params.majorRadiusM),q=Math.max(.8,params.safetyFactorQ);
    const h=4*Math.PI/360;
    for(const rho of [.22,.40])for(const startTheta of [0,Math.PI]){
      const points:Vec3[]=[];let theta=startTheta;
      const slope=(a:number)=>(R0+rho*Math.cos(a))/(q*R0);
      for(let i=0;i<=360;i++){
        const phi=i*h,R=R0+rho*Math.cos(theta);
        points.push({x:R*Math.cos(phi),y:R*Math.sin(phi),z:rho*Math.sin(theta)});
        const k1=slope(theta),k2=slope(theta+h*k1/2),k3=slope(theta+h*k2/2),k4=slope(theta+h*k3);
        theta+=h*(k1+2*k2+2*k3+k4)/6;
      }
      lines.push(points);
    }
  }
  return lines;
}

export function computeObservables(state: TokamakMirrorState, params: TokamakMirrorParams): Record<string, number> {
  const keErr = Math.abs(state.currentKineticJ - state.initialKineticJ) / Math.max(1e-12, state.initialKineticJ);
  return {
    t: state.t,
    z: state.position.z,
    bMagT: Math.hypot(state.bField.x, state.bField.y, state.bField.z),
    muCurrent: state.muCurrent,
    maxMuRelDev: state.maxMuRelDev,
    keDriftRel: keErr,
    reflectionCount: state.reflectionCount,
    escaped:state.escaped?1:0,
    vParallel:fusionParallelVelocity(state.velocity,state.bField),
    vPerp:Math.sqrt(Math.max(0,2*state.currentKineticJ-fusionParallelVelocity(state.velocity,state.bField)**2)),
    minorRadiusM:fusionMinorRadius(state.position,params),
    lossConeDeg: computeMirrorLossConeDeg(params)
  };
}

export function checkInvariants(state: TokamakMirrorState): InvariantReport[] {
  const keErr = Math.abs(state.currentKineticJ - state.initialKineticJ) / Math.max(1e-12, state.initialKineticJ);
  return [
    {
      name: 'Boris 3D 磁场动能相对漂移',
      measuredError: keErr,
      tolerance: 1e-8,
      passed: keErr < 1e-8
    },
    {
      name: '磁矩绝热近似 μ/m 相对波动（非严格守恒）',
      measuredError: state.maxMuRelDev,
      tolerance: 0.05,
      passed: state.maxMuRelDev < 0.05
    }
  ];
}
