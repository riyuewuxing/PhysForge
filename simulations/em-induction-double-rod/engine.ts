import { bisectEvent, CLASSROOM_GRAVITY, degToRad, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type RodMode = 'double' | 'single';
export type CircuitLoadType = 'resistor' | 'capacitor' | 'battery';

export type InductionParams = {
  rodMode: RodMode;
  circuitLoad: CircuitLoadType;
  magneticB: number;
  railWidth: number;
  railWidth2?: number;
  inclineDeg?: number;
  mass1: number;
  mass2: number;
  resistorR: number;
  rodResistance1: number;
  rodResistance2: number;
  capacitance: number;
  batteryEmf: number;
  externalForce: number;
  frictionMu: number;
  v1Initial: number;
  v2Initial: number;
};

export interface InductionState {
  readonly t: number;
  readonly x1: number;
  readonly v1: number;
  readonly x2: number;
  readonly v2: number;
  readonly qCap: number;
  readonly qTotalIntegral: number;
  readonly current: number;
  readonly jouleHeat: number;
  readonly frictionHeat: number;
  readonly externalWork: number;
  readonly sourceWork: number;
  readonly ampereImpulse1: number;
  readonly rod1Stopped: boolean;
  readonly rod2Stopped: boolean;
  readonly events: readonly PhysicsEvent[];
}

export function getEffectiveL2(params: InductionParams): number {
  return params.railWidth2 && params.railWidth2 > 0 ? params.railWidth2 : params.railWidth;
}

function getRawTotalResistance(params: InductionParams): number {
  const r2 = params.rodMode === 'double' ? params.rodResistance2 : 0;
  return Math.max(0, params.resistorR + params.rodResistance1 + r2);
}

function isIdealZeroRCapacitor(params: InductionParams): boolean {
  return (
    params.rodMode === 'single' &&
    params.circuitLoad === 'capacitor' &&
    getRawTotalResistance(params) < 1e-6
  );
}

function getTotalResistance(params: InductionParams): number {
  return Math.max(getRawTotalResistance(params), 1e-4);
}

function computeCurrentFromState(
  v1: number,
  v2: number,
  qCap: number,
  params: InductionParams
): number {
  const BL1 = params.magneticB * params.railWidth;
  const BL2 = params.magneticB * getEffectiveL2(params);
  const Rtot = getTotalResistance(params);

  if (params.rodMode === 'double') {
    return (BL1 * v1 - BL2 * v2) / Rtot;
  }

  if (params.circuitLoad === 'capacitor') {
    if (isIdealZeroRCapacitor(params)) {
      const m1 = Math.max(params.mass1, 1e-6);
      const C = Math.max(params.capacitance, 1e-9);
      const th = degToRad(params.inclineDeg ?? 0);
      const a1 = (params.externalForce - m1 * CLASSROOM_GRAVITY * Math.sin(th)) / (m1 + C * BL1 * BL1);
      return C * BL1 * a1;
    }
    const C = Math.max(params.capacitance, 1e-6);
    return (BL1 * v1 - qCap / C) / Rtot;
  }
  if (params.circuitLoad === 'battery') {
    return (params.batteryEmf - BL1 * v1) / Rtot;
  }
  return (BL1 * v1) / Rtot;
}

function frictionForceForRod(
  v: number,
  drivingForce: number,
  mass: number,
  mu: number,
  cosTheta: number,
  stoppedLock: boolean
): number {
  if (mu <= 0) return 0;
  const fMax = mu * mass * CLASSROOM_GRAVITY * cosTheta;
  if (stoppedLock || Math.abs(v) < 1e-9) {
    if (Math.abs(drivingForce) <= fMax) {
      return -drivingForce;
    }
    return -Math.sign(drivingForce) * fMax;
  }
  return -Math.sign(v) * fMax;
}

export function createInitialState(params: InductionParams): InductionState {
  const C = Math.max(params.capacitance, 1e-9);
  const q0 = isIdealZeroRCapacitor(params)
    ? C * params.magneticB * params.railWidth * params.v1Initial
    : 0;
  const current = computeCurrentFromState(params.v1Initial, params.v2Initial, q0, params);
  return {
    t: 0,
    x1: params.rodMode === 'double' ? 1.5 : 1.0,
    v1: params.v1Initial,
    x2: 0.3,
    v2: params.rodMode === 'double' ? params.v2Initial : 0,
    qCap: q0,
    qTotalIntegral: 0,
    current,
    jouleHeat: 0,
    frictionHeat: 0,
    externalWork: 0,
    sourceWork: 0,
    ampereImpulse1: 0,
    rod1Stopped: false,
    rod2Stopped: params.rodMode === 'single',
    events: []
  };
}

function advanceContinuous(
  s: InductionState,
  params: InductionParams,
  dt: number
): InductionState {
  if (dt === 0) return s;
  const m1 = Math.max(params.mass1, 1e-6);
  const m2 = Math.max(params.mass2, 1e-6);
  const BL1 = params.magneticB * params.railWidth;
  const BL2 = params.magneticB * getEffectiveL2(params);
  const Rtot = getTotalResistance(params);
  const th = degToRad(params.inclineDeg ?? 0);
  const sinTh = Math.sin(th);
  const cosTh = Math.cos(th);

  // Ideal zero-resistance capacitor-rod analytical inertia mode: a = (F - m*g*sin(th) + fric) / (m + C*B^2*L^2)
  if (isIdealZeroRCapacitor(params)) {
    const C = Math.max(params.capacitance, 1e-9);
    const mEff = m1 + C * BL1 * BL1;
    const drive1 = params.externalForce - m1 * CLASSROOM_GRAVITY * sinTh;
    const fric1 = frictionForceForRod(s.v1, drive1, m1, params.frictionMu, cosTh, s.rod1Stopped);
    const a1 = s.rod1Stopped && fric1 === -drive1 ? 0 : (drive1 + fric1) / mEff;
    const nextV1 = s.rod1Stopped ? 0 : s.v1 + a1 * dt;
    const dx1 = 0.5 * (s.v1 + nextV1) * dt;
    const nextQ = C * BL1 * nextV1;
    const I = C * BL1 * a1;
    return {
      ...s,
      t: s.t + dt,
      x1: s.x1 + dx1,
      v1: nextV1,
      qCap: nextQ,
      qTotalIntegral: s.qTotalIntegral + I * dt,
      current: I,
      externalWork: s.externalWork + params.externalForce * dx1,
      frictionHeat: s.frictionHeat + Math.abs(fric1 * dx1)
    };
  }

  // vec = [x1, v1, x2, v2, qCap, jouleHeat, frictionHeat, externalWork, sourceWork, ampereImpulse1, qTotalIntegral]
  const y0 = [
    s.x1,
    s.v1,
    s.x2,
    s.v2,
    s.qCap,
    s.jouleHeat,
    s.frictionHeat,
    s.externalWork,
    s.sourceWork,
    s.ampereImpulse1,
    s.qTotalIntegral
  ];

  const deriv = (_t: number, y: readonly number[]): number[] => {
    const v1 = s.rod1Stopped ? 0 : y[1]!;
    const v2 = params.rodMode === 'single' || s.rod2Stopped ? 0 : y[3]!;
    const qCap = y[4]!;

    const I = computeCurrentFromState(v1, v2, qCap, params);
    const fAmp1 = BL1 * I;
    const fAmp2 = BL2 * I;

    const netElectroForce1 =
      params.rodMode === 'single' && params.circuitLoad === 'battery' ? fAmp1 : -fAmp1;
    const drive1 = params.externalForce - m1 * CLASSROOM_GRAVITY * sinTh + netElectroForce1;
    const fric1 = frictionForceForRod(s.v1, drive1, m1, params.frictionMu, cosTh, s.rod1Stopped);
    const a1 = s.rod1Stopped && fric1 === -drive1 ? 0 : (drive1 + fric1) / m1;

    let a2 = 0;
    let fric2 = 0;
    if (params.rodMode === 'double') {
      const drive2 = fAmp2 - m2 * CLASSROOM_GRAVITY * sinTh;
      fric2 = frictionForceForRod(s.v2, drive2, m2, params.frictionMu, cosTh, s.rod2Stopped);
      a2 = s.rod2Stopped && fric2 === -drive2 ? 0 : (drive2 + fric2) / m2;
    }

    const dq = params.rodMode === 'single' && params.circuitLoad === 'capacitor' ? I : 0;
    const pJoule = I * I * Rtot;
    const pFric = Math.abs(fric1 * v1) + Math.abs(fric2 * v2);
    const pExt = params.externalForce * v1;
    const pSrc =
      params.rodMode === 'single' && params.circuitLoad === 'battery' ? params.batteryEmf * I : 0;

    return [v1, a1, v2, a2, dq, pJoule, pFric, pExt, pSrc, netElectroForce1, I];
  };

  const y1 = stepRK4(y0, s.t, dt, deriv);
  const nextV1 = s.rod1Stopped ? 0 : y1[1]!;
  const nextV2 = params.rodMode === 'single' || s.rod2Stopped ? 0 : y1[3]!;
  const nextQ = y1[4]!;
  const nextI = computeCurrentFromState(nextV1, nextV2, nextQ, params);

  return {
    ...s,
    t: s.t + dt,
    x1: y1[0]!,
    v1: nextV1,
    x2: y1[2]!,
    v2: nextV2,
    qCap: nextQ,
    current: nextI,
    jouleHeat: y1[5]!,
    frictionHeat: y1[6]!,
    externalWork: y1[7]!,
    sourceWork: y1[8]!,
    ampereImpulse1: y1[9]!,
    qTotalIntegral: y1[10]!
  };
}

export function stepInduction(
  state: InductionState,
  params: InductionParams,
  dt: number
): StepResult<InductionState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  let cur = state;
  const events: PhysicsEvent[] = [];
  const cosTh = Math.cos(degToRad(params.inclineDeg ?? 0));
  const sinTh = Math.sin(degToRad(params.inclineDeg ?? 0));

  if (params.frictionMu > 0 && !cur.rod1Stopped && Math.abs(cur.v1) > 1e-9) {
    const stopEv = bisectEvent(
      cur,
      cur.t,
      dt,
      (s, sub) => advanceContinuous(s, params, sub),
      (s) => s.v1,
      { timeTolerance: 1e-8 }
    );

    if (stopEv) {
      const m1 = Math.max(params.mass1, 1e-6);
      const driveAtStop =
        params.externalForce -
        m1 * CLASSROOM_GRAVITY * sinTh -
        (params.rodMode === 'single' && params.circuitLoad === 'battery'
          ? -params.magneticB * params.railWidth * stopEv.state.current
          : params.magneticB * params.railWidth * stopEv.state.current);
      const fMax = params.frictionMu * m1 * CLASSROOM_GRAVITY * cosTh;
      const shouldLock = Math.abs(driveAtStop) <= fMax;

      cur = {
        ...stopEv.state,
        v1: 0,
        rod1Stopped: shouldLock
      };
      events.push({
        id: `rod1-stop-${stopEv.time.toFixed(5)}`,
        time: stopEv.time,
        label: '杆 1 速度归零',
        position: { x: cur.x1, y: 0 }
      });

      const rem = dt - stopEv.timeOffset;
      if (rem > 1e-12) {
        cur = advanceContinuous(cur, params, rem);
      }
      return {
        nextState: { ...cur, events: [...state.events, ...events] },
        events
      };
    }
  }

  if (cur.rod1Stopped && params.frictionMu > 0) {
    const m1 = Math.max(params.mass1, 1e-6);
    const fMax = params.frictionMu * m1 * CLASSROOM_GRAVITY * cosTh;
    const I = computeCurrentFromState(0, cur.v2, cur.qCap, params);
    const netElectro =
      params.rodMode === 'single' && params.circuitLoad === 'battery'
        ? params.magneticB * params.railWidth * I
        : -params.magneticB * params.railWidth * I;
    if (Math.abs(params.externalForce - m1 * CLASSROOM_GRAVITY * sinTh + netElectro) > fMax) {
      cur = { ...cur, rod1Stopped: false };
    }
  }

  cur = advanceContinuous(cur, params, dt);
  return {
    nextState: { ...cur, events: [...state.events, ...events] },
    events
  };
}

export function computeObservables(
  state: InductionState,
  params: InductionParams
): Record<string, number> {
  const m1 = Math.max(params.mass1, 1e-6);
  const m2 = Math.max(params.mass2, 1e-6);
  const L1 = params.railWidth;
  const L2 = getEffectiveL2(params);
  const sinTh = Math.sin(degToRad(params.inclineDeg ?? 0));

  const ke1 = 0.5 * m1 * state.v1 * state.v1;
  const ke2 = params.rodMode === 'double' ? 0.5 * m2 * state.v2 * state.v2 : 0;
  const keTotal = ke1 + ke2;
  const capEnergy =
    params.rodMode === 'single' && params.circuitLoad === 'capacitor'
      ? (state.qCap * state.qCap) / (2 * Math.max(params.capacitance, 1e-9))
      : 0;
  const gravPe =
    (m1 * state.x1 + (params.rodMode === 'double' ? m2 * state.x2 : 0)) *
    CLASSROOM_GRAVITY *
    sinTh;

  const momentumTotal = m1 * state.v1 + (params.rodMode === 'double' ? m2 * state.v2 : 0);
  const generalizedMomentum =
    m1 * L2 * state.v1 + (params.rodMode === 'double' ? m2 * L1 * state.v2 : 0);

  return {
    v1: state.v1,
    v2: state.v2,
    current: state.current,
    qTotalIntegral: state.qTotalIntegral,
    jouleHeat: state.jouleHeat,
    kineticEnergy: keTotal,
    capacitorEnergy: capEnergy,
    frictionHeat: state.frictionHeat,
    gravPe,
    totalEnergyAccounted: keTotal + capEnergy + gravPe + state.jouleHeat + state.frictionHeat,
    externalWork: state.externalWork,
    sourceWork: state.sourceWork,
    momentumTotal,
    generalizedMomentum,
    qCap: state.qCap
  };
}

export function checkInvariants(
  state: InductionState,
  initial: InductionState,
  params: InductionParams
): InvariantReport[] {
  const obs0 = computeObservables(initial, params);
  const obs1 = computeObservables(state, params);

  const e0 = obs0.kineticEnergy! + obs0.capacitorEnergy! + obs0.gravPe!;
  const eNow = obs1.totalEnergyAccounted!;
  const eExpected = e0 + state.externalWork + state.sourceWork;
  const energyErr = Math.abs(eNow - eExpected) / Math.max(Math.abs(eExpected), Math.abs(e0), 1e-9);

  const reports: InvariantReport[] = [
    {
      name: '全系统能量守恒 (ΔEk + Ec + Ep + Q = W外 + W源)',
      measuredError: energyErr,
      tolerance: 1e-4,
      passed: energyErr < 1e-4
    }
  ];

  if (
    params.rodMode === 'double' &&
    params.externalForce === 0 &&
    params.frictionMu === 0 &&
    (params.inclineDeg ?? 0) === 0
  ) {
    const gm0 = obs0.generalizedMomentum!;
    const gm1 = obs1.generalizedMomentum!;
    const momErr = Math.abs(gm1 - gm0) / Math.max(Math.abs(gm0), 1e-9);
    reports.push({
      name: '双杆系统广义动量守恒 (m1*L2*v1 + m2*L1*v2)',
      measuredError: momErr,
      tolerance: 1e-6,
      passed: momErr < 1e-6
    });
  }

  return reports;
}
