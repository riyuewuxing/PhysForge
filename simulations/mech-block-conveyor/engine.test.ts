import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepBlockConveyor,
  type BlockConveyorParams
} from './engine.js';

const baseParams: BlockConveyorParams = {
  systemMode: 'conveyor',
  massBlock: 2.0,
  massPlank: 4.0,
  muBlockCarrier: 0.25,
  muGround: 0,
  inclineDeg: 0,
  beltVelocity: 4.0,
  blockInitialV: 0,
  plankInitialV: 0,
  externalForcePlank: 0
};

describe('mech-block-conveyor engine', () => {
  it('captures horizontal conveyor co-moving event (< 1e-6 s) and verifies half-energy heat Q = 0.5*m*v^2', () => {
    const initial = createInitialState(baseParams);
    let state = initial;
    const dt = 0.01;
    let coMovingTime: number | null = null;

    for (let i = 0; i < 300; i++) {
      const res = stepBlockConveyor(state, baseParams, dt);
      state = res.nextState;
      if (res.events.length > 0) {
        coMovingTime = res.events[0]!.time;
      }
    }

    const exactT = baseParams.beltVelocity / (baseParams.muBlockCarrier * CLASSROOM_GRAVITY);
    const exactXBlock = (0.5 * baseParams.beltVelocity * baseParams.beltVelocity) / (baseParams.muBlockCarrier * CLASSROOM_GRAVITY);
    const exactHeat = 0.5 * baseParams.massBlock * baseParams.beltVelocity * baseParams.beltVelocity;

    expect(coMovingTime).not.toBeNull();
    expect(Math.abs(coMovingTime! - exactT)).toBeLessThan(1e-6);
    expect(state.coMovingLocked).toBe(true);
    expect(state.vBlock).toBeCloseTo(baseParams.beltVelocity, 10);
    expect(state.relativeScratch).toBeCloseTo(exactXBlock, 5);
    expect(state.frictionHeat).toBeCloseTo(exactHeat, 5);

    const inv = checkInvariants(state, initial, baseParams);
    expect(inv[0]?.passed).toBe(true);
  });

  it('captures downward inclined conveyor friction flip (< 1e-6 s) without chattering', () => {
    // 逆时针向下传送带 v_belt = -4.0 m/s, theta = 37°, sin(37°) ≈ 0.6018, cos ≈ 0.7986, mu = 0.25 (< tan37°)
    const inclinedParams: BlockConveyorParams = {
      ...baseParams,
      inclineDeg: 37,
      muBlockCarrier: 0.25,
      beltVelocity: -4.0,
      blockInitialV: 0
    };
    const theta = degToRad(37);
    const g = CLASSROOM_GRAVITY;
    const a1 = -g * (Math.sin(theta) + 0.25 * Math.cos(theta));
    const exactCoMovingT = -4.0 / a1;

    const initial = createInitialState(inclinedParams);
    let state = initial;
    let coMovingTime: number | null = null;

    for (let i = 0; i < 150; i++) {
      const res = stepBlockConveyor(state, inclinedParams, 0.01);
      state = res.nextState;
      if (res.events.length > 0) {
        coMovingTime = res.events[0]!.time;
      }
    }

    expect(coMovingTime).not.toBeNull();
    expect(Math.abs(coMovingTime! - exactCoMovingT)).toBeLessThan(1e-6);
    expect(state.coMovingLocked).toBe(false); // mu < tan(theta)，共速后继续加速下滑

    // 共速后加速度 a2 = -g*(sin(theta) - mu*cos(theta))
    const a2 = -g * (Math.sin(theta) - 0.25 * Math.cos(theta));
    const expectedVAtEnd = -4.0 + a2 * (1.5 - exactCoMovingT);
    expect(state.vBlock).toBeCloseTo(expectedVAtEnd, 4);

    const inv = checkInvariants(state, initial, inclinedParams);
    expect(inv[0]?.passed).toBe(true);
  });

  it('conserves momentum (< 1e-8) and mechanical+heat energy (< 1e-4) in smooth-ground plank model', () => {
    const plankParams: BlockConveyorParams = {
      ...baseParams,
      systemMode: 'plank',
      massBlock: 2.0,
      massPlank: 4.0,
      muBlockCarrier: 0.2,
      muGround: 0,
      blockInitialV: 6.0,
      plankInitialV: 0,
      externalForcePlank: 0
    };

    const initial = createInitialState(plankParams);
    let state = initial;
    for (let i = 0; i < 300; i++) {
      state = stepBlockConveyor(state, plankParams, 0.01).nextState;
    }

    // 解析共速 v_eq = (2*6)/(2+4) = 2.0 m/s
    // 解析相对划痕产生的热 Q = 0.5*(2*4/6)*6^2 = 24 J
    expect(state.coMovingLocked).toBe(true);
    expect(state.vBlock).toBeCloseTo(2.0, 6);
    expect(state.vCarrier).toBeCloseTo(2.0, 6);
    expect(state.frictionHeat).toBeCloseTo(24.0, 4);

    const reports = checkInvariants(state, initial, plankParams);
    for (const r of reports) {
      expect(r.passed).toBe(true);
    }
  });

  it('handles mu=0, v_belt=0, v0=v_belt, and dt=0 without NaN or Infinity', () => {
    const cases: BlockConveyorParams[] = [
      { ...baseParams, muBlockCarrier: 0 },
      { ...baseParams, beltVelocity: 0, blockInitialV: 0 },
      { ...baseParams, blockInitialV: 4.0, beltVelocity: 4.0 },
      { ...baseParams, systemMode: 'plank', muBlockCarrier: 0, muGround: 0 }
    ];

    for (const p of cases) {
      const s0 = createInitialState(p);
      const s1 = stepBlockConveyor(s0, p, 0).nextState;
      const s2 = stepBlockConveyor(s1, p, 0.02).nextState;
      const obs = computeObservables(s2, p);
      for (const val of Object.values(obs)) {
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });
});
