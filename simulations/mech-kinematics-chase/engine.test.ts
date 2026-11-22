import { describe, expect, it } from 'vitest';
import { createInitialState, stepKinematicsChase, type KinematicsChaseParams } from './engine.js';

describe('M01 mech-kinematics-chase verification', () => {
  it('captures exact co-velocity (t=4s) and catch-up (t=8s) within < 1e-7 s', () => {
    const params: KinematicsChaseParams = {
      scenario: 'accelerate-chase',
      vA0: 0,
      aA: 2,
      reactionTime: 0,
      xB0: 16,
      vB0: 8,
      aB: 0
    };
    let state = createInitialState(params);
    const dt = 0.01;
    for (let i = 0; i < 1000; i++) {
      state = stepKinematicsChase(state, params, dt).nextState;
    }

    const coVel = state.events.find((e) => e.id.startsWith('co-vel'));
    const meet = state.events.find((e) => e.id.startsWith('meet'));
    expect(coVel).toBeDefined();
    expect(meet).toBeDefined();
    expect(Math.abs(coVel!.time - 4.0)).toBeLessThan(1e-7);
    // Exact root of t^2 = 16 + 8*t -> t = 4 + 4*sqrt(2)
    expect(Math.abs(meet!.time - (4 + 4 * Math.SQRT2))).toBeLessThan(1e-7);
  });

  it('locks braked car velocity strictly at zero after stopping (no reversing)', () => {
    const params: KinematicsChaseParams = {
      scenario: 'brake-collision-avoid',
      vA0: 20,
      aA: -5,
      reactionTime: 0.4,
      xB0: 80,
      vB0: 10,
      aB: -5
    };
    let state = createInitialState(params);
    for (let i = 0; i < 600; i++) {
      state = stepKinematicsChase(state, params, 0.01).nextState;
    }
    expect(state.aLockedZero).toBe(true);
    expect(state.bLockedZero).toBe(true);
    expect(state.vA).toBe(0);
    expect(state.vB).toBe(0);
    // Exact A stopping distance: 20*0.4 + 20^2/(2*5) = 8 + 40 = 48 m
    expect(state.xA).toBeCloseTo(48, 6);
  });
});
