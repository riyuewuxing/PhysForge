import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { opticsWaveInterferencePlugin } from './plugin.js';
import { waveOpticsPresets } from './presets.js';
import {
  computeKeyOpticsMetrics,
  createInitialState,
  evalFraunhoferGratingIntensity,
  evalNewtonRingIntensity,
  evalThinFilmIntensity,
  stepWaveOptics,
  type WaveOpticsParams
} from './engine.js';

function getPreset(idx: number): WaveOpticsParams {
  return resolvePluginParams(opticsWaveInterferencePlugin.paramSchema, waveOpticsPresets[idx]!.params);
}

describe('optics-wave-interference wedge, Newton rings & missing order (O01)', () => {
  it('verifies air wedge fringe spacing delta_x = lambda/(2 n tan alpha) within < 1e-6', () => {
    const p = getPreset(0);
    const { wedgeSpacingMm } = computeKeyOpticsMetrics(p);
    // Exact dark fringe positions occur when 2*d = m*lambda (due to half-wave shift at bottom)
    expect(evalThinFilmIntensity(0, p)).toBeLessThan(1e-12);
    expect(evalThinFilmIntensity(wedgeSpacingMm, p)).toBeLessThan(1e-12);
    expect(evalThinFilmIntensity(0.5 * wedgeSpacingMm, p)).toBeGreaterThan(1 - 1e-12);
  });

  it('matches Newton rings dark fringe radii r_k = sqrt(k * R * lambda) within < 1e-4', () => {
    const p = getPreset(2);
    const { newtonR1Mm } = computeKeyOpticsMetrics(p);
    for (const k of [1, 2, 3]) {
      const rk = newtonR1Mm * Math.sqrt(k);
      expect(evalNewtonRingIntensity(rk, p)).toBeLessThan(1e-4);
    }
  });

  it('suppresses missing order 3 (I < 1e-10) when d/a = 3 in Fraunhofer grating diffraction', () => {
    const p = getPreset(3); // slitWidth=4 um, gratingPitch=12 um -> d/a = 3
    const lambdaUm = p.wavelengthNm * 1e-3;
    const sinThetaOrder3 = (3 * lambdaUm) / p.gratingPitchMicron; // = lambda / a
    const missingIntensity = evalFraunhoferGratingIntensity(sinThetaOrder3, p);
    expect(missingIntensity).toBeLessThan(1e-10);

    // Order 1 remains strong
    const order1 = evalFraunhoferGratingIntensity((1 * lambdaUm) / p.gratingPitchMicron, p);
    expect(order1).toBeGreaterThan(0.4);
  });

  it('handles dt=0 and N=1 boundaries cleanly without NaN', () => {
    const p0: WaveOpticsParams = { ...getPreset(3), slitCountN: 1 };
    const s0 = createInitialState(p0);
    expect(stepWaveOptics(s0, p0, 0).nextState.t).toBe(0);
    expect(Number.isFinite(evalFraunhoferGratingIntensity(0, p0))).toBe(true);
  });
});
