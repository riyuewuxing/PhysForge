import {
  SpatialHash2D,
  createSeededPrng,
  type DiskParticle2D
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';
import { R_GAS } from '../thermo-piston-gas-laws/engine.js';

export type ThermoCycleMdMode = 'cycle-carnot' | 'cycle-rect-pv' | 'kinetic-md-box';

export type ThermoCycleMdParams = {
  mode: ThermoCycleMdMode;
  molesN: number;
  tHotK: number;
  tColdK: number;
  compressionRatioV2OverV1: number;
  rectPressureRatio: number;
  particleCountN: number;
  seed: number;
  brownianPollen: boolean;
  mdSpeedScale: number;
};

export interface CycleSegmentMetrics {
  readonly label: string;
  readonly wJ: number;
  readonly qJ: number;
  readonly duJ: number;
  readonly points: readonly { vL: number; pKPa: number }[];
}

export interface CycleAnalysis {
  readonly segments: readonly CycleSegmentMetrics[];
  readonly sumDuJ: number;
  readonly sumWJ: number;
  readonly sumQJ: number;
  readonly efficiency: number;
  readonly carnotEfficiency: number;
}

export interface ThermoCycleMdState {
  readonly t: number;
  readonly particles: readonly DiskParticle2D[];
  readonly brownianTrail: readonly { x: number; y: number }[];
  readonly boxSize: number;
  readonly wallPressure: number;
  readonly initialKineticEnergy: number;
  readonly kineticEnergy: number;
  readonly cycle: CycleAnalysis;
}

const BOX_SIZE = 10.0;
const GAS_RADIUS = 0.14;
const POLLEN_RADIUS = 0.32;

export function evaluateClosedCycle(params: ThermoCycleMdParams): CycleAnalysis {
  const n = Math.max(0.1, params.molesN);
  const cv = 1.5 * R_GAS;
  const gamma = 5 / 3;
  const tH = Math.max(320, params.tHotK);
  const tC = Math.min(tH - 40, Math.max(150, params.tColdK));
  const rV = Math.max(1.2, params.compressionRatioV2OverV1);
  const v1 = 0.005; // 5 L in m^3

  if (params.mode === 'cycle-rect-pv') {
    const v2 = v1 * rV;
    const pLow = (n * R_GAS * tC) / v1;
    const pHigh = pLow * Math.max(1.2, params.rectPressureRatio);
    const t2 = (pHigh * v1) / (n * R_GAS);
    const t3 = (pHigh * v2) / (n * R_GAS);
    const t4 = (pLow * v2) / (n * R_GAS);

    // A(v1, pLow) -> B(v1, pHigh) -> C(v2, pHigh) -> D(v2, pLow) -> A
    const du1 = n * cv * (t2 - tC);
    const w1 = 0;
    const q1 = du1;

    const w2 = pHigh * (v2 - v1);
    const du2 = n * cv * (t3 - t2);
    const q2 = du2 + w2;

    const du3 = n * cv * (t4 - t3);
    const w3 = 0;
    const q3 = du3;

    const w4 = pLow * (v1 - v2);
    const du4 = n * cv * (tC - t4);
    const q4 = du4 + w4;

    const segs: CycleSegmentMetrics[] = [
      { label: '等容升温 A→B', wJ: w1, qJ: q1, duJ: du1, points: [{ vL: v1 * 1e3, pKPa: pLow / 1e3 }, { vL: v1 * 1e3, pKPa: pHigh / 1e3 }] },
      { label: '定压膨胀 B→C', wJ: w2, qJ: q2, duJ: du2, points: [{ vL: v1 * 1e3, pKPa: pHigh / 1e3 }, { vL: v2 * 1e3, pKPa: pHigh / 1e3 }] },
      { label: '等容降温 C→D', wJ: w3, qJ: q3, duJ: du3, points: [{ vL: v2 * 1e3, pKPa: pHigh / 1e3 }, { vL: v2 * 1e3, pKPa: pLow / 1e3 }] },
      { label: '定压压缩 D→A', wJ: w4, qJ: q4, duJ: du4, points: [{ vL: v2 * 1e3, pKPa: pLow / 1e3 }, { vL: v1 * 1e3, pKPa: pLow / 1e3 }] }
    ];
    const sumW = w1 + w2 + w3 + w4;
    const sumQ = q1 + q2 + q3 + q4;
    const qIn = (q1 > 0 ? q1 : 0) + (q2 > 0 ? q2 : 0) + (q3 > 0 ? q3 : 0) + (q4 > 0 ? q4 : 0);
    return {
      segments: segs,
      sumDuJ: du1 + du2 + du3 + du4,
      sumWJ: sumW,
      sumQJ: sumQ,
      efficiency: qIn > 0 ? sumW / qIn : 0,
      carnotEfficiency: 1 - tC / t3
    };
  }

  // Carnot Cycle
  const v2 = v1 * rV;
  const adiabFactor = Math.pow(tH / tC, 1 / (gamma - 1));
  const v3 = v2 * adiabFactor;
  const v4 = v1 * adiabFactor;

  const sampleCurve = (vA: number, vB: number, fn: (v: number) => number) => {
    const pts: { vL: number; pKPa: number }[] = [];
    for (let i = 0; i <= 14; i++) {
      const v = vA + (i / 14) * (vB - vA);
      pts.push({ vL: v * 1e3, pKPa: fn(v) / 1e3 });
    }
    return pts;
  };

  const w1 = n * R_GAS * tH * Math.log(v2 / v1);
  const q1 = w1;
  const du1 = 0;

  const du2 = n * cv * (tC - tH);
  const w2 = -du2;
  const q2 = 0;

  const w3 = n * R_GAS * tC * Math.log(v4 / v3);
  const q3 = w3;
  const du3 = 0;

  const du4 = n * cv * (tH - tC);
  const w4 = -du4;
  const q4 = 0;

  const segs: CycleSegmentMetrics[] = [
    { label: '等温吸热膨胀 (T_H)', wJ: w1, qJ: q1, duJ: du1, points: sampleCurve(v1, v2, (v) => (n * R_GAS * tH) / v) },
    { label: '绝热膨胀降温', wJ: w2, qJ: q2, duJ: du2, points: sampleCurve(v2, v3, (v) => (n * R_GAS * tH * Math.pow(v2, gamma - 1)) / Math.pow(v, gamma)) },
    { label: '等温放热压缩 (T_C)', wJ: w3, qJ: q3, duJ: du3, points: sampleCurve(v3, v4, (v) => (n * R_GAS * tC) / v) },
    { label: '绝热压缩升温', wJ: w4, qJ: q4, duJ: du4, points: sampleCurve(v4, v1, (v) => (n * R_GAS * tC * Math.pow(v4, gamma - 1)) / Math.pow(v, gamma)) }
  ];

  const sumW = w1 + w2 + w3 + w4;
  const sumQ = q1 + q2 + q3 + q4;
  return {
    segments: segs,
    sumDuJ: du1 + du2 + du3 + du4,
    sumWJ: sumW,
    sumQJ: sumQ,
    efficiency: q1 > 0 ? sumW / q1 : 0,
    carnotEfficiency: 1 - tC / tH
  };
}

function initMdParticles(params: ThermoCycleMdParams): DiskParticle2D[] {
  const N = Math.max(40, Math.min(400, Math.round(params.particleCountN)));
  const rng = createSeededPrng(params.seed);
  const particles: DiskParticle2D[] = [];
  const cols = Math.ceil(Math.sqrt(N));
  const step = (BOX_SIZE - 1.0) / cols;
  const speedAmp = Math.max(0.5, params.mdSpeedScale) * 2.6;

  if (params.brownianPollen) {
    particles.push({
      x: 0.5 * BOX_SIZE,
      y: 0.5 * BOX_SIZE,
      vx: 0,
      vy: 0,
      radius: POLLEN_RADIUS,
      mass: 20
    });
  }

  let placed = 0;
  for (let row = 0; row < cols && placed < N; row++) {
    for (let col = 0; col < cols && placed < N; col++) {
      const x = 0.5 + (col + 0.5) * step + rng.range(-0.08 * step, 0.08 * step);
      const y = 0.5 + (row + 0.5) * step + rng.range(-0.08 * step, 0.08 * step);
      if (params.brownianPollen && Math.hypot(x - 0.5 * BOX_SIZE, y - 0.5 * BOX_SIZE) < POLLEN_RADIUS + GAS_RADIUS + 0.1) {
        continue;
      }
      particles.push({
        x,
        y,
        vx: rng.gaussian(0, speedAmp),
        vy: rng.gaussian(0, speedAmp),
        radius: GAS_RADIUS,
        mass: 1
      });
      placed++;
    }
  }
  return particles;
}

function totalKineticEnergy(particles: readonly DiskParticle2D[]): number {
  let ek = 0;
  for (const p of particles) {
    ek += 0.5 * p.mass * (p.vx * p.vx + p.vy * p.vy);
  }
  return ek;
}

/**
 * Evaluates Kolmogorov-Smirnov max CDF discrepancy against analytical 2D Maxwell-Boltzmann distribution.
 */
export function evaluateMaxwellKsStat(particles: readonly DiskParticle2D[]): number {
  const gasSpeeds: number[] = [];
  let sumSq = 0;
  for (const p of particles) {
    if (p.mass > 2) continue; // exclude Brownian pollen
    const v2 = p.vx * p.vx + p.vy * p.vy;
    sumSq += v2;
    gasSpeeds.push(Math.sqrt(v2));
  }
  const n = gasSpeeds.length;
  if (n === 0) return 0;
  const vRmsSq = sumSq / n;
  gasSpeeds.sort((a, b) => a - b);
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const v = gasSpeeds[i]!;
    const fTheo = 1 - Math.exp(-(v * v) / Math.max(1e-12, vRmsSq));
    const fEmpUp = (i + 1) / n;
    const fEmpDown = i / n;
    maxD = Math.max(maxD, Math.abs(fEmpUp - fTheo), Math.abs(fTheo - fEmpDown));
  }
  return maxD;
}

export function createInitialState(params: ThermoCycleMdParams): ThermoCycleMdState {
  const particles = initMdParticles(params);
  const ek0 = totalKineticEnergy(particles);
  return {
    t: 0,
    particles,
    brownianTrail: params.brownianPollen ? [{ x: 0.5 * BOX_SIZE, y: 0.5 * BOX_SIZE }] : [],
    boxSize: BOX_SIZE,
    wallPressure: 0,
    initialKineticEnergy: ek0,
    kineticEnergy: ek0,
    cycle: evaluateClosedCycle(params)
  };
}

const sharedSpatialHash = new SpatialHash2D(GAS_RADIUS * 2.5);

export function stepThermoCycleMd(
  state: ThermoCycleMdState,
  params: ThermoCycleMdParams,
  dt: number
): StepResult<ThermoCycleMdState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const cycle = evaluateClosedCycle(params);
  if (params.mode !== 'kinetic-md-box') {
    return {
      nextState: { ...state, t: state.t + dt, cycle },
      events: []
    };
  }

  const nextParticles: DiskParticle2D[] = state.particles.map((p) => ({ ...p }));
  let wallImpulse = 0;

  for (const p of nextParticles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < p.radius) {
      p.x = 2 * p.radius - p.x;
      wallImpulse += 2 * p.mass * Math.abs(p.vx);
      p.vx = Math.abs(p.vx);
    } else if (p.x > BOX_SIZE - p.radius) {
      p.x = 2 * (BOX_SIZE - p.radius) - p.x;
      wallImpulse += 2 * p.mass * Math.abs(p.vx);
      p.vx = -Math.abs(p.vx);
    }
    if (p.y < p.radius) {
      p.y = 2 * p.radius - p.y;
      wallImpulse += 2 * p.mass * Math.abs(p.vy);
      p.vy = Math.abs(p.vy);
    } else if (p.y > BOX_SIZE - p.radius) {
      p.y = 2 * (BOX_SIZE - p.radius) - p.y;
      wallImpulse += 2 * p.mass * Math.abs(p.vy);
      p.vy = -Math.abs(p.vy);
    }
  }

  sharedSpatialHash.resolveDiskCollisions(nextParticles, 1.0);
  const ekNow = totalKineticEnergy(nextParticles);
  const wallP = wallImpulse / (4 * BOX_SIZE * dt);
  const pollen = params.brownianPollen ? nextParticles[0] : null;
  const trail = pollen
    ? [...state.brownianTrail.slice(-240), { x: pollen.x, y: pollen.y }]
    : state.brownianTrail;

  return {
    nextState: {
      ...state,
      t: state.t + dt,
      particles: nextParticles,
      brownianTrail: trail,
      wallPressure: 0.85 * state.wallPressure + 0.15 * wallP,
      kineticEnergy: ekNow,
      cycle
    },
    events: []
  };
}

export function computeObservables(state: ThermoCycleMdState, params: ThermoCycleMdParams): Record<string, number> {
  return {
    t: state.t,
    kineticEnergy: state.kineticEnergy,
    wallPressure: state.wallPressure,
    efficiencyPct: state.cycle.efficiency * 100,
    carnotEfficiencyPct: state.cycle.carnotEfficiency * 100,
    maxwellKs: params.mode === 'kinetic-md-box' ? evaluateMaxwellKsStat(state.particles) : 0
  };
}

export function checkInvariants(state: ThermoCycleMdState, _init: ThermoCycleMdState, params: ThermoCycleMdParams): InvariantReport[] {
  if (params.mode === 'kinetic-md-box') {
    const err = Math.abs(state.kineticEnergy - state.initialKineticEnergy) / Math.max(1e-9, state.initialKineticEnergy);
    return [
      {
        name: '绝热硬球 MD 总动能守恒',
        measuredError: err,
        tolerance: 1e-8,
        passed: Number.isFinite(err) && err < 1e-8
      }
    ];
  }
  const c = state.cycle;
  const err = Math.abs(c.sumDuJ) + Math.abs(c.sumQJ - c.sumWJ);
  return [
    {
      name: '热力学封闭循环 ΣΔU=0 & ΣQ=ΣW',
      measuredError: err,
      tolerance: 1e-8,
      passed: Number.isFinite(err) && err < 1e-8
    }
  ];
}
