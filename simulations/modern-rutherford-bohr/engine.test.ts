import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { modernRutherfordBohrPlugin } from './plugin.js';
import { rutherfordBohrPresets } from './presets.js';
import {
  solveBohrTransitions,
  solveRutherfordScattering,
  stepRutherfordBohr,
  createInitialState,
  type RutherfordBohrParams
} from './engine.js';

function getPreset(idx: number): RutherfordBohrParams {
  return resolvePluginParams(modernRutherfordBohrPlugin.paramSchema, rutherfordBohrPresets[idx]!.params);
}

describe('modern-rutherford-bohr physics invariants (N02)', () => {
  it('matches Rutherford analytical scattering angle (< 1e-4 rad) and conserves energy (< 1e-6) using ScaleContext + RK45', () => {
    for (const bFm of [15, 25, 50]) {
      const r = solveRutherfordScattering(5.0, 79, bFm);
      expect(r.angleErrorRad).toBeLessThan(1e-4);
      expect(r.energyDriftRel).toBeLessThan(1e-6);
    }
  });

  it('reproduces first 4 Balmer wavelengths within < 0.2 nm and distinguishes photon vs electron excitation', () => {
    const bohrEnsemble = solveBohrTransitions(getPreset(1));
    expect(bohrEnsemble.totalCombinationLines).toBe(15);
    expect(bohrEnsemble.maxSingleAtomLines).toBe(5);

    const nistBalmerNm: Record<number, number> = {
      3: 656.28,
      4: 486.13,
      5: 434.05,
      6: 410.17
    };
    for (const upper of [3, 4, 5, 6]) {
      const line = bohrEnsemble.spectralLines.find((l) => l.upperN === upper && l.lowerN === 2)!;
      expect(Math.abs(line.wavelengthNm - nistBalmerNm[upper]!)).toBeLessThan(0.2);
    }

    const photonOffRes = solveBohrTransitions({ ...getPreset(2), probeKind: 'photon', probeEnergyEv: 12.5 });
    expect(photonOffRes.excitationAccepted).toBe(false);

    const electronRes = solveBohrTransitions(getPreset(2));
    expect(electronRes.excitationAccepted).toBe(true);
    expect(electronRes.reachedLevel).toBe(3);
    expect(Math.abs(electronRes.residualElectronEv - (12.5 - 12.08888888888889))).toBeLessThan(1e-6);
  });

  it('handles zero impact parameter and dt=0 cleanly without NaN', () => {
    const headOn = solveRutherfordScattering(5.0, 79, 0);
    expect(headOn.simulatedAngleDeg).toBe(180);
    const p = getPreset(0);
    const st = createInitialState(p);
    expect(stepRutherfordBohr(st, p, 0).nextState.t).toBe(0);
  });
});
