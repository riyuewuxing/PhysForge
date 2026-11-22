import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { mechCollisionRecoilPlugin } from './plugin.js';
import { collisionRecoilPresets } from './presets.js';
import {
  computeObservables,
  createInitialState,
  stepCollisionRecoil,
  type CollisionRecoilParams
} from './engine.js';

function getPreset(idx: number): CollisionRecoilParams {
  return resolvePluginParams(mechCollisionRecoilPlugin.paramSchema, collisionRecoilPresets[idx]!.params);
}

function simulate(params: CollisionRecoilParams, duration: number, dt = 0.005) {
  let state = createInitialState(params);
  const steps = Math.round(duration / dt);
  for (let i = 0; i < steps; i++) {
    state = stepCollisionRecoil(state, params, dt).nextState;
  }
  return state;
}

describe('mech-collision-recoil physics invariants (M09)', () => {
  it('conserves 2D momentum & kinetic energy and verifies 90 deg equal-mass oblique scattering', () => {
    const params = getPreset(0); // m1=m2=2, e=1, v20=0, b=0.36
    const end = simulate(params, 1.5, 0.005);
    expect(end.collided).toBe(true);
    const obs = computeObservables(end, params);
    expect(Math.abs(obs.px! - end.pInitX)).toBeLessThan(1e-10);
    expect(Math.abs(obs.py! - end.pInitY)).toBeLessThan(1e-10);
    expect(Math.abs(obs.ek! - end.kInit)).toBeLessThan(1e-10);
    expect(Math.abs(obs.vDotProduct!)).toBeLessThan(1e-9);
  });

  it('matches inelastic kinetic energy loss across restitution e in [0, 1]', () => {
    const params: CollisionRecoilParams = {
      ...getPreset(1),
      restitutionE: 0.6
    };
    const mu = (params.mass1 * params.mass2) / (params.mass1 + params.mass2);
    const expectedLoss = 0.5 * mu * (1 - params.restitutionE ** 2) * (params.v10 - params.v20) ** 2;
    const end = simulate(params, 1.5, 0.005);
    expect(end.collided).toBe(true);
    const obs = computeObservables(end, params);
    expect(Math.abs(obs.px! - end.pInitX)).toBeLessThan(1e-10);
    expect(Math.abs(end.heatLostJ - expectedLoss)).toBeLessThan(1e-9);
  });

  it('captures bullet-block co-velocity heat loss and fixed boat center-of-mass axis', () => {
    const bulletParams = getPreset(2);
    const endBullet = simulate(bulletParams, 2.0, 0.005);
    expect(endBullet.bulletPhase).toBe('comoving');
    const obsBullet = computeObservables(endBullet, bulletParams);
    expect(Math.abs(obsBullet.px! - endBullet.pInitX)).toBeLessThan(1e-10);
    expect(Math.abs(obsBullet.ek! + endBullet.heatLostJ - endBullet.kInit)).toBeLessThan(1e-9);

    const boatParams = getPreset(3);
    const startBoat = createInitialState(boatParams);
    let st = startBoat;
    for (let i = 0; i < 400; i++) {
      st = stepCollisionRecoil(st, boatParams, 0.005).nextState;
      const obsBoat = computeObservables(st, boatParams);
      expect(Math.abs(obsBoat.xCm! - startBoat.xCm0)).toBeLessThan(1e-10);
    }
  });

  it('remains finite at parameter boundaries and zero dt', () => {
    const zeroV: CollisionRecoilParams = { ...getPreset(0), v10: 0, impactParamB: 0 };
    const s0 = createInitialState(zeroV);
    const s1 = stepCollisionRecoil(s0, zeroV, 0).nextState;
    expect(s1).toEqual(s0);
    const s2 = simulate(zeroV, 0.2, 0.01);
    expect(Number.isFinite(s2.x1)).toBe(true);
  });
});
