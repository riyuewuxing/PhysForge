import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { stseEmDevicesSuitePlugin } from './plugin.js';
import { emDevicesPresets } from './presets.js';
import {
  computeCyclotronExitMetrics,
  computeHallVoltageV,
  computeMhdMetrics,
  createInitialState,
  stepEmDevices,
  type EmDevicesParams
} from './engine.js';

function getPreset(idx: number): EmDevicesParams {
  return resolvePluginParams(stseEmDevicesSuitePlugin.paramSchema, emDevicesPresets[idx]!.params);
}

describe('stse-em-devices-suite physics invariants (S02)', () => {
  it('matches classic cyclotron exit kinetic energy (< 1e-5) and demonstrates relativistic detuning', () => {
    const classic = getPreset(0);
    const metrics = computeCyclotronExitMetrics(classic);
    expect(metrics.relError).toBeLessThan(1e-5);

    const rel = { ...classic, bFieldT: 3.5, cyclotronRadiusM: 1.0, relativisticDetune: true };
    const relMetrics = computeCyclotronExitMetrics(rel);
    expect(relMetrics.discreteMaxJ).toBeLessThanOrEqual(relMetrics.analyticalMaxJ);
  });

  it('flips Hall voltage sign between electron and hole (< 1e-8) and maximizes MHD power at R = r', () => {
    const pElec = getPreset(1);
    const uElec = computeHallVoltageV(pElec);
    const uHole = computeHallVoltageV({ ...pElec, carrierType: 'hole' });
    expect(uElec).toBeLessThan(0);
    expect(uHole).toBeGreaterThan(0);
    expect(Math.abs(uElec + uHole)).toBeLessThan(1e-8);

    const pMhd = getPreset(2);
    const mMatch = computeMhdMetrics(pMhd);
    const mAtExactR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm });
    const mLowR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm * 0.5 });
    const mHighR = computeMhdMetrics({ ...pMhd, mhdLoadOhm: mMatch.internalOhm * 2.0 });
    expect(Math.abs(mAtExactR.outputWatt - mAtExactR.maxPowerWatt)).toBeLessThan(1e-8);
    expect(mAtExactR.outputWatt).toBeGreaterThan(mLowR.outputWatt);
    expect(mAtExactR.outputWatt).toBeGreaterThan(mHighR.outputWatt);
  });

  it('handles dt=0 cleanly across all 6 devices without NaN', () => {
    for (const dev of ['velocity-selector', 'mass-spectrometer', 'cyclotron', 'hall-sensor', 'mhd-generator', 'em-flowmeter'] as const) {
      const p: EmDevicesParams = { ...getPreset(0), device: dev };
      const st = createInitialState(p);
      expect(stepEmDevices(st, p, 0).nextState.t).toBe(0);
      expect(Number.isFinite(st.selectedSpeed)).toBe(true);
    }
  });
});
