import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { mechConicalTurntablePlugin } from './plugin.js';
import {
  checkInvariants,
  computeCriticalOmegas,
  createInitialState,
  stepConicalTurntable,
  type ConicalTurntableParams
} from './engine.js';

describe('M07 mech-conical-turntable verification', () => {
  it('computes exact critical angular speeds omega1, omega2, omega3 < 1e-6 and slides outward beyond omega3', () => {
    const base: ConicalTurntableParams = {
      mode: 'turntable-dual',
      omega: 2.0,
      massA: 1.0,
      massB: 2.0,
      radiusA: 0.6,
      radiusB: 1.5,
      mu: 0.3,
      pendulumLength: 1.5
    };
    const g = CLASSROOM_GRAVITY;
    const { omega1, omega2, omega3 } = computeCriticalOmegas(base);
    expect(Math.abs(omega1 - Math.sqrt((0.3 * g) / 1.5))).toBeLessThan(1e-10);
    expect(Math.abs(omega2! - Math.sqrt((0.3 * 2 * g) / (2 * 1.5 - 1 * 0.6)))).toBeLessThan(1e-10);
    expect(Math.abs(omega3! - Math.sqrt((0.3 * 3 * g) / (2 * 1.5 - 1 * 0.6)))).toBeLessThan(1e-10);

    // Below omega3: equilibrium holds rigorously
    const eqState = createInitialState({ ...base, omega: omega3! - 0.1 });
    expect(eqState.slippingOut).toBe(false);
    expect(checkInvariants(eqState, eqState, { ...base, omega: omega3! - 0.1 })[0]!.passed).toBe(true);

    // Above omega3: blocks slip outward
    const slipParams = { ...base, omega: omega3! + 0.5 };
    let slipState = createInitialState(slipParams);
    expect(slipState.slippingOut).toBe(true);
    for (let i = 0; i < 60; i++) {
      slipState = stepConicalTurntable(slipState, slipParams, 0.01).nextState;
    }
    expect(slipState.rB).toBeGreaterThan(base.radiusB);
  });

  it('exposes the signed inward friction and string tension in Auto-FBD vectors', () => {
    const params = resolvePluginParams(mechConicalTurntablePlugin.paramSchema, {
      mode: 'turntable-dual',
      omega: 1.5
    });
    const state = createInitialState(params);
    const plugin = mechConicalTurntablePlugin as SimulationPluginV2<typeof params, typeof state>;
    const vectors = plugin.getForceVectors?.(state, params) ?? [];

    expect(vectors.map((vector) => vector.id)).toContain('friction-a');
    expect(vectors.map((vector) => vector.id)).toContain('tension-a');
    const frictionA = vectors.find((vector) => vector.id === 'friction-a');
    expect(frictionA?.force.x).toBeGreaterThan(0);

    const highOmegaParams = { ...params, omega: 1.7 };
    const highOmegaState = createInitialState(highOmegaParams);
    const highOmegaVectors = plugin.getForceVectors?.(highOmegaState, highOmegaParams) ?? [];
    const reversedFrictionA = highOmegaVectors.find((vector) => vector.id === 'friction-a');
    expect(reversedFrictionA?.force.x).toBeLessThan(0);
  });
});

describe('H26 M07 static feasibility and physical string regression',()=>{
  const p:ConicalTurntableParams={mode:'turntable-dual',omega:1.7,massA:1,massB:2,radiusA:.6,radiusB:1.5,mu:.3,pendulumLength:1.5};
  it('uses the signed mass-radius difference, including A-dominant cases',()=>{
    const q={...p,massA:5,massB:.5,radiusA:1.2,radiusB:1.5};
    const D=q.massA*q.radiusA-q.massB*q.radiusB;
    expect(computeCriticalOmegas(q).omega3).toBeCloseTo(Math.sqrt(q.mu*9.8*(q.massA+q.massB)/D),12);
    expect(computeCriticalOmegas(q).omega2).toBeCloseTo(Math.sqrt(q.mu*9.8*q.massA/D),12);
  });
  it('does not manufacture a finite angular limit for exactly balanced mass-radius products',()=>{
    const q={...p,massA:2,massB:1,radiusA:.75,radiusB:1.5,omega:6};
    expect(computeCriticalOmegas(q).omega2).toBeNull();
    expect(computeCriticalOmegas(q).omega3).toBeNull();
    const s=createInitialState(q);expect(s.slippingOut).toBe(false);
    expect(Math.abs(s.frictionAN)).toBeLessThanOrEqual(q.mu*q.massA*9.8+1e-10);
    expect(Math.abs(s.frictionBN)).toBeLessThanOrEqual(q.mu*q.massB*9.8+1e-10);
  });
  it('selects the minimum feasible nonnegative tension and obeys both independent friction bounds',()=>{
    const q={...p,massA:1,massB:1,radiusA:1.2,radiusB:.8,omega:1.8};
    const s=createInitialState(q),f=q.mu*9.8;
    expect(s.tensionN).toBeCloseTo(q.massA*q.omega**2*q.radiusA-f,12);
    expect(Math.abs(s.frictionAN)).toBeLessThanOrEqual(f+1e-10);
    expect(Math.abs(s.frictionBN)).toBeLessThanOrEqual(f+1e-10);
    expect(s.frictionAN+s.tensionN).toBeCloseTo(q.massA*q.omega**2*q.radiusA,12);
    expect(s.frictionBN+s.tensionN).toBeCloseTo(q.massB*q.omega**2*q.radiusB,12);
  });
  it('keeps an actual taut rope at its initial length after loss of static equilibrium',()=>{
    const q={...p,omega:3.2};let s=createInitialState(q);
    for(let i=0;i<15;i++)s=stepConicalTurntable(s,q,.01).nextState;
    const f=mechConicalTurntablePlugin.getForceVectors!(s,q);
    const a=f.find(x=>x.id==='tension-a')!,b=f.find(x=>x.id==='tension-b')!;
    expect(a).toBeDefined();expect(b).toBeDefined();
    expect(Math.hypot(a.origin.x-b.origin.x,a.origin.y-b.origin.y)).toBeCloseTo(q.radiusA+q.radiusB,10);
    expect(a.force.x+b.force.x).toBeCloseTo(0,10);expect(a.force.y+b.force.y).toBeCloseTo(0,10);
  });
  it('projects a real three-dimensional conical-pendulum force without renormalizing the projection',()=>{
    const q={...p,mode:'conical-pendulum' as const,omega:3.6};
    const s=stepConicalTurntable(createInitialState(q),q,Math.PI/(2*q.omega)).nextState;
    const f=mechConicalTurntablePlugin.getForceVectors!(s,q);
    const tension=f.find(x=>x.id==='tension')!,net=f.find(x=>x.id==='net')!;
    expect(tension.force.y).toBeCloseTo(q.massA*9.8,11);
    expect(net.force.x).toBeCloseTo(0,11);expect(net.force.y).toBeCloseTo(0,11);
  });
});

describe('H26 dynamic and energetic checks',()=>{
  const p:ConicalTurntableParams={mode:'turntable-dual',omega:3.2,massA:1,massB:2,radiusA:.6,radiusB:1.5,mu:.3,pendulumLength:1.5};
  it('frictionless inertial center of mass and free rotation are exact until the fixed edge',()=>{
    const q={...p,mu:0,omega:2},init=createInitialState(q),s=stepConicalTurntable(init,q,.2).nextState;
    const C=(q.massB*q.radiusB-q.massA*q.radiusA)/(q.massA+q.massB);
    expect((q.massA*s.a.x+q.massB*s.b.x)/(q.massA+q.massB)).toBeCloseTo(C,11);
    expect((q.massA*s.a.y+q.massB*s.b.y)/(q.massA+q.massB)).toBeCloseTo(C*q.omega*.2,11);
    expect(s.direction.x).toBeCloseTo(Math.cos(q.omega*.2),11);
    expect(s.direction.y).toBeCloseTo(Math.sin(q.omega*.2),11);
    expect(s.tensionN).toBeCloseTo(q.massA*q.massB/(q.massA+q.massB)*(q.radiusA+q.radiusB)*q.omega**2,10);
    expect(s.heat).toBe(0);expect(s.diskWork).toBe(0);
  });
  it('checks individual bounds, taut length and the disk work/heat ledger through actual sliding',()=>{
    const init=createInitialState(p);let s=init;let lastHeat=0;
    for(let i=0;i<480&&!s.terminal;i++){
      const out=stepConicalTurntable(s,p,1/240);s=out.nextState;
      expect(s.heat).toBeGreaterThanOrEqual(lastHeat-1e-12);lastHeat=s.heat;
      for(const report of checkInvariants(s,init,p))expect(report.passed,report.name+': '+report.measuredError).toBe(true);
      const ua={x:s.va.x+p.omega*s.a.y,y:s.va.y-p.omega*s.a.x},ub={x:s.vb.x+p.omega*s.b.y,y:s.vb.y-p.omega*s.b.x};
      expect(s.fa.x*ua.x+s.fa.y*ua.y).toBeLessThanOrEqual(1e-12);expect(s.fb.x*ub.x+s.fb.y*ub.y).toBeLessThanOrEqual(1e-12);
    }
    expect(s.terminal).toBe('edge-a');expect(s.heat).toBeGreaterThan(0);
    expect(s.t).toBeCloseTo(1.03331744326271,7);expect(s.rA).toBeCloseTo(2.6,8);
    expect(s.rB).toBeCloseTo(2.5757195066690546,7);
    expect(s.heat).toBeCloseTo(25.779116693071362,5);expect(s.diskWork).toBeCloseTo(31.11955606419061,5);
    const stop=stepConicalTurntable(s,p,1);expect(stop.nextState).toBe(s);expect(stop.advancedTime).toBe(0);
  });
  it('does not invent a rotating cone below the stationary-branch threshold',()=>{
    const q={...p,mode:'conical-pendulum' as const,omega:1},s=stepConicalTurntable(createInitialState(q),q,2).nextState;
    expect(s.rotatingCone).toBe(false);expect(s.rA).toBe(0);expect(s.tensionN).toBeCloseTo(q.massA*9.8,12);
    expect(s.a).toEqual({x:0,y:1.1-q.pendulumLength});expect(s.va.x).toBe(0);
  });
});

import { staticFeasibility } from './engine.js';
import { turntableDiagram,staticForceSweep,fitTurntableViewport,turntableBoundsFit } from './diagram.js';
describe('H26 M07 linked diagrams and parameter-domain contracts',()=>{
  const p:ConicalTurntableParams={mode:'turntable-dual',omega:1.7,massA:1,massB:2,radiusA:.6,radiusB:1.5,mu:.3,pendulumLength:1.5};
  it('samples only the real piecewise-linear feasible domain and includes all three thresholds',()=>{
    const q=staticForceSweep(p),c=computeCriticalOmegas(p);
    for(const w of [c.omega1,c.omega2!,c.omega3!])expect(q.points.some(x=>Math.abs(x.w2-w*w)<1e-10)).toBe(true);
    for(const x of q.points){expect(x.w2).toBeLessThanOrEqual(c.omega3!**2+1e-10);expect(x.fa+x.T).toBeCloseTo(p.massA*p.radiusA*x.w2,10);expect(x.fb+x.T).toBeCloseTo(p.massB*p.radiusB*x.w2,10);}
    expect(q.points.at(-1)?.fa).toBeCloseTo(-p.mu*p.massA*9.8,10);
  });
  it('checks both static inequalities across reversed radii, masses and zero friction',()=>{
    for(const mA of [.5,1,5])for(const mB of [.5,2,5])for(const rA of [.2,1.2])for(const rB of [.8,2.4])for(const mu of [0,.3,.8])for(const w of [0,1,3,6]){
      const q={...p,massA:mA,massB:mB,radiusA:rA,radiusB:rB,mu,omega:w},f=staticFeasibility(q),s=createInitialState(q);
      const D=Math.abs(mB*rB-mA*rA),feasible=D*w*w<=mu*9.8*(mA+mB)+1e-10;
      expect(f.feasible).toBe(feasible);expect(s.slippingOut).toBe(!feasible);
      if(feasible){
        expect(Math.abs(s.frictionAN)).toBeLessThanOrEqual(mu*mA*9.8+1e-9);expect(Math.abs(s.frictionBN)).toBeLessThanOrEqual(mu*mB*9.8+1e-9);
        expect(s.frictionAN+s.tensionN).toBeCloseTo(mA*w*w*rA,9);expect(s.frictionBN+s.tensionN).toBeCloseTo(mB*w*w*rB,9);
      }
    }
  });
  it('uses identical actual moving A/B and fixed disk geometry in Canvas/IR',()=>{
    const q={...p,omega:3.2},s=stepConicalTurntable(createInitialState(q),q,.6).nextState,d=turntableDiagram(s,q);
    expect(s.a.x).toBeCloseTo(.75746123,7);expect(s.a.y).toBeCloseTo(.14735106,7);
    expect(s.b.x).toBeCloseTo(.03894696,7);expect(s.b.y).toBeCloseTo(2.12060656,7);
    const rope=d.items.find(i=>i.role==='rope')?.primitive;
    expect(rope).toMatchObject({kind:'line',x1:s.a.x,y1:s.a.y,x2:s.b.x,y2:s.b.y});
    expect(d.items.find(i=>i.role==='disk')?.primitive).toMatchObject({kind:'circle',r:2.6});
    const ir=mechConicalTurntablePlugin.exportDiagramIR!(s,q);
    expect(ir.primitives).toContainEqual(rope);
    const v={width:1440,height:900,dpr:1,scale:1,offsetX:0,offsetY:0},safe={left:28,right:1120,top:28,bottom:720};
    const fit=fitTurntableViewport(s,q,v,safe)!;expect(turntableBoundsFit(s,q,fit,safe)).toBe(true);
  });
  it('cone linked top view uses the actual 3D radius while side projection preserves the real bob',()=>{
    const q={...p,mode:'conical-pendulum' as const,omega:3.6},s=stepConicalTurntable(createInitialState(q),q,Math.PI/(2*q.omega)).nextState,d=turntableDiagram(s,q);
    expect(d.items.find(i=>i.role==='bob')?.primitive).toMatchObject({kind:'circle',cx:s.a.x,cy:s.a.y});
    expect(d.items.find(i=>i.role==='orbit')?.primitive).toMatchObject({kind:'circle',r:s.rA});
    expect(d.items.some(i=>i.role==='top-bob')).toBe(true);
    expect(d.items.some(i=>i.role==='disk')).toBe(false);
  });
});

it('uses exact Coulomb onset and near-critical motion without low-speed drag regularization',()=>{
  const p:ConicalTurntableParams={mode:'turntable-dual',omega:Math.sqrt(8.82/2.4)*1.001,massA:1,massB:2,radiusA:.6,radiusB:1.5,mu:.3,pendulumLength:1.5};
  const init=createInitialState(p);expect(init.slippingOut).toBe(true);
  expect(Math.hypot(init.fa.x,init.fa.y)).toBeCloseTo(2.94,12);
  expect(Math.hypot(init.fb.x,init.fb.y)).toBeCloseTo(5.88,12);
  let s=init;for(let i=0;i<480;i++)s=stepConicalTurntable(s,p,1/240).nextState;
  // Independent high-accuracy inertial-frame SciPy integration, exact Coulomb.
  const u={x:s.va.x+p.omega*s.a.y,y:s.va.y-p.omega*s.a.x};
  expect(Math.hypot(u.x,u.y)).toBeCloseTo(.06741013813709107,7);
  expect(s.heat).toBeCloseTo(.3046509164868411,7);
  expect(s.diskWork).toBeCloseTo(.5966871046979096,7);
  expect(s.rA).toBeCloseTo(.565504129400,7);
  expect(s.rB).toBeCloseTo(1.53449869406,7);
  expect(Math.hypot(s.fa.x,s.fa.y)).toBeCloseTo(2.94,11);
  expect(Math.hypot(s.fb.x,s.fb.y)).toBeCloseTo(5.88,11);
  expect(Math.abs(s.kineticEnergy-s.initialEnergy+s.heat-s.diskWork)).toBeLessThan(1e-9);
  expect(s.terminal).toBeNull();
});
