import { bisectEvent, CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ConveyorSystemMode = 'conveyor' | 'plank';

export type BlockConveyorParams = {
  systemMode: ConveyorSystemMode;
  massBlock: number;
  massPlank: number;
  muBlockCarrier: number;
  muGround: number;
  inclineDeg: number;
  beltVelocity: number;
  blockInitialV: number;
  plankInitialV: number;
  externalForcePlank: number;
};

export interface BlockConveyorState {
  readonly t: number;
  readonly xBlock: number;
  readonly vBlock: number;
  readonly xCarrier: number;
  readonly vCarrier: number;
  readonly relativeScratch: number;
  readonly frictionHeat: number;
  readonly groundHeat: number;
  readonly carrierWork: number; // 传送带驱动力或外力做功
  readonly coMovingLocked: boolean;
  readonly plankStopped: boolean;
  readonly events: readonly PhysicsEvent[];
}

export function createInitialState(params: BlockConveyorParams): BlockConveyorState {
  const vCarrier0 = params.systemMode === 'conveyor' ? params.beltVelocity : params.plankInitialV;
  const isAlreadyCoMoving = Math.abs(params.blockInitialV - vCarrier0) < 1e-9;

  let locked = false;
  if (isAlreadyCoMoving) {
    if (params.systemMode === 'conveyor') {
      const theta = degToRad(params.inclineDeg);
      const maxStatic = params.muBlockCarrier * Math.cos(theta);
      locked = Math.sin(theta) <= maxStatic + 1e-12;
    } else {
      locked = true;
    }
  }

  return {
    t: 0,
    xBlock: 0,
    vBlock: params.blockInitialV,
    xCarrier: 0,
    vCarrier: vCarrier0,
    relativeScratch: 0,
    frictionHeat: 0,
    groundHeat: 0,
    carrierWork: 0,
    coMovingLocked: locked,
    plankStopped: false,
    events: []
  };
}

function advanceConveyorSegment(
  s: BlockConveyorState,
  params: BlockConveyorParams,
  dt: number
): BlockConveyorState {
  if (dt === 0) return s;
  const m = Math.max(params.massBlock, 1e-6);
  const g = CLASSROOM_GRAVITY;
  const theta = degToRad(params.inclineDeg);
  const gParallel = m * g * Math.sin(theta);
  const fk = params.muBlockCarrier * m * g * Math.cos(theta);
  const vBelt = params.beltVelocity;

  if (s.coMovingLocked) {
    // 静摩擦平衡重力沿斜面向下分力: f_static = +gParallel 沿斜面向上
    const fStatic = gParallel;
    const dx = vBelt * dt;
    // 传送带维持匀速克服物块对皮带反作用力做功
    const work = fStatic * vBelt * dt;
    return {
      ...s,
      t: s.t + dt,
      xBlock: s.xBlock + dx,
      vBlock: vBelt,
      xCarrier: s.xCarrier + dx,
      vCarrier: vBelt,
      carrierWork: s.carrierWork + work
    };
  }

  const vRel0 = s.vBlock - vBelt;
  // 若初始恰好共速但不能锁定（tan(theta) > mu），重力下滑占优，相对速度立即趋向负方向 -> 摩擦沿斜面向上 (+fk)
  const fricOnBlock =
    Math.abs(vRel0) < 1e-12
      ? fk
      : vRel0 > 0
        ? -fk
        : fk;

  const acc = (fricOnBlock - gParallel) / m;
  const nextV = s.vBlock + acc * dt;
  const dxBlock = s.vBlock * dt + 0.5 * acc * dt * dt;
  const dxBelt = vBelt * dt;
  const dScratch = Math.abs(dxBlock - dxBelt);
  const dHeat = fk * dScratch;
  const dWork = fricOnBlock * vBelt * dt;

  return {
    ...s,
    t: s.t + dt,
    xBlock: s.xBlock + dxBlock,
    vBlock: nextV,
    xCarrier: s.xCarrier + dxBelt,
    vCarrier: vBelt,
    relativeScratch: s.relativeScratch + dScratch,
    frictionHeat: s.frictionHeat + dHeat,
    carrierWork: s.carrierWork + dWork
  };
}

function advancePlankSegment(
  s: BlockConveyorState,
  params: BlockConveyorParams,
  dt: number
): BlockConveyorState {
  if (dt === 0) return s;
  const m1 = Math.max(params.massBlock, 1e-6);
  const m2 = Math.max(params.massPlank, 1e-6);
  const g = CLASSROOM_GRAVITY;
  const f1Max = params.muBlockCarrier * m1 * g;
  const f2Max = params.muGround * (m1 + m2) * g;

  if (s.coMovingLocked) {
    const v = s.vCarrier;
    const fGround =
      Math.abs(v) < 1e-9
        ? Math.abs(params.externalForcePlank) <= f2Max
          ? -params.externalForcePlank
          : -Math.sign(params.externalForcePlank) * f2Max
        : -Math.sign(v) * f2Max;
    const aCommon = (params.externalForcePlank + fGround) / (m1 + m2);
    // 检查是否突破块间最大静摩擦
    const requiredF1 = m1 * Math.abs(aCommon);
    if (requiredF1 <= f1Max + 1e-9) {
      const nextV =
        Math.abs(v) < 1e-9 && Math.abs(params.externalForcePlank) <= f2Max
          ? 0
          : v + aCommon * dt;
      const dx = 0.5 * (v + nextV) * dt;
      const dGroundHeat = Math.abs(fGround * dx);
      const dExtWork = params.externalForcePlank * dx;
      return {
        ...s,
        t: s.t + dt,
        xBlock: s.xBlock + dx,
        vBlock: nextV,
        xCarrier: s.xCarrier + dx,
        vCarrier: nextV,
        groundHeat: s.groundHeat + dGroundHeat,
        carrierWork: s.carrierWork + dExtWork
      };
    }
  }

  const vRel = s.vBlock - s.vCarrier;
  const f1OnBlock =
    Math.abs(vRel) < 1e-12
      ? Math.sign(params.externalForcePlank) * f1Max
      : vRel > 0
        ? -f1Max
        : f1Max;
  const a1 = f1OnBlock / m1;

  const netDrive2 = params.externalForcePlank - f1OnBlock;
  const fGround =
    Math.abs(s.vCarrier) < 1e-9
      ? Math.abs(netDrive2) <= f2Max
        ? -netDrive2
        : -Math.sign(netDrive2) * f2Max
      : -Math.sign(s.vCarrier) * f2Max;
  const a2 = (netDrive2 + fGround) / m2;

  const nextV1 = s.vBlock + a1 * dt;
  const nextV2 = s.vCarrier + a2 * dt;
  const dx1 = 0.5 * (s.vBlock + nextV1) * dt;
  const dx2 = 0.5 * (s.vCarrier + nextV2) * dt;
  const dScratch = Math.abs(dx1 - dx2);
  const dHeat = f1Max * dScratch;
  const dGroundHeat = Math.abs(fGround * dx2);
  const dExtWork = params.externalForcePlank * dx2;

  return {
    ...s,
    t: s.t + dt,
    xBlock: s.xBlock + dx1,
    vBlock: nextV1,
    xCarrier: s.xCarrier + dx2,
    vCarrier: nextV2,
    relativeScratch: s.relativeScratch + dScratch,
    frictionHeat: s.frictionHeat + dHeat,
    groundHeat: s.groundHeat + dGroundHeat,
    carrierWork: s.carrierWork + dExtWork
  };
}

export function stepBlockConveyor(
  state: BlockConveyorState,
  params: BlockConveyorParams,
  dt: number
): StepResult<BlockConveyorState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  let cur = state;
  let remaining = dt;
  const events: PhysicsEvent[] = [];

  if (params.systemMode === 'conveyor') {
    if (!cur.coMovingLocked && Math.abs(cur.vBlock - params.beltVelocity) > 1e-10) {
      const ev = bisectEvent(
        cur,
        cur.t,
        remaining,
        (s, sub) => advanceConveyorSegment(s, params, sub),
        (s) => s.vBlock - params.beltVelocity,
        { timeTolerance: 1e-8 }
      );
      if (ev) {
        const theta = degToRad(params.inclineDeg);
        const canLock = Math.sin(theta) <= params.muBlockCarrier * Math.cos(theta) + 1e-12;
        cur = {
          ...ev.state,
          vBlock: params.beltVelocity,
          coMovingLocked: canLock
        };
        events.push({
          id: `comove-${ev.time.toFixed(6)}`,
          time: ev.time,
          label: canLock ? '与传送带共速锁定' : '共速瞬间摩擦力方向突变',
          position: { x: cur.xBlock, y: 0 },
          metrics: {
            relativeScratch: cur.relativeScratch,
            frictionHeat: cur.frictionHeat
          }
        });
        remaining -= ev.timeOffset;
      }
    }

    if (remaining > 1e-12) {
      cur = advanceConveyorSegment(cur, params, remaining);
    }
  } else {
    // plank 模式：捕获块板共速瞬间
    if (!cur.coMovingLocked && Math.abs(cur.vBlock - cur.vCarrier) > 1e-10) {
      const ev = bisectEvent(
        cur,
        cur.t,
        remaining,
        (s, sub) => advancePlankSegment(s, params, sub),
        (s) => s.vBlock - s.vCarrier,
        { timeTolerance: 1e-8 }
      );
      if (ev) {
        const m1 = Math.max(params.massBlock, 1e-6);
        const m2 = Math.max(params.massPlank, 1e-6);
        const f1Max = params.muBlockCarrier * m1 * CLASSROOM_GRAVITY;
        const f2Max = params.muGround * (m1 + m2) * CLASSROOM_GRAVITY;
        const vCommon = ev.state.vCarrier;
        const fGround = Math.abs(vCommon) < 1e-9 ? 0 : -Math.sign(vCommon) * f2Max;
        const aCommon = (params.externalForcePlank + fGround) / (m1 + m2);
        const canLock = m1 * Math.abs(aCommon) <= f1Max + 1e-9;

        cur = {
          ...ev.state,
          vBlock: vCommon,
          vCarrier: vCommon,
          coMovingLocked: canLock
        };
        events.push({
          id: `plank-comove-${ev.time.toFixed(6)}`,
          time: ev.time,
          label: '物块与木板达到共速',
          position: { x: cur.xBlock, y: 0 },
          metrics: { relativeScratch: cur.relativeScratch, vCommon }
        });
        remaining -= ev.timeOffset;
      }
    }

    if (remaining > 1e-12) {
      cur = advancePlankSegment(cur, params, remaining);
    }
  }

  return {
    nextState: { ...cur, events: [...state.events, ...events] },
    events
  };
}

export function computeObservables(
  state: BlockConveyorState,
  params: BlockConveyorParams
): Record<string, number> {
  const m1 = Math.max(params.massBlock, 1e-6);
  const m2 = Math.max(params.massPlank, 1e-6);
  const g = CLASSROOM_GRAVITY;
  const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;

  const keBlock = 0.5 * m1 * state.vBlock * state.vBlock;
  const kePlank = params.systemMode === 'plank' ? 0.5 * m2 * state.vCarrier * state.vCarrier : 0;
  const peBlock = m1 * g * state.xBlock * Math.sin(theta);

  return {
    vBlock: state.vBlock,
    vCarrier: state.vCarrier,
    xBlock: state.xBlock,
    xCarrier: state.xCarrier,
    relativeScratch: state.relativeScratch,
    frictionHeat: state.frictionHeat,
    groundHeat: state.groundHeat,
    kineticEnergy: keBlock + kePlank,
    potentialEnergy: peBlock,
    carrierWork: state.carrierWork
  };
}

export function checkInvariants(
  state: BlockConveyorState,
  initial: BlockConveyorState,
  params: BlockConveyorParams
): InvariantReport[] {
  const obs0 = computeObservables(initial, params);
  const obs1 = computeObservables(state, params);

  const e0 = obs0.kineticEnergy! + obs0.potentialEnergy!;
  const e1 =
    obs1.kineticEnergy! + obs1.potentialEnergy! + state.frictionHeat + state.groundHeat;
  const expected = e0 + state.carrierWork;
  const relErr = Math.abs(e1 - expected) / Math.max(Math.abs(expected), Math.abs(e0), 1e-9);

  const reports: InvariantReport[] = [
    {
      name: '系统功能关系守恒 (ΔEk + ΔEp + Q = W外/带)',
      measuredError: relErr,
      tolerance: 1e-4,
      passed: relErr < 1e-4
    }
  ];

  if (
    params.systemMode === 'plank' &&
    params.muGround === 0 &&
    params.externalForcePlank === 0
  ) {
    const m1 = Math.max(params.massBlock, 1e-6);
    const m2 = Math.max(params.massPlank, 1e-6);
    const p0 = m1 * initial.vBlock + m2 * initial.vCarrier;
    const p1 = m1 * state.vBlock + m2 * state.vCarrier;
    const pErr = Math.abs(p1 - p0) / Math.max(Math.abs(p0), 1e-9);
    reports.push({
      name: '光滑地面板块动量守恒',
      measuredError: pErr,
      tolerance: 1e-8,
      passed: pErr < 1e-8
    });
  }

  return reports;
}
