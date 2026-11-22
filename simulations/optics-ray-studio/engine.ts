import { degToRad, radToDeg, vec2, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type OpticsSceneMode =
  | 'tir-interface'
  | 'parallel-slab'
  | 'prism-dispersion'
  | 'optical-fiber'
  | 'double-slit';

export type OpticsParams = {
  sceneMode: OpticsSceneMode;
  incidentAngleDeg: number;
  n1: number;
  n2: number;
  slabThickness: number;
  prismApexDeg: number;
  fiberHalfWidth: number;
  wavelengthNm: number;
  slitSeparationMm: number;
  screenDistanceM: number;
  animateSweep: boolean;
};

export interface RaySegment {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly color: string;
  readonly intensity: number;
  readonly label?: string;
}

export interface OpticsState {
  readonly t: number;
  readonly activeAngleDeg: number;
  readonly rays: readonly RaySegment[];
  readonly criticalAngleDeg: number | null;
  readonly isTotalInternalReflection: boolean;
  readonly refractedAngleDeg: number | null;
  readonly lateralShift: number;
  readonly prismDeviationDeg: number;
  readonly fringeSpacingMm: number;
  readonly events: readonly PhysicsEvent[];
}

export function refractVector2D(
  dir: Vec2,
  normalIntoIncoming: Vec2,
  nFrom: number,
  nTo: number
): { refracted: Vec2 | null; reflected: Vec2; sinI: number; sinT: number } {
  const dLen = Math.hypot(dir.x, dir.y) || 1;
  const dx = dir.x / dLen;
  const dy = dir.y / dLen;

  const nLen = Math.hypot(normalIntoIncoming.x, normalIntoIncoming.y) || 1;
  let nx = normalIntoIncoming.x / nLen;
  let ny = normalIntoIncoming.y / nLen;

  // 确保法向与入射方向点积 <= 0（指向入射介质一侧）
  let cosI = -(dx * nx + dy * ny);
  if (cosI < 0) {
    nx = -nx;
    ny = -ny;
    cosI = -cosI;
  }

  const eta = nFrom / Math.max(nTo, 1e-6);
  const sinISq = Math.max(0, 1 - cosI * cosI);
  const sinT = eta * Math.sqrt(sinISq);
  const reflected = vec2(dx + 2 * cosI * nx, dy + 2 * cosI * ny);

  if (sinT >= 1 - 1e-12) {
    return { refracted: null, reflected, sinI: Math.sqrt(sinISq), sinT: 1 };
  }

  const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
  const rx = eta * dx + (eta * cosI - cosT) * nx;
  const ry = eta * dy + (eta * cosI - cosT) * ny;
  const rLen = Math.hypot(rx, ry) || 1;

  return {
    refracted: vec2(rx / rLen, ry / rLen),
    reflected,
    sinI: Math.sqrt(sinISq),
    sinT
  };
}

function solveRayTrace(
  activeAngleDeg: number,
  params: OpticsParams
): Omit<OpticsState, 't' | 'events'> {
  const rays: RaySegment[] = [];
  const criticalAngleDeg =
    params.n1 > params.n2 ? radToDeg(Math.asin(Math.min(1, params.n2 / params.n1))) : null;

  if (params.sceneMode === 'tir-interface') {
    const theta1 = degToRad(Math.max(0, Math.min(89, activeAngleDeg)));
    const origin = vec2(0, 0);
    const incDir = vec2(Math.sin(theta1), -Math.cos(theta1));
    const startPt = vec2(-2.2 * incDir.x, -2.2 * incDir.y);
    rays.push({ from: startPt, to: origin, color: '#fbbf24', intensity: 1, label: '入射光' });

    const { refracted, reflected } = refractVector2D(
      incDir,
      vec2(0, 1),
      params.n1,
      params.n2
    );
    const isTir = refracted === null;
    rays.push({
      from: origin,
      to: vec2(reflected.x * 2.2, reflected.y * 2.2),
      color: isTir ? '#f472b6' : '#fbbf24',
      intensity: isTir ? 1 : 0.35,
      label: isTir ? '全反射光 (100%)' : '反射光'
    });

    let refractedAngleDeg: number | null = null;
    if (refracted) {
      refractedAngleDeg = radToDeg(Math.acos(Math.min(1, Math.max(-1, -refracted.y))));
      rays.push({
        from: origin,
        to: vec2(refracted.x * 2.4, refracted.y * 2.4),
        color: '#38bdf8',
        intensity: 0.9,
        label: '折射光'
      });
    }

    return {
      activeAngleDeg,
      rays,
      criticalAngleDeg,
      isTotalInternalReflection: isTir,
      refractedAngleDeg,
      lateralShift: 0,
      prismDeviationDeg: 0,
      fringeSpacingMm: 0
    };
  }

  if (params.sceneMode === 'parallel-slab') {
    const theta1 = degToRad(Math.max(0, Math.min(85, activeAngleDeg)));
    const d = Math.max(0.2, params.slabThickness);
    const nAir = 1.0;
    const nGlass = Math.max(1.0, params.n1);
    const incDir = vec2(Math.sin(theta1), -Math.cos(theta1));
    const topHit = vec2(-0.5, 0.5 * d);
    rays.push({
      from: vec2(topHit.x - incDir.x * 1.6, topHit.y - incDir.y * 1.6),
      to: topHit,
      color: '#fbbf24',
      intensity: 1
    });

    const first = refractVector2D(incDir, vec2(0, 1), nAir, nGlass);
    const innerDir = first.refracted ?? first.reflected;
    // 玻璃内底面 y = -0.5 * d
    const tToBottom = d / Math.max(1e-9, -innerDir.y);
    const botHit = vec2(topHit.x + innerDir.x * tToBottom, -0.5 * d);
    rays.push({ from: topHit, to: botHit, color: '#38bdf8', intensity: 0.95 });

    const second = refractVector2D(innerDir, vec2(0, 1), nGlass, nAir);
    const outDir = second.refracted ?? second.reflected;
    rays.push({
      from: botHit,
      to: vec2(botHit.x + outDir.x * 1.8, botHit.y + outDir.y * 1.8),
      color: '#4ade80',
      intensity: 0.95,
      label: '出射光'
    });

    const sinT2 = Math.sin(theta1) / nGlass;
    const theta2 = Math.asin(Math.min(1, sinT2));
    const lateralShift = (d * Math.sin(theta1 - theta2)) / Math.max(Math.cos(theta2), 1e-9);

    return {
      activeAngleDeg,
      rays,
      criticalAngleDeg: null,
      isTotalInternalReflection: false,
      refractedAngleDeg: radToDeg(theta2),
      lateralShift,
      prismDeviationDeg: 0,
      fringeSpacingMm: 0
    };
  }

  if (params.sceneMode === 'prism-dispersion') {
    const apexRad = degToRad(Math.max(20, Math.min(80, params.prismApexDeg)));
    const halfA = 0.5 * apexRad;
    const h = 1.6;
    const halfBase = h * Math.tan(halfA);
    const apex = vec2(0, 0.6 * h);
    const leftBot = vec2(-halfBase, -0.4 * h);
    const rightBot = vec2(halfBase, -0.4 * h);

    // 左面外法向 (-cos(halfA), sin(halfA))，右面外法向 (+cos(halfA), sin(halfA))
    const leftNormal = vec2(-Math.cos(halfA), Math.sin(halfA));
    const rightNormal = vec2(Math.cos(halfA), Math.sin(halfA));

    // 入射光水平（或按入射角微调）击中左腰中点附近
    const hitLeft = vec2(0.5 * (apex.x + leftBot.x), 0.5 * (apex.y + leftBot.y));
    const incAngleOnNormal = degToRad(Math.max(5, Math.min(80, activeAngleDeg)));
    // 左腰沿面方向单位向量 (sin(halfA), cos(halfA))
    const incDir = vec2(
      Math.cos(halfA) * Math.cos(incAngleOnNormal) + Math.sin(halfA) * Math.sin(incAngleOnNormal),
      -Math.sin(halfA) * Math.cos(incAngleOnNormal) + Math.cos(halfA) * Math.sin(incAngleOnNormal)
    );
    const incNorm = Math.hypot(incDir.x, incDir.y) || 1;
    const dir0 = vec2(incDir.x / incNorm, incDir.y / incNorm);

    rays.push({
      from: vec2(hitLeft.x - dir0.x * 1.6, hitLeft.y - dir0.y * 1.6),
      to: hitLeft,
      color: '#f8fafc',
      intensity: 1,
      label: '复色白光'
    });

    const spectrum = [
      { label: '红', deltaN: -0.025, color: '#ef4444' },
      { label: '橙', deltaN: -0.012, color: '#f97316' },
      { label: '黄', deltaN: 0.0, color: '#eab308' },
      { label: '绿', deltaN: 0.014, color: '#22c55e' },
      { label: '蓝', deltaN: 0.028, color: '#3b82f6' },
      { label: '紫', deltaN: 0.042, color: '#a855f7' }
    ];

    let yellowDeviation = 0;
    for (const band of spectrum) {
      const nBand = Math.max(1.05, params.n1 + band.deltaN);
      const r1 = refractVector2D(dir0, leftNormal, 1.0, nBand);
      const d1 = r1.refracted ?? r1.reflected;
      // 与右腰线段求交: (hitLeft + t*d1 - apex) · rightNormal = 0
      const denom = d1.x * rightNormal.x + d1.y * rightNormal.y;
      if (Math.abs(denom) < 1e-6) continue;
      const tHit =
        ((apex.x - hitLeft.x) * rightNormal.x + (apex.y - hitLeft.y) * rightNormal.y) / denom;
      if (tHit <= 0) continue;
      const hitRight = vec2(hitLeft.x + tHit * d1.x, hitLeft.y + tHit * d1.y);
      if (hitRight.y < rightBot.y) continue;

      rays.push({ from: hitLeft, to: hitRight, color: band.color, intensity: 0.8 });
      const r2 = refractVector2D(d1, rightNormal, nBand, 1.0);
      const d2 = r2.refracted ?? r2.reflected;
      rays.push({
        from: hitRight,
        to: vec2(hitRight.x + d2.x * 1.8, hitRight.y + d2.y * 1.8),
        color: band.color,
        intensity: 0.9
      });

      if (band.label === '黄') {
        const dotVal = Math.max(-1, Math.min(1, dir0.x * d2.x + dir0.y * d2.y));
        yellowDeviation = radToDeg(Math.acos(dotVal));
      }
    }

    return {
      activeAngleDeg,
      rays,
      criticalAngleDeg,
      isTotalInternalReflection: false,
      refractedAngleDeg: null,
      lateralShift: 0,
      prismDeviationDeg: yellowDeviation,
      fringeSpacingMm: 0
    };
  }

  if (params.sceneMode === 'optical-fiber') {
    const hw = Math.max(0.15, params.fiberHalfWidth);
    const nCore = Math.max(1.1, params.n1);
    const nClad = Math.min(nCore - 0.01, Math.max(1.0, params.n2));
    const critDeg = radToDeg(Math.asin(nClad / nCore));

    const entryPt = vec2(-2.4, 0);
    const thetaAir = degToRad(Math.max(1, Math.min(80, activeAngleDeg)));
    const extDir = vec2(Math.cos(thetaAir), Math.sin(thetaAir));
    rays.push({
      from: vec2(entryPt.x - extDir.x * 0.9, entryPt.y - extDir.y * 0.9),
      to: entryPt,
      color: '#fbbf24',
      intensity: 1
    });

    const entryRef = refractVector2D(extDir, vec2(-1, 0), 1.0, nCore);
    let curPt = entryPt;
    let curDir = entryRef.refracted ?? extDir;
    let totalTir = true;

    for (let bounce = 0; bounce < 6; bounce++) {
      if (Math.abs(curDir.y) < 1e-6) {
        rays.push({ from: curPt, to: vec2(2.4, curPt.y), color: '#38bdf8', intensity: 1 });
        break;
      }
      const targetY = curDir.y > 0 ? hw : -hw;
      const tWall = (targetY - curPt.y) / curDir.y;
      const nextX = curPt.x + tWall * curDir.x;
      if (nextX > 2.4) {
        const tEnd = (2.4 - curPt.x) / Math.max(curDir.x, 1e-6);
        rays.push({
          from: curPt,
          to: vec2(2.4, curPt.y + tEnd * curDir.y),
          color: '#38bdf8',
          intensity: 0.95
        });
        break;
      }
      const hitPt = vec2(nextX, targetY);
      rays.push({ from: curPt, to: hitPt, color: '#38bdf8', intensity: 0.95 });

      const wallNormal = curDir.y > 0 ? vec2(0, -1) : vec2(0, 1);
      const bounceRes = refractVector2D(curDir, wallNormal, nCore, nClad);
      if (bounceRes.refracted !== null) {
        totalTir = false;
        rays.push({
          from: hitPt,
          to: vec2(hitPt.x + bounceRes.refracted.x * 1.1, hitPt.y + bounceRes.refracted.y * 1.1),
          color: '#f87171',
          intensity: 0.85,
          label: '漏光'
        });
        break;
      }
      curPt = hitPt;
      curDir = bounceRes.reflected;
    }

    return {
      activeAngleDeg,
      rays,
      criticalAngleDeg: critDeg,
      isTotalInternalReflection: totalTir,
      refractedAngleDeg: null,
      lateralShift: 0,
      prismDeviationDeg: 0,
      fringeSpacingMm: 0
    };
  }

  // double-slit 双缝干涉解析：Delta x = (L * lambda) / d
  const lambdaM = Math.max(380, params.wavelengthNm) * 1e-9;
  const dM = Math.max(0.05, params.slitSeparationMm) * 1e-3;
  const L = Math.max(0.2, params.screenDistanceM);
  const fringeSpacingMm = ((L * lambdaM) / dM) * 1e3;

  return {
    activeAngleDeg,
    rays: [],
    criticalAngleDeg: null,
    isTotalInternalReflection: false,
    refractedAngleDeg: null,
    lateralShift: 0,
    prismDeviationDeg: 0,
    fringeSpacingMm
  };
}

export function createInitialState(params: OpticsParams): OpticsState {
  const angle = params.animateSweep ? 15 : params.incidentAngleDeg;
  const solved = solveRayTrace(angle, params);
  return {
    t: 0,
    ...solved,
    events: []
  };
}

export function stepOptics(
  state: OpticsState,
  params: OpticsParams,
  dt: number
): StepResult<OpticsState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  const nextT = state.t + dt;
  const angle = params.animateSweep
    ? 42.5 + 37.5 * Math.sin(nextT * 0.65 - 0.8)
    : params.incidentAngleDeg;

  const solved = solveRayTrace(angle, params);
  const events: PhysicsEvent[] = [];

  if (
    params.sceneMode === 'tir-interface' &&
    !state.isTotalInternalReflection &&
    solved.isTotalInternalReflection &&
    solved.criticalAngleDeg !== null
  ) {
    events.push({
      id: `tir-${nextT.toFixed(5)}`,
      time: nextT,
      label: `发生全反射 (C=${solved.criticalAngleDeg.toFixed(1)}°)`
    });
  }

  return {
    nextState: {
      t: nextT,
      ...solved,
      events: [...state.events, ...events]
    },
    events
  };
}

export function computeObservables(state: OpticsState): Record<string, number> {
  return {
    incidentAngleDeg: state.activeAngleDeg,
    refractedAngleDeg: state.refractedAngleDeg ?? 0,
    criticalAngleDeg: state.criticalAngleDeg ?? 0,
    lateralShift: state.lateralShift,
    prismDeviationDeg: state.prismDeviationDeg,
    fringeSpacingMm: state.fringeSpacingMm
  };
}

export function checkInvariants(
  state: OpticsState,
  _initial: OpticsState,
  params: OpticsParams
): InvariantReport[] {
  if (params.sceneMode === 'tir-interface' && state.refractedAngleDeg !== null) {
    const lhs = params.n1 * Math.sin(degToRad(state.activeAngleDeg));
    const rhs = params.n2 * Math.sin(degToRad(state.refractedAngleDeg));
    const err = Math.abs(lhs - rhs);
    return [
      {
        name: '斯涅尔定律 (n₁sinθ₁ = n₂sinθ₂)',
        measuredError: err,
        tolerance: 1e-6,
        passed: err < 1e-6
      }
    ];
  }
  return [];
}
