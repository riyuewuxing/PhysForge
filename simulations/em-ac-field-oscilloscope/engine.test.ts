import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emAcFieldOscilloscopePlugin } from './plugin.js';
import { acScopePresets } from './presets.js';
import {
  computeObservables,
  createInitialState,
  integrateDeflectionTrajectory,
  stepAcScope,
  type AcScopeParams
} from './engine.js';

function getPreset(idx: number): AcScopeParams {
  return resolvePluginParams(emAcFieldOscilloscopePlugin.paramSchema, acScopePresets[idx]!.params);
}

describe('em-ac-field-oscilloscope physics invariants (E03)', () => {
  it('matches oscilloscope plate deflection formula within < 1e-6 via numerical RK4 verification', () => {
    const { numericY, analyticalY } = integrateDeflectionTrajectory(1200, 80);
    const relErr = Math.abs(numericY - analyticalY) / Math.abs(analyticalY);
    expect(relErr).toBeLessThan(1e-6);
  });

  it('yields zero net displacement (< 1e-7 m) over one full square-wave period for particle released at t0 = T/4', () => {
    const params = getPreset(0); // square-wave T=2.0s => t0 = 0.5s, one full period later = 2.5s
    let state = createInitialState(params);
    const steps = 125; // dt = 0.02s => 2.50s
    for (let i = 0; i < steps; i++) {
      state = stepAcScope(state, params, 0.02).nextState;
    }
    const quarterParticle = state.particles[2]!;
    expect(quarterParticle.t0Frac).toBe(0.25);
    expect(Math.abs(quarterParticle.x)).toBeLessThan(1e-7);
    expect(Math.abs(quarterParticle.v)).toBeLessThan(1e-7);

    // Meanwhile t0=0 particle advances strictly monotonically forward
    expect(state.particles[0]!.x).toBeGreaterThan(2.0);
  });

  it('conserves equivalent-gravity pendulum total energy within < 1e-5', () => {
    const params = getPreset(2);
    let state = createInitialState(params);
    const e0 = state.initialEqEnergy;
    for (let i = 0; i < 150; i++) {
      state = stepAcScope(state, params, 0.02).nextState;
    }
    const obs = computeObservables(state, params);
    const relErr = Math.abs(obs.eqTotalEnergy! - e0) / Math.max(1, Math.abs(e0));
    expect(relErr).toBeLessThan(1e-5);
  });

  it('handles zero acceleration and zero dt cleanly without NaN', () => {
    const p0: AcScopeParams = { ...getPreset(0), accelA0: 0 };
    const s0 = createInitialState(p0);
    expect(stepAcScope(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepAcScope(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.particles[0]!.x)).toBe(true);
  });
});
