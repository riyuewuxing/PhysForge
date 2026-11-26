import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { stseGravityAssistRendezvousPlugin } from './plugin.js';
import { gravityAssistPresets } from './presets.js';
import {
  createInitialState,
  stepGravityAssistRendezvous,
  type GravityAssistRendezvousParams
} from './engine.js';

function getPreset(idx: number): GravityAssistRendezvousParams {
  return resolvePluginParams(stseGravityAssistRendezvousPlugin.paramSchema, gravityAssistPresets[idx]!.params);
}

describe('stse-gravity-assist-rendezvous invariants (S04)', () => {
  it('conserves planet-frame encounter speed (< 1e-5) while speeding up trailing vs slowing down leading flybys', () => {
    const trailing = getPreset(0);
    let stT = createInitialState(trailing);
    for (let i = 0; i < 120; i++) {
      stT = stepGravityAssistRendezvous(stT, trailing, 0.1).nextState;
    }
    expect(stT.planetFrameSpeedRelErr).toBeLessThan(1e-5);
    expect(stT.helioEnergyCurrent - stT.helioEnergyInitial).toBeGreaterThan(0.05);

    const leading = getPreset(1);
    let stL = createInitialState(leading);
    for (let i = 0; i < 120; i++) {
      stL = stepGravityAssistRendezvous(stL, leading, 0.1).nextState;
    }
    expect(stL.planetFrameSpeedRelErr).toBeLessThan(1e-5);
    expect(stL.helioEnergyCurrent - stL.helioEnergyInitial).toBeLessThan(-0.05);
  });

  it('proves prograde boost lags further behind after one target period while retro drop catches up', () => {
    const prograde = getPreset(2);
    let stP = createInitialState(prograde);
    const totalTime = 2 * Math.PI;
    const steps = 200;
    for (let i = 0; i < steps; i++) {
      stP = stepGravityAssistRendezvous(stP, prograde, totalTime / steps).nextState;
    }
    expect(stP.chaserAngleRad).toBeLessThan(2 * Math.PI - 0.1);

    const retro: GravityAssistRendezvousParams = { ...prograde, rendezvousBurn: 'retro-lower-catchup' };
    let stR = createInitialState(retro);
    for (let i = 0; i < steps; i++) {
      stR = stepGravityAssistRendezvous(stR, retro, totalTime / steps).nextState;
    }
    expect(stR.chaserAngleRad).toBeGreaterThan(stP.chaserAngleRad);
  });

  it('handles dt=0 cleanly without NaN', () => {
    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepGravityAssistRendezvous(st, p, 0).nextState.t).toBe(0);
  });

  it('provides a signed impact-parameter aiming handle and planet-frame origin/velocity', () => {
    const params = getPreset(0);
    const state = createInitialState(params);
    const frames = stseGravityAssistRendezvousPlugin.referenceFrames ?? [];
    const planetFrame = frames.find((frame) => frame.id === 'planet-frame');
    const heliocentric = frames.find((frame) => frame.id === 'heliocentric');
    const handle = stseGravityAssistRendezvousPlugin.getControlHandles?.(state, params)
      .find((item) => item.id === 'impact-parameter');

    expect(planetFrame?.getOrigin(state, params)).toEqual({ x: state.planetPos.x * 0.5, y: state.planetPos.y * 0.5 });
    expect(planetFrame?.getVelocity?.(state, params)).toEqual({ x: state.planetVel.x * 0.5, y: state.planetVel.y * 0.5 });
    expect(heliocentric?.getOrigin(state, params)).toEqual({ x: 0, y: 0 });
    expect(handle).toBeDefined();
    expect(handle?.onDrag({ x: handle.position.x, y: 0.7 })['flybySide']).toBe('leading');
    expect(handle?.onDrag({ x: handle.position.x, y: -0.7 })['flybySide']).toBe('trailing');
  });
});

describe('H53 F07 independent educational state/representation regressions',()=>{
  it('preserves the target initial phase in both coordinates and reported angle',()=>{
    const p=getPreset(2),a=createInitialState(p);
    const b=stepGravityAssistRendezvous(a,p,.1).nextState;
    expect(b.targetAngleRad-a.targetAngleRad).toBeCloseTo(.1,10);
    expect(b.planetPos.x).toBeCloseTo(Math.cos(b.targetAngleRad),10);
    expect(b.planetPos.y).toBeCloseTo(Math.sin(b.targetAngleRad),10);
    expect(b.planetVel.x).toBeCloseTo(-Math.sin(b.targetAngleRad),10);
    expect(b.planetVel.y).toBeCloseTo(Math.cos(b.targetAngleRad),10);
  });
  it('uses actual angular separation for the first target-period observation',()=>{
    const p=getPreset(2),a=createInitialState(p);
    let b=a;
    for(let i=0;i<200;i++)b=stepGravityAssistRendezvous(b,p,a.targetOrbitPeriod/200).nextState;
    expect(b.chaserPhaseLagAfterPeriod).not.toBeNull();
    expect(b.chaserPhaseLagAfterPeriod!).toBeCloseTo(b.targetAngleRad-b.chaserAngleRad,6);
  });
  it('does not present finite-radius encounter speed as an asymptotic velocity',()=>{
    const p=getPreset(0),a=createInitialState(p);
    const o=stseGravityAssistRendezvousPlugin.engine.computeObservables(a,p);
    expect(o.relativeSpeed).toBeCloseTo(Math.hypot(a.vel.x-a.planetVel.x,a.vel.y-a.planetVel.y),10);
    expect(o.relativeSpecificEnergy).toBeCloseTo(.5*o.relativeSpeed!**2-p.muPlanet/Math.hypot(a.pos.x-a.planetPos.x,a.pos.y-a.planetPos.y),10);
    const f=stseGravityAssistRendezvousPlugin.formatFormulas!(a,p);
    expect(f.some(x=>x.label.includes('局部二体'))).toBe(true);
    expect(f.some(x=>x.latex.includes('v}_{\\infty}'))).toBe(false);
  });
  it('keeps the two teaching modes separate and the planet marker in its actual world reference frame',()=>{
    const a=getPreset(0),b=getPreset(2);
    const fields=(p:GravityAssistRendezvousParams)=>(stseGravityAssistRendezvousPlugin.getParamFields?.(p)??stseGravityAssistRendezvousPlugin.paramSchema).map(f=>f.key);
    expect(fields(a)).not.toContain('rendezvousBurn');
    expect(fields(b)).not.toContain('impactParam');
    expect(fields(b)).not.toContain('muPlanet');
    const state=createInitialState(a);
    const frame=stseGravityAssistRendezvousPlugin.referenceFrames!.find(f=>f.id==='planet-frame')!;
    expect(frame.getOrigin(state,a)).toEqual(state.planetPos);
    expect(frame.getVelocity!(state,a)).toEqual(state.planetVel);
  });
});
