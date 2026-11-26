import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { stseEmLaunchRegenBrakePlugin } from './plugin.js';
import { emLaunchRegenPresets } from './presets.js';
import {
  computeAnalyticPureEmStopDistance,
  createInitialState,
  stepEmLaunchRegen,
  type EmLaunchRegenParams
} from './engine.js';

function getPreset(idx: number): EmLaunchRegenParams {
  return resolvePluginParams(stseEmLaunchRegenBrakePlugin.paramSchema, emLaunchRegenPresets[idx]!.params);
}

describe('stse-em-launch-regen-brake invariants (S03)', () => {
  it('maintains global energy ledger residual < 1e-6 J for both capacitor and constant-current railgun', () => {
    for (const driveMode of ['capacitor-pulse', 'constant-current'] as const) {
      const p: EmLaunchRegenParams = { ...getPreset(0), driveMode };
      let st = createInitialState(p);
      for (let i = 0; i < 40; i++) {
        st = stepEmLaunchRegen(st, p, 0.02).nextState;
      }
      expect(st.v).toBeGreaterThan(1);
      expect(st.ledgerResidualJ).toBeLessThan(1e-6);
    }
  });

  it('matches pure EM braking momentum theorem total stopping distance within < 1e-6 and energy ledger < 1e-6', () => {
    const p = getPreset(1);
    const expectedX = computeAnalyticPureEmStopDistance(p);
    let st = createInitialState(p);
    // Run > 18 time constants until v drops below 1e-8 * v0
    for (let i = 0; i < 600; i++) {
      st = stepEmLaunchRegen(st, p, 0.05).nextState;
    }
    const relDistErr = Math.abs(st.x - expectedX) / expectedX;
    expect(relDistErr).toBeLessThan(1e-6);
    expect(st.ledgerResidualJ).toBeLessThan(1e-6);
  });

  it('handles dt=0 cleanly without NaN', () => {
    const p = getPreset(2);
    const st = createInitialState(p);
    expect(stepEmLaunchRegen(st, p, 0).nextState.t).toBe(0);
  });
});

describe('H52 F06 independent regenerative-braking regressions',()=>{
  it('uses the closed-circuit initial current at the same initial physical state',()=>{
    const p=getPreset(1),s=createInitialState(p);
    const expected=p.bFieldT*p.trackSpanM*p.v0Mps/(p.circuitResOhm+p.loadResOhm);
    expect(s.currentA).toBeCloseTo(expected,10);
    const force=stseEmLaunchRegenBrakePlugin.getForceVectors!(s,p).find(f=>f.id==='em-ampere');
    expect(force?.force.x).toBeLessThan(0);
  });
  it('exports a backward braking arrow and shares the displayed vehicle center',()=>{
    const p=getPreset(1),s=stepEmLaunchRegen(createInitialState(p),p,.2).nextState;
    const ir=stseEmLaunchRegenBrakePlugin.exportDiagramIR!(s,p);
    const body=ir.primitives.find(x=>x.kind==='block');
    const f=ir.primitives.find(x=>x.kind==='arrow'&&x.label==='F_em');
    const actual=stseEmLaunchRegenBrakePlugin.getForceVectors!(s,p).find(x=>x.id==='em-ampere');
    expect(body?.kind).toBe('block');expect(f?.kind).toBe('arrow');
    if(body?.kind!=='block'||f?.kind!=='arrow'||!actual)throw Error('missing geometry');
    expect(f.x2).toBeLessThan(f.x1);
    expect(f.x1).toBeCloseTo(body.cx,10);
    expect(body.cx).toBeCloseTo(actual.origin.x,10);
  });
  it('shows the limiting distance only for pure electromagnetic braking, not as finite stopping',()=>{
    const pure=getPreset(1),mixed=getPreset(2);
    const p=stseEmLaunchRegenBrakePlugin.formatFormulas!(createInitialState(pure),pure);
    const m=stseEmLaunchRegenBrakePlugin.formatFormulas!(createInitialState(mixed),mixed);
    expect(p.some(f=>f.id==='regen-pure-limit'&&f.label.includes('极限'))).toBe(true);
    expect(m.some(f=>f.id==='regen-pure-limit'||f.latex.includes('x_{\\text{停}}'))).toBe(false);
    expect(m.some(f=>f.id==='regen-energy-budget')).toBe(true);
  });
  it('exposes the full regenerative energy budget, distinguishing load transfer from losses',()=>{
    const p=getPreset(2),s=stepEmLaunchRegen(createInitialState(p),p,.5).nextState;
    const o=stseEmLaunchRegenBrakePlugin.engine.computeObservables(s,p);
    expect(o.energyInitialKj).toBeCloseTo(s.energyInitialJ/1000,10);
    expect(o.energyJouleKj).toBeCloseTo(s.energyJouleJ/1000,10);
    expect(o.energyDragMechKj).toBeCloseTo(s.energyDragMechJ/1000,10);
    expect(o.energyRegenKj).toBeCloseTo(s.energyRegenJ/1000,10);
    expect(o.energyKineticKj!+o.energyRegenKj!+o.energyJouleKj!+o.energyDragMechKj!).toBeCloseTo(o.energyInitialKj!,8);
  });
  it('keeps launch-only inputs outside the regenerative-braking control panel',()=>{
    const p=getPreset(1);
    const fields=stseEmLaunchRegenBrakePlugin.getParamFields?.(p)??stseEmLaunchRegenBrakePlugin.paramSchema;
    const keys=fields.map(f=>f.key);
    expect(keys).toContain('loadResOhm');
    expect(keys).toContain('v0Mps');
    expect(keys).not.toContain('capVoltageV');
    expect(keys).not.toContain('driveCurrentA');
  });
});
