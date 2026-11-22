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
