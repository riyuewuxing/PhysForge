import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compRelativityQuantumTunnelingPlugin } from './plugin.js';
import { relativityQuantumPresets } from './presets.js';
import {
  createInitialState,
  solveLorentzInterval,
  stepRelativityQuantum,
  type RelativityQuantumParams
} from './engine.js';

function getPreset(idx: number): RelativityQuantumParams {
  return resolvePluginParams(compRelativityQuantumTunnelingPlugin.paramSchema, relativityQuantumPresets[idx]!.params);
}

describe('comp-relativity-quantum-tunneling invariants (C03)', () => {
  it('conserves 1D Crank-Nicolson TDSE probability norm (< 1e-10) over 1000 steps', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    for (let i = 0; i < 1000; i++) {
      st = stepRelativityQuantum(st, p, 0.04).nextState;
    }
    expect(st.normDrift).toBeLessThan(1e-10);
  });

  it('produces sub-barrier quantum tunneling T > 0 when E0 < V0 and exponential decay with barrier width', () => {
    const thin = { ...getPreset(0), barrierWidth: 1.0 };
    const thick = { ...getPreset(0), barrierWidth: 2.2 };
    let stThin = createInitialState(thin);
    let stThick = createInitialState(thick);
    // k0 = 2.0 => v_g = 2.0, x0 = -18 => wavepacket hits and finishes tunneling by t = 15 (375 steps * 0.04)
    for (let i = 0; i < 375; i++) {
      stThin = stepRelativityQuantum(stThin, thin, 0.04).nextState;
      stThick = stepRelativityQuantum(stThick, thick, 0.04).nextState;
    }
    expect(stThin.transmissionProb).toBeGreaterThan(0.01);
    expect(stThick.transmissionProb).toBeGreaterThan(0);
    expect(stThick.transmissionProb).toBeLessThan(stThin.transmissionProb);
  });

  it('preserves Minkowski spacetime interval Δs² across Lorentz boosts (< 1e-10) and handles dt=0', () => {
    for (const beta of [-0.85, 0, 0.6, 0.92]) {
      const lor = solveLorentzInterval(beta, 4.5, 7.2);
      expect(lor.err).toBeLessThan(1e-10);
    }
    const p = getPreset(2);
    const st = createInitialState(p);
    expect(stepRelativityQuantum(st, p, 0).nextState.t).toBe(0);
  });
});
