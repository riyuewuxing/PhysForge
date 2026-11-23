import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compRigidRollingSlipPlugin } from './plugin.js';
import { rigidRollingPresets } from './presets.js';
import { createInitialState, stepRigidRollingSlip, type RigidRollingParams } from './engine.js';

function getPreset(idx: number): RigidRollingParams {
  return resolvePluginParams(compRigidRollingSlipPlugin.paramSchema, rigidRollingPresets[idx]!.params);
}

describe('comp-rigid-rolling-slip hybrid & rotational invariants (C01)', () => {
  it('captures exact solid-sphere tc = 2*v0/(7*mu*g) and vc = 5/7*v0 within < 1e-6 via HybridAutomaton', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    const expectedTc = (2 * p.v0Mps) / (7 * p.muK * 9.8);
    const expectedVc = (5 * p.v0Mps) / 7;

    for (let i = 0; i < 60; i++) {
      st = stepRigidRollingSlip(st, p, 0.05).nextState;
    }
    expect(st.mode).toBe('pure-rolling');
    expect(st.transitionTimeS).not.toBeNull();
    expect(Math.abs(st.transitionTimeS! - expectedTc)).toBeLessThan(1e-6);
    expect(Math.abs(st.transitionSpeedMps! - expectedVc)).toBeLessThan(1e-6);
  });

  it('reproduces backspin bowling return (v < 0) and incline race energy conservation (< 1e-6)', () => {
    const bowl = getPreset(1);
    let stB = createInitialState(bowl);
    for (let i = 0; i < 80; i++) {
      stB = stepRigidRollingSlip(stB, bowl, 0.05).nextState;
    }
    expect(stB.mode).toBe('pure-rolling');
    expect(stB.v).toBeLessThan(0);

    const race = getPreset(2);
    let stR = createInitialState(race);
    for (let i = 0; i < 60; i++) {
      stR = stepRigidRollingSlip(stR, race, 0.05).nextState;
    }
    expect(stR.inclinePositions['solid-sphere']).toBeGreaterThan(stR.inclinePositions['solid-cylinder']);
    expect(stR.inclinePositions['solid-cylinder']).toBeGreaterThan(stR.inclinePositions['hollow-sphere']);
    expect(stR.inclinePositions['hollow-sphere']).toBeGreaterThan(stR.inclinePositions['thin-ring']);
    const eDrift = Math.abs(stR.currentEnergyJ - stR.initialEnergyJ) / (Math.abs(stR.initialEnergyJ) + 1);
    expect(eDrift).toBeLessThan(1e-6);
  });

  it('handles dt=0 cleanly without NaN', () => {
    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepRigidRollingSlip(st, p, 0).nextState.t).toBe(0);
  });

  it('shows signed contact friction and direct initial-condition handles', () => {
    const params = resolvePluginParams(compRigidRollingSlipPlugin.paramSchema, {
      scenario: 'flat-bowling-slip',
      v0Mps: 7,
      omega0Radps: 0
    });
    const state = createInitialState(params);
    const plugin = compRigidRollingSlipPlugin as SimulationPluginV2<typeof params, typeof state>;
    const vectors = plugin.getForceVectors?.(state, params) ?? [];
    const friction = vectors.find((vector) => vector.id === 'friction');
    const handles = plugin.getControlHandles?.(state, params) ?? [];

    expect(friction?.origin.y).toBeCloseTo(0, 10);
    expect(friction?.force.x).toBeLessThan(0);
    expect(handles.map((handle) => handle.id)).toEqual(['initial-velocity', 'initial-omega']);
    expect(Number(handles[0]?.onDrag({ x: 1.5, y: 0 })['v0Mps'])).toBeGreaterThan(0);

    const rollingParams = { ...params, v0Mps: 1, omega0Radps: 1 / params.radiusM };
    const rollingState = createInitialState(rollingParams);
    const rollingVectors = plugin.getForceVectors?.(rollingState, rollingParams) ?? [];
    expect(rollingVectors.some((vector) => vector.id === 'friction')).toBe(false);
  });
});
