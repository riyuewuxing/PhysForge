import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { emLcRlcOscillationPlugin } from './plugin.js';
import { lcRlcPresets } from './presets.js';
import {
  checkInvariants,
  computeLcNaturalOmega,
  computeImpedanceSummary,
  computeObservables,
  createInitialState,
  stepLcRlcOscillation,
  type LcRlcParams
} from './engine.js';

function getPreset(idx: number): LcRlcParams {
  return resolvePluginParams(emLcRlcOscillationPlugin.paramSchema, lcRlcPresets[idx]!.params);
}

describe('em-lc-rlc-oscillation period, 20-cycle conservation, and resonance peak (E09)', () => {
  it('conserves LC energy (< 1e-5) over 20 full periods and matches T = 2*pi*sqrt(L*C) (< 1e-5)', () => {
    const params = getPreset(0);
    const w0 = computeLcNaturalOmega(params);
    const expectedT = (2 * Math.PI) / w0;
    const initial = createInitialState(params);
    let st = initial;
    const dt = expectedT / 50;
    for (let i = 0; i < 20 * 50; i++) {
      st = stepLcRlcOscillation(st, params, dt).nextState;
    }

    expect(st.measuredPeriod).not.toBeNull();
    expect(Math.abs(st.measuredPeriod! - expectedT) / expectedT).toBeLessThan(1e-5);
    const reports = checkInvariants(st, initial, params);
    expect(reports[0]!.passed).toBe(true);
    expect(reports[0]!.measuredError).toBeLessThan(1e-5);
  });

  it('reaches exact resonance current amplitude Um / R at omega = 1/sqrt(LC)', () => {
    const resParams = getPreset(1); // omega = 1/sqrt(0.25*0.1) = 6.324555, Um=10, R=2 => Ipeak = 5.0 A
    let st = createInitialState(resParams);
    // Decay time constant tau = 2L/R = 0.25 s; integrate 4 s (> 16 tau) to true steady state
    for (let i = 0; i < 400; i++) {
      st = stepLcRlcOscillation(st, resParams, 0.01).nextState;
    }
    let peakI = 0;
    for (let i = 0; i < 200; i++) {
      st = stepLcRlcOscillation(st, resParams, 0.005).nextState;
      peakI = Math.max(peakI, Math.abs(st.currentI));
    }
    const expectedI = resParams.driveVoltAmpUm / resParams.resistanceR;
    expect(Math.abs(peakI - expectedI) / expectedI).toBeLessThan(1e-4);
  });

  it('handles zero drive voltage and zero dt boundaries cleanly', () => {
    const p0: LcRlcParams = { ...getPreset(1), driveVoltAmpUm: 0 };
    const s0 = createInitialState(p0);
    expect(stepLcRlcOscillation(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepLcRlcOscillation(s0, p0, 0.1).nextState;
    expect(Number.isFinite(s1.chargeQ)).toBe(true);
  });
});

describe('E09 independent physical oracles and truthful observation boundaries',()=>{
  const run=(p:LcRlcParams,t:number)=>{
    let s=createInitialState(p);const n=Math.ceil(t/.013);
    for(let i=0;i<n;i++)s=stepLcRlcOscillation(s,p,t/n).nextState;
    return s;
  };
  it('does not silently add resistance to a lossless off-resonance driven circuit',()=>{
    const p={...getPreset(1),resistanceR:0,driveOmega:4},z=computeImpedanceSummary(p);
    expect(z.zMag).toBeCloseTo(Math.abs(4*p.inductanceH-1/(4*p.capacitanceF)),12);
    expect(Reflect.get(z,'responseKind')).toBe(2);
    expect(Reflect.get(z,'referenceCurrentPeak')).toBeCloseTo(p.driveVoltAmpUm/z.zMag,12);
  });
  it('lossless exact resonance has no finite periodic current amplitude and follows the secular solution',()=>{
    const p={...getPreset(1),resistanceR:0,driveOmega:computeLcNaturalOmega(getPreset(1))},w=p.driveOmega,t=1.137;
    const z=computeImpedanceSummary(p),s=run(p,t),A=p.driveVoltAmpUm/(2*p.inductanceH*w);
    expect(z.zMag).toBeLessThan(1e-12);
    expect(Reflect.get(z,'responseKind')).toBe(3);
    expect(Reflect.get(z,'referenceCurrentPeak')).toBeUndefined();
    expect(s.chargeQ).toBeCloseTo(A*t*Math.sin(w*t),6);
    expect(s.currentI).toBeCloseTo(A*(Math.sin(w*t)+w*t*Math.cos(w*t)),6);
    expect(Reflect.get(s,'jouleHeatJ')).toBe(0);
    expect(Reflect.get(s,'sourceWorkJ')).toBeCloseTo(s.energyElectricJ+s.energyMagneticJ,6);
  });
  it('integrates heat independently in a damped circuit and matches the analytical trajectory',()=>{
    const p=getPreset(2),t=1.137,s=run(p,t),a=p.resistanceR/(2*p.inductanceH),w0=1/Math.sqrt(p.inductanceH*p.capacitanceF),w=Math.sqrt(w0*w0-a*a);
    const q=p.initialChargeC*Math.exp(-a*t)*(Math.cos(w*t)+a/w*Math.sin(w*t));
    const i=-p.initialChargeC*Math.exp(-a*t)*w0*w0/w*Math.sin(w*t);
    expect(s.chargeQ).toBeCloseTo(q,6);expect(s.currentI).toBeCloseTo(i,6);
    const heat=p.initialChargeC**2/(2*p.capacitanceF)-q*q/(2*p.capacitanceF)-p.inductanceH*i*i/2;
    expect(Reflect.get(s,'jouleHeatJ')).toBeCloseTo(heat,6);
    expect(Reflect.get(s,'sourceWorkJ')).toBe(0);
    expect(checkInvariants(s,createInitialState(p),p).every(r=>r.passed)).toBe(true);
  });
  it('distinguishes critical and overdamped free decay without inventing a measured period',()=>{
    for(const R of [2,3]){
      const p={...getPreset(2),inductanceH:.25,capacitanceF:.25,resistanceR:R},t=.91,s=run(p,t),a=R/(2*p.inductanceH),w0=4;
      const beta=Math.sqrt(Math.max(0,a*a-w0*w0));
      const q=beta===0?p.initialChargeC*(1+a*t)*Math.exp(-a*t):p.initialChargeC*Math.exp(-a*t)*(Math.cosh(beta*t)+a/beta*Math.sinh(beta*t));
      const i=beta===0?-p.initialChargeC*w0*w0*t*Math.exp(-a*t):-p.initialChargeC*w0*w0/beta*Math.exp(-a*t)*Math.sinh(beta*t);
      expect(s.chargeQ).toBeCloseTo(q,6);expect(s.currentI).toBeCloseTo(i,6);
      expect(s.measuredPeriod).toBeNull();expect(computeObservables(s).measuredPeriod).toBeUndefined();
      expect(Reflect.get(s,'dampingRegime')).toBe(R===2?2:3);
    }
  });
  it('a corrupted damped or driven stored energy cannot pass a zero-error finite-number audit',()=>{
    for(const p of [getPreset(1),getPreset(2)]){
      const initial=createInitialState(p),s=run(p,.73);
      expect(checkInvariants({...s,energyElectricJ:s.energyElectricJ+.25},initial,p).some(r=>!r.passed)).toBe(true);
    }
  });
  it('does not publish an unobserved period as a zero-second measurement',()=>{
    expect(computeObservables(createInitialState(getPreset(0))).measuredPeriod).toBeUndefined();
  });
  it('includes actual driven energy and a signed work ledger, not just a bounded theoretical amplitude',()=>{
    const p={...getPreset(1),driveOmega:5.1,resistanceR:1.2},s=run(p,.823);
    const Q=Reflect.get(s,'jouleHeatJ'),W=Reflect.get(s,'sourceWorkJ');
    expect(Q).toBeGreaterThan(0);
    expect(W).toBeCloseTo(s.energyElectricJ+s.energyMagneticJ+Q,6);
    expect(computeObservables(s).energyResidualJ).toBeCloseTo(0,6);
  });
});
