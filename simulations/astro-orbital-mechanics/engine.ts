import {
  bisectEvent,
  createScaleContext,
  extractIsolines,
  findRootBrent,
  stepVelocityVerlet,
  type IsolineContour,
  type ScaleContext
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const G_SI = 6.6743e-11;
export const EARTH_MASS_KG = 5.972e24;
export const SOLAR_MASS_KG = 1.989e30;
export const EARTH_ORBIT_REF_M = 7.0e6;
export const AU_METERS = 1.495978707e11;

export type AstroMode = 'kepler-ellipse' | 'hohmann-transfer' | 'binary-lagrange';
export type AstroScaleRegime = 'earth-orbit' | 'solar-au';

export type AstroOrbitalParams = {
  mode: AstroMode;
  scaleRegime: AstroScaleRegime;
  r1Ratio: number;
  r2OverR1: number;
  v0Ratio: number;
  massRatioQ: number;
  simSpeed: number;
};

export interface SweptSector {
  readonly vertices: readonly { x: number; y: number }[];
  readonly areaDimless: number;
}

export interface LagrangePoint {
  readonly id: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  readonly x: number;
  readonly y: number;
}

export interface AstroOrbitalState {
  readonly tSim: number;
  readonly tNorm: number;
  readonly xNorm: number;
  readonly yNorm: number;
  readonly vxNorm: number;
  readonly vyNorm: number;
  readonly trailNorm: readonly { x: number; y: number }[];
  readonly sectors: readonly SweptSector[];
  readonly currentSectorVerts: readonly { x: number; y: number }[];
  readonly sectorStartTNorm: number;
  readonly hohmannPhase: 'parking' | 'transfer' | 'circularized';
  readonly deltaV1SI: number;
  readonly deltaV2SI: number;
  readonly energyNorm0: number;
  readonly angularMomNorm0: number;
  readonly semiMajorAxisNorm0: number;
  readonly events: readonly PhysicsEvent[];
}

const CBRT_2 = Math.cbrt(2);
const YOSHIDA_W1 = 1 / (2 - CBRT_2);
const YOSHIDA_W0 = -CBRT_2 / (2 - CBRT_2);

export function buildAstroScaleContext(params: AstroOrbitalParams): {
  scale: ScaleContext;
  centralMassKg: number;
  muSI: number;
  r1SI: number;
} {
  const isSolar = params.scaleRegime === 'solar-au';
  const centralMassKg = isSolar ? SOLAR_MASS_KG : EARTH_MASS_KG;
  const baseLength = isSolar ? AU_METERS : EARTH_ORBIT_REF_M;
  const r1SI = Math.max(0.2, params.r1Ratio) * baseLength;
  const muSI = G_SI * centralMassKg;
  const timeUnit = Math.sqrt((r1SI * r1SI * r1SI) / muSI);
  const scale = createScaleContext({
    lengthUnit: r1SI,
    timeUnit,
    massUnit: 1000,
    chargeUnit: 1
  });
  return { scale, centralMassKg, muSI, r1SI };
}

function twoBodyAccelNorm(positions: readonly number[]): number[] {
  const x = positions[0]!;
  const y = positions[1]!;
  const r2 = x * x + y * y;
  const invR3 = r2 > 1e-12 ? 1 / (r2 * Math.sqrt(r2)) : 0;
  return [-x * invR3, -y * invR3];
}

function restricted3BodyAccelNorm(positions: readonly number[], t: number, q: number): number[] {
  const x = positions[0]!;
  const y = positions[1]!;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const x1 = -q * ct;
  const y1 = -q * st;
  const x2 = (1 - q) * ct;
  const y2 = (1 - q) * st;

  const dx1 = x - x1;
  const dy1 = y - y1;
  const d1Sq = dx1 * dx1 + dy1 * dy1 + 1e-6;
  const invD1_3 = 1 / (d1Sq * Math.sqrt(d1Sq));

  const dx2 = x - x2;
  const dy2 = y - y2;
  const d2Sq = dx2 * dx2 + dy2 * dy2 + 1e-6;
  const invD2_3 = 1 / (d2Sq * Math.sqrt(d2Sq));

  return [
    -(1 - q) * dx1 * invD1_3 - q * dx2 * invD2_3,
    -(1 - q) * dy1 * invD1_3 - q * dy2 * invD2_3
  ];
}

function stepYoshida4Verlet(
  pos: readonly number[],
  vel: readonly number[],
  t: number,
  h: number,
  mode: AstroMode,
  q: number
): { positions: readonly number[]; velocities: readonly number[]; t: number } {
  const accelFn =
    mode === 'binary-lagrange'
      ? (p: readonly number[], _v: readonly number[], tau: number) =>
          restricted3BodyAccelNorm(p, tau, q)
      : (p: readonly number[]) => twoBodyAccelNorm(p);

  const s1 = stepVelocityVerlet({ positions: pos, velocities: vel, t }, YOSHIDA_W1 * h, accelFn);
  const s2 = stepVelocityVerlet(s1, YOSHIDA_W0 * h, accelFn);
  return stepVelocityVerlet(s2, YOSHIDA_W1 * h, accelFn);
}

export function computeLagrangePoints(massRatioQ: number): LagrangePoint[] {
  const q = Math.max(0.01, Math.min(0.49, massRatioQ));
  const mu1 = 1 - q;
  const mu2 = q;
  const x1 = -q;
  const x2 = 1 - q;

  const dPhiDx = (x: number): number => {
    const dx1 = x - x1;
    const dx2 = x - x2;
    return x - (mu1 * dx1) / Math.pow(Math.abs(dx1), 3) - (mu2 * dx2) / Math.pow(Math.abs(dx2), 3);
  };

  const l1x = findRootBrent(dPhiDx, x1 + 0.02, x2 - 0.02, { tolerance: 1e-11 }).root;
  const l2x = findRootBrent(dPhiDx, x2 + 0.02, 2.5, { tolerance: 1e-11 }).root;
  const l3x = findRootBrent(dPhiDx, -2.5, x1 - 0.02, { tolerance: 1e-11 }).root;

  return [
    { id: 'L1', x: l1x, y: 0 },
    { id: 'L2', x: l2x, y: 0 },
    { id: 'L3', x: l3x, y: 0 },
    { id: 'L4', x: 0.5 - q, y: Math.sqrt(3) / 2 },
    { id: 'L5', x: 0.5 - q, y: -Math.sqrt(3) / 2 }
  ];
}

export function extractRocheIsolines(massRatioQ: number): IsolineContour[] {
  const q = Math.max(0.01, Math.min(0.49, massRatioQ));
  const nx = 44;
  const ny = 44;
  const bounds = { xMin: -1.8, xMax: 1.8, yMin: -1.8, yMax: 1.8 };
  const grid = new Float64Array(nx * ny);
  const x1 = -q;
  const x2 = 1 - q;

  for (let j = 0; j < ny; j++) {
    const y = bounds.yMin + (j / (ny - 1)) * (bounds.yMax - bounds.yMin);
    for (let i = 0; i < nx; i++) {
      const x = bounds.xMin + (i / (nx - 1)) * (bounds.xMax - bounds.xMin);
      const r1 = Math.max(0.08, Math.hypot(x - x1, y));
      const r2 = Math.max(0.08, Math.hypot(x - x2, y));
      const phiEff = -(1 - q) / r1 - q / r2 - 0.5 * (x * x + y * y);
      grid[j * nx + i] = Math.max(-6, phiEff);
    }
  }
  return extractIsolines(grid, nx, ny, bounds, [-2.4, -2.0, -1.75, -1.55]);
}

function twoBodyMetricsNorm(x: number, y: number, vx: number, vy: number): {
  r: number;
  energy: number;
  lz: number;
  a: number;
  ecc: number;
} {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = 0.5 * v2 - 1 / Math.max(1e-9, r);
  const lz = x * vy - y * vx;
  const a = energy < -1e-12 ? -0.5 / energy : Infinity;
  const rDotV = x * vx + y * vy;
  const ex = (v2 - 1 / r) * x - rDotV * vx;
  const ey = (v2 - 1 / r) * y - rDotV * vy;
  const ecc = Math.hypot(ex, ey);
  return { r, energy, lz, a, ecc };
}

export function createInitialState(params: AstroOrbitalParams): AstroOrbitalState {
  const { scale, muSI, r1SI } = buildAstroScaleContext(params);

  if (params.mode === 'binary-lagrange') {
    const q = Math.max(0.01, Math.min(0.45, params.massRatioQ));
    const x0 = 0.5 - q + 0.025;
    const y0 = Math.sqrt(3) / 2 - 0.02;
    const vx0 = -y0;
    const vy0 = x0;
    return {
      tSim: 0,
      tNorm: 0,
      xNorm: x0,
      yNorm: y0,
      vxNorm: vx0,
      vyNorm: vy0,
      trailNorm: [{ x: x0, y: y0 }],
      sectors: [],
      currentSectorVerts: [{ x: x0, y: y0 }],
      sectorStartTNorm: 0,
      hohmannPhase: 'parking',
      deltaV1SI: 0,
      deltaV2SI: 0,
      energyNorm0: 0.5 * (vx0 * vx0 + vy0 * vy0),
      angularMomNorm0: x0 * vy0 - y0 * vx0,
      semiMajorAxisNorm0: 1,
      events: []
    };
  }

  const vCircSI = Math.sqrt(muSI / r1SI);

  if (params.mode === 'hohmann-transfer') {
    const rho = Math.max(1.1, params.r2OverR1);
    const dv1Factor = Math.sqrt((2 * rho) / (1 + rho)) - 1;
    const vTransferSI = vCircSI * (1 + dv1Factor);
    const dv1SI = vCircSI * dv1Factor;

    const xNorm = scale.toDimless(r1SI, 'length');
    const yNorm = scale.toDimless(0, 'length');
    const vyNorm = scale.toDimless(vTransferSI, 'velocity');
    const m = twoBodyMetricsNorm(xNorm, yNorm, 0, vyNorm);

    const burn1Event: PhysicsEvent = {
      id: 'hohmann-burn-1',
      time: 0,
      label: '近地点点火 Δv₁ 进入霍曼转移椭圆',
      position: { x: xNorm, y: yNorm },
      metrics: { deltaV1SI: dv1SI }
    };

    return {
      tSim: 0,
      tNorm: 0,
      xNorm,
      yNorm,
      vxNorm: 0,
      vyNorm,
      trailNorm: [{ x: xNorm, y: yNorm }],
      sectors: [],
      currentSectorVerts: [{ x: xNorm, y: yNorm }],
      sectorStartTNorm: 0,
      hohmannPhase: 'transfer',
      deltaV1SI: dv1SI,
      deltaV2SI: 0,
      energyNorm0: m.energy,
      angularMomNorm0: m.lz,
      semiMajorAxisNorm0: m.a,
      events: [burn1Event]
    };
  }

  const v0SI = Math.max(0.5, params.v0Ratio) * vCircSI;
  const xNorm = scale.toDimless(r1SI, 'length');
  const yNorm = scale.toDimless(0, 'length');
  const vyNorm = scale.toDimless(v0SI, 'velocity');
  const m = twoBodyMetricsNorm(xNorm, yNorm, 0, vyNorm);

  return {
    tSim: 0,
    tNorm: 0,
    xNorm,
    yNorm,
    vxNorm: 0,
    vyNorm,
    trailNorm: [{ x: xNorm, y: yNorm }],
    sectors: [],
    currentSectorVerts: [{ x: xNorm, y: yNorm }],
    sectorStartTNorm: 0,
    hohmannPhase: 'parking',
    deltaV1SI: 0,
    deltaV2SI: 0,
    energyNorm0: m.energy,
    angularMomNorm0: m.lz,
    semiMajorAxisNorm0: m.a,
    events: []
  };
}

interface VerletSubState {
  readonly positions: readonly number[];
  readonly velocities: readonly number[];
  readonly t: number;
}

export function stepAstroOrbital(
  state: AstroOrbitalState,
  params: AstroOrbitalParams,
  dt: number
): StepResult<AstroOrbitalState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const { scale } = buildAstroScaleContext(params);
  const q = Math.max(0.01, Math.min(0.45, params.massRatioQ));
  const simRate = Math.max(0.2, params.simSpeed);
  const dtNormTotal = dt * simRate;

  const maxSub = 0.015;
  const nSub = Math.max(1, Math.ceil(dtNormTotal / maxSub));
  const subH = dtNormTotal / nSub;

  let curSub: VerletSubState = {
    positions: [state.xNorm, state.yNorm],
    velocities: [state.vxNorm, state.vyNorm],
    t: state.tNorm
  };
  let phase = state.hohmannPhase;
  let deltaV2SI = state.deltaV2SI;
  const newEvents: PhysicsEvent[] = [];

  const advSub = (s: VerletSubState, h: number) => stepYoshida4Verlet(s.positions, s.velocities, s.t, h, params.mode, q);
  const radialVelFn = (s: VerletSubState) => s.positions[0]! * s.velocities[0]! + s.positions[1]! * s.velocities[1]!;

  for (let i = 0; i < nSub; i++) {
    const next = advSub(curSub, subH);

    if (params.mode === 'hohmann-transfer' && phase === 'transfer') {
      if (radialVelFn(curSub) > 0 && radialVelFn(next) <= 0) {
        const hit = bisectEvent(curSub, curSub.t, subH, advSub, radialVelFn, {
          timeTolerance: 1e-10,
          biasEndpoint: 'midpoint'
        });
        if (hit) {
          const atApo = hit.state;
          const rx = atApo.positions[0]!;
          const ry = atApo.positions[1]!;
          const vx = atApo.velocities[0]!;
          const vy = atApo.velocities[1]!;
          const rApo = Math.hypot(rx, ry);
          const vCircApoNorm = 1 / Math.sqrt(rApo);
          const vApoNorm = Math.hypot(vx, vy);
          deltaV2SI = scale.toSI(vCircApoNorm - vApoNorm, 'velocity');

          const ux = vApoNorm > 1e-12 ? vx / vApoNorm : -ry / rApo;
          const uy = vApoNorm > 1e-12 ? vy / vApoNorm : rx / rApo;
          const postBurnSub: VerletSubState = {
            positions: atApo.positions,
            velocities: [ux * vCircApoNorm, uy * vCircApoNorm],
            t: atApo.t
          };

          const ev: PhysicsEvent = {
            id: `hohmann-burn-2-${state.events.length + newEvents.length}`,
            time: state.tSim + (i * subH + hit.timeOffset) / simRate,
            label: '远地点二次点火 Δv₂ 圆化轨道',
            position: { x: rx, y: ry },
            metrics: { rApoNorm: rApo, deltaV2SI }
          };
          newEvents.push(ev);
          phase = 'circularized';

          curSub = advSub(postBurnSub, subH - hit.timeOffset);
          continue;
        }
      }
    }

    curSub = next;
  }

  const nx = curSub.positions[0]!;
  const ny = curSub.positions[1]!;
  const nvx = curSub.velocities[0]!;
  const nvy = curSub.velocities[1]!;

  const lastTrail = state.trailNorm[state.trailNorm.length - 1];
  const shouldAppend = !lastTrail || Math.hypot(nx - lastTrail.x, ny - lastTrail.y) > 0.04;
  const trailNorm = shouldAppend ? [...state.trailNorm.slice(-420), { x: nx, y: ny }] : state.trailNorm;

  const sectorInterval = 0.55;
  let sectors = state.sectors;
  let currentSectorVerts = [...state.currentSectorVerts, { x: nx, y: ny }];
  let sectorStartTNorm = state.sectorStartTNorm;

  if (params.mode === 'kepler-ellipse' && curSub.t - sectorStartTNorm >= sectorInterval) {
    let area = 0;
    for (let k = 0; k < currentSectorVerts.length - 1; k++) {
      const a = currentSectorVerts[k]!;
      const b = currentSectorVerts[k + 1]!;
      area += 0.5 * (a.x * b.y - a.y * b.x);
    }
    sectors = [...sectors.slice(-5), { vertices: currentSectorVerts, areaDimless: Math.abs(area) }];
    currentSectorVerts = [{ x: nx, y: ny }];
    sectorStartTNorm = curSub.t;
  }

  return {
    nextState: {
      ...state,
      tSim: state.tSim + dt,
      tNorm: curSub.t,
      xNorm: nx,
      yNorm: ny,
      vxNorm: nvx,
      vyNorm: nvy,
      trailNorm,
      sectors,
      currentSectorVerts,
      sectorStartTNorm,
      hohmannPhase: phase,
      deltaV2SI,
      events: newEvents.length > 0 ? [...state.events, ...newEvents] : state.events
    },
    events: newEvents
  };
}

export function computeObservables(
  state: AstroOrbitalState,
  params: AstroOrbitalParams
): Record<string, number> {
  const { scale } = buildAstroScaleContext(params);
  const m = twoBodyMetricsNorm(state.xNorm, state.yNorm, state.vxNorm, state.vyNorm);
  const speedNorm = Math.hypot(state.vxNorm, state.vyNorm);
  return {
    tSim: state.tSim,
    tNorm: state.tNorm,
    rNorm: m.r,
    speedNorm,
    rSI: scale.toSI(m.r, 'length'),
    speedSI: scale.toSI(speedNorm, 'velocity'),
    eccentricity: m.ecc,
    semiMajorAxisNorm: m.a,
    aSI: Number.isFinite(m.a) ? scale.toSI(m.a, 'length') : Infinity,
    energyNorm: m.energy,
    angularMomNorm: m.lz,
    deltaV1SI: state.deltaV1SI,
    deltaV2SI: state.deltaV2SI
  };
}

export function checkInvariants(
  state: AstroOrbitalState,
  _initial: AstroOrbitalState,
  params: AstroOrbitalParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  if (params.mode !== 'kepler-ellipse') {
    return [
      {
        name: '数值解有限性检查',
        measuredError: 0,
        tolerance: 1e-6,
        passed: Number.isFinite(state.xNorm) && Number.isFinite(state.yNorm)
      }
    ];
  }

  const relEnergyErr = Math.abs(obs.energyNorm! - state.energyNorm0) / Math.max(1e-9, Math.abs(state.energyNorm0));
  const relLzErr = Math.abs(obs.angularMomNorm! - state.angularMomNorm0) / Math.max(1e-9, Math.abs(state.angularMomNorm0));

  return [
    {
      name: '比机械能辛积分相对漂移',
      measuredError: relEnergyErr,
      tolerance: 1e-6,
      passed: Number.isFinite(relEnergyErr) && relEnergyErr < 1e-6
    },
    {
      name: '比角动量相对漂移',
      measuredError: relLzErr,
      tolerance: 1e-7,
      passed: Number.isFinite(relLzErr) && relLzErr < 1e-7
    }
  ];
}
