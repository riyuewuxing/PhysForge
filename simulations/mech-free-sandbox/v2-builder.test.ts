import { describe, expect, it } from 'vitest';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { mechFreeSandboxPlugin } from './plugin.js';
import {
  computeObservables,
  createInitialState,
  stepSandbox,
  type SandboxParams
} from './engine.js';

describe('B4 builder-mechanics-lab V2 verification', () => {
  it('matches Udwadia-Kalaba Atwood acceleration and rope tension to < 1e-10', () => {
    const params = resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema, {
      scenario: 'atwood-constrained',
      massRatio: 3.0, // m1 = 1 kg, m2 = 3 kg => a = (3-1)/(3+1) * g = 0.5g, T = 2*1*3/(1+3) g = 1.5g
      gravity: 9.8
    });
    let state = createInitialState(params);
    const dt = 0.01;
    state = stepSandbox(state, params, dt).nextState;

    const obs = computeObservables(state, params);
    const expectedT = ((2 * 1 * 3) / (1 + 3)) * 9.8;
    expect(Math.abs(obs.constraintTensionN! - expectedT)).toBeLessThan(1e-10);

    const bLeft = state.bodies.find((b) => b.id === 'atwood-left')!;
    const bRight = state.bodies.find((b) => b.id === 'atwood-right')!;
    // After 10ms, ay1 = +0.5*g => vy1 = 0.5*9.8*0.01
    expect(bLeft.vy).toBeCloseTo(0.5 * 9.8 * dt, 10);
    expect(bRight.vy).toBeCloseTo(-0.5 * 9.8 * dt, 10);
  });

  it('conserves mechanical energy < 1e-4 over 20s in spring-oscillator Velocity-Verlet fallback', () => {
    const params = resolvePluginParams<SandboxParams>(mechFreeSandboxPlugin.paramSchema, {
      scenario: 'spring-oscillator',
      springK: 25
    });
    let state = createInitialState(params);
    const e0 = computeObservables(state, params);
    const total0 = e0.kineticEnergy! + e0.potentialEnergy!;

    const dt = 1 / 240;
    for (let i = 0; i < 20 * 240; i++) {
      state = stepSandbox(state, params, dt).nextState;
    }

    const e1 = computeObservables(state, params);
    const total1 = e1.kineticEnergy! + e1.potentialEnergy!;
    expect(Math.abs(total1 - total0) / Math.max(total0, 1e-9)).toBeLessThan(1e-4);

    const fbd = mechFreeSandboxPlugin.getForceVectors?.(state, params) ?? [];
    expect(fbd.length).toBeGreaterThan(0);
    const ir = mechFreeSandboxPlugin.exportDiagramIR?.(state, params);
    expect(ir?.primitives.some((p) => p.kind === 'spring')).toBe(true);
  });
});
