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
    for(let i=0;i<240&&!s.terminal;i++){
      const out=stepConicalTurntable(s,p,1/240);s=out.nextState;
      expect(s.heat).toBeGreaterThanOrEqual(lastHeat-1e-12);lastHeat=s.heat;
      for(const report of checkInvariants(s,init,p))expect(report.passed,report.name+': '+report.measuredError).toBe(true);
      const ua={x:s.va.x+p.omega*s.a.y,y:s.va.y-p.omega*s.a.x},ub={x:s.vb.x+p.omega*s.b.y,y:s.vb.y-p.omega*s.b.x};
      expect(s.fa.x*ua.x+s.fa.y*ua.y).toBeLessThanOrEqual(1e-12);expect(s.fb.x*ub.x+s.fb.y*ub.y).toBeLessThanOrEqual(1e-12);
    }
    expect(s.terminal).not.toBeNull();expect(s.heat).toBeGreaterThan(0);
    const stop=stepConicalTurntable(s,p,1);expect(stop.nextState).toBe(s);expect(stop.advancedTime).toBe(0);
  });
  it('does not invent a rotating cone below the stationary-branch threshold',()=>{
    const q={...p,mode:'conical-pendulum' as const,omega:1},s=stepConicalTurntable(createInitialState(q),q,2).nextState;
    expect(s.rotatingCone).toBe(false);expect(s.rA).toBe(0);expect(s.tensionN).toBeCloseTo(q.massA*9.8,12);
    expect(s.a).toEqual({x:0,y:1.1-q.pendulumLength});expect(s.va.x).toBe(0);
  });
});
