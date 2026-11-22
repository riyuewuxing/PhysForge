import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { mechShmResonancePlugin } from './plugin.js';
import { shmResonancePresets } from './presets.js';
import {
  computeNaturalOmega,
  computeObservables,
  computeTheoreticalResonanceOmega,
  createInitialState,
  stepShmResonance,
  type ShmResonanceParams
} from './engine.js';

function getPreset(idx: number): ShmResonanceParams {
  return resolvePluginParams(mechShmResonancePlugin.paramSchema, shmResonancePresets[idx]!.params);
}

describe('mech-shm-resonance nonlinear pendulum & resonance invariants (M11)', () => {
  it('matches T0 = 2*pi*sqrt(L/g) within < 1e-4 at 2 degree small-angle oscillation', () => {
    const params = getPreset(0);
    const expectedT0 = 2 * Math.PI * Math.sqrt(params.lengthL / params.gravityG);
    let state = createInitialState(params);
    for (let i = 0; i < 600; i++) {
      state = stepShmResonance(state, params, 0.01).nextState;
    }
    expect(state.measuredPeriod).not.toBeNull();
    const relErr = Math.abs(state.measuredPeriod! - expectedT0) / expectedT0;
    expect(relErr).toBeLessThan(1e-4);
  });

  it('conserves mechanical energy (< 1e-6) during 10-period undamped 60 degree large-angle oscillation', () => {
    const params = getPreset(1);
    let state = createInitialState(params);
    const e0 = state.initialEnergy;
    const tEnd = 10 * ((2 * Math.PI) / computeNaturalOmega(params));
    const steps = Math.ceil(tEnd / 0.02);
    for (let i = 0; i < steps; i++) {
      state = stepShmResonance(state, params, 0.02).nextState;
    }
    const obs = computeObservables(state, params);
    const relErr = Math.abs(obs.mechanicalEnergy! - e0) / e0;
    expect(relErr).toBeLessThan(1e-6);
    expect(Math.abs(state.theta - state.thetaLinear)).toBeGreaterThan(0.05);
  });

  it('achieves steady-state forced amplitude peak near omega_res = sqrt(w0^2 - 2*gamma^2)', () => {
    const base: ShmResonanceParams = {
      mode: 'forced-resonance',
      lengthL: 1,
      gravityG: 9.8,
      massM: 1,
      initialAngleDeg: 0,
      dampingGamma: 0.45,
      driveAccelAmp: 0.15,
      driveOmega: 3
    };
    const wRes = computeTheoreticalResonanceOmega(base);
    const sweepOmega = [wRes * 0.78, wRes * 0.9, wRes, wRes * 1.1, wRes * 1.22];
    const steadyAmps = sweepOmega.map((wd) => {
      const p: ShmResonanceParams = { ...base, driveOmega: wd };
      let st = createInitialState(p);
      for (let i = 0; i < 900; i++) {
        st = stepShmResonance(st, p, 0.02).nextState;
      }
      let peak = 0;
      for (let i = 0; i < 300; i++) {
        st = stepShmResonance(st, p, 0.02).nextState;
        peak = Math.max(peak, Math.abs(st.theta));
      }
      return peak;
    });

    const maxIdx = steadyAmps.indexOf(Math.max(...steadyAmps));
    expect(maxIdx).toBe(2);
  });

  it('remains finite on zero angle and zero dt boundaries', () => {
    const params: ShmResonanceParams = { ...getPreset(0), initialAngleDeg: 0 };
    const s0 = createInitialState(params);
    expect(stepShmResonance(s0, params, 0).nextState).toEqual(s0);
    const s1 = stepShmResonance(s0, params, 0.05).nextState;
    expect(Number.isFinite(s1.theta)).toBe(true);
  });
});
