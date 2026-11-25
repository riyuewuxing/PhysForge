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

describe('H18 M03 independently differentiated physical paths',()=>{
  const p:ConstrainedVelocityParams={mode:'rope-pull-boat',driveSpeed:1.5,heightOrLength:1.8,initialAngleDeg:30};
  const at=(q:ConstrainedVelocityParams,t:number)=>stepConstrainedVelocity(createInitialState(q),q,t).nextState;
  it('matches exact rope-length derivative and instantaneous acceleration, including coarse steps',()=>{
    const t=.3,H=1.8,L0=H/Math.sin(Math.PI/6),L=L0-1.5*t,x=Math.sqrt(L*L-H*H);
    const s=at(p,t);
    expect(s.posA.x).toBeCloseTo(x,10);
    expect(s.velA.x).toBeCloseTo(-1.5*L/x,10);
    expect(s.accelBoatMag).toBeCloseTo(1.5**2*H**2/x**3,10);
    expect(Math.abs(s.accelBoatMag-1.5**2*H**2/x**3)).toBeLessThan(1e-5);
  });
  it('does not teleport away from shore on the first step at a steep initial angle',()=>{
    const q={...p,initialAngleDeg:75};
    const a=createInitialState(q),b=stepConstrainedVelocity(a,q,1e-6).nextState;
    expect(b.posA.x).toBeLessThan(a.posA.x);
    expect((b.posA.x-a.posA.x)/1e-6).toBeCloseTo(a.velA.x,3);
  });
  it('prescribes the ladder material endpoint speed, not an arbitrary angular speed',()=>{
    const q={...p,mode:'ladder-wall' as const,driveSpeed:2,heightOrLength:3,initialAngleDeg:40},t=.25,h=1e-5;
    const s=at(q,t),a=at(q,t-h),b=at(q,t+h),y=3*Math.sin(40*Math.PI/180)-2*t;
    expect(s.posA.y).toBeCloseTo(y,10);
    expect(Math.hypot(s.posB.x,s.posA.y)).toBeCloseTo(3,10);
    expect((b.posA.y-a.posA.y)/(2*h)).toBeCloseTo(s.velA.y,7);
    expect((b.posB.x-a.posB.x)/(2*h)).toBeCloseTo(s.velB.x,7);
  });
  it('translates the wedge and raises the constrained rod at their reported velocities',()=>{
    const q={...p,mode:'wedge-rod' as const,driveSpeed:2,heightOrLength:3,initialAngleDeg:40},t=.25,h=1e-5;
    const s=at(q,t),a=at(q,t-h),b=at(q,t+h);
    expect((b.posA.x-a.posA.x)/(2*h)).toBeCloseTo(s.velA.x,7);
    expect((b.posB.y-a.posB.y)/(2*h)).toBeCloseTo(s.velB.y,7);
    expect(s.velB.y).toBeCloseTo(2*Math.tan(40*Math.PI/180),10);
    expect(s.posB.x).toBe(a.posB.x);
  });
  it('halts at the valid boundary, records one event and never advances frozen time',()=>{
    const q={...p,initialAngleDeg:75};
    const first=stepConstrainedVelocity(createInitialState(q),q,100);
    expect(first.halt).toBe(true);
    expect(first.advancedTime).toBeLessThan(100);
    expect(first.events).toHaveLength(1);
    expect(first.nextState.t).toBeCloseTo((1.8/Math.sin(75*Math.PI/180)-1.8/Math.sin(80*Math.PI/180))/1.5,7);
    const later=stepConstrainedVelocity(first.nextState,q,1);
    expect(later.advancedTime).toBe(0);
    expect(later.events).toHaveLength(0);
    expect(later.nextState).toBe(first.nextState);
  });
  it('solves asymmetric two-rope material length constraints from both moving distances',()=>{
    // Keep the test compilable against the pre-feature engine: the new mode is intentionally absent there.
    const q={...p,mode:'dual-rope-pull' as ConstrainedVelocityParams['mode'],heightOrLength:3,initialAngleDeg:45,secondarySpeedRatio:.6};
    const t=.2,h=1e-5,s=at(q,t),a=at(q,t-h),b=at(q,t+h),L0=3/(2*Math.cos(Math.PI/4));
    const l1=L0-1.5*t,l2=L0-.9*t;
    expect(Math.hypot(s.posA.x,s.posA.y)).toBeCloseTo(l1,9);
    expect(Math.hypot(s.posA.x-3,s.posA.y)).toBeCloseTo(l2,9);
    expect((b.posA.x-a.posA.x)/(2*h)).toBeCloseTo(s.velA.x,7);
    expect((b.posA.y-a.posA.y)/(2*h)).toBeCloseTo(s.velA.y,7);
    expect((-s.posA.x*s.velA.x-s.posA.y*s.velA.y)/l1).toBeCloseTo(1.5,10);
    expect(((3-s.posA.x)*s.velA.x-s.posA.y*s.velA.y)/l2).toBeCloseTo(.9,10);
  });
});

describe('H18 M03 geometry, orthogonal decomposition and terminal guards',()=>{
  it('preserves constraints and decomposes actual velocities for every mode, parameter extreme and time',()=>{
    for(const mode of ['rope-pull-boat','ladder-wall','wedge-rod','dual-rope-pull'] as const)
      for(const driveSpeed of [0,.5,5])for(const heightOrLength of [1,4])for(const initialAngleDeg of [15,45,75])
      for(const secondarySpeedRatio of [0,.6,1.5]){
        const p:ConstrainedVelocityParams={mode,driveSpeed,heightOrLength,initialAngleDeg,secondarySpeedRatio};
        let s=createInitialState(p);
        for(const dt of [0,.0001,.03,.4,20]){
          s=stepConstrainedVelocity(s,p,dt).nextState;
          expect(checkInvariants(s).every(x=>x.passed)).toBe(true);
          for(const c of s.constraints){
            expect(Math.hypot(c.unit.x,c.unit.y)).toBeCloseTo(1,12);
            expect(c.parallel.x+c.perpendicular.x).toBeCloseTo(c.velocity.x,10);
            expect(c.parallel.y+c.perpendicular.y).toBeCloseTo(c.velocity.y,10);
            expect(c.perpendicular.x*c.unit.x+c.perpendicular.y*c.unit.y).toBeCloseTo(0,10);
            expect(Math.abs(c.velocity.x*c.unit.x+c.velocity.y*c.unit.y-c.expected)).toBeLessThan(1e-10);
          }
          if(driveSpeed===0)expect(Math.hypot(s.velA.x,s.velA.y,s.velB.x,s.velB.y)).toBe(0);
        }
      }
  });
  it('captures independent analytic terminal times for rod and ramp',()=>{
    const q={driveSpeed:2,heightOrLength:3,initialAngleDeg:40};
    for(const [mode,expected] of [['ladder-wall',3*Math.sin(40*Math.PI/180)/2],['wedge-rod',.75*3/2]] as const){
      const p={...q,mode},r=stepConstrainedVelocity(createInitialState(p),p,20);
      expect(r.halt).toBe(true);expect(r.events).toHaveLength(1);
      expect(Math.abs(r.nextState.t-expected)).toBeLessThan(1e-7);
      expect(r.nextState.terminal).toBeTruthy();
      expect(stepConstrainedVelocity(r.nextState,p,1).advancedTime).toBe(0);
    }
  });
  it('dual rope terminates before degeneracy with an independent exact time',()=>{
    const p:ConstrainedVelocityParams={mode:'dual-rope-pull',driveSpeed:1.5,heightOrLength:3,initialAngleDeg:45,secondarySpeedRatio:.6};
    const expected=(3/Math.cos(Math.PI/4)-3.06)/2.4,r=stepConstrainedVelocity(createInitialState(p),p,10);
    expect(r.halt).toBe(true);expect(Math.abs(r.nextState.t-expected)).toBeLessThan(1e-7);
    expect(r.nextState.posA.y).toBeLessThan(0);
    expect(r.nextState.projectionResidual).toBeLessThan(1e-10);
  });
});

import { mechConstrainedVelocityPlugin,constrainedGeometry } from './plugin.js';
it('shares actual geometry and vector decomposition with print and handle contracts',()=>{
  for(const mode of ['rope-pull-boat','ladder-wall','wedge-rod','dual-rope-pull'] as const){
    const p:ConstrainedVelocityParams={mode,driveSpeed:1.5,heightOrLength:3,initialAngleDeg:45,secondarySpeedRatio:.6};
    const s=createInitialState(p),g=constrainedGeometry(s,p),model=mechConstrainedVelocityPlugin;
    expect(model.getControlHandles!(s,p)[0]!.onDrag(model.getControlHandles!(s,p)[0]!.position).initialAngleDeg).toBe(45);
    expect(model.getForceVectors!(s,p)).toEqual([]);
    expect(model.exportDiagramIR!(s,p).primitives).toEqual([...g.structure,...g.vectors].map(x=>x.primitive));
    expect(g.vectors.some(x=>x.role==='parallel'&&x.primitive.kind==='arrow')).toBe(true);
    expect(g.vectors.some(x=>x.role==='perpendicular'&&x.primitive.kind==='arrow')).toBe(true);
  }
});
