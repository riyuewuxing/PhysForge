import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { wave2dRippleFdtdPlugin } from './plugin.js';
import { waveFdtdPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepWaveFdtd,
  type WaveFdtdParams
} from './engine.js';

function getPreset(idx: number): WaveFdtdParams {
  return resolvePluginParams(wave2dRippleFdtdPlugin.paramSchema, waveFdtdPresets[idx]!.params);
}

describe('wave-2d-ripple-fdtd stability & double-slit fringes (W02)', () => {
  it('enforces CFL < 0.5 and runs 2000 FDTD steps with zero NaN or blowup', () => {
    const params = getPreset(0);
    let st = createInitialState(params);
    expect(st.courantNumber).toBeLessThan(0.5);

    // Preserve the original 45 physical seconds; the corrected solver actually executes 10800 substeps.
    for (let i = 0; i < 100; i++) {
      st = stepWaveFdtd(st, params, 0.45).nextState;
    }
    expect(st.stepsRun).toBeGreaterThanOrEqual(2000);
    const inv = checkInvariants(st)[0]!;
    expect(inv.passed).toBe(true);
    expect(st.maxAmplitude).toBeGreaterThan(0);
    expect(st.maxAmplitude).toBeLessThan(10);
    expect(st.t).toBeCloseTo(45,10);
    expect(st.fieldTime).toBeCloseTo(45,10);
  },30000);

  it('measures genuine symmetric fringe peaks and minima in the finite tank, explicitly reports ideal reference error',()=>{
    const p={...getPreset(0),wavelengthCells:10,slitSepCells:30};
    let s=createInitialState(p);for(let i=0;i<65;i++)s=stepWaveFdtd(s,p,.45).nextState;
    const cy=75,lo=16,hi=133,v=s.screenIntensity,peaks:number[]=[],mins:number[]=[];
    expect(s.screenAverageSamples).toBeGreaterThan(0);
    expect(v[cy]!).toBeGreaterThan(.00001);
    for(let j=lo+1;j<hi;j++){
      if(v[j]!>v[j-1]!&&v[j]!>=v[j+1]!)peaks.push(j);
      if(v[j]!<v[j-1]!&&v[j]!<=v[j+1]!)mins.push(j);
    }
    const left=peaks.filter(j=>j<cy-5).at(-1),right=peaks.find(j=>j>cy+5);
    console.log('W02 finite screen diagnostics',JSON.stringify({peaks,mins,center:v[cy],left:left===undefined?null:v[left],right:right===undefined?null:v[right],samples:s.screenAverageSamples,profile:Array.from(v)}));
    expect(left).toBeDefined();expect(right).toBeDefined();
    const valley=mins.find(j=>j>cy&&j<right!);
    expect(valley).toBeDefined();expect(v[valley!]!).toBeLessThan(Math.min(v[cy]!,v[right!]!)*.7);
    // Symmetry is an independent physical property of equal apertures/source.
    expect(Math.abs((cy-left!)-(right!-cy))).toBeLessThanOrEqual(3);
    const L=s.screenI-s.wallI,d=s.geometry.separationCells,lambda=p.wavelengthCells,ideal=lambda/2*Math.sqrt(1+4*L*L/(d*d-lambda*lambda));
    console.log('W02 finite peak vs ideal point sources',JSON.stringify({left:cy-left!,right:right!-cy,ideal,paraxial:L*lambda/d,relativeError:Math.abs(right!-cy-ideal)/ideal}));
    // No false 5% far-field claim for a finite aperture and d²/(λL)≈0.82.
    expect(checkInvariants(s).every(r=>r.passed)).toBe(true);
  },30000);

  it('handles zero amplitude and dt=0 cleanly', () => {
    const p0: WaveFdtdParams = { ...getPreset(0), amplitude: 0 };
    const s0 = createInitialState(p0);
    expect(stepWaveFdtd(s0, p0, 0).nextState).toEqual(s0);
    const s1 = stepWaveFdtd(s0, p0, 0.1).nextState;
    expect(s1.maxAmplitude).toBe(0);
  });
});

describe('W02 independent physical clock and realized geometry',()=>{
  it('advances exactly the requested outer time at 240 Hz rather than forcing one larger solver step',()=>{
    for(const c of [.5,1,2]){
      const p={...getPreset(0),waveSpeed:c},initial=createInitialState(p);
      let s=initial;
      for(let j=0;j<60;j++)s=stepWaveFdtd(s,p,1/240).nextState;
      expect(s.t).toBeCloseTo(.25,12);
    }
  });
  it('does not truncate long elapsed physical intervals',()=>{
    const p=getPreset(0),s=stepWaveFdtd(createInitialState(p),p,1.17).nextState;
    expect(s.t).toBeCloseTo(1.17,12);
  });
  it('is partition independent for equal elapsed times and does not mutate prior solver state',()=>{
    const p=getPreset(0),i=createInitialState(p);
    const a=stepWaveFdtd(i,p,.125).nextState;
    let b=i;for(let j=0;j<30;j++)b=stepWaveFdtd(b,p,1/240).nextState;
    expect(a.t).toBeCloseTo(b.t,12);
    let err=0;for(let j=0;j<a.fieldSnapshot.length;j++)err=Math.max(err,Math.abs(a.fieldSnapshot[j]!-b.fieldSnapshot[j]!));
    expect(err).toBeLessThan(1e-7);
    expect(i.fdtdRef.uCurr.every(v=>v===0)).toBe(true);
  });
  it('realizes exact requested slit widths in nonoverlap geometry',()=>{
    for(const width of [3,4,5,8]){
      const p={...getPreset(0),slitWidthCells:width,slitSepCells:30},s=createInitialState(p);
      const runs:number[]=[];let n=0;
      for(let j=0;j<s.ny;j++){
        if(s.speedSnapshot[j*s.nx+s.wallI]!>0)n++;
        else if(n){runs.push(n);n=0;}
      }
      if(n)runs.push(n);
      expect(runs).toEqual([width,width]);
    }
  });
  it('does not include preflight zero samples in a measured screen average',()=>{
    const p=getPreset(0),s=stepWaveFdtd(createInitialState(p),p,3).nextState;
    expect(computeObservables(s).screenAverageSamples).toBe(0);
    expect(computeObservables(s).centerScreenIntensity).toBeUndefined();
  });
  it('exports two genuine aperture gaps, not a solid wall covering them',()=>{
    const p=getPreset(0),s=createInitialState(p),ir=wave2dRippleFdtdPlugin.exportDiagramIR!(s,p);
    const walls=ir.primitives.filter(q=>q.kind==='rect'&&q.hatch);
    expect(walls.length).toBe(3);
  });
});

it('exposes substep remainder instead of advancing an extra field sample, and retains a branchable old state',()=>{
  const p=getPreset(0),i=createInitialState(p),a=stepWaveFdtd(i,p,.001).nextState;
  expect(a.t).toBe(.001);expect(a.fieldTime).toBe(0);expect(a.fieldSnapshot).toBe(i.fieldSnapshot);
  const b=stepWaveFdtd(a,p,1/240-.001).nextState;expect(b.fieldTime).toBeCloseTo(1/240,12);
  const c=stepWaveFdtd(i,p,1/240).nextState;expect(c.fieldSnapshot).toEqual(b.fieldSnapshot);
  expect(i.fdtdRef.uPrev.every(v=>v===0)).toBe(true);expect(i.fdtdRef.uCurr.every(v=>v===0)).toBe(true);
});
it('rejects overlapping requested apertures without silently moving them',()=>{
  const p={...getPreset(0),slitWidthCells:20,slitSepCells:14},s=createInitialState(p),o=computeObservables(s,p);
  expect(s.geometry.valid).toBe(false);expect(o.geometryValid).toBe(0);expect(o.maxAmplitude).toBeUndefined();
  const r=stepWaveFdtd(s,p,1);expect(r.halt).toBe(true);expect(r.advancedTime).toBe(0);expect(r.nextState).toBe(s);
});
it('keeps screen averages tied to actual samples and detects corrupt field/clock',()=>{
  const p={...getPreset(0),waveSpeed:2},s=createInitialState(p),a=stepWaveFdtd(s,p,s.averageStartTime+.1).nextState;
  expect(a.screenAverageSamples).toBeGreaterThan(0);expect(a.averageFirstTime).toBeGreaterThanOrEqual(s.averageStartTime);
  expect(computeObservables(a,p).screenAverageDuration).toBeCloseTo(a.screenAverageSamples*a.fdtdRef.dt,10);
  expect(checkInvariants(a).every(r=>r.passed)).toBe(true);
  expect(checkInvariants({...a,fieldTime:a.fieldTime+.1}).some(r=>!r.passed)).toBe(true);
},30000);

it('adds exactly one independently recomputed screen mean sample at the next physical grid step',()=>{
  const p={...getPreset(0),waveSpeed:2},i=createInitialState(p),s=stepWaveFdtd(i,p,i.averageStartTime+.12).nextState;
  const a=stepWaveFdtd(s,p,s.fdtdRef.dt).nextState;
  expect(a.screenAverageSamples).toBe(s.screenAverageSamples+1);
  for(let j=0;j<a.ny;j++){const u=a.fieldSnapshot[j*a.nx+a.screenI]!,want=Math.fround((s.screenAverageSamples*s.screenIntensity[j]!+u*u)/a.screenAverageSamples);expect(Math.abs(a.screenIntensity[j]!-want)).toBeLessThan(2e-7);}
},30000);

it('never misses a physical grid tick during long 240 Hz sequential playback',()=>{
  const p={...getPreset(0),amplitude:0},h=1/240;let s=createInitialState(p);
  for(let k=1;k<=1800;k++){
    s=stepWaveFdtd(s,p,h).nextState;
    expect(s.stepsRun).toBe(k);
    expect(Math.abs(s.fieldTime-k*h)).toBeLessThan(1e-12);
  }
  expect(s.t).toBeCloseTo(7.5,12);
},30000);
