import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { expElectricalErrorLabPlugin } from './plugin.js';
import { electricalErrorPresets } from './presets.js';
import {
  createInitialState,
  decodeInstruments,
  solveBulbCurveViaMna,
  solveEmfViaMna,
  solveHalfBiasViaMna,
  stepElectricalErrorLab,
  type ElectricalErrorParams
} from './engine.js';

function getPreset(idx: number): ElectricalErrorParams {
  return resolvePluginParams(expElectricalErrorLabPlugin.paramSchema, electricalErrorPresets[idx]!.params);
}

describe('exp-electrical-error-lab MNA & precision instrument invariants (X02)', () => {
  it('matches non-ideal MNA E/r fitted slope and intercept against analytical bias within < 1e-6', () => {
    const outer = solveEmfViaMna(getPreset(0));
    expect(outer.fitError).toBeLessThan(1e-6);
    expect(outer.eFittedV).toBeLessThan(3.0);
    expect(outer.rFittedOhm).toBeLessThan(1.5);

    const inner = solveEmfViaMna({ ...getPreset(0), emfWiring: 'ammeter-in-series' });
    expect(inner.fitError).toBeLessThan(1e-6);
    expect(Math.abs(inner.eFittedV - 3.0)).toBeLessThan(1e-6);
    expect(Math.abs(inner.rFittedOhm - (1.5 + 0.4))).toBeLessThan(1e-6);
  });

  it('proves half-bias Rg_measured < Rg_true and monotonically converges toward Rg_true as R1 grows', () => {
    const lowV = solveHalfBiasViaMna(1.5, 120);
    const highV = solveHalfBiasViaMna(12.0, 120);
    expect(lowV.rgMeasuredOhm).toBeLessThan(120);
    expect(highV.rgMeasuredOhm).toBeLessThan(120);
    expect(highV.rgMeasuredOhm).toBeGreaterThan(lowV.rgMeasuredOhm);
  });

  it('verifies nonlinear lamp divider vs current-limit range, zero-error caliper/micrometer, and dt=0', () => {
    const divider = solveBulbCurveViaMna(getPreset(2));
    const limiter = solveBulbCurveViaMna({ ...getPreset(2), bulbWiring: 'current-limit' });
    expect(divider[0]!.voltageV).toBeLessThan(0.05);
    expect(limiter[0]!.voltageV).toBeGreaterThan(0.3);

    const inst = decodeInstruments(23.46, '50', 5.73);
    expect(inst.vernierReadoutMm).toBe(23.46);
    expect(inst.vernierCoincidentIndex).toBe(23);
    expect(inst.microReadoutMm).toBe(5.73);

    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepElectricalErrorLab(st, p, 0).nextState.t).toBe(0);
  });

  it('exposes draggable caliper and micrometer controls with their measurement precision', () => {
    const params = resolvePluginParams(expElectricalErrorLabPlugin.paramSchema, {
      mode: 'caliper-micrometer',
      vernierDivisions: '50'
    });
    const state = createInitialState(params);
    const plugin = expElectricalErrorLabPlugin as SimulationPluginV2<typeof params, typeof state>;
    const handles = plugin.getControlHandles?.(state, params) ?? [];
    const jaw = handles.find((handle) => handle.id === 'vernier-jaw');
    const thimble = handles.find((handle) => handle.id === 'micrometer-thimble');

    expect(jaw).toBeDefined();
    expect(thimble).toBeDefined();
    expect(Number(jaw?.onDrag({ x: 1.234, y: jaw.position.y })['targetVernierMm'])).toBe(50);
    expect(Number(thimble?.onDrag({ x: 2.345, y: thimble.position.y })['targetMicrometerMm'])).toBe(20);
  });
});
