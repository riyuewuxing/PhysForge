import { describe, expect, it } from 'vitest';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { solveEquilibriumAtAngle, type EquilibriumParams } from './engine.js';

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
