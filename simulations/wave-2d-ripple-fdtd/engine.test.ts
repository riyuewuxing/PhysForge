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

    // Each stepWaveFdtd(dt=0.45) runs ~20 FDTD steps -> 100 calls = 2000 steps
    for (let i = 0; i < 100; i++) {
      st = stepWaveFdtd(st, params, 0.45).nextState;
    }
    expect(st.stepsRun).toBeGreaterThanOrEqual(2000);
    const inv = checkInvariants(st)[0]!;
    expect(inv.passed).toBe(true);
    expect(st.maxAmplitude).toBeGreaterThan(0);
    expect(st.maxAmplitude).toBeLessThan(10);
  });

  it('matches double-slit far-field fringe spacing delta_y = (L/d)*lambda within < 5%', () => {
    const params: WaveFdtdParams = {
      ...getPreset(0),
      wavelengthCells: 10,
      slitSepCells: 30
    };
    let st = createInitialState(params);
    for (let i = 0; i < 65; i++) {
      st = stepWaveFdtd(st, params, 0.45).nextState;
    }

    const cy = Math.floor(st.ny / 2);
    const L = st.screenI - st.wallI; // distance in cells
    const expectedFringeStep = (L * params.wavelengthCells) / params.slitSepCells;

    // Locate first symmetric intensity maximum outside central peak (at j > cy + 0.5 * expectedFringeStep)
    let firstPeakJ = -1;
    let firstPeakVal = -1;
    const minJ = cy + Math.round(0.6 * expectedFringeStep);
    const maxJ = cy + Math.round(1.4 * expectedFringeStep);
    for (let j = minJ; j <= maxJ; j++) {
      if (st.screenIntensity[j]! > firstPeakVal) {
        firstPeakVal = st.screenIntensity[j]!;
        firstPeakJ = j;
      }
    }

    const measuredSpacing = firstPeakJ - cy;
    expect(Math.abs(measuredSpacing - expectedFringeStep) / expectedFringeStep).toBeLessThan(0.05);
  });

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
