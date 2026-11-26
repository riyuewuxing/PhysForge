import { resolvePluginParams, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compRigidRollingSlipPlugin } from './plugin.js';
import { rigidRollingPresets } from './presets.js';
import { createInitialState, stepRigidRollingSlip, type RigidRollingParams } from './engine.js';

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
