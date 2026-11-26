import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compRigidRollingSlipPlugin } from './plugin.js';
import { rigidRollingPresets } from './presets.js';
import { createInitialState, stepRigidRollingSlip, rollingQuantities, computeObservables, type RigidRollingParams } from './engine.js';
import { rollingScene, rollingViewBounds, fitRollingViewport } from './geometry.js';

function getPreset(idx: number): RigidRollingParams {
  return resolvePluginParams(compRigidRollingSlipPlugin.paramSchema, rigidRollingPresets[idx]!.params);
}

describe('comp-rigid-rolling-slip hybrid & rotational invariants (C01)', () => {
  it('captures exact solid-sphere tc = 2*v0/(7*mu*g) and vc = 5/7*v0 within < 1e-6 via HybridAutomaton', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    const expectedTc = (2 * p.v0Mps) / (7 * p.muK * 9.8);
    const expectedVc = (5 * p.v0Mps) / 7;

    for (let i = 0; i < 60; i++) {
      st = stepRigidRollingSlip(st, p, 0.05).nextState;
    }
    expect(st.mode).toBe('pure-rolling');
    expect(st.transitionTimeS).not.toBeNull();
    expect(Math.abs(st.transitionTimeS! - expectedTc)).toBeLessThan(1e-6);
    expect(Math.abs(st.transitionSpeedMps! - expectedVc)).toBeLessThan(1e-6);
  });

  it('reproduces backspin bowling return (v < 0) and incline race energy conservation (< 1e-6)', () => {
    const bowl = getPreset(1);
    let stB = createInitialState(bowl);
    for (let i = 0; i < 80; i++) {
      stB = stepRigidRollingSlip(stB, bowl, 0.05).nextState;
    }
    expect(stB.mode).toBe('pure-rolling');
    expect(stB.v).toBeLessThan(0);

    const race = getPreset(2);
    let stR = createInitialState(race);
    for (let i = 0; i < 60; i++) {
      stR = stepRigidRollingSlip(stR, race, 0.05).nextState;
    }
    expect(stR.inclinePositions['solid-sphere']).toBeGreaterThan(stR.inclinePositions['solid-cylinder']);
    expect(stR.inclinePositions['solid-cylinder']).toBeGreaterThan(stR.inclinePositions['hollow-sphere']);
    expect(stR.inclinePositions['hollow-sphere']).toBeGreaterThan(stR.inclinePositions['thin-ring']);
    const eDrift = Math.abs(stR.currentEnergyJ - stR.initialEnergyJ) / (Math.abs(stR.initialEnergyJ) + 1);
    expect(eDrift).toBeLessThan(1e-6);
  });

  it('handles dt=0 cleanly without NaN', () => {
    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepRigidRollingSlip(st, p, 0).nextState.t).toBe(0);
  });

  it('shows signed contact friction and direct initial-condition handles', () => {
    const params = resolvePluginParams(compRigidRollingSlipPlugin.paramSchema, {
      scenario: 'flat-bowling-slip',
      v0Mps: 7,
      omega0Radps: 0
    });
    const state = createInitialState(params);
    const plugin = compRigidRollingSlipPlugin as SimulationPluginV2<typeof params, typeof state>;
    const vectors = plugin.getForceVectors?.(state, params) ?? [];
    const friction = vectors.find((vector) => vector.id === 'friction');
    const handles = plugin.getControlHandles?.(state, params) ?? [];

    expect(friction?.origin.y).toBeCloseTo(0, 10);
    expect(friction?.force.x).toBeLessThan(0);
    expect(handles.map((handle) => handle.id)).toEqual(['initial-velocity', 'initial-omega']);
    expect(Number(handles[0]?.onDrag({ x: 1.5, y: 0 })['v0Mps'])).toBeGreaterThan(0);

    const rollingParams = { ...params, v0Mps: 1, omega0Radps: 1 / params.radiusM };
    const rollingState = createInitialState(rollingParams);
    const rollingVectors = plugin.getForceVectors?.(rollingState, rollingParams) ?? [];
    expect(rollingVectors.some((vector) => vector.id === 'friction')).toBe(false);
  });
});

describe('C01 independent signed dynamics and diagram contracts (H59 pre-fix)', () => {
  const cases = [
    { shape: 'solid-sphere' as const, c: 2/5, v0Mps: 7, omega0Radps: 0 },
    { shape: 'solid-cylinder' as const, c: 1/2, v0Mps: -5, omega0Radps: 10 },
    { shape: 'hollow-sphere' as const, c: 2/3, v0Mps: 2, omega0Radps: 80 },
    { shape: 'thin-ring' as const, c: 1, v0Mps: 4, omega0Radps: -120 }
  ];
  for (const row of cases) {
    it(`conserves ground-point angular momentum and dissipates only slip energy: ${row.shape}`, () => {
      const p = { ...getPreset(0), shape: row.shape, v0Mps: row.v0Mps, omega0Radps: row.omega0Radps };
      const R = p.radiusM, m = p.massKg, I = row.c*m*R*R;
      const u0 = p.v0Mps - R*p.omega0Radps;
      const tc = Math.abs(u0)/(p.muK*9.8*(1+1/row.c));
      const vc = (p.v0Mps + row.c*R*p.omega0Radps)/(1+row.c);
      const L0 = m*R*p.v0Mps + I*p.omega0Radps;
      const energyLoss = m*row.c*u0*u0/(2*(1+row.c));
      const initial = createInitialState(p);
      const early = stepRigidRollingSlip(initial,p,tc/3).nextState;
      expect(early.mode).toBe('slipping');
      expect(m*R*early.v+I*early.omega).toBeCloseTo(L0,7);
      expect(early.currentEnergyJ).toBeLessThan(initial.currentEnergyJ);
      const final = stepRigidRollingSlip(initial,p,tc+0.4).nextState;
      expect(final.mode).toBe('pure-rolling');
      expect(final.transitionTimeS).toBeCloseTo(tc,7);
      expect(final.v).toBeCloseTo(vc,7);
      expect(final.omega*R).toBeCloseTo(vc,7);
      expect(m*R*final.v+I*final.omega).toBeCloseTo(L0,6);
      expect(initial.currentEnergyJ-final.currentEnergyJ).toBeCloseTo(energyLoss,6);
      const after = stepRigidRollingSlip(final,p,0.6).nextState;
      expect(after.currentEnergyJ).toBeCloseTo(final.currentEnergyJ,8);
      expect(after.x-final.x).toBeCloseTo(0.6*vc,8);
    });
  }

  it('force overlay matches the actual acceleration even for very small nonzero slip', () => {
    const p = { ...getPreset(0), v0Mps: 1, omega0Radps: (1-0.0005)/getPreset(0).radiusM };
    const s = createInitialState(p);
    expect(s.mode).toBe('slipping');
    const dt=1e-6;
    const next=stepRigidRollingSlip(s,p,dt).nextState;
    const f=compRigidRollingSlipPlugin.getForceVectors?.(s,p)?.find(v=>v.id==='friction');
    expect(f).toBeDefined();
    expect(f!.force.x).toBeCloseTo(p.massKg*(next.v-s.v)/dt,6);
    expect(f!.force.x*(s.v-s.omega*p.radiusM)).toBeLessThan(0);
  });

  it('exports a signed velocity rather than a fixed rightward arrow for backward motion', () => {
    const p = { ...getPreset(0), v0Mps: -4, omega0Radps: 0 };
    const s = createInitialState(p);
    const d = compRigidRollingSlipPlugin.exportDiagramIR!(s,p);
    const arrow = d.primitives.find(v=>v.kind==='arrow' && v.label === 'v');
    expect(arrow?.kind).toBe('arrow');
    if (arrow?.kind==='arrow') expect(arrow.x2-arrow.x1).toBeLessThan(0);
  });

  it('represents the four distinct incline competitors and a nonhorizontal track in SVG geometry', () => {
    const p = getPreset(2);
    const s = stepRigidRollingSlip(createInitialState(p),p,1).nextState;
    const d = compRigidRollingSlipPlugin.exportDiagramIR!(s,p);
    expect(d.primitives.filter(v=>v.kind==='circle').length).toBeGreaterThanOrEqual(4);
    const tracks=d.primitives.filter(v=>v.kind==='hatchedGround');
    expect(tracks.some(v=>v.kind==='hatchedGround' && Math.abs(v.y2-v.y1)>1e-4)).toBe(true);
  });
});

describe('F10 independent boundary and display consistency',()=>{
  it('does not invent friction or a lock when kinetic friction vanishes',()=>{
    const p={...getPreset(0),muK:0,v0Mps:-3,omega0Radps:18};
    const a=createInitialState(p),b=stepRigidRollingSlip(a,p,4).nextState,q=rollingQuantities(b,p);
    expect(b.mode).toBe('slipping');expect(b.transitionTimeS).toBeNull();expect(b.events).toHaveLength(0);
    expect(b.v).toBe(-3);expect(b.omega).toBe(18);expect(b.x).toBeCloseTo(-12,10);
    expect(b.theta).toBeCloseTo(72,10);expect(q.heat).toBe(0);expect(q.predictedTime).toBeNull();
    expect(b.currentEnergyJ).toBeCloseTo(a.currentEnergyJ,10);
    expect(compRigidRollingSlipPlugin.getForceVectors!(b,p).some(f=>f.id==='friction')).toBe(false);
  });
  it('integrates positive dissipation, with exactly one lock and partition-independent final state',()=>{
    const p=getPreset(1),R=p.radiusM,m=p.massKg,c=.4,u=p.v0Mps-R*p.omega0Radps,A=p.muK*9.8*(1+1/c),tc=Math.abs(u)/A;
    const a=createInitialState(p),t=tc*.41,b=stepRigidRollingSlip(a,p,t).nextState;
    const Q=p.muK*m*9.8*(Math.abs(u)*t-.5*A*t*t);
    expect(rollingQuantities(b,p).heat).toBeCloseTo(Q,8);expect(b.currentEnergyJ+Q).toBeCloseTo(a.currentEnergyJ,8);
    const end=tc+.37,whole=stepRigidRollingSlip(a,p,end).nextState;
    let split=a;for(let i=0;i<113;i++)split=stepRigidRollingSlip(split,p,end/113).nextState;
    expect(split.events).toHaveLength(1);expect(whole.events).toHaveLength(1);
    expect(split.x).toBeCloseTo(whole.x,6);expect(split.theta).toBeCloseTo(whole.theta,6);
    expect(split.v).toBeCloseTo(whole.v,7);expect(split.transitionTimeS!).toBeCloseTo(tc,7);
    const obs=computeObservables(split,p);
    expect(obs.translationalEnergyJ!+obs.rotationalEnergyJ!+obs.dissipatedEnergyJ!).toBeCloseTo(a.currentEnergyJ,7);
  });
  for(const shape of ['solid-sphere','solid-cylinder','hollow-sphere','thin-ring'] as const){
    it('matches actual static friction, tangent geometry, and torque at steep incline: '+shape,()=>{
      const p={...getPreset(2),shape,inclineDeg:45,muK:0};
      const c=shape==='solid-sphere'?.4:shape==='solid-cylinder'?.5:shape==='hollow-sphere'?2/3:1;
      const s=stepRigidRollingSlip(createInitialState(p),p,2).nextState,q=rollingQuantities(s,p),sc=rollingScene(s,p);
      const a=9.8*Math.sin(Math.PI/4)/(1+c),f=-c*p.massKg*a;
      expect(s.v).toBeCloseTo(2*a,10);expect(q.f).toBeCloseTo(f,10);expect(q.acceleration).toBeCloseTo(a,10);
      expect(q.angularAcceleration*p.radiusM).toBeCloseTo(a,10);expect(q.requiredStaticMu).toBeCloseTo(c/(1+c),10);
      expect(q.vEnergy+q.wEnergy+q.pEnergy).toBeCloseTo(0,9);
      const vec=compRigidRollingSlipPlugin.getForceVectors!(s,p).find(v=>v.id==='friction')!;
      expect(vec.force.x*sc.tangent.x+vec.force.y*sc.tangent.y).toBeCloseTo(f,10);
      expect(vec.origin).toEqual(sc.selected.contact);
      expect(compRigidRollingSlipPlugin.referenceFrames![0]!.getOrigin(s,p)).toEqual(sc.selected.center);
      expect(sc.bodies).toHaveLength(4);
      for(const b of sc.bodies){
        const dx=b.center.x-b.contact.x,dy=b.center.y-b.contact.y;
        expect(Math.hypot(dx,dy)).toBeCloseTo(b.radius,10);
        expect(dx*sc.tangent.x+dy*sc.tangent.y).toBeCloseTo(0,10);
        expect((b.trackEnd.y-b.trackStart.y)/(b.trackEnd.x-b.trackStart.x)).toBeCloseTo(-1,10);
        expect((b.contact.x-b.trackStart.x)*sc.normal.x+(b.contact.y-b.trackStart.y)*sc.normal.y).toBeCloseTo(0,10);
        expect(Math.hypot(b.contact.x-b.trackStart.x,b.contact.y-b.trackStart.y)/Math.hypot(b.trackEnd.x-b.trackStart.x,b.trackEnd.y-b.trackStart.y)).toBeCloseTo(b.distance/sc.raceExtent,10);
      }
    });
  }
  it('uses a translated metric window without falsifying displacement or contact position',()=>{
    const p=getPreset(0),s=stepRigidRollingSlip(createInitialState(p),p,40).nextState,sc=rollingScene(s,p);
    expect(sc.selected.contact.x+sc.windowOrigin).toBeCloseTo(s.x,10);
    expect(sc.selected.center.y).toBeCloseTo(p.radiusM,10);
    expect(sc.selected.contact.y).toBe(0);expect(Math.abs(sc.selected.center.x)).toBeLessThan(2);
    const f=compRigidRollingSlipPlugin.getForceVectors!(s,p).find(v=>v.id==='normal')!;
    expect(f.origin).toEqual(sc.selected.contact);
  });
  it('filters controls by physical mode and exposes signed initial rotation drag',()=>{
    const p=getPreset(0),a=createInitialState(p),handles=compRigidRollingSlipPlugin.getControlHandles!(a,p);
    expect(handles[1]!.onDrag({x:.2,y:0}).omega0Radps).toBeLessThan(0);
    const race=getPreset(2),keys=compRigidRollingSlipPlugin.getParamFields!(race).map(f=>f.key);
    expect(keys).not.toContain('muK');expect(keys).not.toContain('v0Mps');expect(keys).toContain('inclineDeg');
    expect(compRigidRollingSlipPlugin.getParamFields!(p).map(f=>f.key)).not.toContain('inclineDeg');
  });
});

describe('F10 viewport fits actual unoccluded space (H61)',()=>{
  for(const scenario of ['flat-bowling-slip','incline-race'] as const){
    it('fits '+scenario+' into desktop safe rectangle and full offline stage without distortion',()=>{
      const p={...getPreset(0),scenario};
      for(const [width,height,safe] of [
        [1392,852,{left:30,right:1080,top:28,bottom:672}],
        [1060,640,{left:26,right:1034,top:28,bottom:612}]
      ] as const){
        const v={width,height,dpr:1,scale:1,offsetX:0,offsetY:0};
        const fitted=fitRollingViewport(p,v,safe)!;
        const b=rollingViewBounds(p,fitted);
        expect(b.left).toBeGreaterThanOrEqual(safe.left-1e-8);
        expect(b.right).toBeLessThanOrEqual(safe.right+1e-8);
        expect(b.top).toBeGreaterThanOrEqual(safe.top-1e-8);
        expect(b.bottom).toBeLessThanOrEqual(safe.bottom+1e-8);
        expect((b.left+b.right)/2).toBeCloseTo((safe.left+safe.right)/2,9);
        expect((b.top+b.bottom)/2).toBeCloseTo((safe.top+safe.bottom)/2,9);
        expect((b.right-b.left)/(b.bottom-b.top)).toBeCloseTo(4.56/(scenario==='incline-race'?4.8:3.58),9);
        expect(Math.max((b.right-b.left)/(safe.right-safe.left),(b.bottom-b.top)/(safe.bottom-safe.top))).toBeCloseTo(1,9);
      }
    });
  }
  it('rejects an empty safe rectangle',()=>{
    expect(fitRollingViewport(getPreset(0),{width:800,height:500,dpr:1,scale:1,offsetX:0,offsetY:0},{left:20,right:10,top:0,bottom:100})).toBeNull();
  });
});
