import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { modernNuclearRecoilDecayPlugin } from './plugin.js';
import { nuclearRecoilPresets } from './presets.js';
import {
  createInitialState,
  computeObservables,
  solveRecoilCloudChamber,
  stepNuclearRecoilDecay,
  type NuclearRecoilDecayParams
} from './engine.js';

function getPreset(idx: number): NuclearRecoilDecayParams {
  return resolvePluginParams(modernNuclearRecoilDecayPlugin.paramSchema, nuclearRecoilPresets[idx]!.params);
}

describe('modern-nuclear-recoil-decay physics invariants (N03)', () => {
  it('matches Boris magnetic recoil radius ratio R1/R2 = q2/q1 (< 1e-6) and external vs internal tangency', () => {
    const alphaSol = solveRecoilCloudChamber(getPreset(0));
    expect(alphaSol.tangentGeometry).toBe('external');
    expect(alphaSol.chargeRatioExpected).toBe(43);
    expect(alphaSol.ratioRelError).toBeLessThan(1e-6);

    const betaSol = solveRecoilCloudChamber(getPreset(1));
    expect(betaSol.tangentGeometry).toBe('internal');
    expect(betaSol.chargeRatioExpected).toBe(91);
    expect(betaSol.ratioRelError).toBeLessThan(1e-6);
  });

  it('reproduces radioactive half-life N(k*T1/2) = N0 * 2^-k deterministically with Seeded PRNG (N0=4000)', () => {
    const params: NuclearRecoilDecayParams = {
      ...getPreset(2),
      nucleiCountN0: 4000,
      halfLifeS: 2.0,
      seed: 20261122
    };
    let stA = createInitialState(params);
    let stB = createInitialState(params);
    for (let k = 1; k <= 3; k++) {
      for (let i = 0; i < 40; i++) {
        stA = stepNuclearRecoilDecay(stA, params, 0.05).nextState;
        stB = stepNuclearRecoilDecay(stB, params, 0.05).nextState;
      }
      expect(stA.remainingCount).toBe(stB.remainingCount);
      const frac = stA.remainingCount / 4000;
      const expected = Math.pow(0.5, k);
      expect(Math.abs(frac - expected)).toBeLessThan(0.025);
    }
  });

  it('handles dt=0 and chain criticality cleanly without NaN', () => {
    const p = getPreset(3);
    const st = createInitialState(p);
    expect(stepNuclearRecoilDecay(st, p, 0).nextState.t).toBe(0);
    expect(Number.isFinite(st.kEff)).toBe(true);
  });
});

describe('H48 F05 prepared independent nuclear-decay and sample-statistics regressions',()=>{
  it('reverses both charged track curvatures under signed B without changing physical radii',()=>{
    const p=getPreset(0),a=solveRecoilCloudChamber({...p,magneticFieldT:1.2}),b=solveRecoilCloudChamber({...p,magneticFieldT:-1.2});
    expect(resolvePluginParams(modernNuclearRecoilDecayPlugin.paramSchema,{...p,magneticFieldT:-1.2}).magneticFieldT).toBe(-1.2);
    expect(a.radiusEmittedM).toBeCloseTo(b.radiusEmittedM!,10);
    expect(a.radiusDaughterM).toBeCloseTo(b.radiusDaughterM!,10);
    for(const [x,y] of [[a.emittedTrackCm,b.emittedTrackCm],[a.daughterTrackCm,b.daughterTrackCm]] as const){
      expect(x.length).toBe(y.length);
      expect(Math.abs(x.at(-1)!.y)).toBeGreaterThan(1e-6);
      for(let i=0;i<x.length;i++){expect(x[i]!.x).toBeCloseTo(y[i]!.x,8);expect(x[i]!.y).toBeCloseTo(-y[i]!.y,8);}
    }
  });
  it('has a zero-field straight-track case with no finite circle or radius-ratio measurement',()=>{
    const p={...getPreset(0),magneticFieldT:0},s=solveRecoilCloudChamber(p);
    expect(resolvePluginParams(modernNuclearRecoilDecayPlugin.paramSchema,p).magneticFieldT).toBe(0);
    expect(s.emittedTrackCm.length).toBeGreaterThan(2);
    expect(s.daughterTrackCm.length).toBeGreaterThan(2);
    expect(s.emittedTrackCm.every(q=>q.y===0)).toBe(true);
    expect(s.daughterTrackCm.every(q=>q.y===0)).toBe(true);
    expect(s.emittedTrackCm.at(-1)!.x).toBeGreaterThan(0);
    expect(s.daughterTrackCm.at(-1)!.x).toBeLessThan(0);
    expect(s.radiusEmittedM).toBeUndefined();
    expect(s.radiusDaughterM).toBeUndefined();
    expect(s.radiusRatioMeasured).toBeUndefined();
    expect(s.tangentGeometry).toBeUndefined();
  });
  it('labels the beta equal-opposite-momentum drawing as a limiting endpoint, not generic three-body beta decay',()=>{
    const a=solveRecoilCloudChamber(getPreset(0)),b=solveRecoilCloudChamber(getPreset(1));
    expect(a).toHaveProperty('kinematicAssumption','alpha-two-body');
    expect(b).toHaveProperty('kinematicAssumption','beta-endpoint-limit');
    expect(b).toHaveProperty('neutrinoEnergyMev',0);
    // The independent Q budget is checked from both kinetic energies.
    for(const s of [a,b]){
      const q=s as unknown as Record<string,number>;
      expect(q.emittedKineticMev!+q.daughterKineticMev!).toBeCloseTo(s.qValueMev,10);
    }
  });
  it('uses one seeded lifetime realization that is invariant to partition of the same elapsed interval',()=>{
    const p={...getPreset(2),nucleiCountN0:400,halfLifeS:2,seed:271828};
    const initial=createInitialState(p),whole=stepNuclearRecoilDecay(initial,p,4).nextState;
    let parts=createInitialState(p);
    for(let i=0;i<32;i++)parts=stepNuclearRecoilDecay(parts,p,.125).nextState;
    expect(parts.t).toBe(4);
    expect(parts.decayedFlags).toEqual(whole.decayedFlags);
    expect(parts.remainingCount).toBe(whole.remainingCount);
    expect(parts.prngCalls).toBe(initial.prngCalls);
    expect(whole.prngCalls).toBe(initial.prngCalls);
  });
  it('keeps the true initial count and observed/theoretical time history instead of dropping the beginning of the experiment',()=>{
    const p={...getPreset(2),nucleiCountN0:16,halfLifeS:2,seed:12345};
    let s=createInitialState(p);
    for(let i=0;i<200;i++)s=stepNuclearRecoilDecay(s,p,.125).nextState;
    expect(s.decayCurve[0]).toMatchObject({t:0,fraction:1,theory:1});
    expect(s.decayCurve.at(-1)!.t).toBe(25);
    expect(s.decayCurve.at(-1)!.fraction).toBe(s.remainingCount/16);
    expect(s.decayCurve.at(-1)!.theory).toBeCloseTo(2**(-25/2),15);
    expect(s.decayCurve.every((x,i)=>i===0||x.t>=s.decayCurve[i-1]!.t&&x.fraction<=s.decayCurve[i-1]!.fraction)).toBe(true);
  });
  it('separates sample-count statistics from unrelated recoil and static generation-expectation comparisons',()=>{
    const mc=getPreset(2),s=createInitialState(mc),o=computeObservables(s);
    expect(o).not.toHaveProperty('qValueMev');expect(o).not.toHaveProperty('radiusRatio');expect(o).not.toHaveProperty('kEff');
    const chain=getPreset(3),c=createInitialState(chain),step=stepNuclearRecoilDecay(c,chain,1);
    expect(step.nextState.t).toBe(0);expect(step.advancedTime).toBe(0);
    const co=computeObservables(c);
    expect(co).not.toHaveProperty('remainingCount');expect(co).not.toHaveProperty('qValueMev');
    const ir=modernNuclearRecoilDecayPlugin.exportDiagramIR!(c,chain);
    expect(ir.primitives.filter(p=>p.kind==='rect').length).toBeGreaterThanOrEqual(9);
    expect(ir.primitives.some(p=>p.kind==='text'&&p.text.includes('期望'))).toBe(true);
  });
});
