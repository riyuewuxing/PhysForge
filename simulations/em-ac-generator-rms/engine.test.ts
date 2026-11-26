import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emAcGeneratorRmsPlugin } from './plugin.js';
import { acGeneratorPresets } from './presets.js';
import {
  checkInvariants,
  computeRmsSimpson,
  createInitialState,
  stepAcGeneratorRms,
  type AcGeneratorParams
} from './engine.js';

function getPreset(idx: number): AcGeneratorParams {
  return resolvePluginParams(emAcGeneratorRmsPlugin.paramSchema, acGeneratorPresets[idx]!.params);
}

describe('em-ac-generator-rms Simpson RMS & waveform tests (E07)', () => {
  it('computes RMS values across all 6 waveforms within < 1e-6 relative error', () => {
    const base = getPreset(0);
    const omega = 2 * Math.PI * base.freqHz;
    const uPeak = base.turnsN * base.magneticB * base.coilAreaS * omega;

    // 1. Sine: Um / sqrt(2)
    expect(Math.abs(computeRmsSimpson(uPeak, { ...base, waveform: 'sine' }) - uPeak / Math.SQRT2) / uPeak).toBeLessThan(1e-6);

    // 2. Half-wave rectified: Um / 2
    expect(Math.abs(computeRmsSimpson(uPeak, { ...base, waveform: 'half-wave' }) - uPeak / 2) / uPeak).toBeLessThan(1e-6);

    // 3. Full-wave rectified: Um / sqrt(2)
    expect(Math.abs(computeRmsSimpson(uPeak, { ...base, waveform: 'full-wave' }) - uPeak / Math.SQRT2) / uPeak).toBeLessThan(1e-6);

    // 4. Duty-cycle square wave (D = 0.25): Um * sqrt(0.25) = 0.5 * Um
    expect(
      Math.abs(computeRmsSimpson(uPeak, { ...base, waveform: 'duty-square', dutyCycleD: 0.25 }) - uPeak * Math.sqrt(0.25)) /
        uPeak
    ).toBeLessThan(1e-6);

    // 5. Sawtooth: Um / sqrt(3)
    expect(
      Math.abs(computeRmsSimpson(uPeak, { ...base, waveform: 'sawtooth' }) - uPeak / Math.sqrt(3)) / uPeak
    ).toBeLessThan(1e-6);

    // 6. DC + sine: sqrt(Udc^2 + Um^2 / 2)
    const dc = 10;
    const expectedDcSine = Math.hypot(dc, uPeak / Math.SQRT2);
    expect(
      Math.abs(computeRmsSimpson(uPeak, { ...base, waveform: 'dc-plus-sine', dcOffsetV: dc }) - expectedDcSine) /
        expectedDcSine
    ).toBeLessThan(1e-6);
  });

  it('matches integrated Joule heat over full period with P_avg * T within < 1e-6 and handles B=0', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    const period = 1 / p.freqHz;
    for (let i = 0; i < 100; i++) {
      st = stepAcGeneratorRms(st, p, period / 100).nextState;
    }
    expect(Math.abs(st.jouleHeatJ - st.pAvgW * period) / st.jouleHeatJ).toBeLessThan(1e-6);

    const zeroB: AcGeneratorParams = { ...p, magneticB: 0 };
    const s0 = createInitialState(zeroB);
    expect(stepAcGeneratorRms(s0, zeroB, 0).nextState).toEqual(s0);
    expect(Number.isFinite(stepAcGeneratorRms(s0, zeroB, 0.1).nextState.uRmsV)).toBe(true);
  });
});

describe('E07 independent interval heat and truthful audit', () => {
  const base = { ...getPreset(0), freqHz: 1, loadR: 7 };
  const amplitude = base.turnsN * base.magneticB * base.coilAreaS * 2 * Math.PI;
  const scale = amplitude * amplitude / base.loadR;
  it('integrates a full rectangular pulse period even when one step crosses both jumps', () => {
    const p: AcGeneratorParams = { ...base, waveform: 'duty-square', dutyCycleD: 0.23 };
    const s = stepAcGeneratorRms(createInitialState(p), p, 1).nextState;
    expect(s.jouleHeatJ / scale).toBeCloseTo(0.23, 10);
  });
  it('integrates a fractional sine period without depending on step partition', () => {
    const p: AcGeneratorParams = { ...base, waveform: 'sine' };
    const dt = 0.37;
    const expected = scale * (dt / 2 - Math.sin(4 * Math.PI * dt) / (8 * Math.PI));
    const s0 = createInitialState(p);
    const one = stepAcGeneratorRms(s0, p, dt).nextState;
    let split = s0;
    for (let i = 0; i < 37; i++) split = stepAcGeneratorRms(split, p, dt / 37).nextState;
    expect(one.jouleHeatJ / scale).toBeCloseTo(expected / scale, 10);
    expect(split.jouleHeatJ / scale).toBeCloseTo(one.jouleHeatJ / scale, 10);
  });
  it('integrates a sawtooth across a reset and several complete cycles', () => {
    const p: AcGeneratorParams = { ...base, waveform: 'sawtooth' };
    const f = 0.27;
    const expected = 3 / 3 + 4 * f ** 3 / 3 - 2 * f ** 2 + f;
    const s = stepAcGeneratorRms(createInitialState(p), p, 3 + f).nextState;
    expect(s.jouleHeatJ / scale).toBeCloseTo(expected, 10);
  });
  it('integrates half-wave heat across off and on intervals', () => {
    const p: AcGeneratorParams = { ...base, waveform: 'half-wave' };
    const s = stepAcGeneratorRms(createInitialState(p), p, 1.75).nextState;
    expect(s.jouleHeatJ / scale).toBeCloseTo(0.5, 10);
  });
  it('reports a deliberately corrupted RMS and heat state as an invariant failure', () => {
    const p: AcGeneratorParams = { ...base, waveform: 'sine' };
    const initial = createInitialState(p);
    const s = stepAcGeneratorRms(initial, p, 0.75).nextState;
    const bad = { ...s, uRmsV: s.uRmsV * 1.5, jouleHeatJ: s.jouleHeatJ + scale };
    const reports = checkInvariants(bad, initial, p);
    expect(reports.some(r => !r.passed && r.measuredError > r.tolerance)).toBe(true);
  });
});
