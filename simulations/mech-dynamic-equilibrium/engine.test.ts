import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { createInitialState, solveEquilibriumAtAngle, stepEquilibrium, computeObservables, checkInvariants, type EquilibriumParams } from './engine.js';

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
    for(const theta of [0,15,35,60,75]){
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
