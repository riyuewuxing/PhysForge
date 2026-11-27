import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compChaosNormalCoriolisPlugin } from './plugin.js';
import { chaosNormalCoriolisPresets } from './presets.js';
import { createInitialState, stepChaosNormalCoriolis, checkInvariants, normalQuantities, coriolisQuantities, computeObservables, type ChaosNormalCoriolisParams } from './engine.js';

import { advancedDiagram, advancedViewBounds, fitAdvancedViewport } from './geometry.js';

function getPreset(idx: number): ChaosNormalCoriolisParams {
  return resolvePluginParams(compChaosNormalCoriolisPlugin.paramSchema, chaosNormalCoriolisPresets[idx]!.params);
}

describe('comp-chaos-normal-coriolis physics invariants (C02)', () => {
  it('conserves double pendulum energy within < 1e-6 over 30s RK45 integration', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    for (let i = 0; i < 600; i++) {
      st = stepChaosNormalCoriolis(st, p, 0.05).nextState;
    }
    expect(st.dpMaxRelDrift).toBeLessThan(1e-6);
  });

  it('matches symmetric and antisymmetric coupled normal-mode frequencies (< 1e-5)', () => {
    const base = getPreset(1);
    for (const [excite, kEff] of [
      ['symmetric', base.springKw],
      ['antisymmetric', base.springKw + 2 * base.springKc]
    ] as const) {
      const p: ChaosNormalCoriolisParams = { ...base, normalExcite: excite };
      let st = createInitialState(p);
      for (let i = 0; i < 400; i++) {
        st = stepChaosNormalCoriolis(st, p, 0.02).nextState;
      }
      expect(st.nmCrossingTimes.length).toBeGreaterThanOrEqual(4);
      const periodMeas = st.nmCrossingTimes[3]! - st.nmCrossingTimes[2]!;
      const omegaMeas = (2 * Math.PI) / periodMeas;
      const omegaExact = Math.sqrt(kEff / p.m1Kg);
      expect(Math.abs(omegaMeas - omegaExact) / omegaExact).toBeLessThan(1e-5);
    }
  });

  it('agrees between rotating-frame Coriolis ODE and rotated inertial trajectory (< 1e-6) and handles dt=0', () => {
    const cor = getPreset(2);
    let stC = createInitialState(cor);
    expect(stepChaosNormalCoriolis(stC, cor, 0).nextState.t).toBe(0);
    for (let i = 0; i < 40; i++) {
      stC = stepChaosNormalCoriolis(stC, cor, 0.05).nextState;
    }
    expect(stC.coriolisDeviation).toBeLessThan(1e-6);
  });

  it('provides two draggable double-pendulum release angles and both declared frame origins', () => {
    const params = getPreset(0);
    const state = createInitialState(params);
    const plugin = compChaosNormalCoriolisPlugin as import('@physforge/sim-sdk').SimulationPluginV2<
      typeof params,
      typeof state
    >;
    const handles = plugin.getControlHandles?.(state, params) ?? [];
    const frames = plugin.referenceFrames ?? [];

    expect(handles.map((handle) => handle.id)).toEqual(['double-pendulum-bob1', 'double-pendulum-bob2']);
    expect(Number(handles[0]?.onDrag({ x: 0.5, y: -0.5 })['theta1Deg'])).toBeCloseTo(45, 0);
    expect(frames.map((frame) => frame.id)).toEqual(['inertial', 'rotating-disk']);
    expect(frames[1]?.getOrigin(state, params)).toEqual({ x: 0, y: 0 });
  });
});


describe('F11 independent mechanics and mode-specific evidence',()=>{
  it('matches the independently diagonalized equal-mass single-excitation solution',()=>{
    const p={...getPreset(1),normalExcite:'single-beat' as const,m1Kg:1.4,m2Kg:1.4,springKw:20,springKc:9};
    let s=createInitialState(p);const t=1.37;
    for(let i=0;i<137;i++)s=stepChaosNormalCoriolis(s,p,.01).nextState;
    const w1=Math.sqrt(p.springKw/p.m1Kg),w2=Math.sqrt((p.springKw+2*p.springKc)/p.m1Kg);
    expect(s.nmVerlet.positions[0]).toBeCloseTo(.4*(Math.cos(w1*t)+Math.cos(w2*t)),4);
    expect(s.nmVerlet.positions[1]).toBeCloseTo(.4*(Math.cos(w1*t)-Math.cos(w2*t)),4);
    expect(s.nmVerlet.velocities[0]).toBeCloseTo(-.4*(w1*Math.sin(w1*t)+w2*Math.sin(w2*t)),3);
    expect(s.nmVerlet.velocities[1]).toBeCloseTo(-.4*(w1*Math.sin(w1*t)-w2*Math.sin(w2*t)),3);
  });
  for(const sign of [-1,1]){
    it('matches rotating-frame position and velocity for signed rotation '+sign,()=>{
      const p={...getPreset(2),diskOmegaRadps:sign*1.7,puckSpeedMps:1.3},s=stepChaosNormalCoriolis(createInitialState(p),p,.83).nextState;
      const t=s.t,w=p.diskOmegaRadps,V=p.puckSpeedMps,C=Math.cos(w*t),S=Math.sin(w*t);
      expect(s.labPos.x).toBeCloseTo(V*t,9);expect(s.labPos.y).toBeCloseTo(0,9);
      const [x,y,vx,vy]=s.rotDirectState;
      expect(x).toBeCloseTo(V*t*C,8);expect(y).toBeCloseTo(-V*t*S,8);
      expect(vx).toBeCloseTo(V*C-w*V*t*S,8);expect(vy).toBeCloseTo(-V*S-w*V*t*C,8);
    });
  }
  it('localizes the first upward Poincare section rather than storing an arbitrary step endpoint',()=>{
    const p={...getPreset(0),theta1Deg:20,theta2Deg:15};
    let coarse=createInitialState(p),fine=createInitialState(p);
    for(let i=0;i<86;i++)coarse=stepChaosNormalCoriolis(coarse,p,.07).nextState;
    for(let i=0;i<8600;i++)fine=stepChaosNormalCoriolis(fine,p,.0007).nextState;
    expect(coarse.poincarePts.length).toBeGreaterThan(0);expect(fine.poincarePts.length).toBeGreaterThan(0);
    expect(Math.abs(coarse.poincarePts[0]!.th2-fine.poincarePts[0]!.th2)).toBeLessThan(.004);
    expect(Math.abs(coarse.poincarePts[0]!.w2-fine.poincarePts[0]!.w2)).toBeLessThan(.004);
  });
  it('uses normal-mode energy invariants that detect an actual corrupted oscillator velocity',()=>{
    const p=getPreset(1),a=createInitialState(p),s=stepChaosNormalCoriolis(a,p,.9).nextState;
    const perturbed={...s,nmVerlet:{...s.nmVerlet,velocities:[s.nmVerlet.velocities[0]!+20,s.nmVerlet.velocities[1]!]}};
    const clean=checkInvariants(s,a,p),bad=checkInvariants(perturbed,a,p);
    expect(clean.some(v=>v.name.includes('双摆'))).toBe(false);
    expect(clean.every(v=>v.passed)).toBe(true);expect(bad.some(v=>!v.passed)).toBe(true);
  });
  it('exports both physical rod lengths and both pendulums rather than one unit rod',()=>{
    const p={...getPreset(0),l1M:1.4,l2M:.7},s=createInitialState(p),d=compChaosNormalCoriolisPlugin.exportDiagramIR!(s,p);
    const lengths=d.primitives.flatMap(v=>v.kind==='line'?[Math.hypot(v.x2-v.x1,v.y2-v.y1)]:[]);
    expect(lengths.filter(l=>Math.abs(l-p.l1M)<1e-8).length).toBeGreaterThanOrEqual(2);
    expect(lengths.filter(l=>Math.abs(l-p.l2M)<1e-8).length).toBeGreaterThanOrEqual(2);
  });
  it('exports three coupled springs and anchors restoring force to the corresponding mass geometry',()=>{
    const p=getPreset(1),s=stepChaosNormalCoriolis(createInitialState(p),p,.31).nextState,d=compChaosNormalCoriolisPlugin.exportDiagramIR!(s,p);
    expect(d.primitives.filter(v=>v.kind==='spring').length).toBe(3);
    const centers=d.primitives.flatMap(v=>v.kind==='block'?[{x:v.cx,y:v.cy}]:v.kind==='rect'?[{x:v.x+v.width/2,y:v.y+v.height/2}]:[]);
    for(const f of compChaosNormalCoriolisPlugin.getForceVectors!(s,p)){
      expect(centers.some(c=>Math.hypot(c.x-f.origin.x,c.y-f.origin.y)<1e-8)).toBe(true);
    }
  });
  it('exports the two Coriolis frames and anchors fictitious accelerations to a rendered puck',()=>{
    const p=getPreset(2),a=createInitialState(p);let s=a;for(let i=0;i<20;i++)s=stepChaosNormalCoriolis(s,p,.04).nextState;
    const d=compChaosNormalCoriolisPlugin.exportDiagramIR!(s,p);
    expect(d.primitives.filter(v=>v.kind==='circle'&&v.r>.4).length).toBeGreaterThanOrEqual(2);
    expect(d.primitives.filter(v=>v.kind==='trajectory'||v.kind==='polyline').length).toBeGreaterThanOrEqual(2);
    const puck=d.primitives.flatMap(v=>v.kind==='circle'&&v.fill?[{x:v.cx,y:v.cy}]:[]);
    const forces=compChaosNormalCoriolisPlugin.getForceVectors!(s,p);
    const [x,y,vx,vy]=s.rotDirectState,w=p.diskOmegaRadps;
    const c=forces.find(f=>f.id==='coriolis-specific')!,cf=forces.find(f=>f.id==='centrifugal-specific')!;
    expect(c.force.x).toBeCloseTo(2*w*vy,8);expect(c.force.y).toBeCloseTo(-2*w*vx,8);
    expect(cf.force.x).toBeCloseTo(w*w*x,8);expect(cf.force.y).toBeCloseTo(w*w*y,8);
    for(const f of forces)expect(puck.some(b=>Math.hypot(b.x-f.origin.x,b.y-f.origin.y)<1e-8)).toBe(true);
  });
  it('does not present unrelated controls or Coriolis formulas in the double-pendulum mode',()=>{
    const p=getPreset(0),s=createInitialState(p),plugin=compChaosNormalCoriolisPlugin;
    const fields=plugin.getParamFields?.(p)??plugin.paramSchema;
    expect(fields.map(f=>f.key)).not.toContain('diskOmegaRadps');
    expect(fields.map(f=>f.key)).not.toContain('springKw');
    const fs=plugin.formatFormulas!(s,p);
    expect(fs.some(f=>f.latex.includes('Omega'))).toBe(false);
    const normal=getPreset(1),nf=plugin.getParamFields?.(normal)??plugin.paramSchema;
    expect(nf.map(f=>f.key)).not.toContain('m2Kg');
    expect(nf.map(f=>f.key)).toContain('m1Kg');
  });
});

describe('H62 physical boundaries and exact event evidence',()=>{
  it('distinguishes both normal waveforms in monochrome and formats scientific formula values',()=>{
    const p=getPreset(1),a=createInitialState(p),s=stepChaosNormalCoriolis(a,p,.2).nextState;
    const paths=advancedDiagram(s,p).primitives.flatMap(v=>v.kind==='trajectory'?[v]:[]);
    expect(paths).toHaveLength(2);expect(paths.map(v=>v.dashed)).toEqual([false,true]);
    expect(advancedDiagram(s,p).primitives.some(v=>v.kind==='text'&&v.text.includes('x₂ 虚线'))).toBe(true);
    const dp=getPreset(0),formula=compChaosNormalCoriolisPlugin.formatFormulas!(createInitialState(dp),dp).find(f=>f.id==='dp-separation')!;
    expect(formula.substitutedLatex).toContain('\\times 10^{-4}');
  });
  it('stores genuine upward section roots with strict time brackets and monotone timestamps',()=>{
    const p={...getPreset(0),theta1Deg:20,theta2Deg:15};
    let s=createInitialState(p);const times:number[]=[];
    for(let j=0;j<100;j++){
      const t0=s.t,r=stepChaosNormalCoriolis(s,p,.07);s=r.nextState;
      for(const e of r.events){expect(e.time).toBeGreaterThanOrEqual(t0);expect(e.time).toBeLessThanOrEqual(s.t+1e-10);times.push(e.time);}
    }
    expect(s.poincarePts.length).toBeGreaterThan(0);
    for(const z of s.poincarePts){
      expect(z.bracketWidth).toBeLessThanOrEqual(1e-7);
      expect(Math.abs(Math.sin(z.th1))).toBeLessThan(1e-6);
      expect(Math.cos(z.th1)).toBeCloseTo(1,8);
      expect(z.w1).toBeGreaterThan(0);
      expect(z.th2).toBeGreaterThanOrEqual(-Math.PI);expect(z.th2).toBeLessThanOrEqual(Math.PI);
    }
    expect(times).toEqual(s.poincarePts.map(z=>z.t));
    for(let j=1;j<times.length;j++)expect(times[j]!).toBeGreaterThan(times[j-1]!);
  });
  it('detects an upward crossing even when the angle starts and ends below the same section in one outer step',()=>{
    const p={...getPreset(0),m1Kg:1,m2Kg:1,l1M:1,l2M:1};
    const base=createInitialState(p),y=[-1e-6,-Math.PI/4,.005,0] as const;
    const a={...base,dpState:y,dpShadow:y};
    const coarse=stepChaosNormalCoriolis(a,p,.01).nextState;
    let fine=a as ReturnType<typeof createInitialState>;
    for(let i=0;i<500;i++)fine=stepChaosNormalCoriolis(fine,p,.00002).nextState;
    expect(coarse.dpState[0]).toBeLessThan(0);
    expect(coarse.poincarePts).toHaveLength(1);
    expect(fine.poincarePts).toHaveLength(1);
    const c=coarse.poincarePts[0]!,f=fine.poincarePts[0]!;
    expect(c.t).toBeGreaterThan(0);expect(c.t).toBeLessThan(.002);
    expect(Math.abs(c.t-f.t)).toBeLessThan(2e-7);
    expect(c.w1).toBeGreaterThan(0);expect(c.bracketWidth).toBeLessThanOrEqual(1e-8);
  });
  it('conserves independently decomposed mode energies at the stiffest legal parameters',()=>{
    const p={...getPreset(1),m1Kg:.5,springKw:60,springKc:40,normalExcite:'single-beat' as const},a=createInitialState(p);let s=a;
    for(let i=0;i<1000;i++){s=stepChaosNormalCoriolis(s,p,.01).nextState;
      const q=normalQuantities(s,p);expect(q.E).toBeCloseTo(q.Es+q.Ea,9);
      expect(checkInvariants(s,a,p).every(r=>r.passed)).toBe(true);
    }
  });
  it('uses exactly equal straight trajectories when Ω=0 and stays at rest when V=0',()=>{
    for(const [w,V] of [[0,1.3],[-3,0],[0,0]] as const){
      const p={...getPreset(2),diskOmegaRadps:w,puckSpeedMps:V},a=createInitialState(p),s=stepChaosNormalCoriolis(a,p,2).nextState,q=coriolisQuantities(s,p);
      expect(q.x).toBeCloseTo(2*V,9);expect(q.y).toBeCloseTo(0,9);
      expect(Math.hypot(q.axC,q.ayC,q.axF,q.ayF)).toBeCloseTo(0,9);
      expect(checkInvariants(s,a,p).every(r=>r.passed)).toBe(true);
    }
  });
  it('keeps independent signed rotating coordinates and physical vector anchors at long times',()=>{
    const p={...getPreset(2),diskOmegaRadps:-1.7,puckSpeedMps:2};let s=createInitialState(p);
    for(let i=0;i<200;i++)s=stepChaosNormalCoriolis(s,p,.05).nextState;
    const d=advancedDiagram(s,p),q=coriolisQuantities(s,p);
    const rings=d.primitives.flatMap(v=>v.kind==='circle'&&!v.fill&&v.r>=1?[v]:[]);
    expect(rings).toHaveLength(2);expect(rings[0]!.r).toBe(rings[1]!.r);
    expect(q.r).toBeCloseTo(20,7);expect(q.positionError).toBeLessThan(1e-6);
    expect(rings[0]!.r).toBeGreaterThan(q.r);
  });
  for(const index of [0,1,2]){
    it('fits all shared geometry with uniform scale, correct telemetry and formula mode '+index,()=>{
      const p=getPreset(index),a=createInitialState(p),s=stepChaosNormalCoriolis(a,p,2).nextState;
      const v={width:1392,height:852,dpr:1,scale:1,offsetX:0,offsetY:0},safe={left:30,right:1080,top:28,bottom:675};
      const next=fitAdvancedViewport(s,p,v,safe)!;
      const b=advancedViewBounds(s,p,next),d=advancedDiagram(s,p);
      expect(b.left).toBeGreaterThanOrEqual(safe.left-1e-8);expect(b.right).toBeLessThanOrEqual(safe.right+1e-8);
      expect(b.top).toBeGreaterThanOrEqual(safe.top-1e-8);expect(b.bottom).toBeLessThanOrEqual(safe.bottom+1e-8);
      expect((b.right-b.left)/(b.bottom-b.top)).toBeCloseTo((d.viewBox.maxX-d.viewBox.minX)/(d.viewBox.maxY-d.viewBox.minY),9);
      const obs=computeObservables(s,p);
      for(const c of compChaosNormalCoriolisPlugin.getTelemetryChannels!(p))expect(Number.isFinite(obs[c.key])).toBe(true);
      expect(compChaosNormalCoriolisPlugin.formatFormulas!(s,p).every(f=>f.id.startsWith(['dp-','nm-','cor-'][index]!))).toBe(true);
    });
  }
});
