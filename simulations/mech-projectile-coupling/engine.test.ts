import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import {
  computeObservables,
  createInitialState,
  stepProjectileCoupling,
  type ProjectileCouplingParams
} from './engine.js';

describe('M04 mech-projectile-coupling verification', () => {
  it('captures flat projectile impact time on incline within < 1e-7 s and stays within safety envelope', () => {
    const params: ProjectileCouplingParams = {
      mode: 'incline-flat',
      v0: 6.0,
      launchAngleDeg: 0,
      inclineDeg: 37,
      troughRadius: 2.5,
      dragCoeff: 0,
      mass: 1.0
    };
    const expectedFlyTime = (2 * params.v0 * Math.tan(degToRad(params.inclineDeg))) / CLASSROOM_GRAVITY;

    let state = createInitialState(params);
    for (let i = 0; i < 400; i++) {
      state = stepProjectileCoupling(state, params, 0.01).nextState;
      if (state.landed) break;
    }
    expect(state.landed).toBe(true);
    expect(Math.abs(state.impactTime! - expectedFlyTime)).toBeLessThan(1e-7);

    // Oblique projectile under quadratic drag vs safety envelope and strictly smaller kinetic energy
    const dragParams: ProjectileCouplingParams = {
      mode: 'safety-envelope',
      v0: 8.0,
      launchAngleDeg: 55,
      inclineDeg: 30,
      troughRadius: 2.0,
      dragCoeff: 0.1,
      mass: 1.0
    };
    let dState = createInitialState(dragParams);
    for (let i = 0; i < 300; i++) {
      dState = stepProjectileCoupling(dState, dragParams, 0.01).nextState;
      const envY =
        (dragParams.v0 * dragParams.v0) / (2 * CLASSROOM_GRAVITY) -
        (CLASSROOM_GRAVITY * dState.x * dState.x) / (2 * dragParams.v0 * dragParams.v0);
      expect(dState.y).toBeLessThanOrEqual(envY + 1e-7);
      if (dState.landed) break;
    }
    const obs = computeObservables(dState, dragParams);
    expect(obs.kineticEnergy!).toBeLessThan(dState.initialEnergy);
  });
});

describe('H20 M04 independent impact and terminal semantics',()=>{
  const p:ProjectileCouplingParams={mode:'incline-flat',v0:6,launchAngleDeg:0,inclineDeg:37,troughRadius:2.5,dragCoeff:0,mass:1};
  it('captures the nonzero return to the incline even inside the very first coarse step',()=>{
    const T=12*Math.tan(37*Math.PI/180)/9.8;
    const hit=stepProjectileCoupling(createInitialState(p),p,2*T);
    expect(hit.nextState.landed).toBe(true);
    expect(hit.events).toHaveLength(1);
    expect(hit.halt).toBe(true);
    expect(Math.abs(hit.nextState.t-T)).toBeLessThan(1e-7);
    expect(Math.abs(hit.nextState.x-6*T)).toBeLessThan(1e-6);
    expect(Math.abs(hit.nextState.y+6*T*Math.tan(37*Math.PI/180))).toBeLessThan(1e-6);
    expect(Math.abs((hit.advancedTime??2*T)-T)).toBeLessThan(1e-7);
  });
  it('reports actual advanced time at impact and does not re-advance or emit duplicate impact events',()=>{
    let state=createInitialState(p);
    for(let i=0;i<100;i++){
      const before=state.t,r=stepProjectileCoupling(state,p,.05);state=r.nextState;
      if(state.landed){
        expect(r.halt).toBe(true);
        expect(r.advancedTime).toBeCloseTo(state.t-before,12);
        const again=stepProjectileCoupling(state,p,1);
        expect(again.nextState).toBe(state);
        expect(again.events).toHaveLength(0);
        expect(again.advancedTime).toBe(0);
        expect(again.halt).toBe(true);return;
      }
    }
    throw Error('missed incline event');
  });
  it('treats horizontal launch from the safety-envelope ground as zero-duration contact',()=>{
    const q={...p,mode:'safety-envelope' as const,launchAngleDeg:0};
    const r=stepProjectileCoupling(createInitialState(q),q,.1);
    expect(r.halt).toBe(true);
    expect(r.nextState.landed).toBe(true);
    expect(r.nextState.impactTime).toBe(0);
    expect(r.advancedTime).toBe(0);
    expect(r.events).toHaveLength(1);
  });
  it('never collides with the nonexistent upper semicircle',()=>{
    const q={...p,mode:'semicircle-trough' as const,troughRadius:1,v0:8,launchAngleDeg:60};
    let s=createInitialState(q);
    for(let i=0;i<40;i++)s=stepProjectileCoupling(s,q,.01).nextState;
    expect(s.landed).toBe(false);
    expect(s.events).toHaveLength(0);
    expect(s.t).toBeCloseTo(.4,10);
    expect(s.x).toBeCloseTo(1.6,10);
    expect(s.y).toBeCloseTo(8*Math.sin(Math.PI/3)*.4-.5*9.8*.4**2,10);
  });
  it('captures the physical lower arc in one coarse step, against an independent analytic root',()=>{
    const q={...p,mode:'semicircle-trough' as const,v0:4,launchAngleDeg:0,troughRadius:2.5};
    // Substitute x=4t, y=-gt²/2 into (x-R)²+y²=R²,
    // then divide out the launch root t=0.
    const f=(t:number)=>16*t+9.8**2*t**3/4-20;
    let lo=0,hi=2;
    for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(f(mid)<0)lo=mid;else hi=mid;}
    const T=(lo+hi)/2,r=stepProjectileCoupling(createInitialState(q),q,2);
    expect(r.nextState.landed).toBe(true);expect(r.halt).toBe(true);
    expect(Math.abs(r.nextState.t-T)).toBeLessThan(1e-7);
    expect(r.nextState.y).toBeLessThan(0);
    expect(Math.abs((r.nextState.x-2.5)**2+r.nextState.y**2-2.5**2)).toBeLessThan(1e-6);
  });
});

it('terminates above the right rim as escape, never as a fictitious collision',()=>{
  const p:ProjectileCouplingParams={mode:'semicircle-trough',v0:8,launchAngleDeg:60,inclineDeg:30,troughRadius:1,dragCoeff:0,mass:1};
  const r=stepProjectileCoupling(createInitialState(p),p,2),s=r.nextState;
  expect(r.halt).toBe(true);expect(s.landed).toBe(false);expect(s.impactTime).toBeNull();expect(s.termination).toBe('escaped');
  expect(Math.abs(s.t-.5)).toBeLessThan(1e-7);expect(s.y).toBeGreaterThan(0);
  expect(r.events[0]!.id).toBe('m04-escaped');
  expect(stepProjectileCoupling(s,p,1).advancedTime).toBe(0);
});
it('preserves exact flight and impact under different outer step sizes, with or without drag',()=>{
  for(const mode of ['incline-flat','semicircle-trough','safety-envelope'] as const)for(const dragCoeff of [0,.08,.3]){
    const p:ProjectileCouplingParams={mode,v0:6,launchAngleDeg:mode==='semicircle-trough'?0:35,inclineDeg:30,troughRadius:2.5,dragCoeff,mass:1};
    const a=stepProjectileCoupling(createInitialState(p),p,20).nextState;
    let b=createInitialState(p);
    for(let i=0;i<2000&&!b.termination;i++)b=stepProjectileCoupling(b,p,1/240).nextState;
    expect(a.termination).toBeTruthy();expect(b.termination).toBe(a.termination);
    expect(Math.abs(a.t-b.t)).toBeLessThan(1e-7);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(1e-6);
    expect(Math.hypot(a.vx-b.vx,a.vy-b.vy)).toBeLessThan(1e-6);
  }
});
