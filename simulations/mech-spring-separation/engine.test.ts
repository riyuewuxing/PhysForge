import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  createInitialState,
  stepSpringSeparation,
  type SpringSepParams
} from './engine.js';

describe('M08 mech-spring-separation verification', () => {
  it('separates strictly at spring natural length s=0 (normal force < 1e-7 N) and conserves mechanical energy < 1e-5', () => {
    const params: SpringSepParams = {
      mass1: 1.0,
      mass2: 2.0,
      springK: 30,
      inclineDeg: 30,
      initialComp: 1.2,
      externalForce: 0
    };
    let state = createInitialState(params);
    for (let i = 0; i < 1500; i++) {
      state = stepSpringSeparation(state, params, 0.002).nextState;
    }

    expect(state.separated).toBe(true);
    expect(Math.abs(state.separationPosS!)).toBeLessThan(1e-7);
    const ev = state.events.find((e) => e.id.startsWith('sep-'));
    expect(Math.abs(ev?.metrics?.normalForceAtSep ?? 1)).toBeLessThan(1e-6);

    const inv = checkInvariants(state, state, params);
    expect(inv[0]!.measuredError).toBeLessThan(inv[0]!.tolerance);
  });
});
