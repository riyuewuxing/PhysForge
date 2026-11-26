import { bisectEvent, degToRad, radToDeg, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ShmMode = 'pendulum-compare' | 'damped-free' | 'forced-resonance';

export type ShmResonanceParams = {
  mode: ShmMode;
  lengthL: number;
  gravityG: number;
  massM: number;
  initialAngleDeg: number;
  dampingGamma: number;
  driveAccelAmp: number;
  driveOmega: number;
};

export interface ShmResonanceState {
  readonly t: number;
  readonly theta: number;
  readonly omega: number;
  readonly thetaLinear: number;
  readonly omegaLinear: number;
  readonly maxSteadyTheta: number;
  readonly measuredPeriod: number | null;
  readonly lastUpwardCrossT: number | null;
  readonly initialEnergy: number;
  readonly heatLostJ: number;
  readonly driveWorkJ: number;
  readonly events: readonly PhysicsEvent[];
}

export function computeNaturalOmega(params: ShmResonanceParams): number {
  return Math.sqrt(Math.max(0.1, params.gravityG) / Math.max(0.1, params.lengthL));
}

export function computeTheoreticalResonanceOmega(params: ShmResonanceParams): number {
  const w0Sq = computeNaturalOmega(params) ** 2;
  const gSq = params.dampingGamma * params.dampingGamma;
  return w0Sq > 2 * gSq ? Math.sqrt(w0Sq - 2 * gSq) : 0;
}

/** Mode-specific coefficients are shared by the integrator and the force diagram. */
export function effectiveDamping(params: ShmResonanceParams): number {
  return params.mode === 'pendulum-compare' ? 0 : Math.max(0, params.dampingGamma);
}

export function angularDriveAt(params: ShmResonanceParams, time: number): number {
  return params.mode === 'forced-resonance'
    ? params.driveAccelAmp * Math.cos(params.driveOmega * time)
    : 0;
}

/** Analytic linear particular-solution amplitude, not a nonlinear steady-state measurement.
 * A nonzero undamped resonant drive has no bounded periodic particular solution.
 */
export function computeLinearResponseAmplitude(params: ShmResonanceParams, frequency: number): number | null {
  if (params.driveAccelAmp === 0) return 0;
  const w0 = computeNaturalOmega(params);
  const gamma = effectiveDamping(params);
  const denominator = Math.hypot(w0*w0-frequency*frequency, 2*gamma*frequency);
  if (gamma === 0 && Math.abs(frequency-w0) <= 4*Number.EPSILON*w0) return null;
  return denominator > 0 ? Math.abs(params.driveAccelAmp)/denominator : null;
}

/** For conservative comparison only: phase point of the LINEAR reference oscillator. */
export function computeReferenceCircle(state: ShmResonanceState, params: ShmResonanceParams) {
  if (params.mode !== 'pendulum-compare') return null;
  const L = Math.max(0.1, params.lengthL);
  return {
    x: L*state.thetaLinear,
    y: -L*state.omegaLinear/computeNaturalOmega(params),
    radius: L*Math.abs(degToRad(params.initialAngleDeg))
  };
}

export function createInitialState(params: ShmResonanceParams): ShmResonanceState {
  const theta0 = degToRad(params.initialAngleDeg);
  const L = Math.max(0.1, params.lengthL);
  const m = Math.max(0.05, params.massM);
  const e0 = m * params.gravityG * L * (1 - Math.cos(theta0));
  return {
    t: 0,
    theta: theta0,
    omega: 0,
    thetaLinear: theta0,
    omegaLinear: 0,
    maxSteadyTheta: 0,
    measuredPeriod: null,
    lastUpwardCrossT: null,
    initialEnergy: e0,
    heatLostJ: 0,
    driveWorkJ: 0,
    events: []
  };
}

interface PendulumSubState {
  readonly t: number;
  readonly vec: readonly number[];
}

function advancePendulumSubstep(
  s: PendulumSubState,
  h: number,
  params: ShmResonanceParams
): PendulumSubState {
  const L = Math.max(0.1, params.lengthL);
  const gOverL = params.gravityG / L;
  const gamma = effectiveDamping(params);
  const inertia = Math.max(0.05, params.massM)*L*L;

  const nextVec = stepRK4(s.vec, s.t, h, (tau, y) => {
    const th = y[0]!;
    const om = y[1]!;
    const thLin = y[2]!;
    const omLin = y[3]!;
    const drive = angularDriveAt(params, tau);
    return [
      om,
      -gOverL * Math.sin(th) - 2 * gamma * om + drive,
      omLin,
      -gOverL * thLin - 2 * gamma * omLin + drive,
      2 * gamma * inertia * om * om,
      inertia * drive * om
    ];
  });
  return { t: s.t + h, vec: nextVec };
}

export function stepShmResonance(
  state: ShmResonanceState,
  params: ShmResonanceParams,
  dt: number
): StepResult<ShmResonanceState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const maxSub = 0.004;
  const nSub = Math.max(1, Math.ceil(dt / maxSub));
  const subH = dt / nSub;

  let cur: PendulumSubState = {
    t: state.t,
    vec: [state.theta, state.omega, state.thetaLinear, state.omegaLinear, state.heatLostJ, state.driveWorkJ]
  };
  let lastUpCross = state.lastUpwardCrossT;
  let measuredPeriod = state.measuredPeriod;
  let maxSteady = state.maxSteadyTheta;
  const events: PhysicsEvent[] = [];

  const advFn = (s: PendulumSubState, h: number) => advancePendulumSubstep(s, h, params);
  const thetaFn = (s: PendulumSubState) => s.vec[0]!;

  for (let i = 0; i < nSub; i++) {
    const prevTheta = cur.vec[0]!;
    const next = advFn(cur, subH);
    const nextTheta = next.vec[0]!;

    if (prevTheta < 0 && nextTheta >= 0 && next.vec[1]! > 0) {
      const hit = bisectEvent(cur, cur.t, subH, advFn, thetaFn, {
        timeTolerance: 1e-10,
        biasEndpoint: 'midpoint'
      });
      if (hit) {
        const tCross = hit.time;
        if (lastUpCross !== null && tCross - lastUpCross > 0.05) {
          measuredPeriod = tCross - lastUpCross;
          const ev: PhysicsEvent = {
            id: `period-${state.events.length + events.length}`,
            time: tCross,
            label: '相邻向上穿零间隔 (θ=0↑)',
            position: { x: 0, y: -params.lengthL },
            metrics: { measuredPeriod }
          };
          events.push(ev);
        }
        lastUpCross = tCross;
      }
    }

    cur = next;
    if (cur.t > 2) {
      maxSteady = Math.max(maxSteady, Math.abs(cur.vec[0]!));
    }
  }

  return {
    nextState: {
      ...state,
      t: cur.t,
      theta: cur.vec[0]!,
      omega: cur.vec[1]!,
      thetaLinear: cur.vec[2]!,
      omegaLinear: cur.vec[3]!,
      heatLostJ: cur.vec[4]!,
      driveWorkJ: cur.vec[5]!,
      maxSteadyTheta: maxSteady,
      measuredPeriod,
      lastUpwardCrossT: lastUpCross,
      events: events.length > 0 ? [...state.events, ...events] : state.events
    },
    events
  };
}

export function computeObservables(
  state: ShmResonanceState,
  params: ShmResonanceParams
): Record<string, number> {
  const L = Math.max(0.1, params.lengthL);
  const m = Math.max(0.05, params.massM);
  const ek = 0.5 * m * L * L * state.omega * state.omega;
  const ep = m * params.gravityG * L * (1 - Math.cos(state.theta));
  const tension = m * params.gravityG * Math.cos(state.theta) + m * L * state.omega * state.omega;
  const circle = computeReferenceCircle(state, params);
  const inertia = m*L*L;
  return {
    t: state.t,
    thetaRad: state.theta,
    thetaDeg: radToDeg(state.theta),
    omega: state.omega,
    thetaLinearRad: state.thetaLinear,
    thetaLinearDeg: radToDeg(state.thetaLinear),
    kineticEnergy: ek,
    potentialEnergy: ep,
    mechanicalEnergy: ek + ep,
    heatLostJ: state.heatLostJ,
    driveWorkJ: state.driveWorkJ,
    energyResidual: Math.abs(ek+ep+state.heatLostJ-state.driveWorkJ-state.initialEnergy),
    dissipationPowerW: 2*effectiveDamping(params)*inertia*state.omega**2,
    drivePowerW: inertia*angularDriveAt(params,state.t)*state.omega,
    tensionN: tension,
    ...(circle ? { referenceCircleX: circle.x, referenceCircleY: circle.y, referenceCircleRadius: circle.radius } : {}),
    measuredPeriod: state.measuredPeriod ?? 0,
    w0: computeNaturalOmega(params)
  };
}

export function checkInvariants(
  state: ShmResonanceState,
  _initial: ShmResonanceState,
  params: ShmResonanceParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  const conservative =
    params.mode === 'pendulum-compare' ||
    (params.mode === 'damped-free' && params.dampingGamma === 0);

  const scale = Math.max(1e-12, Math.abs(state.initialEnergy), Math.abs(obs.mechanicalEnergy!),
    state.heatLostJ, Math.abs(state.driveWorkJ));
  const relEnergyErr = obs.energyResidual! / scale;
  return [
    {
      name: conservative ? '非线性单摆机械能守恒' : '功—能平衡 E+Q−W=E₀',
      measuredError: relEnergyErr,
      tolerance: 1e-6,
      passed: Object.values(obs).every(Number.isFinite) && state.heatLostJ >= 0 && relEnergyErr < 1e-6
    }
  ];
}
