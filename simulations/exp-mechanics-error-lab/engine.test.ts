import { createWorldMapper, resolvePluginParams, type SimulationPluginV2, type Viewport } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { expMechanicsErrorLabPlugin } from './plugin.js';
import { mechanicsErrorPresets } from './presets.js';
import { afGeometry, graphItems, tapeGeometry } from './geometry.js';
import {
  computeTrueCartAcceleration,
  createInitialState,
  solveMechanicsErrorAnalysis,
  stepMechanicsErrorLab,
  type MechanicsErrorParams
} from './engine.js';

function getPreset(idx: number): MechanicsErrorParams {
  return resolvePluginParams(expMechanicsErrorLabPlugin.paramSchema, mechanicsErrorPresets[idx]!.params);
}

describe('exp-mechanics-error-lab invariants (X01)', () => {
  it('achieves < 1e-10 successive-difference error at zero noise and recovers F-axis/a-axis systematic intercepts', () => {
    const under = getPreset(0);
    const sUnder = solveMechanicsErrorAnalysis(under);
    expect(sUnder.diffErrorMps2).toBeLessThan(1e-10);
    expect(sUnder.analyticInterceptF).toBeGreaterThan(0);

    const over = { ...getPreset(1), readingNoiseMm: 0 };
    const sOver = solveMechanicsErrorAnalysis(over);
    expect(sOver.diffErrorMps2).toBeLessThan(1e-10);
    expect(sOver.analyticInterceptA).toBeGreaterThan(0);
  });

  it('strictly reproduces heavy-hanger bend F/(M + F/g) within < 1e-10 at zero noise', () => {
    const bend = getPreset(2);
    const sBend = solveMechanicsErrorAnalysis(bend);
    for (const pt of sBend.afCurve) {
      const exact = pt.fAppN / (bend.cartMassKg + pt.fAppN / 9.8);
      expect(Math.abs(pt.aMeasured - exact)).toBeLessThan(1e-10);
    }
  });

  it('handles dt=0 and deterministic seeded Gaussian noise cleanly without NaN', () => {
    const p = { ...getPreset(1), readingNoiseMm: 0.2 };
    const s1 = createInitialState(p);
    const s2 = createInitialState(p);
    expect(s1.aDiffMeasuredMps2).toBe(s2.aDiffMeasuredMps2);
    expect(stepMechanicsErrorLab(s1, p, 0).nextState.t).toBe(0);
  });

  it('keeps the draggable ruler offset visual-only and clamps its range', () => {
    const params = resolvePluginParams(expMechanicsErrorLabPlugin.paramSchema, { rulerOffsetCm: 2.4 });
    const state = createInitialState(params);
    const plugin = expMechanicsErrorLabPlugin as SimulationPluginV2<typeof params, typeof state>;
    const handle = plugin.getControlHandles?.(state, params)?.find((item) => item.id === 'tape-ruler-origin');

    expect(handle).toBeDefined();
    expect(Number(handle?.onDrag({ x: 99, y: handle.position.y })['rulerOffsetCm'])).toBe(20);
    expect(solveMechanicsErrorAnalysis(params).aDiffMeasuredMps2).toBe(state.aDiffMeasuredMps2);
  });
});

describe('F08 independent mechanics-error regressions (pre-fix)', () => {
  it('uses the same force law for the heavy-hanger sweep and the active paper tape even when compensation changes', () => {
    const p = { ...getPreset(2), trackTiltDeg: 4, frictionForceN: 0.05, readingNoiseMm: 0 };
    const s = solveMechanicsErrorAnalysis(p);
    const bias = p.cartMassKg * 9.8 * Math.sin(4 * Math.PI / 180) - p.frictionForceN;
    for (const pt of s.afCurve) {
      const expected = (pt.fAppN + bias) / (p.cartMassKg + pt.fAppN / 9.8);
      expect(pt.aAnalytic).toBeCloseTo(expected, 10);
      expect(pt.aMeasured).toBeCloseTo(expected, 10);
    }
    const point = s.afCurve.find(pt => Math.abs(pt.fAppN - p.hangerMassKg * 9.8) < 1e-12);
    expect(point).toBeDefined();
    expect(point!.aAnalytic).toBeCloseTo(s.aTrueMps2, 10);
  });

  it('evaluates the unloaded positive-acceleration intercept without an invented hanging mass', () => {
    const M = 0.4, theta = 4, f = 0.05;
    const expected = 9.8 * Math.sin(theta * Math.PI / 180) - f / M;
    expect(expected).toBeGreaterThan(0);
    expect(computeTrueCartAcceleration(M, 0, theta, f)).toBeCloseTo(expected, 10);
  });

  it('makes all four stated a-F teaching comparisons available as balanced or deliberately biased presets', () => {
    expect(new Set(mechanicsErrorPresets.map(p => p.params.scenario))).toEqual(new Set([
      'ideal-compensated', 'under-compensated', 'over-compensated', 'heavy-hanger-bend'
    ]));
    const preset = mechanicsErrorPresets.find(p => p.params.scenario === 'ideal-compensated')!;
    const p = resolvePluginParams(expMechanicsErrorLabPlugin.paramSchema, preset.params);
    expect(p.cartMassKg * 9.8 * Math.sin(p.trackTiltDeg * Math.PI / 180) - p.frictionForceN).toBeCloseTo(0, 10);
  });

  it('keeps all exported measured points in the diagram viewBox at a valid high-acceleration boundary', () => {
    const p = { ...getPreset(2), cartMassKg: 0.1, readingNoiseMm: 0 };
    const state = createInitialState(p);
    const plugin = expMechanicsErrorLabPlugin as SimulationPluginV2<typeof p, typeof state>;
    const diagram = plugin.exportDiagramIR!(state, p);
    const curve = diagram.primitives.find(q => q.kind === 'polyline');
    expect(curve).toBeDefined();
    if (curve?.kind !== 'polyline') throw new Error('missing measured curve');
    expect(curve.points.length).toBe(state.afCurve.length);
    for (const point of curve.points) {
      expect(point.x).toBeGreaterThanOrEqual(diagram.viewBox.minX);
      expect(point.x).toBeLessThanOrEqual(diagram.viewBox.maxX);
      expect(point.y).toBeGreaterThanOrEqual(diagram.viewBox.minY);
      expect(point.y).toBeLessThanOrEqual(diagram.viewBox.maxY);
    }
  });
});

describe('H57 F08 signed sampling and shared geometry',()=>{
  it('keeps the tape moving forward while measuring a negative signed acceleration',()=>{
    const p={...getPreset(0),cartMassKg:.1,hangerMassKg:.01,frictionForceN:.3,readingNoiseMm:0};
    const s=solveMechanicsErrorAnalysis(p);
    expect(s.aTrueMps2).toBeCloseTo((.098-.3)/.11,10);
    expect(s.aTrueMps2).toBeLessThan(0);
    expect(s.aDiffMeasuredMps2).toBeCloseTo(s.aTrueMps2,10);
    for(let i=1;i<s.tapeDots.length;i++){
      expect(s.tapeDots[i]!.timeS-s.tapeDots[i-1]!.timeS).toBeCloseTo(.1,12);
      expect(s.tapeDots[i]!.posCm).toBeGreaterThan(s.tapeDots[i-1]!.posCm);
    }
    expect(s.analyticInterceptA).toBeCloseTo(-3,10);
  });
  it('keeps tape geometry affine, readings relative to ruler zero and differences invariant',()=>{
    const p={...getPreset(2),cartMassKg:.1,hangerMassKg:.5,readingNoiseMm:0};
    const s=createInitialState(p),a=tapeGeometry(s,{...p,rulerOffsetCm:-5}),b=tapeGeometry(s,{...p,rulerOffsetCm:20});
    expect(a.scale).toBe(b.scale);
    expect(a.dots.map(d=>d.x)).toEqual(b.dots.map(d=>d.x));
    expect(b.zeroX-a.zeroX).toBeCloseTo(25*a.scale,12);
    expect(b.offsetAtX(b.zeroX)).toBeCloseTo(20,12);
    for(const d of b.dots)expect(d.x).toBeCloseTo(b.zeroX+d.reading*b.scale,12);
    expect(a.dots[6]!.reading-a.dots[0]!.reading).toBeCloseTo(b.dots[6]!.reading-b.dots[0]!.reading,12);
    expect(b.ticks.every(t=>t.x>=-1.7500001&&t.x<=1.7500001)).toBe(true);
  });
  it('shares the exact measured/analytic coordinates with export, with honest zero axes',()=>{
    const p={...getPreset(0),cartMassKg:.1,frictionForceN:.3,readingNoiseMm:0};
    const s=createInitialState(p),g=afGeometry(s,p);
    expect(g.aMin).toBeLessThan(0);
    expect(g.map(0,0).x).toBeCloseTo(g.bounds.left,12);
    expect(g.map(0,0).y).toBeGreaterThan(g.bounds.bottom);
    const items=graphItems(s,p),plugin=expMechanicsErrorLabPlugin as SimulationPluginV2<typeof p,typeof s>;
    expect(plugin.exportDiagramIR!(s,p).primitives).toEqual(items.map(i=>i.primitive));
    expect(g.data.theory[0]!.a).toBeCloseTo(-3,10);
    expect(g.data.measured.map(q=>g.map(q.f,q.a)).every(q=>q.y>=g.bounds.bottom-1e-10&&q.y<=g.bounds.top+1e-10)).toBe(true);
  });
  it('rejects missing, malformed and out-of-domain CSV samples instead of silently mapping them to zero',()=>{
    const p={...getPreset(0),phyphoxOverlayCsv:'F,a\n0.2;0.3\n;2\n1;;2\n1;Infinity\n-1;2\n3;101'};
    expect(solveMechanicsErrorAnalysis(p).csvOverlayPoints).toEqual([{fAppN:.2,a:.3}]);
  });
});

describe('F08 actual Canvas label anchoring',()=>{
  it.each([
    {cartMassKg:.1,hangerMassKg:.01,frictionForceN:.3,rulerOffsetCm:20},
    {cartMassKg:.1,hangerMassKg:.5,frictionForceN:0,rulerOffsetCm:0}
  ])('draws each quantitative label at its intended coordinate and retains seven readings',changes=>{
    const p={...getPreset(0),...changes,readingNoiseMm:0},state=createInitialState(p);
    const vp:Viewport={width:1120,height:584,dpr:1,scale:.78,offsetX:0,offsetY:0};
    const mapper=createWorldMapper(vp);
    const drawn:Array<{text:string;x:number;y:number;align:string;baseline:string}>=[];
    const target={textAlign:'left',textBaseline:'alphabetic',canvas:{width:vp.width,height:vp.height},
      measureText:(text:string)=>({width:text.length*6}),
      fillText:(text:string,x:number,y:number)=>drawn.push({text,x,y,align:target.textAlign,baseline:target.textBaseline})};
    const ctx=new Proxy(target,{get:(o,k)=>Reflect.has(o,k)?Reflect.get(o,k):()=>undefined}) as unknown as CanvasRenderingContext2D;
    expMechanicsErrorLabPlugin.renderCanvas(ctx,state,p,vp,new Set(['tape','afCurve']));
    for(const {role,primitive:q} of graphItems(state,p)){
      if(role!=='tick'||q.kind!=='text')continue;
      const expected=mapper.toScreen(q.x,q.y);
      expect(drawn.some(d=>d.text===q.text&&Math.abs(d.x-expected.x)<1e-8&&Math.abs(d.y-expected.y)<1e-8&&d.baseline==='middle'&&d.align===(q.align==='end'?'right':'center')),q.text).toBe(true);
    }
    for(const d of tapeGeometry(state,p).dots)
      expect(drawn.filter(q=>q.text==='x'+d.index+'='+d.reading.toFixed(2))).toHaveLength(1);
  });
});
