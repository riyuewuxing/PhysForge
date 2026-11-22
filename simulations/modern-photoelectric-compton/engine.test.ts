import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { modernPhotoelectricComptonPlugin } from './plugin.js';
import { photoelectricComptonPresets } from './presets.js';
import {
  E_CHARGE,
  H_PLANCK,
  computePhotocurrentMa,
  createInitialState,
  solveComptonScattering,
  solvePhotoelectric,
  stepPhotoelectricCompton,
  type PhotoelectricComptonParams
} from './engine.js';

function getPreset(idx: number): PhotoelectricComptonParams {
  return resolvePluginParams(modernPhotoelectricComptonPlugin.paramSchema, photoelectricComptonPresets[idx]!.params);
}

describe('modern-photoelectric-compton physics invariants (N01)', () => {
  it('matches cutoff frequency ν0 = W0/h and Einstein stopping voltage e*Uc = hν - W0 within < 1e-10', () => {
    for (const metal of ['Cs', 'Na', 'Zn', 'Pt'] as const) {
      const params: PhotoelectricComptonParams = { ...getPreset(0), cathodeMetal: metal, wavelengthNm: 200 };
      const sol = solvePhotoelectric(params);
      expect(Math.abs(sol.cutoffFreqHz - (sol.workFunctionEv * E_CHARGE) / H_PLANCK) / sol.cutoffFreqHz).toBeLessThan(
        1e-12
      );
      expect(sol.thresholdPassed).toBe(true);
      expect(Math.abs(sol.photonEnergyEv - sol.workFunctionEv - sol.stoppingVoltageV)).toBeLessThan(1e-10);
      expect(computePhotocurrentMa(-sol.stoppingVoltageV, sol, params.intensityRel)).toBe(0);
    }
  });

  it('closes Compton relativistic energy and 2D momentum triangle within < 1e-10 across angles', () => {
    for (const lam of [0.05, 0.071]) {
      for (const deg of [30, 90, 135, 180]) {
        const c = solveComptonScattering(lam, deg);
        expect(c.pxResidualRel).toBeLessThan(1e-10);
        expect(c.pyResidualRel).toBeLessThan(1e-10);
        expect(c.energyResidualRel).toBeLessThan(1e-10);
      }
    }
  });

  it('produces zero photocurrent below threshold and handles dt=0 cleanly', () => {
    const p = getPreset(1);
    const st = createInitialState(p);
    expect(st.photoelectric.thresholdPassed).toBe(false);
    expect(st.photoelectric.currentMa).toBe(0);
    const same = stepPhotoelectricCompton(st, p, 0).nextState;
    expect(same.t).toBe(0);
  });
});
