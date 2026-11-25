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

describe('H22 M05 independent Coulomb phase and boundary tests',()=>{
  const p:BlockConveyorParams={...baseParams,systemMode:'plank',muBlockCarrier:.8,muGround:.5,blockInitialV:1,plankInitialV:1};
  it('stops a jointly moving plank without spurious reverse motion or heat after stopping',()=>{
    const s0=createInitialState(p),r=stepBlockConveyor(s0,p,1),s=r.nextState;
    const stop=1/(.5*9.8),x=.5*stop;
    expect(s.vBlock).toBe(0);expect(s.vCarrier).toBe(0);
    expect(s.xBlock).toBeCloseTo(x,9);expect(s.xCarrier).toBeCloseTo(x,9);
    expect(s.groundHeat).toBeCloseTo(3,9);expect(s.relativeScratch).toBeCloseTo(0,12);
    expect(r.events).toHaveLength(1);expect(Math.abs(r.events[0]!.time-stop)).toBeLessThan(1e-7);
    expect(s.plankStopped).toBe(true);
  });
  it('does not declare an impossible initial static contact under a strong pull',()=>{
    const q={...p,muGround:0,muBlockCarrier:.1,blockInitialV:0,plankInitialV:0,externalForcePlank:30},s0=createInitialState(q);
    expect(s0.coMovingLocked).toBe(false);
    const s=stepBlockConveyor(s0,q,.2).nextState;
    expect(s.coMovingLocked).toBe(false);
    expect(s.vBlock).toBeCloseTo(.98*.2,10);expect(s.vCarrier).toBeCloseTo((30-1.96)/4*.2,10);
    expect(s.relativeScratch).toBeCloseTo(.5*((30-1.96)/4-.98)*.2**2,10);
  });
  it('lets ground static friction hold a stationary plank against the moving block',()=>{
    const q={...p,muBlockCarrier:.2,blockInitialV:2,plankInitialV:0};
    const s=stepBlockConveyor(createInitialState(q),q,2).nextState;
    expect(s.vBlock).toBe(0);expect(s.vCarrier).toBe(0);expect(s.plankStopped).toBe(true);
    expect(s.xCarrier).toBe(0);expect(s.xBlock).toBeCloseTo(4/(2*1.96),9);
    expect(s.frictionHeat).toBeCloseTo(4,9);expect(s.groundHeat).toBe(0);
  });
  it('resolves static failure due to ground deceleration, not external force sign',()=>{
    const q={...p,muBlockCarrier:.1,blockInitialV:2,plankInitialV:2};
    const s0=createInitialState(q),s=stepBlockConveyor(s0,q,.1).nextState;
    expect(s0.coMovingLocked).toBe(false);expect(s.coMovingLocked).toBe(false);
    expect(s.vBlock).toBeCloseTo(2-.98*.1,10);expect(s.vCarrier).toBeCloseTo(2+(1.96-29.4)/4*.1,10);
    expect(s.frictionHeat).toBeGreaterThan(0);
  });
  it('halts at the optional physical edge and does not integrate unsupported contact',()=>{
    const q={...baseParams,systemMode:'conveyor' as const,beltVelocity:0,blockInitialV:4,muBlockCarrier:0,carrierLengthM:2};
    const r=stepBlockConveyor(createInitialState(q),q,2);
    expect(r.halt).toBe(true);expect(r.nextState.xBlock).toBeCloseTo(1,9);
    expect(r.advancedTime).toBeCloseTo(.25,9);expect(r.events).toHaveLength(1);
    const a=stepBlockConveyor(r.nextState,q,1);expect(a.nextState).toBe(r.nextState);expect(a.advancedTime).toBe(0);expect(a.events).toHaveLength(0);
  });
  it('checks absolute work-energy residual in joules rather than a dimensionless tolerance',()=>{
    const s0=createInitialState(p),s=stepBlockConveyor(s0,p,1).nextState;
    const reports=checkInvariants(s,s0,p);
    expect(reports.some(r=>r.unit==='J'&&r.tolerance===1e-7&&r.passed)).toBe(true);
    expect(reports[0]!.measuredError).toBeLessThan(1e-7);
  });
});

it('detects a finite edge even when a coarse step would return inside the interval',()=>{
  const p={...baseParams,beltVelocity:0,blockInitialV:4,muBlockCarrier:0, inclineDeg:30,carrierLengthM:2};
  // Without contact loss the quadratic would later return to the origin.
  const a=9.8*.5,T=(4-Math.sqrt(16-2*a))/a;
  const r=stepBlockConveyor(createInitialState(p),p,8/a);
  expect(r.halt).toBe(true);expect(r.nextState.xBlock).toBeCloseTo(1,10);expect(r.nextState.t).toBeCloseTo(T,10);
});
it('uses the moving plank edge rather than ground coordinates',()=>{
  const p={...baseParams,systemMode:'plank' as const,muBlockCarrier:0,blockInitialV:3,plankInitialV:2,carrierLengthM:2};
  const r=stepBlockConveyor(createInitialState(p),p,4);
  expect(r.halt).toBe(true);expect(r.nextState.t).toBeCloseTo(1,10);
  expect(r.nextState.xBlock).toBeCloseTo(3,10);expect(r.nextState.xCarrier).toBeCloseTo(2,10);
});
it('conserves absolute energy and agrees across coarse/fine partition for diverse Coulomb phases',()=>{
  for(const systemMode of ['conveyor','plank'] as const)
  for(const muBlockCarrier of [0,.1,.8])
  for(const muGround of [0,.25,.5])
  for(const externalForcePlank of [-20,0,30])
  for(const blockInitialV of [-2,0,3])
  for(const plankInitialV of [-1,0,3]){
    const p={...baseParams,systemMode,muBlockCarrier,muGround,externalForcePlank,blockInitialV,plankInitialV,inclineDeg:37,beltVelocity:-1};
    const init=createInitialState(p),coarse=stepBlockConveyor(init,p,2).nextState;
    let fine=init;for(let i=0;i<200;i++)fine=stepBlockConveyor(fine,p,.01).nextState;
    expect(checkInvariants(coarse,init,p)[0]!.measuredError).toBeLessThan(1e-7);
    expect(checkInvariants(fine,init,p)[0]!.measuredError).toBeLessThan(1e-7);
    for(const k of ['xBlock','xCarrier','vBlock','vCarrier','relativeScratch','frictionHeat','groundHeat','carrierWork'] as const)
      expect(Math.abs(coarse[k]-fine[k])).toBeLessThan(1e-7);
    expect(fine.coMovingLocked).toBe(coarse.coMovingLocked);expect(fine.plankStopped).toBe(coarse.plankStopped);
  }
});
