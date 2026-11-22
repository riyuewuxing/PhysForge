import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import {
  computeObservables,
  createInitialState,
  stepProjectileCoupling,
  type ProjectileCouplingParams
} from './engine.js';

describe('M04 mech-projectile-coupling verification', () => {
  it('captures flat projectile impact time on incline within < 1e-7 s and stays within safety envelope', () => {
    const params: ProjectileCouplingParams = {
      mode: 'incline-flat',
      v0: 6.0,
      launchAngleDeg: 0,
      inclineDeg: 37,
      troughRadius: 2.5,
      dragCoeff: 0,
      mass: 1.0
    };
    const expectedFlyTime = (2 * params.v0 * Math.tan(degToRad(params.inclineDeg))) / CLASSROOM_GRAVITY;

    let state = createInitialState(params);
    for (let i = 0; i < 400; i++) {
      state = stepProjectileCoupling(state, params, 0.01).nextState;
      if (state.landed) break;
    }
    expect(state.landed).toBe(true);
    expect(Math.abs(state.impactTime! - expectedFlyTime)).toBeLessThan(1e-7);

    // Oblique projectile under quadratic drag vs safety envelope and strictly smaller kinetic energy
    const dragParams: ProjectileCouplingParams = {
      mode: 'safety-envelope',
      v0: 8.0,
      launchAngleDeg: 55,
      inclineDeg: 30,
      troughRadius: 2.0,
      dragCoeff: 0.1,
      mass: 1.0
    };
    let dState = createInitialState(dragParams);
    for (let i = 0; i < 300; i++) {
      dState = stepProjectileCoupling(dState, dragParams, 0.01).nextState;
      const envY =
        (dragParams.v0 * dragParams.v0) / (2 * CLASSROOM_GRAVITY) -
        (CLASSROOM_GRAVITY * dState.x * dState.x) / (2 * dragParams.v0 * dragParams.v0);
      expect(dState.y).toBeLessThanOrEqual(envY + 1e-7);
      if (dState.landed) break;
    }
    const obs = computeObservables(dState, dragParams);
    expect(obs.kineticEnergy!).toBeLessThan(dState.initialEnergy);
  });
});
