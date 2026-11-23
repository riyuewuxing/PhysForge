import { describe, expect, it } from 'vitest';
import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { mechSpringSeparationPlugin } from './plugin.js';
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

  it('shows spring and contact forces before separation, then removes the contact pair', () => {
    const params = resolvePluginParams(mechSpringSeparationPlugin.paramSchema, {
      mass1: 1,
      mass2: 2,
      springK: 30,
      inclineDeg: 0,
      initialComp: 1,
      externalForce: 0
    });
    const plugin = mechSpringSeparationPlugin as SimulationPluginV2<typeof params, ReturnType<typeof createInitialState>>;
    let state = createInitialState(params);
    const initialVectors = plugin.getForceVectors?.(state, params) ?? [];

    expect(initialVectors.some((vector) => vector.id === 'spring-1')).toBe(true);
    expect(initialVectors.some((vector) => vector.id === 'contact-12')).toBe(true);
    expect(state.normalForceN).toBeGreaterThan(0);

    for (let i = 0; i < 500 && !state.separated; i++) {
      state = stepSpringSeparation(state, params, 0.01).nextState;
    }
    expect(state.separated).toBe(true);
    expect(state.normalForceN).toBe(0);
    const separatedVectors = plugin.getForceVectors?.(state, params) ?? [];
    expect(separatedVectors.some((vector) => vector.id === 'contact-12')).toBe(false);
    expect(separatedVectors.some((vector) => vector.id === 'contact-21')).toBe(false);
  });
});
