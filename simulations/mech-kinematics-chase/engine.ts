import { bisectEvent } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ChaseScenario = 'accelerate-chase' | 'brake-collision-avoid' | 'two-stage-overtake';

export type KinematicsChaseParams = {
  scenario: ChaseScenario;
  vA0: number;
  aA: number;
  reactionTime: number;
  xB0: number;
  vB0: number;
  aB: number;
};

export interface KinematicsChaseState {
  readonly t: number;
  readonly xA: number;
  readonly vA: number;
  readonly aACurrent: number;
  readonly aLockedZero: boolean;
  readonly xB: number;
  readonly vB: number;
  readonly aBCurrent: number;
  readonly bLockedZero: boolean;
  readonly minGap: number;
  readonly events: readonly PhysicsEvent[];
}

export function createInitialState(params: KinematicsChaseParams): KinematicsChaseState {
  const aACurrent = params.reactionTime > 0 ? 0 : params.aA;
  return {
    t: 0,
    xA: 0,
    vA: params.vA0,
    aACurrent,
    aLockedZero: params.vA0 <= 0 && params.aA < 0,
    xB: params.xB0,
    vB: params.vB0,
    aBCurrent: params.aB,
    bLockedZero: params.vB0 <= 0 && params.aB < 0,
    minGap: Math.abs(params.xB0),
    events: []
  };
}

function advanceContinuousSegment(
  s: KinematicsChaseState,
  params: KinematicsChaseParams,
  dt: number
): KinematicsChaseState {
  if (dt <= 0) return s;
  const effAA =
    s.t + 0.5 * dt < params.reactionTime
      ? 0
      : s.aLockedZero
        ? 0
        : params.aA;
  const effAB = s.bLockedZero ? 0 : params.aB;

  const nextVA = s.aLockedZero ? 0 : s.vA + effAA * dt;
  const nextVB = s.bLockedZero ? 0 : s.vB + effAB * dt;
  const nextXA = s.xA + 0.5 * (s.vA + nextVA) * dt;
  const nextXB = s.xB + 0.5 * (s.vB + nextVB) * dt;

  return {
    ...s,
    t: s.t + dt,
    xA: nextXA,
    vA: nextVA,
    aACurrent: effAA,
    xB: nextXB,
    vB: nextVB,
    aBCurrent: effAB,
    minGap: Math.min(s.minGap, Math.abs(nextXB - nextXA))
  };
}

/**
 * 追及相遇单步推进：严格处理反应时间边界、单向刹车零速锁止、共速与相遇 bisectEvent 精确定位
 */
export function stepKinematicsChase(
  state: KinematicsChaseState,
  params: KinematicsChaseParams,
  dt: number
): StepResult<KinematicsChaseState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) return { nextState: state, events: [] };

  let cur = state;
  let remaining = dt;
  const stepEvents: PhysicsEvent[] = [];

  // 若跨过反应时间节点，先精准切分反应阶段与制动/加速阶段
  if (params.reactionTime > 0 && cur.t < params.reactionTime && cur.t + remaining > params.reactionTime) {
    const preDt = params.reactionTime - cur.t;
    cur = advanceContinuousSegment(cur, params, preDt);
    remaining -= preDt;
  }

  for (let seg = 0; seg < 4 && remaining > 1e-12; seg++) {
    const endCand = advanceContinuousSegment(cur, params, remaining);
    const advFn = (s: KinematicsChaseState, subDt: number) =>
      advanceContinuousSegment(s, params, subDt);

    const guards: {
      id: string;
      label: string;
      res: NonNullable<ReturnType<typeof bisectEvent<KinematicsChaseState>>>;
    }[] = [];

    if (!cur.aLockedZero && cur.vA > 0 && params.aA < 0 && cur.t >= params.reactionTime - 1e-12 && endCand.vA <= 0) {
      const r = bisectEvent(cur, cur.t, remaining, advFn, (s) => s.vA, {
        timeTolerance: 1e-8,
        biasEndpoint: 'midpoint'
      });
      if (r) guards.push({ id: 'stop-a', label: 'A车刹停锁止 (vA=0)', res: r });
    }
    if (!cur.bLockedZero && cur.vB > 0 && params.aB < 0 && endCand.vB <= 0) {
      const r = bisectEvent(cur, cur.t, remaining, advFn, (s) => s.vB, {
        timeTolerance: 1e-8,
        biasEndpoint: 'midpoint'
      });
      if (r) guards.push({ id: 'stop-b', label: 'B车刹停锁止 (vB=0)', res: r });
    }
    if ((cur.vA - cur.vB) * (endCand.vA - endCand.vB) < 0) {
      const r = bisectEvent(cur, cur.t, remaining, advFn, (s) => s.vA - s.vB, {
        timeTolerance: 1e-8,
        biasEndpoint: 'midpoint'
      });
      if (r) guards.push({ id: 'co-vel', label: 'A、B 共速临界 (Δx极值)', res: r });
    }
    if ((cur.xA - cur.xB) * (endCand.xA - endCand.xB) < 0) {
      const r = bisectEvent(cur, cur.t, remaining, advFn, (s) => s.xA - s.xB, {
        timeTolerance: 1e-8,
        biasEndpoint: 'midpoint'
      });
      if (r) guards.push({ id: 'meet', label: 'A 追上 B（xA=xB）', res: r });
    }

    if (guards.length === 0) {
      cur = endCand;
      break;
    }

    guards.sort((a, b) => a.res.timeOffset - b.res.timeOffset);
    const earliest = guards[0]!;
    let boundary = earliest.res.state;
    if (earliest.id === 'stop-a') {
      boundary = { ...boundary, vA: 0, aACurrent: 0, aLockedZero: true };
    } else if (earliest.id === 'stop-b') {
      boundary = { ...boundary, vB: 0, aBCurrent: 0, aLockedZero: boundary.aLockedZero, bLockedZero: true };
    }

    stepEvents.push({
      id: `${earliest.id}-${earliest.res.time.toFixed(6)}`,
      time: earliest.res.time,
      label: earliest.label,
      position: { x: boundary.xA, y: 0 },
      metrics: { deltaX: boundary.xB - boundary.xA, vA: boundary.vA, vB: boundary.vB }
    });

    cur = boundary;
    remaining -= earliest.res.timeOffset;
  }

  return {
    nextState: {
      ...cur,
      events: [...state.events, ...stepEvents]
    },
    events: stepEvents
  };
}

export function computeObservables(state: KinematicsChaseState): Record<string, number> {
  return {
    xA: state.xA,
    xB: state.xB,
    vA: state.vA,
    vB: state.vB,
    deltaX: state.xB - state.xA,
    deltaV: state.vA - state.vB,
    minGap: state.minGap
  };
}

export function checkInvariants(state: KinematicsChaseState): InvariantReport[] {
  const noReverse =
    (!state.aLockedZero || Math.abs(state.vA) < 1e-10) &&
    (!state.bLockedZero || Math.abs(state.vB) < 1e-10);
  return [
    {
      name: '单向刹车零速锁止不倒车校验',
      measuredError: noReverse ? 0 : Math.abs(state.vA),
      tolerance: 1e-10,
      passed: noReverse
    }
  ];
}
