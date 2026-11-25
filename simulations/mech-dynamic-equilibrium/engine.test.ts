import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { createInitialState, solveEquilibriumAtAngle, stepEquilibrium, computeObservables, checkInvariants, angleRange, equilibriumAngleSamples, type EquilibriumParams } from './engine.js';

describe('M02 mech-dynamic-equilibrium verification', () => {
  it('maintains vector equilibrium residual < 1e-10 N across all angles and equal active-knot tension', () => {
    const knotParams: EquilibriumParams = {
      mode: 'active-pulley-knot',
      mass: 2.0,
      baseAngleDeg: 30,
      sweepAngleDeg: 40,
      autoSweep: false
    };
    for (const ang of [15, 30, 45, 60, 75]) {
      const sol = solveEquilibriumAtAngle(knotParams, ang);
      expect(sol.netResidualN).toBeLessThan(1e-10);
      expect(Math.abs(sol.force1.mag - sol.force2.mag)).toBeLessThan(1e-10);
    }

    // Dead knot: minimum pull occurs at beta === alpha (= 37 deg) with value mg * sin(alpha)
    const deadParams: EquilibriumParams = {
      mode: 'dead-knot-rotate',
      mass: 2.0,
      baseAngleDeg: 37,
      sweepAngleDeg: 37,
      autoSweep: false
    };
    const atOpt = solveEquilibriumAtAngle(deadParams, 37);
    const expectedMin = 2.0 * CLASSROOM_GRAVITY * Math.sin(degToRad(37));
    expect(Math.abs(atOpt.force2.mag - expectedMin)).toBeLessThan(1e-6);
    expect(atOpt.netResidualN).toBeLessThan(1e-10);
    expect(solveEquilibriumAtAngle(deadParams, 15).force2.mag).toBeGreaterThan(atOpt.force2.mag);
    expect(solveEquilibriumAtAngle(deadParams, 65).force2.mag).toBeGreaterThan(atOpt.force2.mag);
  });
});

describe('M02 independent boundary and initial-state regressions', () => {
  const p: EquilibriumParams = { mode: 'dead-knot-rotate', mass: 2, baseAngleDeg: 75, sweepAngleDeg: -30, autoSweep: false };
  it('cannot balance a weight by making either of two ropes push', () => {
    const s = solveEquilibriumAtAngle(p, -30);
    expect(s.force1.x).toBeLessThanOrEqual(0);
    expect(s.force2.x).toBeGreaterThanOrEqual(0);
    expect(s.netResidualN).toBeGreaterThan(1e-10);
  });
  it('does not invent enormous rope forces at the collinear singularity', () => {
    const s = solveEquilibriumAtAngle({ ...p, baseAngleDeg: 60 }, -30);
    expect(s.force1.mag).toBe(0);
    expect(s.force2.mag).toBe(0);
    expect(s.netResidualN).toBeCloseTo(p.mass * CLASSROOM_GRAVITY, 10);
  });
  it('reports the same support angle used by the actual normal force', () => {
    const s = solveEquilibriumAtAngle({ ...p, mode: 'hemisphere-similar' }, 10);
    const normalTilt = Math.atan2(-s.force1.x, s.force1.y) * 180 / Math.PI;
    expect(s.activeAngleDeg).toBeCloseTo(normalTilt, 10);
  });
  it('reports the same angle as the actual active-pulley rope direction', () => {
    const s = solveEquilibriumAtAngle({ ...p, mode: 'active-pulley-knot' }, 0);
    const ropeAngle = Math.atan2(s.force2.y, s.force2.x) * 180 / Math.PI;
    expect(s.activeAngleDeg).toBeCloseTo(ropeAngle, 10);
  });
  it('does not jump from the selected initial angle on the first automatic step', () => {
    const params = { ...p, baseAngleDeg: 37, sweepAngleDeg: 65, autoSweep: true };
    const init = createInitialState(params);
    const s = stepEquilibrium(init, params, 1e-6).nextState;
    expect(Math.abs(s.activeAngleDeg - init.activeAngleDeg)).toBeLessThan(0.001);
  });
  it('matches independently projected force magnitudes across the feasible dead-knot domain', () => {
    for (const alpha of [15, 37, 75]) {
      for (const beta of [-30, 0, 20, 55, 75]) {
        const cosine = Math.cos(degToRad(alpha - beta));
        if (cosine <= 1e-8) continue;
        const s = solveEquilibriumAtAngle({ ...p, baseAngleDeg: alpha }, beta);
        const mg = p.mass * CLASSROOM_GRAVITY;
        expect(s.force1.mag).toBeCloseTo(mg * Math.cos(degToRad(beta)) / cosine, 8);
        expect(s.force2.mag).toBeCloseTo(mg * Math.sin(degToRad(alpha)) / cosine, 8);
        expect(s.netResidualN).toBeLessThan(1e-10);
      }
    }
  });
});

describe('M02 hemisphere and invalid telemetry',()=>{
  const p:EquilibriumParams={mode:'hemisphere-suspension',mass:2,baseAngleDeg:37,sweepAngleDeg:35,autoSweep:false,radiusM:1.2,anchorHeightM:.8};
  it('derives actual rope length and constant normal force from sphere geometry',()=>{
    for(const theta of [1,15,35,53]){
      const s=solveEquilibriumAtAngle(p,theta),mg=p.mass*CLASSROOM_GRAVITY;
      const L=Math.sqrt(1.2**2+2**2-2*1.2*2*Math.cos(degToRad(theta)));
      expect(s.sphere?.ropeLength).toBeCloseTo(L,12);
      expect(Math.hypot(s.point.x,s.point.y)).toBeCloseTo(1.2,12);
      expect(s.force1.mag).toBeCloseTo(mg*.6,12);
      expect(s.force2.mag).toBeCloseTo(mg*L/2,12);
      expect(s.force1.x*s.point.y-s.force1.y*s.point.x).toBeCloseTo(0,12);
      expect(s.force2.x*(2-s.point.y)+s.force2.y*s.point.x).toBeCloseTo(0,12);
      expect(s.netResidualN).toBeLessThan(1e-10);
      expect(s.minPullForceN).toBeCloseTo(mg*.4,12);
    }
  });
  it('does not publish fictitious zero force data when there is no solution',()=>{
    const s=createInitialState({...p,mode:'dead-knot-rotate',baseAngleDeg:75,sweepAngleDeg:-30});
    expect(s.status).toBe('infeasible');
    expect(computeObservables(s)).not.toHaveProperty('force1');
    expect(computeObservables(s)).not.toHaveProperty('force2');
    expect(computeObservables(s).solutionDefined).toBe(0);
    expect(checkInvariants(s)[0]?.passed).toBe(false);
  });
});

it('keeps the hemisphere rope outside the solid sphere and avoids the nonunique pole',()=>{
  for(const radiusM of [.5,1,1.5])for(const anchorHeightM of [.2,.6,1.2]){
    const p:EquilibriumParams={mode:'hemisphere-suspension',mass:2,baseAngleDeg:37,sweepAngleDeg:75,autoSweep:true,radiusM,anchorHeightM};
    const [lo,hi]=angleRange(p.mode,p);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThanOrEqual(Math.acos(radiusM/(radiusM+anchorHeightM))*180/Math.PI);
    for(const requested of [-20,0,35,75,100]){
      const s=solveEquilibriumAtAngle(p,requested),a=s.sphere!.anchor;
      expect(s.point.x*(a.x-s.point.x)+s.point.y*(a.y-s.point.y)).toBeGreaterThanOrEqual(-1e-12);
      expect(s.activeAngleDeg).toBeGreaterThanOrEqual(lo);
      expect(s.activeAngleDeg).toBeLessThanOrEqual(hi);
      expect(s.netResidualN).toBeLessThan(1e-10);
    }
  }
});

import { mechDynamicEquilibriumPlugin, equilibriumGeometry } from './plugin.js';
it('shares physical geometry between handles, canvas vectors and diagram export',()=>{
  for(const mode of ['dead-knot-rotate','active-pulley-knot','hemisphere-similar','hemisphere-suspension'] as const){
    const p:EquilibriumParams={mode,mass:2,baseAngleDeg:37,sweepAngleDeg:35,autoSweep:false};
    const s=createInitialState(p),g=equilibriumGeometry(s);
    const h=mechDynamicEquilibriumPlugin.getControlHandles!(s,p)[0]!;
    expect(h.onDrag(h.position).sweepAngleDeg).toBe(35);
    const fbd=mechDynamicEquilibriumPlugin.getForceVectors!(s,p);
    expect(fbd).toHaveLength(3);
    for(const a of [...g.arrows,...g.triangle]){
      expect(a.to.x-a.from.x).toBeCloseTo(a.force.x*g.scale,12);
      expect(a.to.y-a.from.y).toBeCloseTo(a.force.y*g.scale,12);
    }
    expect(g.triangle[2]!.to.x).toBeCloseTo(g.triangle[0]!.from.x,12);
    expect(g.triangle[2]!.to.y).toBeCloseTo(g.triangle[0]!.from.y,12);
    expect(mechDynamicEquilibriumPlugin.exportDiagramIR!(s,p).primitives.filter(x=>x.kind==='arrow')).toHaveLength(6);
  }
  const p:EquilibriumParams={mode:'dead-knot-rotate',mass:2,baseAngleDeg:75,sweepAngleDeg:-30,autoSweep:false};
  const s=createInitialState(p),g=equilibriumGeometry(s);
  expect(g.triangle).toHaveLength(0);expect(g.arrows).toHaveLength(1);
  expect(mechDynamicEquilibriumPlugin.getForceVectors!(s,p)).toHaveLength(1);
  expect(mechDynamicEquilibriumPlugin.exportDiagramIR!(s,p).primitives.filter(x=>x.kind==='arrow')).toHaveLength(1);
});

describe('H16 independent rod equilibrium specification',()=>{
  const p={mode:'hinged-rod' as EquilibriumParams['mode'],mass:2,baseAngleDeg:30,sweepAngleDeg:60,autoSweep:false,rodLengthM:1.2,pullForceN:8};
  const at=(params:EquilibriumParams,beta:number)=>createInitialState({...params,sweepAngleDeg:beta});
  it('supports both compression and tension in an ideal hinged two-force rod',()=>{
    const positive=at(p,60),negative=at(p,120),zero=at(p,90);
    expect(computeObservables(positive).rodAxialForceN).toBeCloseTo(9.8,10);
    expect(computeObservables(negative).rodAxialForceN).toBeCloseTo(-19.6,10);
    expect(computeObservables(zero).rodAxialForceN).toBeCloseTo(0,10);
    expect(positive.force2.mag).toBeCloseTo(19.6*Math.sqrt(3)/2,10);
    expect(negative.force2.mag).toBeCloseTo(19.6*Math.sqrt(3),10);
    expect(positive.netResidualN).toBeLessThan(1e-10);
    expect(negative.netResidualN).toBeLessThan(1e-10);
  });
  it('rejects singular and impossible rope directions even though rod can push or pull',()=>{
    const singular=at(p,150);
    const invalid=at({...p,baseAngleDeg:60},135);
    expect(singular.status).toBe('singular');
    expect(invalid.status).toBe('infeasible');
    expect(computeObservables(invalid)).not.toHaveProperty('force2');
  });
  it('minimizes hinged rod rope tension at the perpendicular direction',()=>{
    const optimum=at(p,60);
    expect(optimum.minPullForceN).toBeCloseTo(19.6*Math.cos(Math.PI/6),10);
    for(const beta of [0,30,75,90,120,149])expect(at(p,beta).force2.mag).toBeGreaterThan(optimum.force2.mag);
  });
  it('balances a fixed support by both its arbitrary-direction resultant and independent moment',()=>{
    const params={...p,mode:'fixed-rod' as EquilibriumParams['mode'],baseAngleDeg:30,pullForceN:8};
    const s=at(params,60),o=computeObservables(s);
    expect(s.force2.mag).toBeCloseTo(8,12);
    expect(s.force1.x).toBeCloseTo(4,12);
    expect(s.force1.y).toBeCloseTo(19.6-4*Math.sqrt(3),12);
    expect(o.supportMomentNm).toBeCloseTo(1.2*(Math.sqrt(3)/2*(19.6-4*Math.sqrt(3))-.5*4),10);
    expect(o.momentResidualNm).toBeLessThan(1e-10);
    expect(o).not.toHaveProperty('minPullForceN');
    expect(checkInvariants(s)).toHaveLength(2);
  });
});

import { minimumAuxiliaryCircle, anglePlotItems } from './analysis.js';
describe('H16 rod geometry, force-space circle and analytic angular curves',()=>{
  const p:EquilibriumParams={mode:'hinged-rod',mass:2,baseAngleDeg:30,sweepAngleDeg:60,rodLengthM:1.2,autoSweep:false};
  it('checks forces and moments by independently projecting the whole rod over its angle domain',()=>{
    for(const alpha of [15,30,47,75])for(const beta of [-30,-15,0,35,60,90,120,135,150]){
      for(const mode of ['hinged-rod','fixed-rod'] as const){
        const params={...p,mode,baseAngleDeg:alpha,pullForceN:17.5};
        const s=createInitialState({...params,sweepAngleDeg:beta}),a=degToRad(alpha),b=degToRad(beta),r=s.rod!;
        if(mode==='hinged-rod'&&Math.sin(a+b)<=1e-12){expect(s.status).not.toBe('balanced');continue;}
        expect(s.status).toBe('balanced');
        const ex=-s.force2.mag*Math.cos(b),ey=s.force2.mag*Math.sin(b)-19.6;
        expect(s.force1.x+ex).toBeCloseTo(0,10);expect(s.force1.y+ey).toBeCloseTo(0,10);
        expect(1.2*(Math.cos(a)*ey-Math.sin(a)*ex)+(r.supportMomentNm??0)).toBeCloseTo(0,10);
        expect(r.momentResidualNm).toBeLessThan(1e-10);
        if(mode==='hinged-rod')expect(s.force1.x*Math.sin(a)-s.force1.y*Math.cos(a)).toBeCloseTo(0,10);
        else expect(s.force2.mag).toBe(17.5);
        expect(Math.hypot(r.pivot.x,r.pivot.y)).toBeCloseTo(1.2,12);
        const handle=mechDynamicEquilibriumPlugin.getControlHandles!(s,params)[0]!;
        expect(handle.onDrag(handle.position).sweepAngleDeg).toBe(beta);
      }
    }
  });
  it('constructs the Thales circle at the true minimum for both fixed force directions',()=>{
    for(const mode of ['hinged-rod','dead-knot-rotate'] as const){
      const s=createInitialState({...p,mode}),g=minimumAuxiliaryCircle(s)!;
      expect(g.a.x*(g.b.x-g.a.x)+g.a.y*(g.b.y-g.a.y)).toBeCloseTo(0,10);
      expect(Math.hypot(g.a.x-g.center.x,g.a.y-g.center.y)).toBeCloseTo(g.radius,10);
      expect(g.minimumN).toBeCloseTo(s.minPullForceN!,10);
    }
  });
  it('samples angle rather than time, includes singular nulls and exact minimum',()=>{
    const samples=equilibriumAngleSamples({...p,baseAngleDeg:30.5});
    expect(samples.find(x=>x.angleDeg===149.5)?.force2).toBeNull();
    expect(samples.find(x=>x.angleDeg===150)?.force2).toBeNull();
    expect(samples.find(x=>x.angleDeg===59.5)?.force2).toBeCloseTo(19.6*Math.cos(degToRad(30.5)),10);
    expect(samples.every((x,i)=>i===0||x.angleDeg>samples[i-1]!.angleDeg)).toBe(true);
    const s=createInitialState(p);expect(anglePlotItems(s,p).length).toBeGreaterThan(30);
    const sphere={...p,mode:'hemisphere-suspension' as const,radiusM:1,anchorHeightM:.6};
    expect(equilibriumAngleSamples(sphere).every(x=>Math.abs((x.force1??0)-12.25)<1e-10)).toBe(true);
  });
  it('keeps fixed support moment signed, and does not invent a minimum for prescribed pull',()=>{
    const s=createInitialState({...p,mode:'fixed-rod',pullForceN:0});
    expect(s.force2.mag).toBe(0);
    expect(s.rod?.supportMomentNm).toBeCloseTo(19.6*1.2*Math.cos(Math.PI/6),10);
    expect(computeObservables(s)).not.toHaveProperty('minPullForceN');
    const neg=createInitialState({...p,mode:'fixed-rod',pullForceN:40});
    expect(neg.rod?.supportMomentNm).toBeLessThan(0);
  });
  it('distinguishes a clipped initial request from the actual hemisphere range',()=>{
    const s=createInitialState({...p,mode:'hemisphere-suspension',sweepAngleDeg:75,radiusM:1.5,anchorHeightM:.2});
    expect(s.requestedInitialAngleDeg).toBe(75);
    expect(s.initialAngleDeg).toBe(s.activeAngleDeg);
    expect(s.initialAngleDeg).toBeLessThan(75);
  });
});
