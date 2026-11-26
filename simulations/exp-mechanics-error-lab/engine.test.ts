import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { expMechanicsErrorLabPlugin } from './plugin.js';
import { mechanicsErrorPresets } from './presets.js';
import {
  computeTrueCartAcceleration,
  createInitialState,
  solveMechanicsErrorAnalysis,
  stepMechanicsErrorLab,
  type MechanicsErrorParams
} from './engine.js';

function getPreset(idx: number): MechanicsErrorParams {
  return resolvePluginParams(expMechanicsErrorLabPlugin.paramSchema, mechanicsErrorPresets[idx]!.params);
}

describe('exp-mechanics-error-lab invariants (X01)', () => {
  it('achieves < 1e-10 successive-difference error at zero noise and recovers F-axis/a-axis systematic intercepts', () => {
    const under = getPreset(0);
    const sUnder = solveMechanicsErrorAnalysis(under);
    expect(sUnder.diffErrorMps2).toBeLessThan(1e-10);
    expect(sUnder.analyticInterceptF).toBeGreaterThan(0);

    const over = { ...getPreset(1), readingNoiseMm: 0 };
    const sOver = solveMechanicsErrorAnalysis(over);
    expect(sOver.diffErrorMps2).toBeLessThan(1e-10);
    expect(sOver.analyticInterceptA).toBeGreaterThan(0);
  });

  it('strictly reproduces heavy-hanger bend F/(M + F/g) within < 1e-10 at zero noise', () => {
    const bend = getPreset(2);
    const sBend = solveMechanicsErrorAnalysis(bend);
    for (const pt of sBend.afCurve) {
      const exact = pt.fAppN / (bend.cartMassKg + pt.fAppN / 9.8);
      expect(Math.abs(pt.aMeasured - exact)).toBeLessThan(1e-10);
    }
  });

  it('handles dt=0 and deterministic seeded Gaussian noise cleanly without NaN', () => {
    const p = { ...getPreset(1), readingNoiseMm: 0.2 };
    const s1 = createInitialState(p);
    const s2 = createInitialState(p);
    expect(s1.aDiffMeasuredMps2).toBe(s2.aDiffMeasuredMps2);
    expect(stepMechanicsErrorLab(s1, p, 0).nextState.t).toBe(0);
  });

  it('keeps the draggable ruler offset visual-only and clamps its range', () => {
    const params = resolvePluginParams(expMechanicsErrorLabPlugin.paramSchema, { rulerOffsetCm: 2.4 });
    const state = createInitialState(params);
    const plugin = expMechanicsErrorLabPlugin as SimulationPluginV2<typeof params, typeof state>;
    const handle = plugin.getControlHandles?.(state, params)?.find((item) => item.id === 'tape-ruler-origin');

    expect(handle).toBeDefined();
    expect(Number(handle?.onDrag({ x: 99, y: handle.position.y })['rulerOffsetCm'])).toBe(20);
    expect(solveMechanicsErrorAnalysis(params).aDiffMeasuredMps2).toBe(state.aDiffMeasuredMps2);
  });
});

describe('F08 independent mechanics-error regressions (pre-fix)', () => {
  it('uses the same force law for the heavy-hanger sweep and the active paper tape even when compensation changes', () => {
    const p = { ...getPreset(2), trackTiltDeg: 4, frictionForceN: 0.05, readingNoiseMm: 0 };
    const s = solveMechanicsErrorAnalysis(p);
    const bias = p.cartMassKg * 9.8 * Math.sin(4 * Math.PI / 180) - p.frictionForceN;
    for (const pt of s.afCurve) {
      const expected = (pt.fAppN + bias) / (p.cartMassKg + pt.fAppN / 9.8);
      expect(pt.aAnalytic).toBeCloseTo(expected, 10);
      expect(pt.aMeasured).toBeCloseTo(expected, 10);
    }
    const point = s.afCurve.find(pt => Math.abs(pt.fAppN - p.hangerMassKg * 9.8) < 1e-12);
    expect(point).toBeDefined();
    expect(point!.aAnalytic).toBeCloseTo(s.aTrueMps2, 10);
  });

  it('evaluates the unloaded positive-acceleration intercept without an invented hanging mass', () => {
    const M = 0.4, theta = 4, f = 0.05;
    const expected = 9.8 * Math.sin(theta * Math.PI / 180) - f / M;
    expect(expected).toBeGreaterThan(0);
    expect(computeTrueCartAcceleration(M, 0, theta, f)).toBeCloseTo(expected, 10);
  });

  it('makes all four stated a-F teaching comparisons available as balanced or deliberately biased presets', () => {
    expect(new Set(mechanicsErrorPresets.map(p => p.params.scenario))).toEqual(new Set([
      'ideal-compensated', 'under-compensated', 'over-compensated', 'heavy-hanger-bend'
    ]));
    const preset = mechanicsErrorPresets.find(p => p.params.scenario === 'ideal-compensated')!;
    const p = resolvePluginParams(expMechanicsErrorLabPlugin.paramSchema, preset.params);
    expect(p.cartMassKg * 9.8 * Math.sin(p.trackTiltDeg * Math.PI / 180) - p.frictionForceN).toBeCloseTo(0, 10);
  });

  it('keeps all exported measured points in the diagram viewBox at a valid high-acceleration boundary', () => {
    const p = { ...getPreset(2), cartMassKg: 0.1, readingNoiseMm: 0 };
    const state = createInitialState(p);
    const plugin = expMechanicsErrorLabPlugin as SimulationPluginV2<typeof p, typeof state>;
    const diagram = plugin.exportDiagramIR!(state, p);
    const curve = diagram.primitives.find(q => q.kind === 'polyline');
    expect(curve).toBeDefined();
    if (curve?.kind !== 'polyline') throw new Error('missing measured curve');
    expect(curve.points.length).toBe(state.afCurve.length);
    for (const point of curve.points) {
      expect(point.x).toBeGreaterThanOrEqual(diagram.viewBox.minX);
      expect(point.x).toBeLessThanOrEqual(diagram.viewBox.maxX);
      expect(point.y).toBeGreaterThanOrEqual(diagram.viewBox.minY);
      expect(point.y).toBeLessThanOrEqual(diagram.viewBox.maxY);
    }
  });
});
