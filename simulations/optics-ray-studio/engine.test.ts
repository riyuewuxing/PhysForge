import { describe, expect, it } from 'vitest';
import { degToRad } from '@physforge/physics-core';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepOptics,
  type OpticsParams
} from './engine.js';

const baseParams: OpticsParams = {
  sceneMode: 'tir-interface',
  incidentAngleDeg: 30,
  n1: 1.5,
  n2: 1.0,
  slabThickness: 1.0,
  prismApexDeg: 60,
  fiberHalfWidth: 0.3,
  wavelengthNm: 600,
  slitSeparationMm: 0.5,
  screenDistanceM: 1.5,
  animateSweep: false
};

describe('optics-ray-studio engine', () => {
  it('satisfies Snell law and triggers exact critical angle total internal reflection', () => {
    // n1=1.5, n2=1.0 -> critical angle arcsin(2/3) ≈ 41.8103°
    const belowCrit = createInitialState({ ...baseParams, incidentAngleDeg: 30 });
    expect(belowCrit.isTotalInternalReflection).toBe(false);
    expect(belowCrit.criticalAngleDeg!).toBeCloseTo(41.8103149, 5);
    const expectedTheta2 = Math.asin((1.5 * Math.sin(degToRad(30))) / 1.0);
    expect(degToRad(belowCrit.refractedAngleDeg!)).toBeCloseTo(expectedTheta2, 8);
    expect(checkInvariants(belowCrit, belowCrit, baseParams)[0]?.passed).toBe(true);

    const aboveCrit = createInitialState({ ...baseParams, incidentAngleDeg: 45 });
    expect(aboveCrit.isTotalInternalReflection).toBe(true);
    expect(aboveCrit.refractedAngleDeg).toBeNull();
  });

  it('matches analytical parallel-slab lateral displacement (< 1e-6)', () => {
    const slabParams: OpticsParams = {
      ...baseParams,
      sceneMode: 'parallel-slab',
      incidentAngleDeg: 50,
      n1: 1.5,
      slabThickness: 1.2
    };
    const s = createInitialState(slabParams);
    const theta1 = degToRad(50);
    const theta2 = Math.asin(Math.sin(theta1) / 1.5);
    const exactShift = (1.2 * Math.sin(theta1 - theta2)) / Math.cos(theta2);
    expect(Math.abs(s.lateralShift - exactShift)).toBeLessThan(1e-6);
  });

  it('matches analytical double-slit fringe spacing Δx = L*λ/d', () => {
    const slitParams: OpticsParams = {
      ...baseParams,
      sceneMode: 'double-slit',
      wavelengthNm: 600,
      slitSeparationMm: 0.5,
      screenDistanceM: 1.5
    };
    const s = createInitialState(slitParams);
    // (1.5 * 600e-9 / 0.5e-3) * 1e3 = 1.8 mm
    expect(s.fringeSpacingMm).toBeCloseTo(1.8, 10);
  });

  it('starts the sweep at the configured incident angle without a discontinuity', () => {
    const sweepingParams = { ...baseParams, incidentAngleDeg: 35, animateSweep: true };
    const initial = createInitialState(sweepingParams);
    expect(initial.activeAngleDeg).toBe(35);

    const firstStep = stepOptics(initial, sweepingParams, 1 / 240).nextState;
    expect(Math.abs(firstStep.activeAngleDeg - initial.activeAngleDeg)).toBeLessThan(0.2);
  });

  it('handles optical fiber TIR guidance and dt=0 without NaN', () => {
    const fiber = createInitialState({
      ...baseParams,
      sceneMode: 'optical-fiber',
      incidentAngleDeg: 20,
      n1: 1.6,
      n2: 1.4
    });
    expect(fiber.isTotalInternalReflection).toBe(true);
    const stepped = stepOptics(fiber, { ...baseParams, sceneMode: 'optical-fiber' }, 0).nextState;
    const obs = computeObservables(stepped);
    for (const v of Object.values(obs)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
