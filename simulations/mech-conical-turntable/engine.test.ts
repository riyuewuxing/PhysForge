import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { mechConicalTurntablePlugin } from './plugin.js';
import {
  checkInvariants,
  computeCriticalOmegas,
  createInitialState,
  stepConicalTurntable,
  type ConicalTurntableParams
} from './engine.js';

describe('M07 mech-conical-turntable verification', () => {
  it('computes exact critical angular speeds omega1, omega2, omega3 < 1e-6 and slides outward beyond omega3', () => {
    const base: ConicalTurntableParams = {
      mode: 'turntable-dual',
      omega: 2.0,
      massA: 1.0,
      massB: 2.0,
      radiusA: 0.6,
      radiusB: 1.5,
      mu: 0.3,
      pendulumLength: 1.5
    };
    const g = CLASSROOM_GRAVITY;
    const { omega1, omega2, omega3 } = computeCriticalOmegas(base);
    expect(Math.abs(omega1 - Math.sqrt((0.3 * g) / 1.5))).toBeLessThan(1e-10);
    expect(Math.abs(omega2 - Math.sqrt((0.3 * 2 * g) / (2 * 1.5 - 1 * 0.6)))).toBeLessThan(1e-10);
    expect(Math.abs(omega3 - Math.sqrt((0.3 * 3 * g) / (2 * 1.5 - 1 * 0.6)))).toBeLessThan(1e-10);

    // Below omega3: equilibrium holds rigorously
    const eqState = createInitialState({ ...base, omega: omega3 - 0.1 });
    expect(eqState.slippingOut).toBe(false);
    expect(checkInvariants(eqState, eqState, { ...base, omega: omega3 - 0.1 })[0]!.passed).toBe(true);

    // Above omega3: blocks slip outward
    const slipParams = { ...base, omega: omega3 + 0.5 };
    let slipState = createInitialState(slipParams);
    expect(slipState.slippingOut).toBe(true);
    for (let i = 0; i < 60; i++) {
      slipState = stepConicalTurntable(slipState, slipParams, 0.01).nextState;
    }
    expect(slipState.rB).toBeGreaterThan(base.radiusB);
  });

  it('exposes the signed inward friction and string tension in Auto-FBD vectors', () => {
    const params = resolvePluginParams(mechConicalTurntablePlugin.paramSchema, {
      mode: 'turntable-dual',
      omega: 1.5
    });
    const state = createInitialState(params);
    const plugin = mechConicalTurntablePlugin as SimulationPluginV2<typeof params, typeof state>;
    const vectors = plugin.getForceVectors?.(state, params) ?? [];

    expect(vectors.map((vector) => vector.id)).toContain('friction-a');
    expect(vectors.map((vector) => vector.id)).toContain('tension-a');
    const frictionA = vectors.find((vector) => vector.id === 'friction-a');
    expect(frictionA?.force.x).toBeGreaterThan(0);

    const highOmegaParams = { ...params, omega: 1.7 };
    const highOmegaState = createInitialState(highOmegaParams);
    const highOmegaVectors = plugin.getForceVectors?.(highOmegaState, highOmegaParams) ?? [];
    const reversedFrictionA = highOmegaVectors.find((vector) => vector.id === 'friction-a');
    expect(reversedFrictionA?.force.x).toBeLessThan(0);
  });
});
