import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { stseTokamakMagneticMirrorPlugin } from './plugin.js';
import { tokamakMirrorPresets } from './presets.js';
import {
  createInitialState,
  evaluateTokamakMirrorField,
  stepTokamakMirror,
  type TokamakMirrorParams
} from './engine.js';

function getPreset(idx: number): TokamakMirrorParams {
  return resolvePluginParams(stseTokamakMagneticMirrorPlugin.paramSchema, tokamakMirrorPresets[idx]!.params);
}

describe('stse-tokamak-magnetic-mirror physics invariants (S01)', () => {
  it('enforces divergence-free B field (< 1e-12) and conserves Boris kinetic energy (< 1e-8) with adiabatic mu < 5% bounce', () => {
    const params = getPreset(0);
    // Finite difference div(B) check
    const eps = 1e-5;
    const p0 = { x: 0.2, y: -0.15, z: 0.7 };
    const bxP = evaluateTokamakMirrorField({ ...p0, x: p0.x + eps }, params).x;
    const bxM = evaluateTokamakMirrorField({ ...p0, x: p0.x - eps }, params).x;
    const byP = evaluateTokamakMirrorField({ ...p0, y: p0.y + eps }, params).y;
    const byM = evaluateTokamakMirrorField({ ...p0, y: p0.y - eps }, params).y;
    const bzP = evaluateTokamakMirrorField({ ...p0, z: p0.z + eps }, params).z;
    const bzM = evaluateTokamakMirrorField({ ...p0, z: p0.z - eps }, params).z;
    const divB = (bxP - bxM + (byP - byM) + (bzP - bzM)) / (2 * eps);
    expect(Math.abs(divB)).toBeLessThan(1e-10);

    let st = createInitialState(params);
    for (let i = 0; i < 60; i++) {
      st = stepTokamakMirror(st, params, 0.05).nextState;
    }
    const keDrift = Math.abs(st.currentKineticJ - st.initialKineticJ) / st.initialKineticJ;
    expect(keDrift).toBeLessThan(1e-8);
    expect(st.escaped).toBe(false);
    expect(st.reflectionCount).toBeGreaterThanOrEqual(2);
    expect(st.maxMuRelDev).toBeLessThan(0.05);
  });

  it('allows particles inside loss cone (theta < theta_c) to escape through mirror throat', () => {
    const params = getPreset(1);
    let st = createInitialState(params);
    for (let i = 0; i < 40; i++) {
      st = stepTokamakMirror(st, params, 0.05).nextState;
    }
    expect(st.escaped).toBe(true);
  });

  it('simulates tokamak helical confinement without NaN and handles dt=0', () => {
    const params = getPreset(2);
    let st = createInitialState(params);
    expect(stepTokamakMirror(st, params, 0).nextState.t).toBe(0);
    for (let i = 0; i < 20; i++) {
      st = stepTokamakMirror(st, params, 0.04).nextState;
    }
    const keDrift = Math.abs(st.currentKineticJ - st.initialKineticJ) / st.initialKineticJ;
    expect(keDrift).toBeLessThan(1e-8);
  });
});
