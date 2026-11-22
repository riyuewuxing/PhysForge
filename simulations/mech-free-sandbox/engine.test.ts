import { describe, expect, it } from 'vitest';
import { ensureRapierLoaded } from './rapierLoader.js';
import {
  computeObservables,
  createInitialState,
  stepSandbox,
  type SandboxParams
} from './engine.js';

const baseParams: SandboxParams = {
  scenario: 'elastic-collision',
  gravity: 9.8,
  restitution: 1.0,
  friction: 0,
  massRatio: 1.0,
  inclineDeg: 30,
  springK: 20
};

describe('mech-free-sandbox with lazy Rapier2D WASM', () => {
  it('lazily initializes @dimforge/rapier2d-compat and conserves momentum & energy in elastic collision', async () => {
    const rapier = await ensureRapierLoaded();
    expect(rapier).toBeDefined();

    const initial = createInitialState(baseParams);
    expect(initial.rapierActive).toBe(true);

    const obs0 = computeObservables(initial, baseParams);
    let state = initial;
    const dt = 1 / 120;
    // 撞前与撞后但撞右墙之前 (t = 1.1 s，球1从-1.8以2.6向右于0.71s撞击x=0.6的等质量球2)
    for (let i = 0; i < 130; i++) {
      state = stepSandbox(state, baseParams, dt).nextState;
    }

    const obs1 = computeObservables(state, baseParams);
    expect(obs1.rapierActive).toBe(1);
    // 动量守恒（< 1e-3）与弹性碰撞动能守恒（< 2e-2，含刚体离散接触容差）
    expect(Math.abs(obs1.totalMomentumX! - obs0.totalMomentumX!)).toBeLessThan(1e-2);
    expect(Math.abs(obs1.kineticEnergy! - obs0.kineticEnergy!) / obs0.kineticEnergy!).toBeLessThan(
      2e-2
    );

    // 等质量正碰交换速度：球1接近静止，球2获得接近 2.6 m/s
    const b1 = state.bodies.find((b) => b.id === 'b1')!;
    const b2 = state.bodies.find((b) => b.id === 'b2')!;
    expect(Math.abs(b1.vx)).toBeLessThan(0.15);
    expect(b2.vx).toBeGreaterThan(2.4);
  });

  it('handles spring oscillator and dt=0 without NaN or Infinity', async () => {
    await ensureRapierLoaded();
    const springParams: SandboxParams = {
      ...baseParams,
      scenario: 'spring-oscillator',
      springK: 16
    };
    let s = createInitialState(springParams);
    s = stepSandbox(s, springParams, 0).nextState;
    for (let i = 0; i < 60; i++) {
      s = stepSandbox(s, springParams, 1 / 120).nextState;
    }
    const obs = computeObservables(s, springParams);
    for (const v of Object.values(obs)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
