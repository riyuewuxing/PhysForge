import { describe, expect, it } from 'vitest';
import { createInitialState, stepKinematicsChase, computeObservables, checkInvariants, type KinematicsChaseParams } from './engine.js';

describe('M01 mech-kinematics-chase verification', () => {
  it('captures exact co-velocity (t=4s) and catch-up (t=4+4√2 s) within < 1e-7 s', () => {
    const params: KinematicsChaseParams = {
      scenario: 'accelerate-chase',
      vA0: 0,
      aA: 2,
      reactionTime: 0,
      xB0: 16,
      vB0: 8,
      aB: 0
    };
    let state = createInitialState(params);
    const dt = 0.01;
    for (let i = 0; i < 1000; i++) {
      state = stepKinematicsChase(state, params, dt).nextState;
    }

    const coVel = state.events.find((e) => e.id.startsWith('co-vel'));
    const meet = state.events.find((e) => e.id.startsWith('meet'));
    expect(coVel).toBeDefined();
    expect(meet).toBeDefined();
    expect(Math.abs(coVel!.time - 4.0)).toBeLessThan(1e-7);
    // Exact root of t^2 = 16 + 8*t -> t = 4 + 4*sqrt(2)
    expect(Math.abs(meet!.time - (4 + 4 * Math.SQRT2))).toBeLessThan(1e-7);
  });

  it('locks braked car velocity strictly at zero after stopping (no reversing)', () => {
    const params: KinematicsChaseParams = {
      scenario: 'brake-collision-avoid',
      vA0: 20,
      aA: -5,
      reactionTime: 0.4,
      xB0: 80,
      vB0: 10,
      aB: -5
    };
    let state = createInitialState(params);
    for (let i = 0; i < 600; i++) {
      state = stepKinematicsChase(state, params, 0.01).nextState;
    }
    expect(state.aLockedZero).toBe(true);
    expect(state.bLockedZero).toBe(true);
    expect(state.vA).toBe(0);
    expect(state.vB).toBe(0);
    // Exact A stopping distance: 20*0.4 + 20^2/(2*5) = 8 + 40 = 48 m
    expect(state.xA).toBeCloseTo(48, 6);
  });
});

describe('H12 analytic event boundaries',()=>{
  const p=(over:Partial<KinematicsChaseParams>):KinematicsChaseParams=>({scenario:'accelerate-chase',vA0:0,aA:0,reactionTime:0,xB0:5,vB0:0,aB:0,...over});
  const run=(params:KinematicsChaseParams,dt:number)=>stepKinematicsChase(createInitialState(params),params,dt).nextState;
  const times=(s:ReturnType<typeof createInitialState>,id:string)=>s.events.filter(e=>e.id.startsWith(id+'-')).map(e=>e.time);
  it('handles B braking and a meeting during the A reaction interval even in a single large step',()=>{
    const s=run(p({vA0:20,aA:-5,reactionTime:3,vB0:10,aB:-5}),4);
    expect(s.t).toBe(4);expect(s.vB).toBe(0);expect(s.xB).toBeCloseTo(15,10);
    expect(s.xA).toBeCloseTo(77.5,10);expect(s.vA).toBe(15);
    expect(times(s,'stop-b')[0]).toBeCloseTo(2,10);
    expect(times(s,'meet')[0]).toBeCloseTo((-10+Math.sqrt(150))/5,10);
    expect(s.minGap).toBe(0);
  });
  it('captures tangential meeting and co-velocity at the same instant',()=>{
    const s=run(p({xB0:1,vA0:2,aB:2}),2);
    expect(times(s,'meet')).toEqual([1]);expect(times(s,'co-vel')).toEqual([1]);expect(s.minGap).toBe(0);
  });
  it('captures two crossings in a step with identical-sign endpoint gaps',()=>{
    const s=run(p({xB0:3,vA0:4,aB:2}),4);
    expect(times(s,'meet')).toEqual([1,3]);expect(times(s,'co-vel')).toEqual([2]);expect(s.minGap).toBe(0);expect(s.t).toBe(4);
  });
  it('records an exact step-end meeting once, not zero or twice',()=>{
    const params=p({xB0:1,vA0:2});
    let s=run(params,.5);expect(times(s,'meet')).toEqual([.5]);s=stepKinematicsChase(s,params,.5).nextState;expect(times(s,'meet')).toEqual([.5]);
  });
  it('locks simultaneous stops, including co-velocity, without losing the remainder',()=>{
    const s=run(p({vA0:4,aA:-2,vB0:2,aB:-1,xB0:5}),3);
    expect(s.t).toBe(3);expect(s.vA).toBe(0);expect(s.vB).toBe(0);
    expect(s.aLockedZero&&s.bLockedZero).toBe(true);expect(times(s,'stop-a')).toEqual([2]);expect(times(s,'stop-b')).toEqual([2]);expect(times(s,'co-vel')).toEqual([2]);
    expect(s.xA).toBeCloseTo(4,10);expect(s.xB).toBeCloseTo(7,10);
  });
  it('returns the exact minimum absolute separation, even if only the interior extremum is sampled',()=>{
    const s=run(p({xB0:5,vA0:4,aB:2}),4);
    expect(s.minGap).toBeCloseTo(1,10);
  });
  it('shows zero effective acceleration at initial braking lock and right-continuous reaction boundary',()=>{
    const params=p({aA:-2,aB:-1,reactionTime:1,vB0:0});
    const s=createInitialState(params);expect(s.aACurrent).toBe(0);expect(s.aBCurrent).toBe(0);
    const q=run(p({vA0:3,aA:-2,reactionTime:1}),1);expect(q.aACurrent).toBe(-2);
  });
  it('agrees for one large step and unequal step partitions',()=>{
    const params=p({vA0:20,aA:-4,reactionTime:.4,xB0:42,vB0:6,aB:-3});
    const full=run(params,8);let s=createInitialState(params);
    for(const dt of [.13,.27,.8,1.1,2.7,3])s=stepKinematicsChase(s,params,dt).nextState;
    for(const key of ['t','xA','xB','vA','vB','minGap'] as const)expect(s[key]).toBeCloseTo(full[key],9);
    expect(s.events.map(e=>e.id)).toEqual(full.events.map(e=>e.id));
  });
});

import { mechKinematicsChasePlugin } from './plugin.js';
import { resolveInitialCameraTransform, worldToScreen, screenToWorld } from '@physforge/sim-sdk';
describe('H12 real metre geometry and teaching contracts',()=>{
  const p:KinematicsChaseParams={scenario:'accelerate-chase',vA0:0,aA:2,reactionTime:0,xB0:16,vB0:8,aB:0};
  it('maps initial handle, reference origin and exported centres in actual metres',()=>{
    const s=createInitialState(p),plugin=mechKinematicsChasePlugin;
    const h=plugin.getControlHandles!(s,p)[0]!;
    expect(h.position.x).toBe(16);
    expect(h.onDrag({x:41,y:h.position.y})).toEqual({xB0:41});
    const later=stepKinematicsChase(s,p,12).nextState;
    expect(plugin.referenceFrames![0]!.getOrigin(later,p)).toEqual({x:144,y:0});
    expect(plugin.referenceFrames![0]!.getVelocity!(later,p)).toEqual({x:24,y:0});
    expect(plugin.getControlHandles!(later,p)).toEqual([]);
    const ir=plugin.exportDiagramIR!(later,p),blocks=ir.primitives.filter(x=>x.kind==='block');
    expect(blocks.map(x=>x.cx)).toEqual([144,112]);
    expect(ir.viewBox.maxX).toBeGreaterThan(144);
    expect(plugin.getForceVectors!(later,p)[0]!.origin.x).toBe(144);
  });
  it('fits the default ten-second physical extent without scaling metres into fake units',()=>{
    const v={width:1280,height:760,dpr:1,...resolveInitialCameraTransform(mechKinematicsChasePlugin,p,1280,760)};
    expect(v.scale).toBeLessThan(.1);
    const a=worldToScreen(0,0,v),b=worldToScreen(100,0,v);
    expect(a.x).toBeGreaterThan(0);expect(b.x).toBeLessThan(v.width*.75);
    expect(screenToWorld(b.x,b.y,v).x).toBeCloseTo(100,12);
  });
  it('separates signed gap, absolute gap, and historical minimum after overtaking',()=>{
    const s=stepKinematicsChase(createInitialState(p),p,12).nextState,o=computeObservables(s);
    expect(o.deltaX).toBe(-32);expect(o.gap).toBe(32);expect(o.minGap).toBe(0);
    expect(o.firstMeetTime).toBeCloseTo(4+4*Math.SQRT2,12);expect(checkInvariants(s)[0]!.passed).toBe(true);
    const b={...p,vA0:20,aA:-4,reactionTime:.4,xB0:42,vB0:6,aB:0};
    const stop=stepKinematicsChase(createInitialState(b),b,10).nextState;
    expect(stop.minGap).toBeCloseTo(11.9,10);
    expect(stop.events.find(e=>e.id.startsWith('co-vel'))?.time).toBeCloseTo(3.9,10);
  });
});

  it('computes only the net force from explicit masses without changing prescribed trajectories',()=>{
    const p:KinematicsChaseParams={scenario:'accelerate-chase',vA0:0,aA:2,reactionTime:0,xB0:16,vB0:8,aB:0,massA:1200,massB:900};
    const a=stepKinematicsChase(createInitialState(p),p,1).nextState;
    const q={...p,massA:1800,massB:2000};
    const b=stepKinematicsChase(createInitialState(q),q,1).nextState;
    expect(a).toEqual(b);
    const v=mechKinematicsChasePlugin.getForceVectors!(a,p);
    expect(v).toHaveLength(1);expect(v[0]!.force.x).toBe(2400);expect(v[0]!.origin.x).toBe(1);expect(v[0]!.unit).toBe('N');
    expect(mechKinematicsChasePlugin.getForceVectors!(b,q)[0]!.force.x).toBe(3600);
  });
