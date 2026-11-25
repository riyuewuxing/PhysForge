import { describe, expect, it } from 'vitest';
import { defineSimulationPlugin } from '@physforge/sim-sdk';
import {
  computeFftSpectrum,
  computePhaseLoopArea,
  fitDampedHarmonic,
  fitExponential,
  fitLinear,
  fitPolynomial,
  parsePhysicsCsv,
  runParameterSweep
} from './index.js';

describe('analysis-lab algorithms', () => {
  it('parses Phyphox semicolon/comma-decimal CSV and Tracker multi-row headers', () => {
    const phyphoxCsv = [
      'Time (s);Acceleration x (m/s^2);Acceleration y (m/s^2)',
      '0,000;0,125;-9,810',
      '0,020;0,250;-9,805',
      '0,040;0,375;-9,800'
    ].join('\n');

    const parsedPhy = parsePhysicsCsv(phyphoxCsv);
    expect(parsedPhy.detectedDialect).toBe('phyphox-semicolon');
    expect(parsedPhy.headers).toEqual([
      'Time (s)',
      'Acceleration x (m/s^2)',
      'Acceleration y (m/s^2)'
    ]);
    expect(parsedPhy.rows).toHaveLength(3);
    expect(parsedPhy.rows[0]!['Acceleration y (m/s^2)']).toBeCloseTo(-9.81, 6);

    const trackerCsv = [
      'mass_A',
      't\tx\ty',
      '0.0\t0.10\t2.00',
      '0.1\t0.25\t1.95'
    ].join('\n');
    const parsedTracker = parsePhysicsCsv(trackerCsv);
    expect(parsedTracker.detectedDialect).toBe('tracker-multirow');
    expect(parsedTracker.headers).toEqual(['t', 'x', 'y']);
    expect(parsedTracker.rows[1]!['x']).toBeCloseTo(0.25, 6);
  });

  it('fits linear, polynomial, exponential, and damped harmonic curves with high R^2', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const lin = fitLinear(xs, xs.map((x) => 2.5 * x - 1.2));
    expect(lin.params[0]).toBeCloseTo(2.5, 8);
    expect(lin.params[1]).toBeCloseTo(-1.2, 8);
    expect(lin.rSquared).toBeCloseTo(1, 8);

    const poly = fitPolynomial(xs, xs.map((x) => 1.5 * x * x - 2 * x + 3), 2);
    expect(poly.params[2]).toBeCloseTo(1.5, 6);
    expect(poly.rSquared).toBeCloseTo(1, 8);

    const expXs = Array.from({ length: 20 }, (_, i) => i * 0.25);
    const expYs = expXs.map((x) => 4.2 * Math.exp(-0.6 * x) + 1.5);
    const expFit = fitExponential(expXs, expYs);
    expect(expFit.rSquared).toBeGreaterThan(0.9999);
    expect(expFit.params[1]).toBeCloseTo(-0.6, 3);

    // Damped harmonic fit y(t) = 2.5 * exp(-0.18*t) * cos(4.2*t + 0.4) + 0.3
    const dt = 0.02;
    const ts = Array.from({ length: 200 }, (_, i) => i * dt);
    const ys = ts.map((t) => 2.5 * Math.exp(-0.18 * t) * Math.cos(4.2 * t + 0.4) + 0.3);
    const harm = fitDampedHarmonic(ts, ys);
    expect(harm.rSquared).toBeGreaterThan(0.999);
    expect(harm.params[0]).toBeCloseTo(2.5, 1);
    expect(harm.params[1]).toBeCloseTo(0.18, 2);
    expect(harm.params[2]).toBeCloseTo(4.2, 2);
  });

  it('computes accurate Radix-2 FFT peak frequencies and Green theorem closed-loop area', () => {
    const dt = 0.005; // 200 Hz sampling
    const n = 512;
    const samples = Array.from({ length: n }, (_, i) => {
      const t = i * dt;
      return 1.2 * Math.sin(2 * Math.PI * 12.5 * t) + 0.4 * Math.cos(2 * Math.PI * 27 * t) + 2.0;
    });

    const spec = computeFftSpectrum(samples, dt, { window: 'hann', removeDc: true });
    expect(spec.peaks.length).toBeGreaterThanOrEqual(2);
    expect(spec.peaks[0]!.frequency).toBeCloseTo(12.5, 1);
    expect(spec.peaks[1]!.frequency).toBeCloseTo(27.0, 1);

    // Ellipse (a cos t, b sin t) -> Area = pi * a * b
    const a = 3;
    const b = 2;
    const m = 400;
    const xs = Array.from({ length: m }, (_, i) => a * Math.cos((2 * Math.PI * i) / m));
    const ys = Array.from({ length: m }, (_, i) => b * Math.sin((2 * Math.PI * i) / m));
    const area = computePhaseLoopArea(xs, ys);
    expect(area.magnitudeArea).toBeCloseTo(Math.PI * a * b, 2);
  });

  it('executes headless parameter sweep deterministically', () => {
    interface P {
      k: number;
      [key: string]: number | boolean | string;
    }
    const plugin = defineSimulationPlugin<P, { t: number; v: number }>({
      meta: {
        id: 'sweep-dummy',
        title: 'Sweep Dummy',
        textbookRef: '必修二',
        curriculumTags: ['科学探究'],
        difficulty: '基础新授',
        version: '1.0.0'
      },
      paramSchema: [{ key: 'k', kind: 'number', label: 'k', min: 1, max: 10, step: 1, defaultValue: 2 }],
      presets: [],
      engine: {
        createInitialState: () => ({ t: 0, v: 0 }),
        step: (s, p, dt) => ({ nextState: { t: s.t + dt, v: s.v + p.k * dt }, events: [] }),
        computeObservables: (s) => ({ v: s.v })
      },
      layers: [],
      telemetryChannels: [],
      renderCanvas: () => {}
    });

    const result = runParameterSweep(plugin, {
      paramKey: 'k',
      values: [1, 2, 4],
      steps: 10,
      dt: 0.1
    });
    expect(result.points.map((pt) => pt.finalObservables['v'])).toEqual([
      expect.closeTo(1, 10),
      expect.closeTo(2, 10),
      expect.closeTo(4, 10)
    ]);
  });
});


describe('finite-step contract in headless parameter sweeps',()=>{
  it('uses actual partial terminal time, never repeats a terminal step, and releases the state',()=>{
    type P={k:number};type S={x:number};
    let steps=0,disposed=0;
    const p=defineSimulationPlugin<P,S>({
      meta:{id:'finite-step-dummy',title:'Finite step dummy',textbookRef:'必修二',curriculumTags:['科学探究'],difficulty:'基础新授',version:'1.0.0'},
      paramSchema:[{key:'k',kind:'number',label:'k',min:1,max:10,step:1,defaultValue:2}],
      presets:[],layers:[],telemetryChannels:[],renderCanvas:()=>{},
      engine:{
        createInitialState:()=>({x:0}),
        step:(s,_p,_dt)=>{steps++;return {nextState:{x:s.x+.025},events:[{id:'stop',time:.025,label:'terminal'}],advancedTime:.025,halt:true};},
        computeObservables:s=>({x:s.x}),
        disposeState:s=>{expect(s.x).toBe(.025);disposed++;}
      }
    });
    const result=runParameterSweep(p,{paramKey:'k',values:[1,2],steps:10,dt:.1});
    expect(steps).toBe(2);expect(disposed).toBe(2);
    expect(result.points.map(p=>p.finalTime)).toEqual([.025,.025]);
    expect(result.points.map(p=>p.eventCount)).toEqual([1,1]);
  });
  it('rejects an unready solver rather than returning zero-time results and frees its state',()=>{
    type P={k:number};let disposed=0;
    const p=defineSimulationPlugin<P,{x:number}>({
      meta:{id:'unready-dummy',title:'Unready dummy',textbookRef:'必修二',curriculumTags:['科学探究'],difficulty:'基础新授',version:'1.0.0'},
      paramSchema:[{key:'k',kind:'number',label:'k',min:1,max:10,step:1,defaultValue:2}],
      presets:[],layers:[],telemetryChannels:[],renderCanvas:()=>{},
      engine:{createInitialState:()=>({x:0}),step:s=>({nextState:s,events:[],advancedTime:0}),computeObservables:s=>({x:s.x}),disposeState:()=>{disposed++;}}
    });
    expect(()=>runParameterSweep(p,{paramKey:'k',values:[1],steps:10,dt:.1})).toThrow('engine did not advance');
    expect(disposed).toBe(1);
  });
});
