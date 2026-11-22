import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emElectrostaticFieldPlugin } from './plugin.js';
import { electrostaticPresets } from './presets.js';
import {
  createInitialState,
  evalPointChargePotentialAndField,
  extractElectrostaticIsolines,
  solveThreePointUniformField,
  stepElectrostatic,
  type ElectrostaticParams
} from './engine.js';

function getPreset(idx: number): ElectrostaticParams {
  return resolvePluginParams(emElectrostaticFieldPlugin.paramSchema, electrostaticPresets[idx]!.params);
}

describe('em-electrostatic-field physics & numerical verification (E01)', () => {
  it('ensures Marching Squares equipotentials are orthogonal to E field within < 1 deg', () => {
    const params = getPreset(0);
    const contours = extractElectrostaticIsolines(params);
    const deviations: number[] = [];
    for (const c of contours) {
      for (const seg of c.segments) {
        const tx = seg.b.x - seg.a.x;
        const ty = seg.b.y - seg.a.y;
        const tMag = Math.hypot(tx, ty);
        if (tMag < 1e-4) continue;
        const mx = 0.5 * (seg.a.x + seg.b.x);
        const my = 0.5 * (seg.a.y + seg.b.y);
        if (Math.hypot(mx - params.x1, my) < 0.35 || Math.hypot(mx - params.x2, my) < 0.35) continue;
        const { Ex, Ey } = evalPointChargePotentialAndField(mx, my, params);
        const eMag = Math.hypot(Ex, Ey);
        if (eMag < 1e-4) continue;
        const cosAngle = Math.abs((tx * Ex + ty * Ey) / (tMag * eMag));
        const degFrom90 = Math.abs(90 - (Math.acos(Math.min(1, cosAngle)) * 180) / Math.PI);
        deviations.push(degFrom90);
      }
    }
    expect(deviations.length).toBeGreaterThan(20);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    expect(avgDeviation).toBeLessThan(1.0);
  });

  it('conserves RK45 test-particle energy Ek + q*phi within < 1e-5', () => {
    const params = getPreset(0);
    let state = createInitialState(params);
    const e0 = state.initialEnergy;
    for (let i = 0; i < 60; i++) {
      state = stepElectrostatic(state, params, 0.02).nextState;
    }
    const { phi } = evalPointChargePotentialAndField(state.px, state.py, params);
    const eNow = 0.5 * (state.vx ** 2 + state.vy ** 2) + params.testChargeRatio * phi;
    const relErr = Math.abs(eNow - e0) / Math.max(1e-6, Math.abs(e0));
    expect(relErr).toBeLessThan(1e-5);
  });

  it('solves three-point trisection uniform field & parallel-plate deflection formula accurately (< 1e-6)', () => {
    const threePt = getPreset(2);
    const sol = solveThreePointUniformField(threePt);
    const eqVecX = sol.equalPointOnAC.x - sol.B.x;
    const eqVecY = sol.equalPointOnAC.y - sol.B.y;
    // Uniform field E must be strictly perpendicular to equipotential segment B -> equalPointOnAC
    expect(Math.abs(eqVecX * sol.Ex + eqVecY * sol.Ey)).toBeLessThan(1e-10);

    const defl = getPreset(3);
    // Enter at x=-1.4, plates from x=-1.0 to x=1.0 (Lp=2.0), d=2.0, y_exit = U2*Lp^2 / (4*d*U1)
    let st = createInitialState(defl);
    const vx = st.vx;
    const dtToEnter = (-1.0 - st.px) / vx;
    const dtInside = 2.0 / vx;
    st = stepElectrostatic(st, defl, dtToEnter + dtInside).nextState;
    const expectedY = (defl.uDeflectV * 2.0 * 2.0) / (4 * 2.0 * defl.uAccelV);
    expect(Math.abs(st.py - expectedY) / expectedY).toBeLessThan(1e-6);
  });

  it('handles zero charges and zero dt boundaries cleanly', () => {
    const p0: ElectrostaticParams = { ...getPreset(0), q1MicroC: 0, q2MicroC: 0, testChargeRatio: 0 };
    const s0 = createInitialState(p0);
    expect(stepElectrostatic(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepElectrostatic(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.px)).toBe(true);
  });
});
