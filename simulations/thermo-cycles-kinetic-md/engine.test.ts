import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { thermoCyclesKineticMdPlugin } from './plugin.js';
import { thermoCycleMdPresets } from './presets.js';
import {
  createInitialState,
  evaluateClosedCycle,
  evaluateMaxwellKsStat,
  stepThermoCycleMd,
  type ThermoCycleMdParams
} from './engine.js';

function getPreset(idx: number): ThermoCycleMdParams {
  return resolvePluginParams(thermoCyclesKineticMdPlugin.paramSchema, thermoCycleMdPresets[idx]!.params);
}

describe('thermo-cycles-kinetic-md cycles & SpatialHash2D MD invariants (T02)', () => {
  it('conserves energy (sum dU=0, sum Q = sum W) within < 1e-10/1e-8 for Carnot and rectangular cycles', () => {
    for (const idx of [1, 2]) {
      const p = getPreset(idx);
      const c = evaluateClosedCycle(p);
      expect(Math.abs(c.sumDuJ)).toBeLessThan(1e-10);
      expect(Math.abs(c.sumQJ - c.sumWJ)).toBeLessThan(1e-8);
      if (idx === 1) {
        expect(Math.abs(c.efficiency - (1 - p.tColdK / p.tHotK))).toBeLessThan(1e-12);
      } else {
        expect(c.efficiency).toBeLessThan(c.carnotEfficiency);
      }
    }
  });

  it('conserves kinetic energy (< 1e-8) over 1000 adiabatic hard-disk MD steps and matches 2D Maxwell-Boltzmann', () => {
    const p: ThermoCycleMdParams = { ...getPreset(0), particleCountN: 300, brownianPollen: false };
    const s0 = createInitialState(p);
    let st = s0;
    for (let i = 0; i < 1000; i++) {
      st = stepThermoCycleMd(st, p, 0.005).nextState;
    }

    const relEnergyDrift = Math.abs(st.kineticEnergy - s0.kineticEnergy) / s0.kineticEnergy;
    expect(relEnergyDrift).toBeLessThan(1e-8);

    // KS critical value at N=300, alpha=0.05 is ~ 1.36 / sqrt(300) = 0.0785
    const ksStat = evaluateMaxwellKsStat(st.particles);
    expect(ksStat).toBeLessThan(0.0785);
  });

  it('reproduces identically with same seed and handles dt=0 cleanly', () => {
    const p = getPreset(0);
    const a = stepThermoCycleMd(createInitialState(p), p, 0.01).nextState;
    const b = stepThermoCycleMd(createInitialState(p), p, 0.01).nextState;
    expect(a.kineticEnergy).toBe(b.kineticEnergy);
    expect(stepThermoCycleMd(createInitialState(p), p, 0).nextState.t).toBe(0);
  });
});
