import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compChaosNormalCoriolisPlugin } from './plugin.js';
import { chaosNormalCoriolisPresets } from './presets.js';
import { createInitialState, stepChaosNormalCoriolis, type ChaosNormalCoriolisParams } from './engine.js';

function getPreset(idx: number): ChaosNormalCoriolisParams {
  return resolvePluginParams(compChaosNormalCoriolisPlugin.paramSchema, chaosNormalCoriolisPresets[idx]!.params);
}

describe('comp-chaos-normal-coriolis physics invariants (C02)', () => {
  it('conserves double pendulum energy within < 1e-6 over 30s RK45 integration', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    for (let i = 0; i < 600; i++) {
      st = stepChaosNormalCoriolis(st, p, 0.05).nextState;
    }
    expect(st.dpMaxRelDrift).toBeLessThan(1e-6);
  });

  it('matches symmetric and antisymmetric coupled normal-mode frequencies (< 1e-5)', () => {
    const base = getPreset(1);
    for (const [excite, kEff] of [
      ['symmetric', base.springKw],
      ['antisymmetric', base.springKw + 2 * base.springKc]
    ] as const) {
      const p: ChaosNormalCoriolisParams = { ...base, normalExcite: excite };
      let st = createInitialState(p);
      for (let i = 0; i < 400; i++) {
        st = stepChaosNormalCoriolis(st, p, 0.02).nextState;
      }
      expect(st.nmCrossingTimes.length).toBeGreaterThanOrEqual(4);
      const periodMeas = st.nmCrossingTimes[3]! - st.nmCrossingTimes[2]!;
      const omegaMeas = (2 * Math.PI) / periodMeas;
      const omegaExact = Math.sqrt(kEff / p.m1Kg);
      expect(Math.abs(omegaMeas - omegaExact) / omegaExact).toBeLessThan(1e-5);
    }
  });

  it('agrees between rotating-frame Coriolis ODE and rotated inertial trajectory (< 1e-6) and handles dt=0', () => {
    const cor = getPreset(2);
    let stC = createInitialState(cor);
    expect(stepChaosNormalCoriolis(stC, cor, 0).nextState.t).toBe(0);
    for (let i = 0; i < 40; i++) {
      stC = stepChaosNormalCoriolis(stC, cor, 0.05).nextState;
    }
    expect(stC.coriolisDeviation).toBeLessThan(1e-6);
  });

  it('provides two draggable double-pendulum release angles and both declared frame origins', () => {
    const params = getPreset(0);
    const state = createInitialState(params);
    const plugin = compChaosNormalCoriolisPlugin as import('@physforge/sim-sdk').SimulationPluginV2<
      typeof params,
      typeof state
    >;
    const handles = plugin.getControlHandles?.(state, params) ?? [];
    const frames = plugin.referenceFrames ?? [];

    expect(handles.map((handle) => handle.id)).toEqual(['double-pendulum-bob1', 'double-pendulum-bob2']);
    expect(Number(handles[0]?.onDrag({ x: 0.5, y: -0.5 })['theta1Deg'])).toBeCloseTo(45, 0);
    expect(frames.map((frame) => frame.id)).toEqual(['inertial', 'rotating-disk']);
    expect(frames[1]?.getOrigin(state, params)).toEqual({ x: 0, y: 0 });
  });
});
