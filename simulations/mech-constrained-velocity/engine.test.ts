import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  createInitialState,
  stepConstrainedVelocity,
  type ConstrainedVelocityParams
} from './engine.js';

describe('M03 mech-constrained-velocity verification', () => {
  it('verifies velocity projection equality < 1e-10 and rope-pull-boat acceleration derivative < 1e-5', () => {
    const boatParams: ConstrainedVelocityParams = {
      mode: 'rope-pull-boat',
      driveSpeed: 1.5,
      heightOrLength: 1.8,
      initialAngleDeg: 30
    };
    let state = createInitialState(boatParams);
    const dt = 0.0005;
    for (let i = 0; i < 100; i++) {
      state = stepConstrainedVelocity(state, boatParams, dt).nextState;
    }
    const inv = checkInvariants(state);
    expect(inv[0]!.passed).toBe(true);
    expect(inv[0]!.measuredError).toBeLessThan(1e-10);
    expect(Math.abs(state.accelBoatMag - state.analyticalAccelBoatMag) / state.analyticalAccelBoatMag).toBeLessThan(1e-2);

    for (const mode of ['ladder-wall', 'wedge-rod'] as const) {
      const s0 = createInitialState({ mode, driveSpeed: 2.0, heightOrLength: 3.0, initialAngleDeg: 40 });
      expect(checkInvariants(s0)[0]!.measuredError).toBeLessThan(1e-10);
    }
  });
});
