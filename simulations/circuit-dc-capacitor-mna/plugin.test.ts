import { describe, expect, it, vi } from 'vitest';
import { resolvePluginParams } from '@physforge/sim-sdk';
import {
  circuitDcCapacitorMnaPlugin,
  drawCurrentParticles,
  drawShortCircuitBanner,
  drawShortCircuitGlow,
  voltageToColor
} from './plugin.js';
import { createInitialState, computeObservables, stepCircuit, type CircuitParams } from './engine.js';
import { topologyEdges } from './topologyView.js';
import { dividerPotentialColor, dividerWiperLabelAnchor, dividerWiperX, dividerWiperY } from './dividerView.js';

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn()
  } as unknown as CanvasRenderingContext2D;
}

describe('circuit-dc-capacitor-mna visual helpers', () => {
  it('maps low, middle, high and missing voltages to stable colors', () => {
    expect(voltageToColor(0, 0, 10)).toBe('hsl(215, 88%, 48%)');
    expect(voltageToColor(5, 0, 10)).toBe('hsl(110, 88%, 48%)');
    expect(voltageToColor(10, 0, 10)).toBe('hsl(5, 88%, 48%)');
    expect(voltageToColor(undefined, 0, 10)).toBe('#94a3b8');
    expect(voltageToColor(Number.NaN, 0, 10)).toBe('#94a3b8');
  });

  it('omits the Rp drag handle when the RC transient circuit has no Rp component', () => {
    const params = resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema, {
      topology: 'rc-transient',
      emf: 10,
      internalR: 1,
      r1: 9,
      capacitance: 0.05,
      switchClosed: true
    });
    const state = createInitialState(params);

    expect(circuitDcCapacitorMnaPlugin.getControlHandles?.(state, params)).toEqual([]);
  });

  it('anchors the Rp handle to the right variable resistor and maps vertical dragging to resistance', () => {
    const params = resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema, {
      topology: 'closed-power',
      emf: 12,
      internalR: 2,
      sliderR: 10
    });
    const state = createInitialState(params);
    const handle = circuitDcCapacitorMnaPlugin.getControlHandles?.(state, params)?.[0];

    expect(handle).toBeDefined();
    expect(handle?.position.x).toBeCloseTo(1.7, 2);
    expect(handle?.position.y).toBeCloseTo(0, 2);
    expect(handle?.onDrag({ x: 1.7, y: -0.7 }).sliderR).toBe(0);
    expect(handle?.onDrag({ x: 1.7, y: 0.7 }).sliderR).toBe(20);
  });

  it('exposes the divider-lamp measurement as the first preset and aligns its wiper handle', () => {
    expect(circuitDcCapacitorMnaPlugin.presets[0]?.id).toBe('divider-lamp-measurement');
    const params = resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema, {
      topology: 'divider-lamp',
      sliderR: 10
    });
    const state = createInitialState(params);
    const handle = circuitDcCapacitorMnaPlugin.getControlHandles?.(state, params)?.[0];

    expect(handle?.showWhenIdle).toBe(false);
    expect(handle?.position.x).toBeCloseTo(0.17, 3);
    expect(handle?.position.y).toBeCloseTo(0.167, 3);
    expect(handle?.onDrag({ x: 0.17, y: -1.093 }).sliderR).toBe(0);
    expect(handle?.onDrag({ x: 0.17, y: 1.427 }).sliderR).toBe(20);
  });

  it('keeps the wiper label clear of the top and bottom wires without moving the drag target', () => {
    const top=dividerWiperY(20),bottom=dividerWiperY(0);
    for (const r of [0,.1,1,5,10,15,19,19.9,20]) {
      const anchor=dividerWiperLabelAnchor(r);
      expect(anchor.y-bottom).toBeGreaterThanOrEqual(.279999);
      expect(top-anchor.y).toBeGreaterThanOrEqual(.279999);
      expect(dividerWiperX-anchor.x).toBeCloseTo(.35,12);
    }
    expect(dividerWiperLabelAnchor(10).y).toBeCloseTo(dividerWiperY(10),12);
    expect(dividerWiperY(0)).toBeCloseTo(-1.093,12);
    expect(dividerWiperY(20)).toBeCloseTo(1.427,12);
  });

  it('exports series ammeter, parallel voltmeter and grounded divider with exact endpoints', () => {
    for(const sliderR of [0,10,20]){
      const p=resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema,{topology:'divider-lamp',sliderR});
      const state=createInitialState(p);
      const ir=circuitDcCapacitorMnaPlugin.exportDiagramIR?.(state,p);
      const elements=ir?.primitives.filter(q=>q.kind==='circuitElement')??[];
      const a=elements.find(q=>q.element==='ammeter'),v=elements.find(q=>q.element==='voltmeter'),l=elements.find(q=>q.element==='lamp');
      expect(a?.x2).toBeLessThan(l!.x1);
      expect(a?.y1).toBe(l?.y1);
      expect(v?.y1).toBeGreaterThan(l!.y1);
      expect(v?.x1).toBeGreaterThan(a!.x2);
      expect(elements.filter(q=>q.element==='resistor')).toHaveLength(sliderR===0||sliderR===20?2:3);
      // Independent electrical-net connectivity: union only ideal wires,
      // never a resistor, lamp, or meter. V must share both lamp nets and
      // A's downstream net must share lamp's positive net.
      const parent=new Map<string,string>();
      const key=(x:number,y:number)=>x.toFixed(6)+','+y.toFixed(6);
      const find=(k:string):string=>{const q=parent.get(k);return q&&q!==k?find(q):k;};
      for(const line of ir?.primitives??[])if(line.kind==='line'){
        const k=key(line.x1,line.y1),j=key(line.x2,line.y2);
        parent.set(find(k),find(j));
      }
      const node=(x:number,y:number)=>find(key(x,y));
      expect(node(v!.x1,v!.y1)).toBe(node(l!.x1,l!.y1));
      expect(node(v!.x2,v!.y2)).toBe(node(l!.x2,l!.y2));
      expect(node(a!.x2,a!.y2)).toBe(node(l!.x1,l!.y1));
      expect(node(a!.x1,a!.y1)).toBe(node(.17,dividerWiperY(sliderR)));
      expect(node(a!.x1,a!.y1)).not.toBe(node(a!.x2,a!.y2));
      expect(node(l!.x1,l!.y1)).not.toBe(node(l!.x2,l!.y2));
      expect(circuitDcCapacitorMnaPlugin.getControlHandles?.(state,p)[0]?.position.y).toBeCloseTo(dividerWiperY(sliderR),12);
    }
    expect(dividerPotentialColor(0,12)).toBe('#67e8f9');
    expect(dividerPotentialColor(3,12)).toBe('#d3dbd9');
    expect(dividerPotentialColor(6,12)).toBe('#ffc76f');
    expect(dividerPotentialColor(12,12)).toBe('#ff7d77');
    expect(dividerPotentialColor(0,0)).toBe(dividerPotentialColor(0,12));
  });

  it('shows the nonlinear lamp law for the divider-lamp preset instead of capacitor equations', () => {
    const params = resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema, {
      topology: 'divider-lamp',
      emf: 12,
      internalR: 1,
      sliderR: 10
    });
    const state = createInitialState(params);
    const formula = circuitDcCapacitorMnaPlugin.formatFormulas?.(state, params)[0];

    expect(formula?.latex).toContain('I_L');
    expect(formula?.latex).toContain('0.65');
    expect(formula?.latex).toContain('P_L');
    expect(formula?.latex).not.toContain('U_C');
  });

  it('draws current particles in the signed branch direction and skips zero current', () => {
    const forward = createMockContext();
    drawCurrentParticles(forward, 'test-forward-branch', { x: 0, y: 0 }, { x: 100, y: 0 }, 1, 0);
    expect(forward.rotate).toHaveBeenCalledWith(0);
    expect(forward.fill).toHaveBeenCalled();

    const reverse = createMockContext();
    drawCurrentParticles(reverse, 'test-reverse-branch', { x: 0, y: 0 }, { x: 100, y: 0 }, -1, 0);
    expect(reverse.rotate).toHaveBeenCalledWith(-Math.PI);

    const stopped = createMockContext();
    drawCurrentParticles(stopped, 'test-zero-branch', { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 0.05);
    expect(stopped.fill).not.toHaveBeenCalled();
  });

  it('draws short-circuit glow and a readable warning banner without throwing', () => {
    const ctx = createMockContext();

    expect(() => drawShortCircuitGlow(ctx, { x: 0, y: 0 }, { x: 100, y: 0 }, 250)).not.toThrow();
    expect(() => drawShortCircuitBanner(ctx, 640, 'E 与 Rp 接近短接')).not.toThrow();
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('电路短路'),
      expect.any(Number),
      expect.any(Number)
    );
  });
});


describe('H8 non-divider topology contracts',()=>{
  const get=(overrides:Partial<CircuitParams>)=>resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema,overrides);
  it('matches mixed parallel and bridge net identities, currents, and component counts',()=>{
    for(const topology of ['series-parallel-dynamic','rc-bridge-charge'] as const){
      const p=get({topology,emf:12,internalR:2,r1:4,r2:6,sliderR:3});
      const initial=createInitialState(p),s=topology==='rc-bridge-charge'?stepCircuit(initial,{...p,sliderR:7},.07).nextState:initial;
      const q=topology==='rc-bridge-charge'?{...p,sliderR:7}:p,edges=topologyEdges(s,q);
      const r=edges.find(e=>e.id==='R1')!,rp=edges.find(e=>e.id==='Rp')!;
      if(topology==='series-parallel-dynamic'){
        expect(r.nb).toBe(rp.na);expect(rp.nb).toBe(0);
        expect(s.totalCurrent).toBeCloseTo(1.5,12);expect(s.branchCurrent1).toBeCloseTo(.5,12);expect(s.branchCurrent2).toBeCloseTo(1,12);
        expect(edges.filter(e=>e.kind==='capacitor')).toHaveLength(0);
      }else{
        const cap=edges.find(e=>e.id==='C')!,lb=edges.find(e=>e.id==='R1-bottom')!,rb=edges.find(e=>e.id==='Rp-bottom')!;
        expect([r.nb,rp.nb]).toEqual([cap.na,cap.nb]);
        expect([lb.na,rb.na]).toEqual([cap.na,cap.nb]);expect(lb.nb).toBe(0);expect(rb.nb).toBe(0);
        expect(r.i-lb.i).toBeCloseTo(cap.i,10);expect(rb.i-rp.i).toBeCloseTo(cap.i,10);
        expect(cap.i).not.toBe(0);
        expect(edges.filter(e=>e.kind==='resistor')).toHaveLength(5);
      }
      // Every geometrically shared terminal is one electrical node.
      const nets=new Map<string,number>();
      for(const e of edges)for(const [a,n] of [[e.a,e.na],[e.b,e.nb]] as const){
        const k=a.x+','+a.y;
        if(nets.has(k))expect(nets.get(k)).toBe(n);else nets.set(k,n);
      }
      expect(circuitDcCapacitorMnaPlugin.exportDiagramIR?.(s,q)?.primitives.some(a=>a.kind==='polyline')).toBe(true);
    }
  });
  it('omits the source for discharge, renders negative signed flow, and distinguishes diode from lamp',()=>{
    const p=get({topology:'rc-transient',switchClosed:false,emf:10,r1:9});
    const s=createInitialState(p),edges=topologyEdges(s,p);
    expect(edges.some(e=>e.kind==='battery')).toBe(false);expect(edges.find(e=>e.id==='C')!.i).toBeCloseTo(-10/9,12);
    expect(edges.find(e=>e.id==='R1')!.na).toBe(0);
    const n=get({topology:'nonlinear-lamp-diode',switchClosed:true,emf:5,internalR:.5,sliderR:10});
    for(const closed of [true,false]){
      const q={...n,switchClosed:closed},a=createInitialState(q);
      expect(topologyEdges(a,q).find(e=>e.id==='load')?.kind).toBe(closed?'diode':'lamp');
      const ir=circuitDcCapacitorMnaPlugin.exportDiagramIR?.(a,q);
      expect(ir?.primitives.some(z=>z.kind==='circle'&&!z.fill)).toBe(!closed);
      expect(circuitDcCapacitorMnaPlugin.formatFormulas?.(a,q)[0]?.id).toBe('nonlinear-load');
    }
  });
  it('does not publish fictitious readings for undefined ideal circuits',()=>{
    const p=get({topology:'closed-power',emf:12,internalR:0,sliderR:0}),s=createInitialState(p);
    expect(computeObservables(s)).toEqual({solutionDefined:0});
    expect(circuitDcCapacitorMnaPlugin.formatFormulas?.(s,p)[0]?.id).toBe('ideal-short');
    const n=get({topology:'nonlinear-lamp-diode',emf:5,internalR:0,sliderR:0,switchClosed:true});
    expect(computeObservables(createInitialState(n))).toEqual({solutionDefined:0});
    const lamp=createInitialState({...n,switchClosed:false});
    expect(lamp.terminalVoltage).toBe(5);expect(lamp.totalCurrent).toBeCloseTo(.25*Math.pow(5+1e-6,-.35)*5,12);
    expect(createInitialState({...n,emf:.78}).totalCurrent).toBeCloseTo(1e-12*Math.expm1(30),9);
  });
  it('anchors bridge drag to upper Rp rather than the lower resistor',()=>{
    const p=get({topology:'rc-bridge-charge',sliderR:10}),s=createInitialState(p);
    const h=circuitDcCapacitorMnaPlugin.getControlHandles?.(s,p)?.[0],r=topologyEdges(s,p).find(e=>e.id==='Rp')!;
    expect(h?.position.x).toBe(r.a.x);expect(h?.position.y).toBeCloseTo((r.a.y+r.b.y)/2,12);
    expect(h?.onDrag({x:r.a.x,y:r.b.y}).sliderR).toBe(0);expect(h?.onDrag({x:r.a.x,y:r.a.y}).sliderR).toBe(20);
  });
});
