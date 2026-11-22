import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { modernNuclearRecoilDecayPlugin } from './plugin.js';
import { nuclearRecoilPresets } from './presets.js';
import {
  createInitialState,
  solveRecoilCloudChamber,
  stepNuclearRecoilDecay,
  type NuclearRecoilDecayParams
} from './engine.js';

function getPreset(idx: number): NuclearRecoilDecayParams {
  return resolvePluginParams(modernNuclearRecoilDecayPlugin.paramSchema, nuclearRecoilPresets[idx]!.params);
}

describe('modern-nuclear-recoil-decay physics invariants (N03)', () => {
  it('matches Boris magnetic recoil radius ratio R1/R2 = q2/q1 (< 1e-6) and external vs internal tangency', () => {
    const alphaSol = solveRecoilCloudChamber(getPreset(0));
    expect(alphaSol.tangentGeometry).toBe('external');
    expect(alphaSol.chargeRatioExpected).toBe(43);
    expect(alphaSol.ratioRelError).toBeLessThan(1e-6);

    const betaSol = solveRecoilCloudChamber(getPreset(1));
    expect(betaSol.tangentGeometry).toBe('internal');
    expect(betaSol.chargeRatioExpected).toBe(91);
    expect(betaSol.ratioRelError).toBeLessThan(1e-6);
  });

  it('reproduces radioactive half-life N(k*T1/2) = N0 * 2^-k deterministically with Seeded PRNG (N0=4000)', () => {
    const params: NuclearRecoilDecayParams = {
      ...getPreset(2),
      nucleiCountN0: 4000,
      halfLifeS: 2.0,
      seed: 20261122
    };
    let stA = createInitialState(params);
    let stB = createInitialState(params);
    for (let k = 1; k <= 3; k++) {
      for (let i = 0; i < 40; i++) {
        stA = stepNuclearRecoilDecay(stA, params, 0.05).nextState;
        stB = stepNuclearRecoilDecay(stB, params, 0.05).nextState;
      }
      expect(stA.remainingCount).toBe(stB.remainingCount);
      const frac = stA.remainingCount / 4000;
      const expected = Math.pow(0.5, k);
      expect(Math.abs(frac - expected)).toBeLessThan(0.025);
    }
  });

  it('handles dt=0 and chain criticality cleanly without NaN', () => {
    const p = getPreset(3);
    const st = createInitialState(p);
    expect(stepNuclearRecoilDecay(st, p, 0).nextState.t).toBe(0);
    expect(Number.isFinite(st.kEff)).toBe(true);
  });
});
