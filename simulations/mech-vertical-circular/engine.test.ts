import { describe, expect, it } from 'vitest';
import { createInitialState, stepVerticalCircular, type VerticalCircularParams } from './engine.js';

describe('M06 mech-vertical-circular verification', () => {
  it('derails smooth outer hemisphere near arccos(2/3) (< 1e-6 rad for tiny launchperturbation) and conserves energy < 1e-6', () => {
    const params: VerticalCircularParams = {
      trackMode: 'outer-dome',
      mass: 1.0,
      radius: 1.6,
      vLaunch: 1e-4,
      startAngleDeg: 0.01
    };
    let state = createInitialState(params);
    for (let i = 0; i < 1500; i++) {
      state = stepVerticalCircular(state, params, 0.004).nextState;
      if (state.derailed) break;
    }

    expect(state.derailed).toBe(true);
    const analyticalRad = Math.acos(2 / 3);
    const measuredRad = (state.derailAngleDeg! * Math.PI) / 180;
    expect(Math.abs(measuredRad - analyticalRad)).toBeLessThan(1e-6);

    // Continue free projectile motion and confirm energy conservation
    for (let i = 0; i < 60; i++) {
      state = stepVerticalCircular(state, params, 0.004).nextState;
    }
    const eNow = 0.5 * params.mass * (state.vx * state.vx + state.vy * state.vy) + params.mass * 9.8 * state.y;
    expect(Math.abs(eNow - state.initialEnergy) / Math.abs(state.initialEnergy)).toBeLessThan(1e-6);
  });
});

describe('H25 M06 unilateral versus bilateral constraints',()=>{
  const R=1.6,g=9.8;
  const p:VerticalCircularParams={trackMode:'outer-dome',mass:1,radius:R,vLaunch:1,startAngleDeg:30};
  it('immediately releases a supercritical outer dome launch, preserving position and velocity',()=>{
    const q={...p,vLaunch:5},s=createInitialState(q);
    expect(s.derailed).toBe(true);expect(s.normalForceN).toBe(0);
    expect(s.events[0]?.time).toBe(0);
    const next=stepVerticalCircular(s,q,.2);
    expect(next.nextState.x).toBeCloseTo(s.x+s.vx*.2,11);
    expect(next.nextState.y).toBeCloseTo(s.y+s.vy*.2-.5*g*.2**2,11);
    expect(next.events).toHaveLength(1);
    expect(stepVerticalCircular(next.nextState,q,.1).events).toHaveLength(0);
  });
  it('does not silently perturb an exactly stationary top equilibrium',()=>{
    const q={...p,vLaunch:0,startAngleDeg:0},s=createInitialState(q);
    const next=stepVerticalCircular(s,q,3).nextState;
    expect(next.x).toBeCloseTo(0,13);expect(next.y).toBeCloseTo(R,13);
    expect(next.vx).toBeCloseTo(0,13);expect(next.normalForceN).toBeCloseTo(g,12);
    expect(next.derailed).toBe(false);
  });
  it('locates an outer release inside a coarse step and integrates the entire remainder',()=>{
    const s=createInitialState(p),r=stepVerticalCircular(s,p,.8),event=r.events[0];
    const t=.3328391586693,angle=53.229676833868496*Math.PI/180;
    const v=Math.sqrt(g*R*Math.cos(angle)),rem=.8-t;
    expect(event?.time).toBeCloseTo(t,7);
    expect(r.nextState.derailed).toBe(true);expect(r.nextState.t).toBeCloseTo(.8,13);
    expect(r.nextState.x).toBeCloseTo(R*Math.sin(angle)+v*Math.cos(angle)*rem,7);
    expect(r.nextState.y).toBeCloseTo(R*Math.cos(angle)-v*Math.sin(angle)*rem-.5*g*rem**2,7);
  });
  it('finds the first inner release even when a large step spans the top and returns',()=>{
    const q={...p,trackMode:'inner-loop' as const,vLaunch:8},s=createInitialState(q);
    const r=stepVerticalCircular(s,q,2);
    expect(r.events).toHaveLength(1);expect(r.events[0]?.time).toBeCloseTo(.6279073638354,7);
    expect(r.nextState.derailAngleDeg).toBeCloseTo(46.06216011426045,5);
    expect(r.nextState.t).toBeCloseTo(2,12);
  });
  it('retains contact through zero-force tangencies at the side and top',()=>{
    for(const v of [Math.sqrt(2*g*R),Math.sqrt(5*g*R)]){
      const q={...p,trackMode:'inner-loop' as const,vLaunch:v};
      let s=createInitialState(q);
      for(let i=0;i<2400;i++){
        s=stepVerticalCircular(s,q,1/240).nextState;
        expect(s.derailed).toBe(false);expect(s.normalForceN).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(s.x,s.y)).toBeCloseTo(R,11);
      }
    }
  });
  it('allows signed compressive rod reaction, without treating negative force as loss of constraint',()=>{
    const q={...p,trackMode:'light-rod' as const,vLaunch:Math.sqrt(4.5*g*R)};
    let s=createInitialState(q),negative=false;
    for(let i=0;i<1600;i++){
      s=stepVerticalCircular(s,q,1/240).nextState;
      negative ||= s.normalForceN<-.1;
      expect(s.derailed).toBe(false);expect(Math.hypot(s.x,s.y)).toBeCloseTo(R,11);
    }
    expect(negative).toBe(true);
  });
});
