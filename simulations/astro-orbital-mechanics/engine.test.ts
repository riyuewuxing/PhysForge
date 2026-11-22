import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { astroOrbitalMechanicsPlugin } from './plugin.js';
import { astroOrbitalPresets } from './presets.js';
import {
  buildAstroScaleContext,
  computeLagrangePoints,
  computeObservables,
  createInitialState,
  stepAstroOrbital,
  type AstroOrbitalParams
} from './engine.js';

function getPreset(idx: number): AstroOrbitalParams {
  return resolvePluginParams(astroOrbitalMechanicsPlugin.paramSchema, astroOrbitalPresets[idx]!.params);
}

describe('astro-orbital-mechanics ScaleContext & symplectic invariants (M10)', () => {
  it('conserves energy, semi-major axis (<1e-6), and angular momentum (<1e-7) over 50 full orbital periods', () => {
    const params = getPreset(0);
    let state = createInitialState(params);
    const obs0 = computeObservables(state, params);
    const a0 = obs0.semiMajorAxisNorm!;
    const periodNorm = 2 * Math.PI * Math.pow(a0, 1.5);
    const totalSimTime = 50 * periodNorm;

    const dt = 0.25;
    const steps = Math.ceil(totalSimTime / dt);
    for (let i = 0; i < steps; i++) {
      state = stepAstroOrbital(state, params, dt).nextState;
    }

    const obsEnd = computeObservables(state, params);
    const relEnergyDrift = Math.abs(obsEnd.energyNorm! - state.energyNorm0) / Math.abs(state.energyNorm0);
    const relAxisDrift = Math.abs(obsEnd.semiMajorAxisNorm! - a0) / a0;
    const relLzDrift = Math.abs(obsEnd.angularMomNorm! - state.angularMomNorm0) / Math.abs(state.angularMomNorm0);

    expect(relEnergyDrift).toBeLessThan(1e-6);
    expect(relAxisDrift).toBeLessThan(1e-6);
    expect(relLzDrift).toBeLessThan(1e-7);
  });

  it('executes Hohmann dual-burn transfer matching analytical deltaV (<1e-5) and circularizes at r2', () => {
    const params = getPreset(1);
    const { muSI, r1SI } = buildAstroScaleContext(params);
    const rho = params.r2OverR1;
    const r2SI = rho * r1SI;
    const expectedDv1 = Math.sqrt(muSI / r1SI) * (Math.sqrt((2 * rho) / (1 + rho)) - 1);
    const expectedDv2 = Math.sqrt(muSI / r2SI) * (1 - Math.sqrt(2 / (1 + rho)));

    let state = createInitialState(params);
    const tHalf = Math.PI * Math.pow((1 + rho) / 2, 1.5);
    const steps = Math.ceil((tHalf + 0.5) / 0.05);
    for (let i = 0; i < steps; i++) {
      state = stepAstroOrbital(state, params, 0.05).nextState;
    }

    expect(state.hohmannPhase).toBe('circularized');
    expect(Math.abs(state.deltaV1SI - expectedDv1) / expectedDv1).toBeLessThan(1e-5);
    expect(Math.abs(state.deltaV2SI - expectedDv2) / expectedDv2).toBeLessThan(1e-5);

    const obs = computeObservables(state, params);
    expect(obs.eccentricity!).toBeLessThan(1e-4);
    expect(Math.abs(obs.rNorm! - rho)).toBeLessThan(1e-4);
  });

  it('finds restricted 3-body Lagrange points L1-L5 with zero effective-potential gradient and finite boundaries', () => {
    const q = 0.05;
    const pts = computeLagrangePoints(q);
    expect(pts).toHaveLength(5);
    const mu1 = 1 - q;
    const mu2 = q;
    for (const lp of pts) {
      const r1 = Math.hypot(lp.x + q, lp.y);
      const r2 = Math.hypot(lp.x - (1 - q), lp.y);
      const gx = lp.x - (mu1 * (lp.x + q)) / r1 ** 3 - (mu2 * (lp.x - (1 - q))) / r2 ** 3;
      const gy = lp.y - (mu1 * lp.y) / r1 ** 3 - (mu2 * lp.y) / r2 ** 3;
      expect(Math.hypot(gx, gy)).toBeLessThan(1e-9);
    }

    const p0 = getPreset(3);
    const s0 = createInitialState(p0);
    expect(stepAstroOrbital(s0, p0, 0).nextState).toEqual(s0);
  });
});
