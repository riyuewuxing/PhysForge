import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { expElectricalErrorLabPlugin } from './plugin.js';
import { electricalErrorPresets } from './presets.js';
import {
  createInitialState,
  decodeInstruments,
  solveBulbCurveViaMna,
  solveEmfViaMna,
  solveHalfBiasViaMna,
  stepElectricalErrorLab,
  type ElectricalErrorParams
} from './engine.js';

function getPreset(idx: number): ElectricalErrorParams {
  return resolvePluginParams(expElectricalErrorLabPlugin.paramSchema, electricalErrorPresets[idx]!.params);
}

describe('exp-electrical-error-lab MNA & precision instrument invariants (X02)', () => {
  it('matches non-ideal MNA E/r fitted slope and intercept against analytical bias within < 1e-6', () => {
    const outer = solveEmfViaMna(getPreset(0));
    expect(outer.fitError).toBeLessThan(1e-6);
    expect(outer.eFittedV).toBeLessThan(3.0);
    expect(outer.rFittedOhm).toBeLessThan(1.5);

    const inner = solveEmfViaMna({ ...getPreset(0), emfWiring: 'ammeter-in-series' });
    expect(inner.fitError).toBeLessThan(1e-6);
    expect(Math.abs(inner.eFittedV - 3.0)).toBeLessThan(1e-6);
    expect(Math.abs(inner.rFittedOhm - (1.5 + 0.4))).toBeLessThan(1e-6);
  });

  it('proves half-bias Rg_measured < Rg_true and monotonically converges toward Rg_true as R1 grows', () => {
    const lowV = solveHalfBiasViaMna(1.5, 120);
    const highV = solveHalfBiasViaMna(12.0, 120);
    expect(lowV.rgMeasuredOhm).toBeLessThan(120);
    expect(highV.rgMeasuredOhm).toBeLessThan(120);
    expect(highV.rgMeasuredOhm).toBeGreaterThan(lowV.rgMeasuredOhm);
  });

  it('verifies nonlinear lamp divider vs current-limit range, zero-error caliper/micrometer, and dt=0', () => {
    const divider = solveBulbCurveViaMna(getPreset(2));
    const limiter = solveBulbCurveViaMna({ ...getPreset(2), bulbWiring: 'current-limit' });
    expect(divider[0]!.voltageV).toBeLessThan(0.05);
    expect(limiter[0]!.voltageV).toBeGreaterThan(0.3);

    const inst = decodeInstruments(23.46, '50', 5.73);
    expect(inst.vernierReadoutMm).toBe(23.46);
    expect(inst.vernierCoincidentIndex).toBe(23);
    expect(inst.microReadoutMm).toBe(5.73);

    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepElectricalErrorLab(st, p, 0).nextState.t).toBe(0);
  });

  it('exposes draggable caliper and micrometer controls with their measurement precision', () => {
    const params = resolvePluginParams(expElectricalErrorLabPlugin.paramSchema, {
      mode: 'caliper-micrometer',
      vernierDivisions: '50'
    });
    const state = createInitialState(params);
    const plugin = expElectricalErrorLabPlugin as SimulationPluginV2<typeof params, typeof state>;
    const handles = plugin.getControlHandles?.(state, params) ?? [];
    const jaw = handles.find((handle) => handle.id === 'vernier-jaw');
    const thimble = handles.find((handle) => handle.id === 'micrometer-thimble');

    expect(jaw).toBeDefined();
    expect(thimble).toBeDefined();
    expect(Number(jaw?.onDrag({ x: 1.234, y: jaw.position.y })['targetVernierMm'])).toBe(50);
    expect(Number(thimble?.onDrag({ x: 2.345, y: thimble.position.y })['targetMicrometerMm'])).toBe(20);
  });
});

describe('F09 independent electrical experiment regression contract (unrun)',()=>{
  it('reports quantization error against the actual off-grid target, not itself',()=>{
    const q=decodeInstruments(23.463,'50',5.734);
    expect(q.vernierReadoutMm).toBeCloseTo(23.46,12);
    expect(q.microReadoutMm).toBeCloseTo(5.73,12);
    expect(q.vernierQuantErrorMm).toBeCloseTo(.003,12);
    expect(q.microQuantErrorMm).toBeCloseTo(.004,12);
  });
  it('returns an exact selected lamp operating point rather than an unrelated sweep',()=>{
    const p={...getPreset(2),rheostatTapFrac:.35,bulbWiring:'voltage-divider' as const};
    const s=createInitialState(p) as ReturnType<typeof createInitialState>&{bulbOperatingPoint?:{tap:number;voltageV:number;currentA:number}};
    const point=s.bulbOperatingPoint;
    expect(point).toBeDefined();
    if(!point)throw Error('slider has no current operating point');
    expect(point.tap).toBeCloseTo(.35,12);
    const u=point.voltageV,i=point.currentA;
    expect(u).toBeGreaterThan(0);
    expect(u).toBeLessThan(p.emfVolts);
    expect(i).toBeCloseTo(.14*Math.pow(Math.abs(u)+1e-6,-.38)*u,7);
    expect((p.emfVolts-u)/(.65*p.rheostatMaxOhm)-u/(.35*p.rheostatMaxOhm)-i).toBeCloseTo(0,6);
    const moved=createInitialState({...p,rheostatTapFrac:.7}) as typeof s;
    expect(moved.bulbOperatingPoint?.voltageV).toBeGreaterThan(u);
  });
  it('exports distinct real measurement circuits for the two E/r wiring choices',()=>{
    const outer=getPreset(0),inner={...outer,emfWiring:'ammeter-in-series' as const};
    const p=expElectricalErrorLabPlugin as SimulationPluginV2<typeof outer,ReturnType<typeof createInitialState>>;
    const a=p.exportDiagramIR!(createInitialState(outer),outer);
    const b=p.exportDiagramIR!(createInitialState(inner),inner);
    const circuits=(d:typeof a)=>d.primitives.filter(q=>q.kind==='circuitElement'||q.kind==='line');
    expect(circuits(a)).not.toEqual(circuits(b));
    for(const d of [a,b]){
      const resistors=d.primitives.filter(q=>q.kind==='circuitElement'&&q.element==='resistor');
      expect(resistors.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('does not export an unrelated E/r circuit for the precision-reading exercise',()=>{
    const p=getPreset(3),plugin=expElectricalErrorLabPlugin as SimulationPluginV2<typeof p,ReturnType<typeof createInitialState>>;
    const d=plugin.exportDiagramIR!(createInitialState(p),p);
    expect(d.primitives.some(q=>q.kind==='circuitElement')).toBe(false);
    expect(d.primitives.length).toBeGreaterThan(0);
  });
  it('keeps formulas mode-specific, including both physically different E/r biases',()=>{
    const outer=getPreset(0),inner={...outer,emfWiring:'ammeter-in-series' as const};
    const plugin=expElectricalErrorLabPlugin as SimulationPluginV2<typeof outer,ReturnType<typeof createInitialState>>;
    const a=plugin.formatFormulas!(createInitialState(outer),outer);
    const b=plugin.formatFormulas!(createInitialState(inner),inner);
    expect(a.map(q=>q.latex)).not.toEqual(b.map(q=>q.latex));
    const bulb=getPreset(2),f=plugin.formatFormulas!(createInitialState(bulb),bulb);
    expect(f.map(q=>q.latex)).not.toEqual(a.map(q=>q.latex));
    const instruments=getPreset(3),g=plugin.formatFormulas!(createInitialState(instruments),instruments);
    expect(g.map(q=>q.latex)).not.toEqual(a.map(q=>q.latex));
  });
});

describe('F09 independent circuit topology and limiting cases (unrun)',()=>{
  it('exports a circuit graph that is isomorphic to each actual MNA measurement topology',()=>{
    const base=getPreset(0);
    const plugin=expElectricalErrorLabPlugin as SimulationPluginV2<typeof base,ReturnType<typeof createInitialState>>;
    for(const emfWiring of ['voltmeter-across-source','ammeter-in-series'] as const){
      const p={...base,emfWiring},ir=plugin.exportDiagramIR!(createInitialState(p),p);
      const elements=ir.primitives.filter(q=>q.kind==='circuitElement');
      const wires=ir.primitives.filter(q=>q.kind==='line');
      type XY={x:number;y:number};
      const key=(q:XY)=>[q.x,q.y].map(n=>Math.round(n*1e8)).join(',');
      const endpoints=(q:{x1:number;y1:number;x2:number;y2:number})=>[{x:q.x1,y:q.y1},{x:q.x2,y:q.y2}];
      const points=[...elements,...wires].flatMap(endpoints);
      const parent=new Map(points.map(q=>[key(q),key(q)]));
      function root(k:string):string{const n=parent.get(k)!;return n===k?k:root(n);}
      function join(a:string,b:string){parent.set(root(a),root(b));}
      for(const w of wires){
        const [a,b]=endpoints(w),dx=b!.x-a!.x,dy=b!.y-a!.y;
        if(Math.hypot(dx,dy)<1e-12)continue;
        for(const q of points){
          const cross=(q.x-a!.x)*dy-(q.y-a!.y)*dx;
          const dot=(q.x-a!.x)*dx+(q.y-a!.y)*dy;
          if(Math.abs(cross)<1e-8&&dot>=-1e-8&&dot<=dx*dx+dy*dy+1e-8)join(key(a!),key(q));
        }
      }
      const edges=elements.map(e=>({kind:e.element,n:endpoints(e).map(q=>root(key(q)))}));
      const battery=edges.find(e=>e.kind==='battery'),ammeter=edges.find(e=>e.kind==='ammeter'),voltmeter=edges.find(e=>e.kind==='voltmeter');
      const rs=edges.filter(e=>e.kind==='resistor');
      expect(battery).toBeDefined();expect(ammeter).toBeDefined();expect(voltmeter).toBeDefined();
      expect(rs.length).toBe(2);
      const connects=(edge:typeof edges[number],a:string,b:string)=>a!==b&&edge.n.includes(a)&&edge.n.includes(b);
      const valid=battery!.n.some((positive,idx)=>{
        const ground=battery!.n[1-idx]!;
        return rs.some((internal,ri)=>{
          if(!internal.n.includes(positive))return false;
          const terminal=internal.n.find(n=>n!==positive);
          if(!terminal||terminal===ground||!ammeter!.n.includes(terminal))return false;
          const load=ammeter!.n.find(n=>n!==terminal);
          if(!load||new Set([positive,ground,terminal,load]).size!==4)return false;
          return connects(rs[1-ri]!,load,ground)&&connects(voltmeter!,emfWiring==='voltmeter-across-source'?terminal:load,ground);
        });
      });
      expect(valid,emfWiring).toBe(true);
    }
  });
  it('models the exact slider endpoints instead of hiding a nonzero divider minimum',()=>{
    const p=getPreset(2),d=solveBulbCurveViaMna({...p,bulbWiring:'voltage-divider'});
    expect(d[0]!.tap).toBe(0);expect(d[0]!.voltageV).toBeCloseTo(0,12);expect(d[0]!.currentA).toBeCloseTo(0,12);
    expect(d.at(-1)!.voltageV).toBeCloseTo(p.emfVolts,12);
    const lim=solveBulbCurveViaMna({...p,bulbWiring:'current-limit'});
    expect(lim[0]!.voltageV).toBeGreaterThan(0);
    expect(lim.at(-1)!.voltageV).toBeCloseTo(p.emfVolts,12);
    const field=expElectricalErrorLabPlugin.paramSchema.find(f=>f.key==='rheostatTapFrac');
    expect(field?.kind).toBe('number');
    if(field?.kind==='number'){expect(field.min).toBe(0);expect(field.max).toBe(1);}
  });
  it('retains the exact finite-R1 half-current benchmark, not merely the bias sign',()=>{
    for(const [supply,rg] of [[1.5,300],[3,120],[12,20]] as const){
      const q=solveHalfBiasViaMna(supply,rg),R1=q.rSeriesR1Ohm;
      const r2=R1*rg/(R1+rg);
      expect(q.rgMeasuredOhm).toBeCloseTo(r2,7);
      const parallel=rg*q.rgMeasuredOhm/(rg+q.rgMeasuredOhm);
      const ig=(supply*parallel/(R1+parallel))/rg;
      expect(ig).toBeCloseTo(supply/(R1+rg)/2,10);
    }
  });
});
