import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { expMechanicsErrorLabPlugin } from './plugin.js';
import { mechanicsErrorPresets } from './presets.js';
import {
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
});
