import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { comptonMomentumVectors, modernPhotoelectricComptonPlugin } from './plugin.js';
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
  it('distinguishes applied voltage from stopping voltage and uses the correct threshold formula', () => {
    const p = {...getPreset(0), wavelengthNm:400, anodeVoltageV:0};
    const s = createInitialState(p);
    expect(s.photoelectric.stoppingVoltageV).toBeCloseTo(0.7396, 3);
    expect(modernPhotoelectricComptonPlugin.getControlHandles?.(s,p)[0]?.label).toBe('U_AK=0.0 V');
    expect(computePhotocurrentMa(-s.photoelectric.stoppingVoltageV,s.photoelectric,p.intensityRel)).toBe(0);
    const below = getPreset(1);
    const st = createInitialState(below);
    const formula = modernPhotoelectricComptonPlugin.formatFormulas?.(st,below)[0];
    expect(formula?.latex).toContain('I=0');
    expect(formula?.latex).not.toContain('U_c');
    expect(formula?.substitutedLatex).not.toContain('U_c');
  });
  it('reports the same saturation asymptote as the plotted response; intensity does not move the stopping point', () => {
    const a = solvePhotoelectric({...getPreset(0), intensityRel:1});
    const b = solvePhotoelectric({...getPreset(0), intensityRel:3});
    expect(computePhotocurrentMa(100,a,1)).toBeCloseTo(a.saturationCurrentMa,10);
    expect(b.saturationCurrentMa/a.saturationCurrentMa).toBeCloseTo(3,10);
    expect(b.stoppingVoltageV).toBe(a.stoppingVoltageV);
  });
  it('uses signed, common-scale momentum vectors in the diagram and keeps Compton axes out of the I–U plot', () => {
    for (const angle of [10,30,90,135,180]) {
      const p = {...getPreset(2), scatterAngleDeg:angle};
      const s = createInitialState(p);
      const v = comptonMomentumVectors(s.compton,angle);
      expect(v.recoil.y).toBeLessThanOrEqual(1e-12);
      expect(v.scattered.y+v.recoil.y).toBeCloseTo(0,9);
      expect(v.scattered.x+v.recoil.x).toBeCloseTo(v.incident.x,9);
      const ir = modernPhotoelectricComptonPlugin.exportDiagramIR?.(s,p);
      const arrows = ir?.primitives.filter(q=>q.kind==='arrow') ?? [];
      expect(arrows).toHaveLength(3);
      expect(arrows.find(q=>q.label==='pe')?.y2).toBeLessThanOrEqual(1e-12);
      expect(arrows.find(q=>q.label==='U_AK (V)')).toBeUndefined();
    }
  });

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
