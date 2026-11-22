import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emEddyVortexFieldPlugin } from './plugin.js';
import { eddyVortexPresets } from './presets.js';
import {
  computeClosedLoopCirculation,
  createInitialState,
  stepEddyVortex,
  type EddyVortexParams
} from './engine.js';

function getPreset(idx: number): EddyVortexParams {
  return resolvePluginParams(emEddyVortexFieldPlugin.paramSchema, eddyVortexPresets[idx]!.params);
}

describe('em-eddy-vortex-field Maxwell circulation & damping (E06)', () => {
  it('verifies closed-loop line integral \\oint E.dl = -dPhi/dt within < 1e-8 inside, outside, and off-center', () => {
    const Rc = 1.2;
    const bDot = 1.5;

    // 1. Inside core (r = 0.7 < Rc)
    const cIn = computeClosedLoopCirculation(0.7, Rc, bDot, 0);
    expect(Math.abs(cIn.lineIntegral - cIn.negDPhiDt) / Math.abs(cIn.negDPhiDt)).toBeLessThan(1e-8);

    // 2. Surrounding entire cylinder (r = 1.8 > Rc)
    const cOut = computeClosedLoopCirculation(1.8, Rc, bDot, 0);
    expect(Math.abs(cOut.lineIntegral - cOut.negDPhiDt) / Math.abs(cOut.negDPhiDt)).toBeLessThan(1e-8);

    // 3. Off-center circular loop completely inside magnetic core (offset = 0.3, r = 0.6)
    const cOff = computeClosedLoopCirculation(0.6, Rc, bDot, 0.3);
    expect(Math.abs(cOff.lineIntegral - cOff.negDPhiDt) / Math.abs(cOff.negDPhiDt)).toBeLessThan(1e-8);
  });

  it('demonstrates strong eddy damping in solid plate vs minimal damping in slotted plate', () => {
    const damp = getPreset(1);
    let st = createInitialState(damp);
    for (let i = 0; i < 250; i++) {
      st = stepEddyVortex(st, damp, 0.02).nextState;
    }
    expect(Math.hypot(st.solidTheta, st.solidOmega)).toBeLessThan(
      0.3 * Math.hypot(st.slottedTheta, st.slottedOmega)
    );
  });

  it('handles zero Bdot and zero dt boundaries cleanly', () => {
    const p0: EddyVortexParams = { ...getPreset(0), bDotRate: 0 };
    const s0 = createInitialState(p0);
    expect(stepEddyVortex(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepEddyVortex(s0, p0, 0.05).nextState;
    expect(Number.isFinite(s1.px)).toBe(true);
  });
});
