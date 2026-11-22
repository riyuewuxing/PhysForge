import { describe, expect, it } from 'vitest';
import { createInitialState, stepVerticalCircular, type VerticalCircularParams } from './engine.js';

describe('M06 mech-vertical-circular verification', () => {
  it('derails smooth outer hemisphere near arccos(2/3) (< 1e-6 rad for tiny launchperturbation) and conserves energy < 1e-6', () => {
    const params: VerticalCircularParams = {
      trackMode: 'outer-dome',
      mass: 1.0,
      radius: 1.6,
      vLaunch: 1e-4,
      startAngleDeg: 0.01
    };
    let state = createInitialState(params);
    for (let i = 0; i < 1500; i++) {
      state = stepVerticalCircular(state, params, 0.004).nextState;
      if (state.derailed) break;
    }

    expect(state.derailed).toBe(true);
    const analyticalRad = Math.acos(2 / 3);
    const measuredRad = (state.derailAngleDeg! * Math.PI) / 180;
    expect(Math.abs(measuredRad - analyticalRad)).toBeLessThan(1e-6);

    // Continue free projectile motion and confirm energy conservation
    for (let i = 0; i < 60; i++) {
      state = stepVerticalCircular(state, params, 0.004).nextState;
    }
    const eNow = 0.5 * params.mass * (state.vx * state.vx + state.vy * state.vy) + params.mass * 9.8 * state.y;
    expect(Math.abs(eNow - state.initialEnergy) / Math.abs(state.initialEnergy)).toBeLessThan(1e-6);
  });
});
