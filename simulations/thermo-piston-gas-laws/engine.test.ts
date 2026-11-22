import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { thermoPistonGasLawsPlugin } from './plugin.js';
import { thermoGasPresets } from './presets.js';
import {
  P_ATM,
  R_GAS,
  computeDetachCriticalTempK,
  computeMultiStrokePressure,
  createInitialState,
  stepThermoGasLaws,
  type ThermoGasParams
} from './engine.js';

function getPreset(idx: number): ThermoGasParams {
  return resolvePluginParams(thermoPistonGasLawsPlugin.paramSchema, thermoGasPresets[idx]!.params);
}

describe('thermo-piston-gas-laws hybrid stop-pin & pump invariants (T01)', () => {
  it('captures exact piston stop-pin detachment critical temperature (< 1e-7 K) and satisfies PV/(nRT) = 1 (< 1e-10)', () => {
    const params = getPreset(0);
    const expectedTCrit = computeDetachCriticalTempK(params);
    let st = createInitialState(params);
    expect(st.mode).toBe('pinned');

    for (let i = 0; i < 60; i++) {
      st = stepThermoGasLaws(st, params, 0.05).nextState;
      const pvErr = Math.abs((st.pressurePa * st.volumeM3) / (st.molesN * R_GAS * st.temperatureK) - 1);
      expect(pvErr).toBeLessThan(1e-10);
    }

    expect(st.mode).toBe('floating');
    expect(st.detachTempK).not.toBeNull();
    expect(Math.abs(st.detachTempK! - expectedTCrit)).toBeLessThan(1e-7);
  });

  it('matches k-stroke vacuum extraction formula P0*(V/(V+dV))^k within < 1e-10', () => {
    const params = getPreset(2);
    const expected = P_ATM * Math.pow(params.tankVolumeL / (params.tankVolumeL + params.pumpDeltaVL), params.pumpStrokesK);
    const measured = computeMultiStrokePressure(params);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(1e-10);
  });

  it('handles zero tilt and zero dt cleanly without NaN', () => {
    const tilt = { ...getPreset(1), tubeTiltDeg: 0 };
    const s0 = createInitialState(tilt);
    expect(stepThermoGasLaws(s0, tilt, 0).nextState).toEqual(s0);
    expect(Number.isFinite(s0.pressurePa)).toBe(true);
  });
});
