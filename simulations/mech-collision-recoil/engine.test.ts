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

describe('H28 M09 exact event and parameter contracts',()=>{
  it('captures an entire oblique collision inside a coarse step with no endpoint overlap',()=>{
    const p=getPreset(0),r=stepCollisionRecoil(createInitialState(p),p,2),s=r.nextState;
    expect(s.collided).toBe(true);expect(r.events).toHaveLength(1);expect(r.events[0]?.time).toBeCloseTo(.53,12);
    expect(s.vx1).toBeCloseTo(1.44,12);expect(s.vy1).toBeCloseTo(1.92,12);
    expect(s.vx2).toBeCloseTo(2.56,12);expect(s.vy2).toBeCloseTo(-1.92,12);
    expect(s.t).toBe(2);
  });
  it('honors the actual aiming offset for a miss and an exact grazing trajectory',()=>{
    for(const b of [.61,.6,-.61,-.6]){
      const p={...getPreset(0),impactParamB:b},init=createInitialState(p),s=stepCollisionRecoil(init,p,1.5).nextState;
      expect(init.y1).toBe(b);expect(s.collided).toBe(false);expect(s.vx1).toBe(4);expect(s.vy1).toBe(0);expect(s.events).toHaveLength(0);
    }
  });
  it('chooses the earliest block exit even when a coarse step passes the turning point',()=>{
    const p={...getPreset(2),blockLength:1},r=stepCollisionRecoil(createInitialState(p),p,2),s=r.nextState;
    expect(s.bulletPhase).toBe('exited');expect(r.events).toHaveLength(2);
    expect(r.events[0]?.time).toBeCloseTo(.2375,12);
    expect(r.events[1]?.time).toBeCloseTo(.2375+2/(8+Math.sqrt(14)),12);
    expect(s.penetrationDist).toBeCloseTo(1,12);expect(s.heatLostJ).toBeCloseTo(10,12);
    expect(s.vx1-s.vx2).toBeCloseTo(Math.sqrt(14),12);
  });
  it('respects zero resistance without manufacturing heat',()=>{
    const p={...getPreset(2),dragForceF:0,blockLength:1},s=stepCollisionRecoil(createInitialState(p),p,2).nextState;
    expect(s.bulletPhase).toBe('exited');expect(s.heatLostJ).toBe(0);expect(s.vx1).toBe(8);expect(s.vx2).toBe(0);
  });
  it('zero relative walking speed means no motion, not a hidden 0.2 m/s minimum',()=>{
    const p={...getPreset(3),v10:0},init=createInitialState(p),s=stepCollisionRecoil(init,p,5).nextState;
    expect(s.x1).toBe(init.x1);expect(s.x2).toBe(init.x2);expect(s.vx1).toBe(0);expect(s.vx2).toBe(0);expect(s.events).toHaveLength(0);
  });
  it('boat velocity starts continuously and the requested speed is the peak of a smooth walk',()=>{
    const p=getPreset(3),init=createInitialState(p),h=1e-5,s=stepCollisionRecoil(init,p,h).nextState;
    expect(Math.abs(s.vx1-s.vx2)).toBeLessThan(1e-7);
    const span=.9*p.blockLength,T=2*span/p.v10,mid=stepCollisionRecoil(init,p,T/2).nextState;
    expect(mid.vx1-mid.vx2).toBeCloseTo(p.v10,12);expect(mid.x1-mid.x2).toBeCloseTo(0,12);
    const end=stepCollisionRecoil(init,p,T+1).nextState;expect(end.x1-end.x2).toBeCloseTo(span/2,12);expect(end.vx1).toBe(0);expect(end.events[0]?.time).toBeCloseTo(T,12);
  });
});
