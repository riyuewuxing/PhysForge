import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { modernRutherfordBohrPlugin } from './plugin.js';
import { rutherfordBohrPresets } from './presets.js';
import {
  solveBohrTransitions,
  computeObservables,
  sampleRutherfordAtTime,
  RUTHERFORD_DEMO_DURATION_S,
  solveRutherfordScattering,
  stepRutherfordBohr,
  createInitialState,
  type RutherfordBohrParams
} from './engine.js';

function getPreset(idx: number): RutherfordBohrParams {
  return resolvePluginParams(modernRutherfordBohrPlugin.paramSchema, rutherfordBohrPresets[idx]!.params);
}

describe('modern-rutherford-bohr physics invariants (N02)', () => {
  it('matches Rutherford analytical scattering angle (< 1e-4 rad) and conserves energy (< 1e-6) using ScaleContext + RK45', () => {
    for (const bFm of [15, 25, 50]) {
      const r = solveRutherfordScattering(5.0, 79, bFm);
      expect(r.angleErrorRad).toBeLessThan(1e-4);
      expect(r.energyDriftRel).toBeLessThan(1e-6);
    }
  });

  it('reproduces first 4 Balmer wavelengths within < 0.2 nm and distinguishes photon vs electron excitation', () => {
    const bohrEnsemble = solveBohrTransitions(getPreset(1));
    expect(bohrEnsemble.totalCombinationLines).toBe(15);
    expect(bohrEnsemble.maxSingleAtomLines).toBe(5);

    const nistBalmerNm: Record<number, number> = {
      3: 656.28,
      4: 486.13,
      5: 434.05,
      6: 410.17
    };
    for (const upper of [3, 4, 5, 6]) {
      const line = bohrEnsemble.spectralLines.find((l) => l.upperN === upper && l.lowerN === 2)!;
      expect(Math.abs(line.wavelengthNm - nistBalmerNm[upper]!)).toBeLessThan(0.2);
    }

    const photonOffRes = solveBohrTransitions({ ...getPreset(2), probeKind: 'photon', probeEnergyEv: 12.5 });
    expect(photonOffRes.excitationAccepted).toBe(false);

    const electronRes = solveBohrTransitions(getPreset(2));
    expect(electronRes.excitationAccepted).toBe(true);
    expect(electronRes.reachedLevel).toBe(3);
    expect(Math.abs(electronRes.residualElectronEv! - (12.5 - 12.08888888888889))).toBeLessThan(1e-6);
  });

  it('handles zero impact parameter and dt=0 cleanly without NaN', () => {
    const headOn = solveRutherfordScattering(5.0, 79, 0);
    expect(headOn.simulatedAngleDeg).toBe(180);
    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepRutherfordBohr(st, p, 0).nextState.t).toBe(0);
  });
});

describe('H47 F04 independent scattering and hydrogen spectrum regressions',()=>{
  // Physical SI definition rather than reusing the solver's ScaleContext conversion.
  const k=8.9875517923e9,e=1.602176634e-19;
  const distance=(KMev:number,Z:number,bFm:number)=>{
    const a=k*2*Z*e*e/(2*KMev*1e6*e)/1e-15;
    return a+Math.hypot(a,bFm);
  };
  it('head-on repulsion turns on the incident side and returns without crossing the nucleus, including a turn outside the old fixed viewport',()=>{
    for(const [K,Z] of [[5,79],[1,92]] as const){
      const r=solveRutherfordScattering(K,Z,0),rmin=distance(K,Z,0),x=r.trajectoryFm.map(p=>p.x);
      expect(r.minDistanceFm).toBeCloseTo(rmin,8);
      expect(x.length).toBeGreaterThan(2);
      expect(Math.max(...x)).toBeCloseTo(-rmin,6);
      expect(x[0]!).toBeLessThan(-rmin);
      expect(x.at(-1)!).toBeLessThan(-rmin);
      expect(r.trajectoryFm.every(p=>p.x<=-rmin+1e-7&&Math.abs(p.y)<1e-10)).toBe(true);
    }
  });
  it('includes the closest approach of the actual Coulomb trajectory, not a coarse sample minimum, and does not crop low-energy backscatter away',()=>{
    for(const [K,Z,b] of [[5,79,25],[1,92,5],[12,13,80],[5,79,-15]] as const){
      const r=solveRutherfordScattering(K,Z,b),want=distance(K,Z,b);
      expect(r.trajectoryFm.length).toBeGreaterThan(20);
      expect(Math.abs(r.minDistanceFm-want)).toBeLessThan(1e-5);
      expect(Math.abs(Math.min(...r.trajectoryFm.map(p=>Math.hypot(p.x,p.y)))-want)).toBeLessThan(1e-5);
      expect(r.angleErrorRad).toBeLessThan(1e-4);
      expect(r.energyDriftRel).toBeLessThan(1e-6);
      expect(Math.hypot(r.trajectoryFm[0]!.x,r.trajectoryFm[0]!.y)).toBeGreaterThan(want);
      expect(Math.hypot(r.trajectoryFm.at(-1)!.x,r.trajectoryFm.at(-1)!.y)).toBeGreaterThan(want);
    }
  });
  it('uses a single physically possible cascade for one atom, rather than rendering all ensemble transitions simultaneously',()=>{
    const p={...getPreset(1),excitedLevelN:6},all=solveBohrTransitions({...p,populationMode:'ensemble'}),one=solveBohrTransitions({...p,populationMode:'single-atom'});
    expect(all.spectralLines).toHaveLength(15);
    expect(one.spectralLines).toHaveLength(5);
    let current=6;
    for(const line of one.spectralLines){expect(line.upperN).toBe(current);expect(line.lowerN).toBeLessThan(current);current=line.lowerN;}
    expect(current).toBe(1);
    expect(one.spectralLines.reduce((sum,q)=>sum+q.deltaEv,0)).toBeCloseTo(13.6*(1-1/36),12);
    expect(one.totalCombinationLines).toBe(15);expect(one.maxSingleAtomLines).toBe(5);
  });
  it('distinguishes a rounded two-decimal resonance from a genuinely off-resonance photon',()=>{
    const p={...getPreset(1),probeKind:'photon' as const};
    expect(solveBohrTransitions({...p,probeEnergyEv:10.2}).reachedLevel).toBe(2);
    expect(solveBohrTransitions({...p,probeEnergyEv:12.09}).reachedLevel).toBe(3);
    expect(solveBohrTransitions({...p,probeEnergyEv:10.22}).excitationAccepted).toBe(false);
    expect(solveBohrTransitions({...p,probeEnergyEv:12.11}).excitationAccepted).toBe(false);
  });
  it('does not claim a discrete excited state on ionization or uniquely assign impact-ionization excess to one electron',()=>{
    const p=getPreset(2);
    const photo=solveBohrTransitions({...p,probeKind:'photon',probeEnergyEv:14.6});
    const impact=solveBohrTransitions({...p,probeKind:'electron',probeEnergyEv:14.6});
    expect(photo.ionized).toBe(true);expect(impact.ionized).toBe(true);
    expect(photo.reachedLevel).toBeUndefined();expect(impact.reachedLevel).toBeUndefined();
    expect(photo.residualElectronEv).toBeCloseTo(1,12);
    expect(impact.residualElectronEv).toBeUndefined();
    expect(impact).toHaveProperty('ionizationExcessEv',expect.closeTo(1,12));
    const rejected=solveBohrTransitions({...p,probeKind:'electron',probeEnergyEv:8});
    expect(rejected.excitationAccepted).toBe(false);
    expect(rejected.residualElectronEv).toBe(8);
  });
  it('exports every selected energy level, not just six, and isolates observables by experiment',()=>{
    const p={...getPreset(1),excitedLevelN:7},s=createInitialState(p),ir=modernRutherfordBohrPlugin.exportDiagramIR!(s,p);
    expect(ir.primitives.some(q=>q.kind==='text'&&q.text.includes('n=7'))).toBe(true);
    const ob=computeObservables(s);
    expect(ob).not.toHaveProperty('rutherfordAngleDeg');
    expect(ob).not.toHaveProperty('minDistanceFm');
    const or=computeObservables(createInitialState(getPreset(0)));
    expect(or).not.toHaveProperty('bohrLinesCount');
    expect(or).not.toHaveProperty('hAlphaNm');
  });
});

describe('F04 prepared actual-time trajectory and no hidden recomputation',()=>{
  it('stores numerical positions, velocities and monotonically increasing physical timestamps, including the turn',()=>{
    const r=solveRutherfordScattering(5,79,25);
    expect(r.trajectoryFm).toHaveLength(201);
    expect(r.angularMomentumDriftRel).toBeLessThan(1e-8);expect(r.maxPositionErrorFm).toBeLessThan(1e-5);
    const middle=r.trajectoryFm[100]!;
    expect(Math.hypot(middle.x,middle.y)).toBeCloseTo(r.minDistanceFm,5);
    expect(Math.abs(middle.x*middle.vx+middle.y*middle.vy)).toBeLessThan(1e-7);
    for(let i=1;i<r.trajectoryFm.length;i++)expect(r.trajectoryFm[i]!.time22).toBeGreaterThan(r.trajectoryFm[i-1]!.time22);
    expect(sampleRutherfordAtTime(r,0)).toEqual(r.trajectoryFm[0]);
    expect(sampleRutherfordAtTime(r,r.timeOfFlight22)).toEqual(r.trajectoryFm.at(-1));
  });
  it('maps demonstration time to physical elapsed trajectory time, halts at the final sample and reuses the solved path',()=>{
    const p=getPreset(0),s=createInitialState(p);if(s.mode!=='rutherford')throw Error('expected Rutherford');
    const a=stepRutherfordBohr(s,p,RUTHERFORD_DEMO_DURATION_S/2).nextState;if(a.mode!=='rutherford')throw Error('expected Rutherford');
    expect(a.rutherford).toBe(s.rutherford);expect(a.sample.time22).toBeCloseTo(s.rutherford.timeOfFlight22/2,12);
    const res=stepRutherfordBohr(a,p,10),b=res.nextState;if(b.mode!=='rutherford')throw Error('expected Rutherford');
    expect(res.halt).toBe(true);expect(res.advancedTime).toBe(RUTHERFORD_DEMO_DURATION_S/2);
    expect(b.sample).toEqual(s.rutherford.trajectoryFm.at(-1));expect(b.t).toBe(RUTHERFORD_DEMO_DURATION_S);
    const bohr=getPreset(1),sb=createInitialState(bohr);
    expect(stepRutherfordBohr(sb,bohr,2)).toMatchObject({nextState:sb,advancedTime:0,halt:true});
    expect(sb.rutherford).toBeNull();
  });
});

describe('F04 mixed time semantics and parameter reset contracts',()=>{
  it('certifies both evolving scattering and static Bohr via the same headless API',async()=>{
    const {auditSceneHeadless}=await import('../../packages/ai-copilot/src/refiner.js');
    for(const p of [getPreset(0),getPreset(1),getPreset(2)]){
      const r=await auditSceneHeadless({schemaVersion:'2.0',modelId:'modern-rutherford-bohr',params:p},{steps:20,dt:.02});
      expect(r.errors).toEqual([]);expect(r.passed).toBe(true);
      expect(r.finalObservables.t).toBeCloseTo(p.mode==='bohr'?0:.4,12);
      expect(r.invariants.length).toBeGreaterThan(0);
    }
  });
  it('never reuses an obsolete same-mode trajectory or spectrum after parameter changes',()=>{
    const p=getPreset(0),s=createInitialState(p),q={...p,impactParamFm:0};
    const res=stepRutherfordBohr(s,q,.1);expect(res.advancedTime).toBe(0);
    expect(res.nextState).toEqual(createInitialState(q));
    const b=getPreset(1),sb=createInitialState(b),c={...b,populationMode:'single-atom' as const};
    expect(stepRutherfordBohr(sb,c,.1).nextState).toEqual(createInitialState(c));
  });
  it('maintains the original strict tolerances across the UI energy/charge/impact extremes and mirror symmetry',()=>{
    for(const K of [1,5,12])for(const Z of [13,79,92])for(const b of [0,5,25,80]){
      const r=solveRutherfordScattering(K,Z,b),mirror=solveRutherfordScattering(K,Z,-b);
      expect(r.angleErrorRad).toBeLessThan(1e-4);expect(r.energyDriftRel).toBeLessThan(1e-6);
      expect(r.maxPositionErrorFm).toBeLessThan(1e-5);
      expect(Math.abs(r.minDistanceFm-r.numericalClosestFm)).toBeLessThan(1e-5);
      expect(r.trajectoryFm.every((q,i)=>Math.abs(q.x-mirror.trajectoryFm[i]!.x)<1e-7&&Math.abs(q.y+mirror.trajectoryFm[i]!.y)<1e-7)).toBe(true);
    }
  });
});
