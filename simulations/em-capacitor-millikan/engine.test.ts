import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emCapacitorMillikanPlugin } from './plugin.js';
import { capacitorMillikanPresets } from './presets.js';
import {
  BASE_AREA_M2,
  EPSILON_0,
  computeCapacitorMetrics,
  createInitialState,
  stepCapacitorMillikan,
  type CapacitorMillikanParams
} from './engine.js';

function getPreset(idx: number): CapacitorMillikanParams {
  return resolvePluginParams(emCapacitorMillikanPlugin.paramSchema, capacitorMillikanPresets[idx]!.params);
}

describe('em-capacitor-millikan dynamic analysis & Millikan balance (E02)', () => {
  it('matches analytical C, Q, U, E, phiP within < 1e-10 and preserves E identically when switch open and only d changes', () => {
    const baseOpen = getPreset(0);
    const m1 = computeCapacitorMetrics({ ...baseOpen, distanceMm: 16 });
    const m2 = computeCapacitorMetrics({ ...baseOpen, distanceMm: 36 });

    // Strict zero change in electric field when Q is constant and only d changes!
    expect(Math.abs(m2.fieldE - m1.fieldE)).toBeLessThan(1e-12);

    const closed = getPreset(1);
    const mc = computeCapacitorMetrics(closed);
    const expectedC = (EPSILON_0 * closed.dielectricEr * closed.areaRatioS * BASE_AREA_M2) / (closed.distanceMm * 1e-3);
    const expectedPhiP = closed.sourceVoltageU0 * closed.probeFracP;
    expect(Math.abs(mc.capacitanceF - expectedC) / expectedC).toBeLessThan(1e-10);
    expect(Math.abs(mc.chargeC - expectedC * closed.sourceVoltageU0) / mc.chargeC).toBeLessThan(1e-10);
    expect(Math.abs(mc.phiPV - expectedPhiP) / expectedPhiP).toBeLessThan(1e-10);
  });

  it('maintains static Millikan oil drop equilibrium (qE = mg) and damps toward terminal Stokes speed otherwise', () => {
    const eqParams = getPreset(2); // calibrated exact equilibrium
    let stEq = createInitialState(eqParams);
    for (let i = 0; i < 100; i++) {
      stEq = stepCapacitorMillikan(stEq, eqParams, 0.02).nextState;
    }
    expect(Math.abs(stEq.dropYFrac - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(stEq.dropVy)).toBeLessThan(1e-12);

    const riseParams: CapacitorMillikanParams = { ...eqParams, sourceVoltageU0: 250 };
    let stRise = createInitialState(riseParams);
    for (let i = 0; i < 10; i++) {
      stRise = stepCapacitorMillikan(stRise, riseParams, 0.005).nextState;
    }
    expect(stRise.dropYFrac).toBeGreaterThan(0.5);
    expect(stRise.dropYFrac).toBeLessThan(1.0);
    expect(stRise.dropVy).toBeGreaterThan(0);

    // Verify terminal Stokes speed v_t = (qE/m - g) / stokesDrag under high drag before hitting plate
    const stokesParams: CapacitorMillikanParams = {
      ...eqParams,
      distanceMm: 40,
      sourceVoltageU0: 400, // E = 10000 V/m -> matches 1*g at 2 steps
      dropChargeSteps: 3,   // qE/m = 1.5 g => net accel = +0.5 g
      stokesDrag: 250       // v_t = 0.5 * 9.8 / 250 = 0.0196 m/s
    };
    let stTerm = createInitialState(stokesParams);
    for (let i = 0; i < 100; i++) {
      stTerm = stepCapacitorMillikan(stTerm, stokesParams, 0.002).nextState;
    }
    const expectedVt = (0.5 * 9.8) / 250;
    expect(Math.abs(stTerm.dropVy - expectedVt) / expectedVt).toBeLessThan(1e-6);
  });

  it('handles zero voltage and zero dt safely without NaN', () => {
    const p0: CapacitorMillikanParams = { ...getPreset(0), sourceVoltageU0: 0 };
    const s0 = createInitialState(p0);
    expect(stepCapacitorMillikan(s0, p0, 0).nextState.voltageV).toBe(0);
    const s1 = stepCapacitorMillikan(s0, p0, 0.05).nextState;
    expect(Number.isFinite(s1.fieldE)).toBe(true);
  });
});
