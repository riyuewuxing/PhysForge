import { bisectEvent, CLASSROOM_GRAVITY, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type RodMode = 'double' | 'single';
export type CircuitLoadType = 'resistor' | 'capacitor' | 'battery';

export type InductionParams = {
  rodMode: RodMode;
  circuitLoad: CircuitLoadType;
  magneticB: number;
  railWidth: number;
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

function getTotalResistance(params: InductionParams): number {
  const r2 = params.rodMode === 'double' ? params.rodResistance2 : 0;
  return Math.max(params.resistorR + params.rodResistance1 + r2, 1e-4);
}

function computeCurrentFromState(
  v1: number,
  v2: number,
  qCap: number,
  params: InductionParams
): number {
  const BL = params.magneticB * params.railWidth;
  const Rtot = getTotalResistance(params);

  if (params.rodMode === 'double') {
    // 双杆简化为回路串联总电阻
    return (BL * (v1 - v2)) / Rtot;
  }

  // 单杆（杆2固定 v2 = 0）
  if (params.circuitLoad === 'capacitor') {
    const C = Math.max(params.capacitance, 1e-6);
    return (BL * v1 - qCap / C) / Rtot;
  }
  if (params.circuitLoad === 'battery') {
    return (params.batteryEmf - BL * v1) / Rtot;
  }
  return (BL * v1) / Rtot;
}

function frictionForceForRod(
  v: number,
  drivingForce: number,
  mass: number,
  mu: number,
  stoppedLock: boolean
): number {
  if (mu <= 0) return 0;
  const fMax = mu * mass * CLASSROOM_GRAVITY;
  if (stoppedLock || Math.abs(v) < 1e-9) {
    if (Math.abs(drivingForce) <= fMax) {
      return -drivingForce; // 静摩擦恰好抵消驱动力
    }
    return -Math.sign(drivingForce) * fMax;
  }
  return -Math.sign(v) * fMax;
}

export function createInitialState(params: InductionParams): InductionState {
  const current = computeCurrentFromState(params.v1Initial, params.v2Initial, 0, params);
  return {
    t: 0,
    x1: params.rodMode === 'double' ? 1.5 : 1.0,
    v1: params.v1Initial,
    x2: 0.3,
    v2: params.rodMode === 'double' ? params.v2Initial : 0,
    qCap: 0,
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
  const BL = params.magneticB * params.railWidth;
  const Rtot = getTotalResistance(params);

  // vec = [x1, v1, x2, v2, qCap, jouleHeat, frictionHeat, externalWork, sourceWork, ampereImpulse1]
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
    s.ampereImpulse1
  ];

  const deriv = (_t: number, y: readonly number[]): number[] => {
    const v1 = s.rod1Stopped ? 0 : y[1]!;
    const v2 = params.rodMode === 'single' || s.rod2Stopped ? 0 : y[3]!;
    const qCap = y[4]!;

    const I = computeCurrentFromState(v1, v2, qCap, params);
    const fAmp = BL * I;

    // 单杆电池模式下正电流 I 给杆提供向 +x 驱动安培力
    const netElectroForce1 =
      params.rodMode === 'single' && params.circuitLoad === 'battery' ? fAmp : -fAmp;
    const drive1 = params.externalForce + netElectroForce1;
    // 在同一连续分支内部保持初速度滑动方向，避免在 RK4 子步穿越零点时发生符号抖振
    const fric1 = frictionForceForRod(s.v1, drive1, m1, params.frictionMu, s.rod1Stopped);
    const a1 = s.rod1Stopped && fric1 === -drive1 ? 0 : (drive1 + fric1) / m1;

    let a2 = 0;
    let fric2 = 0;
    if (params.rodMode === 'double') {
      const drive2 = fAmp;
      fric2 = frictionForceForRod(s.v2, drive2, m2, params.frictionMu, s.rod2Stopped);
      a2 = s.rod2Stopped && fric2 === -drive2 ? 0 : (drive2 + fric2) / m2;
    }

    const dq = params.rodMode === 'single' && params.circuitLoad === 'capacitor' ? I : 0;
    const pJoule = I * I * Rtot;
    const pFric = Math.abs(fric1 * v1) + Math.abs(fric2 * v2);
    const pExt = params.externalForce * v1;
    const pSrc =
      params.rodMode === 'single' && params.circuitLoad === 'battery' ? params.batteryEmf * I : 0;

    return [v1, a1, v2, a2, dq, pJoule, pFric, pExt, pSrc, netElectroForce1];
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
    ampereImpulse1: y1[9]!
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

  // 若存在摩擦且杆1正运动，检测是否在本步内减速至 v1 = 0（静摩擦切换点）
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
        (params.rodMode === 'single' && params.circuitLoad === 'battery'
          ? -params.magneticB * params.railWidth * stopEv.state.current
          : params.magneticB * params.railWidth * stopEv.state.current);
      const fMax = params.frictionMu * m1 * CLASSROOM_GRAVITY;
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

  // 若先前锁止，检查驱动力是否突破最大静摩擦
  if (cur.rod1Stopped && params.frictionMu > 0) {
    const fMax = params.frictionMu * Math.max(params.mass1, 1e-6) * CLASSROOM_GRAVITY;
    const I = computeCurrentFromState(0, cur.v2, cur.qCap, params);
    const netElectro =
      params.rodMode === 'single' && params.circuitLoad === 'battery'
        ? params.magneticB * params.railWidth * I
        : -params.magneticB * params.railWidth * I;
    if (Math.abs(params.externalForce + netElectro) > fMax) {
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
  const ke1 = 0.5 * m1 * state.v1 * state.v1;
  const ke2 = params.rodMode === 'double' ? 0.5 * m2 * state.v2 * state.v2 : 0;
  const keTotal = ke1 + ke2;
  const capEnergy =
    params.rodMode === 'single' && params.circuitLoad === 'capacitor'
      ? (state.qCap * state.qCap) / (2 * Math.max(params.capacitance, 1e-6))
      : 0;
  const momentumTotal = m1 * state.v1 + (params.rodMode === 'double' ? m2 * state.v2 : 0);

  return {
    v1: state.v1,
    v2: state.v2,
    current: state.current,
    jouleHeat: state.jouleHeat,
    kineticEnergy: keTotal,
    capacitorEnergy: capEnergy,
    frictionHeat: state.frictionHeat,
    totalEnergyAccounted: keTotal + capEnergy + state.jouleHeat + state.frictionHeat,
    externalWork: state.externalWork,
    sourceWork: state.sourceWork,
    momentumTotal,
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

  const e0 = obs0.kineticEnergy! + obs0.capacitorEnergy!;
  const eNow = obs1.totalEnergyAccounted!;
  const eExpected = e0 + state.externalWork + state.sourceWork;
  const energyErr = Math.abs(eNow - eExpected) / Math.max(Math.abs(eExpected), Math.abs(e0), 1e-9);

  const reports: InvariantReport[] = [
    {
      name: '全系统能量守恒 (ΔEk + Ec + Q = W外 + W源)',
      measuredError: energyErr,
      tolerance: 1e-4,
      passed: energyErr < 1e-4
    }
  ];

  if (params.rodMode === 'double' && params.externalForce === 0 && params.frictionMu === 0) {
    const p0 = obs0.momentumTotal!;
    const p1 = obs1.momentumTotal!;
    const momErr = Math.abs(p1 - p0) / Math.max(Math.abs(p0), 1e-9);
    reports.push({
      name: '双杆系统动量守恒 (m1v1 + m2v2)',
      measuredError: momErr,
      tolerance: 1e-6,
      passed: momErr < 1e-6
    });
  }

  return reports;
}
