import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compChaosNormalCoriolisPlugin } from './plugin.js';
import { chaosNormalCoriolisPresets } from './presets.js';
import { createInitialState, stepChaosNormalCoriolis, checkInvariants, type ChaosNormalCoriolisParams } from './engine.js';

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


describe('F11 independent mechanics and mode-specific evidence (H60 pre-fix, unrun)',()=>{
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
