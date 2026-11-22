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
});
