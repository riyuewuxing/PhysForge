import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { mechShmResonancePlugin } from './plugin.js';
import { shmResonancePresets } from './presets.js';
import {
  computeNaturalOmega,
  computeObservables,
  computeTheoreticalResonanceOmega,
  createInitialState,
  stepShmResonance,
  type ShmResonanceParams
} from './engine.js';

function getPreset(idx: number): ShmResonanceParams {
  return resolvePluginParams(mechShmResonancePlugin.paramSchema, shmResonancePresets[idx]!.params);
}

describe('mech-shm-resonance nonlinear pendulum & resonance invariants (M11)', () => {
  it('matches T0 = 2*pi*sqrt(L/g) within < 1e-4 at 2 degree small-angle oscillation', () => {
    const params = getPreset(0);
    const expectedT0 = 2 * Math.PI * Math.sqrt(params.lengthL / params.gravityG);
    let state = createInitialState(params);
    for (let i = 0; i < 600; i++) {
      state = stepShmResonance(state, params, 0.01).nextState;
    }
    expect(state.measuredPeriod).not.toBeNull();
    const relErr = Math.abs(state.measuredPeriod! - expectedT0) / expectedT0;
    expect(relErr).toBeLessThan(1e-4);
  });

  it('conserves mechanical energy (< 1e-6) during 10-period undamped 60 degree large-angle oscillation', () => {
    const params = getPreset(1);
    let state = createInitialState(params);
    const e0 = state.initialEnergy;
    const tEnd = 10 * ((2 * Math.PI) / computeNaturalOmega(params));
    const steps = Math.ceil(tEnd / 0.02);
    for (let i = 0; i < steps; i++) {
      state = stepShmResonance(state, params, 0.02).nextState;
    }
    const obs = computeObservables(state, params);
    const relErr = Math.abs(obs.mechanicalEnergy! - e0) / e0;
    expect(relErr).toBeLessThan(1e-6);
    expect(Math.abs(state.theta - state.thetaLinear)).toBeGreaterThan(0.05);
  });

  it('achieves steady-state forced amplitude peak near omega_res = sqrt(w0^2 - 2*gamma^2)', () => {
    const base: ShmResonanceParams = {
      mode: 'forced-resonance',
      lengthL: 1,
      gravityG: 9.8,
      massM: 1,
      initialAngleDeg: 0,
      dampingGamma: 0.45,
      driveAccelAmp: 0.15,
      driveOmega: 3
    };
    const wRes = computeTheoreticalResonanceOmega(base);
    const sweepOmega = [wRes * 0.78, wRes * 0.9, wRes, wRes * 1.1, wRes * 1.22];
    const steadyAmps = sweepOmega.map((wd) => {
      const p: ShmResonanceParams = { ...base, driveOmega: wd };
      let st = createInitialState(p);
      for (let i = 0; i < 900; i++) {
        st = stepShmResonance(st, p, 0.02).nextState;
      }
      let peak = 0;
      for (let i = 0; i < 300; i++) {
        st = stepShmResonance(st, p, 0.02).nextState;
        peak = Math.max(peak, Math.abs(st.theta));
      }
      return peak;
    });

    const maxIdx = steadyAmps.indexOf(Math.max(...steadyAmps));
    expect(maxIdx).toBe(2);
  });

  it('remains finite on zero angle and zero dt boundaries', () => {
    const params: ShmResonanceParams = { ...getPreset(0), initialAngleDeg: 0 };
    const s0 = createInitialState(params);
    expect(stepShmResonance(s0, params, 0).nextState).toEqual(s0);
    const s1 = stepShmResonance(s0, params, 0.05).nextState;
    expect(Number.isFinite(s1.theta)).toBe(true);
  });
});

describe('M11 physical reference and work-energy regression', () => {
  it('reference circle is the signed phase of the linear oscillator, not a projection of the nonlinear bob', () => {
    const p = { ...getPreset(1), initialAngleDeg: 60 };
    const A = p.lengthL * Math.PI / 3;
    const w = Math.sqrt(p.gravityG / p.lengthL);
    for (const t of [0, Math.PI / (2*w), Math.PI / w, 3*Math.PI/(2*w)]) {
      const s = stepShmResonance(createInitialState(p), p, t).nextState;
      const o = computeObservables(s,p);
      expect(o.referenceCircleX).toBeCloseTo(A*Math.cos(w*t), 7);
      expect(o.referenceCircleY).toBeCloseTo(A*Math.sin(w*t), 7);
      expect(Math.hypot(o.referenceCircleX!,o.referenceCircleY!)).toBeCloseTo(A,7);
    }
  });

  it('accounts for dissipated energy and external work at the RK stages', () => {
    for (const p of [getPreset(2),getPreset(3),{ ...getPreset(3), dampingGamma: 0 }]) {
      let s = createInitialState(p);
      let independentQ=0, independentW=0;
      const power = (q: typeof s) => [
        2*p.dampingGamma*p.massM*p.lengthL**2*q.omega**2,
        p.mode==='forced-resonance' ? p.massM*p.lengthL**2*p.driveAccelAmp*Math.cos(p.driveOmega*q.t)*q.omega : 0
      ];
      for(let i=0;i<8000;i++){
        const before=power(s);
        const next=stepShmResonance(s,p,0.001).nextState;
        const after=power(next);
        independentQ+=0.0005*(before[0]!+after[0]!);
        independentW+=0.0005*(before[1]!+after[1]!);
        s=next;
      }
      const o=computeObservables(s,p);
      expect(o.heatLostJ).toBeCloseTo(independentQ,5);
      expect(o.driveWorkJ).toBeCloseTo(independentW,5);
      expect(Math.abs(o.mechanicalEnergy!+o.heatLostJ!-o.driveWorkJ!-s.initialEnergy)).toBeLessThan(1e-7);
      expect(o.energyResidual).toBeLessThan(1e-7);
    }
  });

  it('retains the exact zero-angle classroom setting and equilibrium', () => {
    const p=resolvePluginParams(mechShmResonancePlugin.paramSchema, {...getPreset(0),initialAngleDeg:0});
    expect(p.initialAngleDeg).toBe(0);
    const s=stepShmResonance(createInitialState(p),p,3).nextState;
    expect(s.theta).toBe(0);
    expect(s.measuredPeriod).toBeNull();
  });
});
