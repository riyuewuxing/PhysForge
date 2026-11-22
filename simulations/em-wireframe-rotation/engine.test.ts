import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emWireframeRotationPlugin } from './plugin.js';
import { wireframePresets } from './presets.js';
import {
  checkInvariants,
  computeFluxAndCuttingFactor,
  createInitialState,
  stepWireframeRotation,
  type WireframeParams
} from './engine.js';

function getPreset(idx: number): WireframeParams {
  return resolvePluginParams(emWireframeRotationPlugin.paramSchema, wireframePresets[idx]!.params);
}

describe('em-wireframe-rotation cutting & energy conservation (E05)', () => {
  it('verifies exact 2.000x EMF ratio when crossing boundary between +B and -B vs entering +B', () => {
    const params = getPreset(0); // dual-opposite L=0.8, H=1.0
    const enterSingleFactor = Math.abs(computeFluxAndCuttingFactor(-0.2, params).dPhiDy); // bottom entered +B
    const crossDualFactor = Math.abs(computeFluxAndCuttingFactor(-1.0, params).dPhiDy); // center at boundary -H
    expect(Math.abs(crossDualFactor / enterSingleFactor - 2.0)).toBeLessThan(1e-10);
  });

  it('conserves mechanical + Joule energy (mg*dh = dEk + Q < 1e-6) during free-fall crossing', () => {
    const params = getPreset(0);
    const initial = createInitialState(params);
    let st = initial;
    for (let i = 0; i < 150; i++) {
      st = stepWireframeRotation(st, params, 0.01).nextState;
    }
    expect(st.jouleHeatJ).toBeGreaterThan(0.1);
    const reports = checkInvariants(st, initial, params);
    expect(reports[0]!.passed).toBe(true);
    expect(reports[0]!.measuredError).toBeLessThan(1e-6);
  });

  it('matches rotating rod & Faraday disk EMF = 0.5*B*omega*R^2 within < 1e-10 and stays finite at B=0', () => {
    const disk = getPreset(3);
    const st = stepWireframeRotation(createInitialState(disk), disk, 0.1).nextState;
    const expected = 0.5 * disk.magneticB * disk.omegaRadS * disk.loopSizeL * disk.loopSizeL;
    expect(Math.abs(st.emfV - expected)).toBeLessThan(1e-10);

    const zeroB: WireframeParams = { ...getPreset(0), magneticB: 0 };
    const s0 = createInitialState(zeroB);
    expect(stepWireframeRotation(s0, zeroB, 0).nextState).toEqual(s0);
  });
});
