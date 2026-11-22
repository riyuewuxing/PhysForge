import { bisectEvent } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type CollisionRecoilMode =
  | 'collision-1d'
  | 'collision-2d-oblique'
  | 'bullet-block'
  | 'boat-recoil';

export type CollisionRecoilParams = {
  mode: CollisionRecoilMode;
  mass1: number;
  mass2: number;
  v10: number;
  v20: number;
  restitutionE: number;
  impactParamB: number;
  radius1: number;
  radius2: number;
  dragForceF: number;
  blockLength: number;
};

export interface CollisionRecoilState {
  readonly t: number;
  readonly x1: number;
  readonly y1: number;
  readonly vx1: number;
  readonly vy1: number;
  readonly x2: number;
  readonly y2: number;
  readonly vx2: number;
  readonly vy2: number;
  readonly collided: boolean;
  readonly bulletPhase: 'approach' | 'penetrating' | 'comoving' | 'exited';
  readonly heatLostJ: number;
  readonly penetrationDist: number;
  readonly xCm0: number;
  readonly pInitX: number;
  readonly pInitY: number;
  readonly kInit: number;
  readonly events: readonly PhysicsEvent[];
}

export function createInitialState(params: CollisionRecoilParams): CollisionRecoilState {
  const m1 = Math.max(0.05, params.mass1);
  const m2 = Math.max(0.05, params.mass2);

  if (params.mode === 'boat-recoil') {
    const boatLen = Math.max(1.0, params.blockLength);
    const x20 = 0;
    const x10 = -0.45 * boatLen;
    const xCm0 = (m1 * x10 + m2 * x20) / (m1 + m2);
    return {
      t: 0,
      x1: x10,
      y1: 0.35,
      vx1: 0,
      vy1: 0,
      x2: x20,
      y2: 0,
      vx2: 0,
      vy2: 0,
      collided: false,
      bulletPhase: 'approach',
      heatLostJ: 0,
      penetrationDist: 0,
      xCm0,
      pInitX: 0,
      pInitY: 0,
      kInit: 0,
      events: []
    };
  }

  const r1 = Math.max(0.1, params.radius1);
  const r2 = Math.max(0.1, params.radius2);
  const is2D = params.mode === 'collision-2d-oblique';
  const maxB = 0.95 * (r1 + r2);
  const b = is2D ? Math.max(-maxB, Math.min(maxB, params.impactParamB)) : 0;

  const x10 = params.mode === 'bullet-block' ? -2.4 : -2.6;
  const x20 = 0;
  const vx10 = params.v10;
  const vx20 = params.mode === 'bullet-block' ? 0 : is2D ? 0 : params.v20;

  const xCm0 = (m1 * x10 + m2 * x20) / (m1 + m2);
  const pInitX = m1 * vx10 + m2 * vx20;
  const kInit = 0.5 * m1 * vx10 * vx10 + 0.5 * m2 * vx20 * vx20;

  return {
    t: 0,
    x1: x10,
    y1: b,
    vx1: vx10,
    vy1: 0,
    x2: x20,
    y2: 0,
    vx2: vx20,
    vy2: 0,
    collided: false,
    bulletPhase: 'approach',
    heatLostJ: 0,
    penetrationDist: 0,
    xCm0,
    pInitX,
    pInitY: 0,
    kInit,
    events: []
  };
}

function advanceLinear(st: CollisionRecoilState, dt: number): CollisionRecoilState {
  return {
    ...st,
    t: st.t + dt,
    x1: st.x1 + st.vx1 * dt,
    y1: st.y1 + st.vy1 * dt,
    x2: st.x2 + st.vx2 * dt,
    y2: st.y2 + st.vy2 * dt
  };
}

function applySphereImpulse(
  st: CollisionRecoilState,
  params: CollisionRecoilParams
): CollisionRecoilState {
  const m1 = Math.max(0.05, params.mass1);
  const m2 = Math.max(0.05, params.mass2);
  const e = Math.max(0, Math.min(1, params.restitutionE));

  const dx = st.x2 - st.x1;
  const dy = st.y2 - st.y1;
  const dist = Math.hypot(dx, dy);
  const nx = dist > 1e-12 ? dx / dist : 1;
  const ny = dist > 1e-12 ? dy / dist : 0;

  const relVn = (st.vx1 - st.vx2) * nx + (st.vy1 - st.vy2) * ny;
  if (relVn <= 0) return st;

  const jn = ((1 + e) * m1 * m2 * relVn) / (m1 + m2);
  const vx1p = st.vx1 - (jn / m1) * nx;
  const vy1p = st.vy1 - (jn / m1) * ny;
  const vx2p = st.vx2 + (jn / m2) * nx;
  const vy2p = st.vy2 + (jn / m2) * ny;

  const kBefore = 0.5 * m1 * (st.vx1 * st.vx1 + st.vy1 * st.vy1) + 0.5 * m2 * (st.vx2 * st.vx2 + st.vy2 * st.vy2);
  const kAfter = 0.5 * m1 * (vx1p * vx1p + vy1p * vy1p) + 0.5 * m2 * (vx2p * vx2p + vy2p * vy2p);

  return {
    ...st,
    vx1: vx1p,
    vy1: vy1p,
    vx2: vx2p,
    vy2: vy2p,
    collided: true,
    heatLostJ: Math.max(0, kBefore - kAfter)
  };
}

function stepSphereCollision(
  state: CollisionRecoilState,
  params: CollisionRecoilParams,
  dt: number
): StepResult<CollisionRecoilState> {
  const rSum = Math.max(0.1, params.radius1) + Math.max(0.1, params.radius2);
  const events: PhysicsEvent[] = [];

  if (state.collided) {
    return { nextState: advanceLinear(state, dt), events };
  }

  const gapFn = (s: CollisionRecoilState) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) - rSum;
  const endCand = advanceLinear(state, dt);

  if (gapFn(state) > 0 && gapFn(endCand) <= 0 && (state.vx1 - state.vx2) * (state.x2 - state.x1) > 0) {
    const hit = bisectEvent(state, state.t, dt, advanceLinear, gapFn, {
      timeTolerance: 1e-9,
      biasEndpoint: 'midpoint'
    });
    if (hit) {
      const afterImpulse = applySphereImpulse(hit.state, params);
      const remDt = dt - hit.timeOffset;
      const finalState = advanceLinear(afterImpulse, remDt);
      const ev: PhysicsEvent = {
        id: `impact-${state.events.length}`,
        time: hit.time,
        label: params.mode === 'collision-2d-oblique' ? '二维斜碰瞬时冲量' : '一维对心碰撞',
        position: { x: 0.5 * (hit.state.x1 + hit.state.x2), y: 0.5 * (hit.state.y1 + hit.state.y2) },
        metrics: { heatLostJ: afterImpulse.heatLostJ }
      };
      events.push(ev);
      return {
        nextState: { ...finalState, events: [...state.events, ev] },
        events
      };
    }
  }

  return { nextState: endCand, events };
}

function advancePenetrating(
  st: CollisionRecoilState,
  m1: number,
  m2: number,
  fDrag: number,
  dt: number
): CollisionRecoilState {
  const a1 = -fDrag / m1;
  const a2 = fDrag / m2;
  const x1 = st.x1 + st.vx1 * dt + 0.5 * a1 * dt * dt;
  const x2 = st.x2 + st.vx2 * dt + 0.5 * a2 * dt * dt;
  const vx1 = st.vx1 + a1 * dt;
  const vx2 = st.vx2 + a2 * dt;
  const relDisp = (st.vx1 - st.vx2) * dt + 0.5 * (a1 - a2) * dt * dt;
  const dRel = st.penetrationDist + Math.max(0, relDisp);
  return {
    ...st,
    t: st.t + dt,
    x1,
    x2,
    vx1,
    vx2,
    penetrationDist: dRel,
    heatLostJ: fDrag * dRel
  };
}

function stepBulletBlock(
  state: CollisionRecoilState,
  params: CollisionRecoilParams,
  dt: number
): StepResult<CollisionRecoilState> {
  const m1 = Math.max(0.05, params.mass1);
  const m2 = Math.max(0.05, params.mass2);
  const fDrag = Math.max(1, params.dragForceF);
  const L = Math.max(0.2, params.blockLength);
  const events: PhysicsEvent[] = [];

  let cur = state;
  let rem = dt;

  if (cur.bulletPhase === 'approach') {
    const gapFn = (s: CollisionRecoilState) => s.x2 - 0.5 * L - s.x1;
    const cand = advanceLinear(cur, rem);
    if (gapFn(cur) > 0 && gapFn(cand) <= 0) {
      const hit = bisectEvent(cur, cur.t, rem, advanceLinear, gapFn, {
        timeTolerance: 1e-9,
        biasEndpoint: 'midpoint'
      });
      if (hit) {
        const ev: PhysicsEvent = {
          id: `entry-${cur.events.length}`,
          time: hit.time,
          label: '子弹射入木块左端',
          position: { x: hit.state.x1, y: 0 }
        };
        events.push(ev);
        cur = {
          ...hit.state,
          collided: true,
          bulletPhase: 'penetrating',
          events: [...cur.events, ev]
        };
        rem -= hit.timeOffset;
      }
    } else {
      return { nextState: cand, events };
    }
  }

  if (cur.bulletPhase === 'penetrating' && rem > 0) {
    const advPen = (s: CollisionRecoilState, h: number) => advancePenetrating(s, m1, m2, fDrag, h);
    const cand = advPen(cur, rem);
    const vRelFn = (s: CollisionRecoilState) => s.vx1 - s.vx2;
    const distRemFn = (s: CollisionRecoilState) => L - s.penetrationDist;

    const coVelHit =
      vRelFn(cur) > 0 && vRelFn(cand) <= 0
        ? bisectEvent(cur, cur.t, rem, advPen, vRelFn, {
            timeTolerance: 1e-9,
            biasEndpoint: 'midpoint'
          })
        : null;
    const exitHit =
      distRemFn(cur) > 0 && distRemFn(cand) <= 0
        ? bisectEvent(cur, cur.t, rem, advPen, distRemFn, {
            timeTolerance: 1e-9,
            biasEndpoint: 'midpoint'
          })
        : null;

    if (exitHit && (!coVelHit || exitHit.timeOffset <= coVelHit.timeOffset)) {
      const ev: PhysicsEvent = {
        id: `exit-${cur.events.length + events.length}`,
        time: exitHit.time,
        label: '子弹穿出木块右端',
        position: { x: exitHit.state.x1, y: 0 },
        metrics: { heatLostJ: exitHit.state.heatLostJ }
      };
      events.push(ev);
      cur = { ...exitHit.state, bulletPhase: 'exited', events: [...cur.events, ev] };
      rem -= exitHit.timeOffset;
    } else if (coVelHit) {
      const vCommon = (m1 * cur.vx1 + m2 * cur.vx2) / (m1 + m2);
      const ev: PhysicsEvent = {
        id: `covel-${cur.events.length + events.length}`,
        time: coVelHit.time,
        label: '子弹与木块共速 (Q=f·d)',
        position: { x: coVelHit.state.x1, y: 0 },
        metrics: { vCommon, heatLostJ: coVelHit.state.heatLostJ }
      };
      events.push(ev);
      cur = {
        ...coVelHit.state,
        vx1: vCommon,
        vx2: vCommon,
        bulletPhase: 'comoving',
        events: [...cur.events, ev]
      };
      rem -= coVelHit.timeOffset;
    } else {
      return { nextState: cand, events };
    }
  }

  if (rem > 0) {
    cur = advanceLinear(cur, rem);
  }
  return { nextState: cur, events };
}

function stepBoatRecoil(
  state: CollisionRecoilState,
  params: CollisionRecoilParams,
  dt: number
): StepResult<CollisionRecoilState> {
  const m1 = Math.max(0.05, params.mass1);
  const m2 = Math.max(0.05, params.mass2);
  const vRelMax = Math.max(0.2, Math.abs(params.v10));
  const walkSpan = 0.9 * Math.max(1.0, params.blockLength);
  const walkDuration = walkSpan / vRelMax;
  const events: PhysicsEvent[] = [];

  if (state.t >= walkDuration) {
    return { nextState: { ...state, t: state.t + dt, vx1: 0, vx2: 0 }, events };
  }

  const endT = Math.min(walkDuration, state.t + dt);
  const activeDt = endT - state.t;
  const v1 = (m2 / (m1 + m2)) * vRelMax;
  const v2 = -(m1 / (m1 + m2)) * vRelMax;
  const x1 = state.x1 + v1 * activeDt;
  const x2 = state.x2 + v2 * activeDt;
  const finished = endT >= walkDuration - 1e-12;

  if (finished && state.bulletPhase !== 'comoving') {
    const ev: PhysicsEvent = {
      id: `boat-stop-${state.events.length}`,
      time: endT,
      label: '人走到船右端停下（双体同时静止）',
      position: { x: x2, y: 0 },
      metrics: { xCm: (m1 * x1 + m2 * x2) / (m1 + m2) }
    };
    events.push(ev);
    return {
      nextState: {
        ...state,
        t: state.t + dt,
        x1,
        x2,
        vx1: 0,
        vx2: 0,
        bulletPhase: 'comoving',
        events: [...state.events, ev]
      },
      events
    };
  }

  return {
    nextState: {
      ...state,
      t: state.t + dt,
      x1,
      x2,
      vx1: finished ? 0 : v1,
      vx2: finished ? 0 : v2
    },
    events
  };
}

export function stepCollisionRecoil(
  state: CollisionRecoilState,
  params: CollisionRecoilParams,
  dt: number
): StepResult<CollisionRecoilState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  switch (params.mode) {
    case 'collision-1d':
    case 'collision-2d-oblique':
      return stepSphereCollision(state, params, dt);
    case 'bullet-block':
      return stepBulletBlock(state, params, dt);
    case 'boat-recoil':
      return stepBoatRecoil(state, params, dt);
  }
}

export function computeObservables(
  state: CollisionRecoilState,
  params: CollisionRecoilParams
): Record<string, number> {
  const m1 = Math.max(0.05, params.mass1);
  const m2 = Math.max(0.05, params.mass2);
  const px = m1 * state.vx1 + m2 * state.vx2;
  const py = m1 * state.vy1 + m2 * state.vy2;
  const ek =
    0.5 * m1 * (state.vx1 * state.vx1 + state.vy1 * state.vy1) +
    0.5 * m2 * (state.vx2 * state.vx2 + state.vy2 * state.vy2);
  const xCm = (m1 * state.x1 + m2 * state.x2) / (m1 + m2);
  return {
    t: state.t,
    x1: state.x1,
    x2: state.x2,
    vx1: state.vx1,
    vy1: state.vy1,
    vx2: state.vx2,
    vy2: state.vy2,
    px,
    py,
    ek,
    heatLostJ: state.heatLostJ,
    xCm,
    vDotProduct: state.vx1 * state.vx2 + state.vy1 * state.vy2
  };
}

export function checkInvariants(
  state: CollisionRecoilState,
  _initial: CollisionRecoilState,
  params: CollisionRecoilParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  const momentumErr = Math.hypot(obs.px! - state.pInitX, obs.py! - state.pInitY);
  const energyErr =
    params.mode === 'boat-recoil' ? 0 : Math.abs(obs.ek! + state.heatLostJ - state.kInit);
  const cmDrift = params.mode === 'boat-recoil' ? Math.abs(obs.xCm! - state.xCm0) : 0;

  return [
    {
      name: '系统水平/二维动量守恒',
      measuredError: momentumErr,
      tolerance: 1e-8,
      passed: Number.isFinite(momentumErr) && momentumErr < 1e-8,
      unit: 'kg·m/s'
    },
    {
      name: params.mode === 'boat-recoil' ? '系统质心位置恒定' : '动能与内能损耗总和守恒',
      measuredError: params.mode === 'boat-recoil' ? cmDrift : energyErr,
      tolerance: 1e-8,
      passed: params.mode === 'boat-recoil' ? cmDrift < 1e-8 : energyErr < 1e-8,
      unit: params.mode === 'boat-recoil' ? 'm' : 'J'
    }
  ];
}
