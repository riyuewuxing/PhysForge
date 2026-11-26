import {
  CLASSROOM_GRAVITY,
  degToRad,
  stepHybridAutomaton,
  type HybridGuard
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type RigidBodyShape = 'solid-sphere' | 'hollow-sphere' | 'solid-cylinder' | 'thin-ring';
export type RigidRollingScenario = 'flat-bowling-slip' | 'incline-race';

export const SHAPE_INERTIA_COEFF: Record<RigidBodyShape, number> = {
  'solid-sphere': 0.4,
  'hollow-sphere': 2 / 3,
  'solid-cylinder': 0.5,
  'thin-ring': 1.0
};

export type RigidRollingParams = {
  scenario: RigidRollingScenario;
  shape: RigidBodyShape;
  massKg: number;
  radiusM: number;
  v0Mps: number;
  omega0Radps: number;
  muK: number;
  inclineDeg: number;
};

export interface RigidRollingState {
  readonly t: number;
  readonly mode: 'slipping' | 'pure-rolling';
  readonly x: number;
  readonly v: number;
  readonly omega: number;
  readonly theta: number;
  readonly transitionTimeS: number | null;
  readonly transitionSpeedMps: number | null;
  readonly initialEnergyJ: number;
  readonly currentEnergyJ: number;
  readonly inclinePositions: Readonly<Record<RigidBodyShape, number>>;
  readonly events: readonly PhysicsEvent[];
}

export interface RollingFrictionResult {
  readonly frictionAlongTangent: number;
  readonly mode: 'slip-forward' | 'slip-backward' | 'pure-roll';
  readonly label: 'f_动' | 'f_静' | '';
}

export function computeRollingFriction(
  v: number,
  omega: number,
  radius: number,
  mass: number,
  mu: number,
  kappa: number,
  inclineRad: number,
  g = CLASSROOM_GRAVITY,
  slipEps = 1e-9
): RollingFrictionResult {
  const safeRadius = Math.max(0.05, Number.isFinite(radius) ? radius : 0.05);
  const safeMass = Math.max(0, Number.isFinite(mass) ? mass : 0);
  const safeMu = Math.max(0, Number.isFinite(mu) ? mu : 0);
  const safeKappa = Math.max(0, Number.isFinite(kappa) ? kappa : 0);
  const safeTheta = Number.isFinite(inclineRad) ? inclineRad : 0;
  const safeG = Math.max(0, Number.isFinite(g) ? g : CLASSROOM_GRAVITY);
  const safeSlipEps = Math.max(0, Number.isFinite(slipEps) ? slipEps : 1e-9);
  const contactSpeed = v - omega * safeRadius;
  const normal = safeMass * safeG * Math.max(0, Math.cos(safeTheta));

  if (Math.abs(contactSpeed) > safeSlipEps) {
    const direction = contactSpeed > 0 ? -1 : 1;
    return {
      frictionAlongTangent: direction * safeMu * normal,
      mode: contactSpeed > 0 ? 'slip-forward' : 'slip-backward',
      label: 'f_动'
    };
  }

  if (Math.abs(safeTheta) < 1e-6) {
    return { frictionAlongTangent: 0, mode: 'pure-roll', label: '' };
  }

  const required = (safeKappa / (1 + safeKappa)) * safeMass * safeG * Math.sin(safeTheta);
  // The incline-race contract assumes sufficient static friction. mu is kinetic,
  // not an invented static coefficient or a cap on the required rolling force.
  return { frictionAlongTangent: -required, mode: 'pure-roll', label: 'f_静' };
}

function computeTotalEnergyJ(x: number, v: number, omega: number, params: RigidRollingParams): number {
  const m = Math.max(0.2, params.massKg);
  const R = Math.max(0.05, params.radiusM);
  const I = SHAPE_INERTIA_COEFF[params.shape] * m * R * R;
  const ke = 0.5 * m * v * v + 0.5 * I * omega * omega;
  const pe =
    params.scenario === 'incline-race'
      ? -m * CLASSROOM_GRAVITY * x * Math.sin(degToRad(params.inclineDeg))
      : 0;
  return ke + pe;
}

export function createInitialState(params: RigidRollingParams): RigidRollingState {
  const R = Math.max(0.05, params.radiusM);
  const v0 = params.scenario === 'incline-race' ? 0 : params.v0Mps;
  const w0 = params.scenario === 'incline-race' ? 0 : params.omega0Radps;
  const isRolling = params.scenario === 'incline-race' || Math.abs(v0 - w0 * R) < 1e-9;
  const e0 = computeTotalEnergyJ(0, v0, w0, params);

  return {
    t: 0,
    mode: isRolling ? 'pure-rolling' : 'slipping',
    x: 0,
    v: v0,
    omega: w0,
    theta: 0,
    transitionTimeS: isRolling ? 0 : null,
    transitionSpeedMps: isRolling ? v0 : null,
    initialEnergyJ: e0,
    currentEnergyJ: e0,
    inclinePositions: {
      'solid-sphere': 0,
      'hollow-sphere': 0,
      'solid-cylinder': 0,
      'thin-ring': 0
    },
    events: []
  };
}

export function stepRigidRollingSlip(
  state: RigidRollingState,
  params: RigidRollingParams,
  dt: number
): StepResult<RigidRollingState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const R = Math.max(0.05, params.radiusM);
  const c = SHAPE_INERTIA_COEFF[params.shape];
  const muK = Math.max(0, params.muK);

  if (params.scenario === 'incline-race') {
    const sinTh = Math.sin(degToRad(params.inclineDeg));
    const aSel = (CLASSROOM_GRAVITY * sinTh) / (1 + c);
    const nextT = state.t + dt;
    const nextV = state.v + aSel * dt;
    const nextX = state.x + state.v * dt + 0.5 * aSel * dt * dt;
    const nextOmega = nextV / R;
    const nextTheta = nextX / R;
    const inclinePositions: Record<RigidBodyShape, number> = {
      'solid-sphere': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 0.4)) * nextT * nextT,
      'solid-cylinder': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 0.5)) * nextT * nextT,
      'hollow-sphere': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 2 / 3)) * nextT * nextT,
      'thin-ring': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 1.0)) * nextT * nextT
    };
    return {
      nextState: {
        ...state,
        t: nextT,
        mode: 'pure-rolling',
        x: nextX,
        v: nextV,
        omega: nextOmega,
        theta: nextTheta,
        initialEnergyJ: state.initialEnergyJ,
        currentEnergyJ: computeTotalEnergyJ(nextX, nextV, nextOmega, params),
        inclinePositions
      },
      events: []
    };
  }

  // Flat bowling slip -> pure rolling via HybridAutomaton
  const initialSlipSign = Math.sign(state.v - state.omega * R) || 1;
  const advanceContinuous = (s: RigidRollingState, h: number): RigidRollingState => {
    if (s.mode === 'pure-rolling') {
      const nextX = s.x + s.v * h;
      const nextTh = s.theta + s.omega * h;
      return {
        ...s,
        t: s.t + h,
        x: nextX,
        theta: nextTh,
        currentEnergyJ: computeTotalEnergyJ(nextX, s.v, s.omega, params)
      };
    }
    const slipNow = s.v - s.omega * R;
    const sgn = Math.sign(slipNow) || initialSlipSign;
    const a = -sgn * muK * CLASSROOM_GRAVITY;
    const alpha = (sgn * muK * CLASSROOM_GRAVITY) / (c * R);
    const nextV = s.v + a * h;
    const nextOmega = s.omega + alpha * h;
    const nextX = s.x + s.v * h + 0.5 * a * h * h;
    const nextTh = s.theta + s.omega * h + 0.5 * alpha * h * h;
    return {
      ...s,
      t: s.t + h,
      x: nextX,
      v: nextV,
      omega: nextOmega,
      theta: nextTh,
      currentEnergyJ: computeTotalEnergyJ(nextX, nextV, nextOmega, params)
    };
  };

  const guards: HybridGuard<'slipping' | 'pure-rolling', RigidRollingState>[] = muK===0 ? [] : [
    {
      id: 'pure-rolling-lock',
      label: '进入 v = ωR 纯滚动模态',
      fromModes: ['slipping'],
      biasEndpoint: 'positive',
      eventFn: (s) => -initialSlipSign * (s.v - s.omega * R),
      reset: (boundaryState, evTime) => {
        const vMatched = (boundaryState.v + c * boundaryState.omega * R) / (1+c);
        return {
          nextState: {
            ...boundaryState,
            mode: 'pure-rolling',
            v: vMatched,
            omega: vMatched / R,
            currentEnergyJ: computeTotalEnergyJ(boundaryState.x,vMatched,vMatched/R,params),
            transitionTimeS: evTime,
            transitionSpeedMps: vMatched
          },
          metrics: { transitionTimeS: evTime, transitionSpeedMps: vMatched }
        };
      }
    }
  ];

  const out = stepHybridAutomaton<'slipping' | 'pure-rolling', RigidRollingState>(
    { advanceContinuous, guards, timeTolerance: 1e-9 },
    state,
    dt
  );
  const newEvs: PhysicsEvent[] = out.events.map((e) => ({
    id: e.id,
    time: e.time,
    label: e.label,
    metrics: e.metrics
  }));
  return {
    nextState: {
      ...out.nextState,
      events: newEvs.length ? [...out.nextState.events, ...newEvs] : out.nextState.events
    },
    events: newEvs
  };
}

/** Signed physical quantities; display geometry must not change these values. */
export function rollingQuantities(state:RigidRollingState,params:RigidRollingParams){
  const m=Math.max(.2,params.massKg),R=Math.max(.05,params.radiusM),c=SHAPE_INERTIA_COEFF[params.shape];
  const I=c*m*R*R,theta=params.scenario==='incline-race'?degToRad(params.inclineDeg):0;
  const u=state.v-R*state.omega,u0=params.scenario==='incline-race'?0:params.v0Mps-R*params.omega0Radps;
  const rolling=state.mode==='pure-rolling';
  const f=rolling?-c/(1+c)*m*CLASSROOM_GRAVITY*Math.sin(theta):-Math.sign(u)*Math.max(0,params.muK)*m*CLASSROOM_GRAVITY*Math.cos(theta);
  const vEnergy=.5*m*state.v*state.v,wEnergy=.5*I*state.omega*state.omega;
  const pEnergy=-m*CLASSROOM_GRAVITY*state.x*Math.sin(theta);
  // Analytic integral of |f*u|, independently of the kinetic energy subtraction.
  const heat=params.scenario==='incline-race'?0:Math.max(0,m*c/(2*(1+c))*(u0*u0-u*u));
  const predictedTime=Math.abs(u0)<=1e-9?0:params.muK>0?Math.abs(u0)/(Math.max(0,params.muK)*CLASSROOM_GRAVITY*(1+1/c)):null;
  return {m,R,c,I,theta,u,u0,f,vEnergy,wEnergy,pEnergy,heat,
    angularMomentum:m*R*state.v+I*state.omega,
    acceleration:CLASSROOM_GRAVITY*Math.sin(theta)+f/m,angularAcceleration:-R*f/I,
    requiredStaticMu:c/(1+c)*Math.tan(theta),predictedTime,predictedV:(params.v0Mps+c*R*params.omega0Radps)/(1+c)};
}

export function computeObservables(state: RigidRollingState, params: RigidRollingParams): Record<string, number> {
  const q=rollingQuantities(state,params);
  return {t:state.t,x:state.x,v:state.v,omegaR:state.omega*q.R,slipSpeed:q.u,
    currentEnergyJ:state.currentEnergyJ,translationalEnergyJ:q.vEnergy,rotationalEnergyJ:q.wEnergy,
    potentialEnergyJ:q.pEnergy,dissipatedEnergyJ:q.heat,frictionN:q.f,accelerationMps2:q.acceleration,
    angularMomentumContact:q.angularMomentum,requiredStaticMu:q.requiredStaticMu};
}

export function checkInvariants(state: RigidRollingState, initial: RigidRollingState, params: RigidRollingParams): InvariantReport[] {
  const q=rollingQuantities(state,params),q0=rollingQuantities(initial,params);
  const e=Math.abs(state.currentEnergyJ+q.heat-state.initialEnergyJ)/Math.max(1,Math.abs(state.initialEnergyJ),q.vEnergy+q.wEnergy);
  const checks:InvariantReport[]=[{name:'机械能 + 滑动耗散能闭合',measuredError:e,tolerance:1e-6,passed:e<1e-6}];
  if(state.mode==='pure-rolling'){
    const u=Math.abs(q.u);checks.push({name:'纯滚动后滑移残差 |v - ωR|',measuredError:u,tolerance:1e-6,passed:u<1e-6});
  }
  if(params.scenario==='flat-bowling-slip'){
    const err=Math.abs(q.angularMomentum-q0.angularMomentum)/Math.max(1,Math.abs(q0.angularMomentum));
    checks.push({name:'水平接触高度角动量守恒',measuredError:err,tolerance:1e-6,passed:err<1e-6});
  }
  return checks;
}
