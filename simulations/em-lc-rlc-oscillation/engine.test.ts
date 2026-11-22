import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emLcRlcOscillationPlugin } from './plugin.js';
import { lcRlcPresets } from './presets.js';
import {
  checkInvariants,
  computeLcNaturalOmega,
  createInitialState,
  stepLcRlcOscillation,
  type LcRlcParams
} from './engine.js';

function getPreset(idx: number): LcRlcParams {
  return resolvePluginParams(emLcRlcOscillationPlugin.paramSchema, lcRlcPresets[idx]!.params);
}

describe('em-lc-rlc-oscillation period, 20-cycle conservation, and resonance peak (E09)', () => {
  it('conserves LC energy (< 1e-5) over 20 full periods and matches T = 2*pi*sqrt(L*C) (< 1e-5)', () => {
    const params = getPreset(0);
    const w0 = computeLcNaturalOmega(params);
    const expectedT = (2 * Math.PI) / w0;
    const initial = createInitialState(params);
    let st = initial;
    const dt = expectedT / 50;
    for (let i = 0; i < 20 * 50; i++) {
      st = stepLcRlcOscillation(st, params, dt).nextState;
    }

    expect(st.measuredPeriod).not.toBeNull();
    expect(Math.abs(st.measuredPeriod! - expectedT) / expectedT).toBeLessThan(1e-5);
    const reports = checkInvariants(st, initial, params);
    expect(reports[0]!.passed).toBe(true);
    expect(reports[0]!.measuredError).toBeLessThan(1e-5);
  });

  it('reaches exact resonance current amplitude Um / R at omega = 1/sqrt(LC)', () => {
    const resParams = getPreset(1); // omega = 1/sqrt(0.25*0.1) = 6.324555, Um=10, R=2 => Ipeak = 5.0 A
    let st = createInitialState(resParams);
    // Decay time constant tau = 2L/R = 0.25 s; integrate 4 s (> 16 tau) to true steady state
    for (let i = 0; i < 400; i++) {
      st = stepLcRlcOscillation(st, resParams, 0.01).nextState;
    }
    let peakI = 0;
    for (let i = 0; i < 200; i++) {
      st = stepLcRlcOscillation(st, resParams, 0.005).nextState;
      peakI = Math.max(peakI, Math.abs(st.currentI));
    }
    const expectedI = resParams.driveVoltAmpUm / resParams.resistanceR;
    expect(Math.abs(peakI - expectedI) / expectedI).toBeLessThan(1e-4);
  });

  it('handles zero drive voltage and zero dt boundaries cleanly', () => {
    const p0: LcRlcParams = { ...getPreset(1), driveVoltAmpUm: 0 };
    const s0 = createInitialState(p0);
    expect(stepLcRlcOscillation(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepLcRlcOscillation(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.chargeQ)).toBe(true);
  });
});
