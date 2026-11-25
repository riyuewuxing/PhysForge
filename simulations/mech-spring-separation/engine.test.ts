import { describe, expect, it } from 'vitest';
import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { mechSpringSeparationPlugin } from './plugin.js';
import {
  checkInvariants,
  createInitialState,
  stepSpringSeparation,
  type SpringSepParams
} from './engine.js';

describe('M08 mech-spring-separation verification', () => {
  it('separates strictly at spring natural length s=0 (normal force < 1e-7 N) and conserves mechanical energy < 1e-5', () => {
    const params: SpringSepParams = {
      mass1: 1.0,
      mass2: 2.0,
      springK: 30,
      inclineDeg: 30,
      initialComp: 1.2,
      externalForce: 0
    };
    let state = createInitialState(params);
    for (let i = 0; i < 1500; i++) {
      state = stepSpringSeparation(state, params, 0.002).nextState;
    }

    expect(state.separated).toBe(true);
    expect(Math.abs(state.separationPosS!)).toBeLessThan(1e-7);
    const ev = state.events.find((e) => e.id.startsWith('sep-'));
    expect(Math.abs(ev?.metrics?.normalForceAtSep ?? 1)).toBeLessThan(1e-6);

    const inv = checkInvariants(state, state, params);
    expect(inv[0]!.measuredError).toBeLessThan(inv[0]!.tolerance);
  });

  it('shows spring and contact forces before separation, then removes the contact pair', () => {
    const params = resolvePluginParams(mechSpringSeparationPlugin.paramSchema, {
      mass1: 1,
      mass2: 2,
      springK: 30,
      inclineDeg: 0,
      initialComp: 1,
      externalForce: 0
    });
    const plugin = mechSpringSeparationPlugin as SimulationPluginV2<typeof params, ReturnType<typeof createInitialState>>;
    let state = createInitialState(params);
    const initialVectors = plugin.getForceVectors?.(state, params) ?? [];

    expect(initialVectors.some((vector) => vector.id === 'spring-1')).toBe(true);
    expect(initialVectors.some((vector) => vector.id === 'contact-12')).toBe(true);
    expect(state.normalForceN).toBeGreaterThan(0);

    for (let i = 0; i < 500 && !state.separated; i++) {
      state = stepSpringSeparation(state, params, 0.01).nextState;
    }
    expect(state.separated).toBe(true);
    expect(state.normalForceN).toBe(0);
    const separatedVectors = plugin.getForceVectors?.(state, params) ?? [];
    expect(separatedVectors.some((vector) => vector.id === 'contact-12')).toBe(false);
    expect(separatedVectors.some((vector) => vector.id === 'contact-21')).toBe(false);
  });
});

describe('H27 unilateral spring contact physical regressions',()=>{
  const p:SpringSepParams={mass1:1,mass2:2,springK:30,inclineDeg:30,initialComp:1.2,externalForce:0};
  it('stops at first approaching recontact rather than passing through the other block',()=>{
    const init=createInitialState(p),r=stepSpringSeparation(init,p,3),s=r.nextState;
    expect(s.separated).toBe(true);expect(s.separationTime).toBeCloseTo(.7375949353217733,8);
    expect(r.halt).toBe(true);expect(s.t).toBeCloseTo(1.6103797957876382,8);
    expect(s.s2-s.s1).toBeGreaterThanOrEqual(-1e-10);expect(s.s2-s.s1).toBeCloseTo(0,9);
    expect(s.v2-s.v1).toBeCloseTo(-3.6548648049950065,7);
    expect(r.events).toHaveLength(2);expect(r.advancedTime).toBeCloseTo(s.t,11);
    expect(stepSpringSeparation(s,p,1).nextState).toBe(s);
  });
  it('retains contact at an exact zero-force turning point without spurious release',()=>{
    const q={...p,initialComp:2*(p.mass1+p.mass2)*9.8*Math.sin(Math.PI/6)/p.springK};
    let s=createInitialState(q);
    for(let i=0;i<1200;i++){
      s=stepSpringSeparation(s,q,1/240).nextState;
      expect(s.separated).toBe(false);expect(s.normalForceN).toBeGreaterThanOrEqual(0);
      expect(s.s1).toBe(s.s2);
    }
  });
  it('distinguishes initial zero force with closing acceleration from actual release',()=>{
    const q={...p,mass2:1,springK:10,initialComp:.4,externalForce:4};
    const s=createInitialState(q);expect(s.separated).toBe(false);
    const r=stepSpringSeparation(s,q,.1).nextState;expect(r.normalForceN).toBeGreaterThan(0);expect(r.s1).toBe(r.s2);
  });
  it('records the initial inadmissible contact event exactly once, without a fictitious zero required force',()=>{
    const q={...p,initialComp:.4,externalForce:30},s=createInitialState(q);
    expect(s.separated).toBe(true);expect(s.events).toHaveLength(1);expect(s.events[0]?.time).toBe(0);
    expect(s.events[0]?.metrics?.requiredNormalForce).toBeCloseTo(-2,12);
    const r=stepSpringSeparation(s,q,.1);expect(r.events).toHaveLength(1);
    expect(stepSpringSeparation(r.nextState,q,.1).events).toHaveLength(0);
    expect(r.nextState.s2-r.nextState.s1).toBeGreaterThan(0);
  });
  it('finds the first separation even when one coarse step spans an entire coupled oscillation',()=>{
    const q={...p,inclineDeg:0,initialComp:1},r=stepSpringSeparation(createInitialState(q),q,2);
    expect(r.nextState.separationTime).toBeCloseTo(Math.PI/(2*Math.sqrt(10)),10);
    expect(r.nextState.s2-r.nextState.s1).toBeGreaterThan(0);expect(r.nextState.t).toBe(2);
  });
});

import { computeObservables,springAnchor } from './engine.js';
import { springDiagram,springCoordinates,springForceVectors,BLOCK_WIDTH,BLOCK_HEIGHT,fitSpringViewport,springBoundsFit } from './diagram.js';
describe('H27 exact dynamics and shared spring geometry',()=>{
  const p:SpringSepParams={mass1:1,mass2:2,springK:30,inclineDeg:30,initialComp:1.2,externalForce:0};
  it('coarse and fine stepping give the same first recontact, without consuming time beyond the collision',()=>{
    const init=createInitialState(p),coarse=stepSpringSeparation(init,p,5).nextState;
    let s=init;for(let i=0;i<1200&&!s.terminal;i++)s=stepSpringSeparation(s,p,1/240).nextState;
    expect(s.terminal).toBe('recontact');expect(coarse.terminal).toBe('recontact');expect(s.t).toBeCloseTo(coarse.t,10);
    expect(s.s1).toBeCloseTo(coarse.s1,10);expect(s.v2).toBeCloseTo(coarse.v2,10);expect(s.events).toHaveLength(2);
    for(const report of checkInvariants(s,init,p))expect(report.passed,report.name).toBe(true);
  });
  it('handles exact initial zero-force equilibrium and outward acceleration separately',()=>{
    const q={...p,mass2:1,springK:10,initialComp:.49,externalForce:4.9};
    const s=stepSpringSeparation(createInitialState(q),q,10).nextState;
    expect(s.separated).toBe(false);expect(s.s1).toBeCloseTo(-.49,12);expect(s.v1).toBeCloseTo(0,12);
    const u={...q,inclineDeg:0},r=stepSpringSeparation(createInitialState(u),u,.2).nextState;
    expect(r.separated).toBe(true);expect(r.separationTime).toBe(0);expect(r.s2-r.s1).toBeGreaterThan(0);
  });
  it('separates in compression with external work, preserving energy and the exact critical force',()=>{
    const q={...p,inclineDeg:0,initialComp:1,externalForce:12},init=createInitialState(q),s=stepSpringSeparation(init,q,2).nextState;
    expect(s.separationTime).toBeCloseTo(Math.acos(3/7)/Math.sqrt(10),11);expect(s.separationPosS).toBeCloseTo(-.2,12);
    expect(s.release?.requiredNormalForce).toBe(0);expect(s.externalWork).toBeCloseTo(12*(s.s2+1),12);
    expect(Math.abs(computeObservables(s,q).energyResidual!)).toBeLessThan(1e-10);
  });
  it('checks the actual mechanical energy, external work and nonnegative gap over 100 oscillations',()=>{
    const q={...p,inclineDeg:0,initialComp:1,externalForce:0},init=createInitialState(q);
    const s=stepSpringSeparation(init,q,100*2*Math.PI/Math.sqrt(30)).nextState;
    expect(s.separated).toBe(true);expect(s.terminal).toBeNull();expect(s.s2-s.s1).toBeGreaterThan(300);
    expect(Math.abs(computeObservables(s,q).energyResidual!)).toBeLessThan(1e-10);
  });
  it('rotates actual block corners, spring endpoints and FBD origins together in Canvas and print',()=>{
    const s=stepSpringSeparation(createInitialState(p),p,1).nextState,d=springDiagram(s,p),{point}=springCoordinates(p);
    const a=d.items.find(i=>i.role==='block1')?.primitive,b=d.items.find(i=>i.role==='block2')?.primitive,coil=d.items.find(i=>i.role==='spring'&&i.primitive.kind==='polyline')?.primitive;
    expect(a?.kind).toBe('polyline');expect(b?.kind).toBe('polyline');expect(coil?.kind).toBe('polyline');
    if(a?.kind!=='polyline'||b?.kind!=='polyline'||coil?.kind!=='polyline')throw Error('geometry');
    expect(a.closed).toBe(true);expect(a.points[0]).toEqual(point(s.s1-BLOCK_WIDTH/2));expect(a.points[2]).toEqual(point(s.s1+BLOCK_WIDTH/2,BLOCK_HEIGHT));
    expect(b.points[0]).toEqual(point(s.s2+BLOCK_WIDTH/2));
    expect(coil.points[0]).toEqual(point(springAnchor(p),BLOCK_HEIGHT/2));expect(coil.points.at(-1)).toEqual(point(s.s1-BLOCK_WIDTH/2,BLOCK_HEIGHT/2));
    const fs=springForceVectors(s,p);expect(fs.find(f=>f.id==='gravity-1')?.origin).toEqual(point(s.s1,BLOCK_HEIGHT/2));
    expect(fs.some(f=>f.id==='contact-12')).toBe(false);
    const ir=mechSpringSeparationPlugin.exportDiagramIR!(s,p);expect(ir.primitives).toContainEqual(a);expect(ir.primitives).toContainEqual(coil);
  });
  it('keeps both blocks and fixed spring anchor inside the safe fitted viewport',()=>{
    const q={...p,inclineDeg:0},s=stepSpringSeparation(createInitialState(q),q,5).nextState;
    const vp={width:1440,height:900,dpr:1,scale:1,offsetX:0,offsetY:0},safe={left:30,right:1120,top:28,bottom:720};
    const fit=fitSpringViewport(s,q,vp,safe)!;expect(springBoundsFit(s,q,fit,safe)).toBe(true);
    expect(s.s2-s.s1).toBeGreaterThan(10);
  });
});
