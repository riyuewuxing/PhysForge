import { describe, expect, it } from 'vitest';
import { runParameterSweep } from '@physforge/analysis-lab/sweep';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { compileSafeFormula, preloadMathjsCompiler } from './safeAstCompiler.js';
import {
  computeObservables,
  createInitialState,
  stepCustomOde,
  type CustomOdeParams
} from './engine.js';
import { builderCustomOdeLabPlugin } from './plugin.js';

describe('B5 builder-custom-ode-lab verification', () => {
  it('rejects 100% of malicious or prototype-pollution expressions cleanly after lazy mathjs@15.2+ load', async () => {
    await preloadMathjsCompiler();

    const maliciousPayloads = [
      'constructor.constructor("return process")()',
      'x.__proto__.polluted = 1',
      'import("node:fs")',
      'process.exit(1)',
      'eval("1+1")',
      'createUnit("hack", "1 m")',
      'unknownVar * 2',
      'x[0] + 1',
      Array.from({ length: 90 }, () => 'x').join(' + ')
    ];

    for (const payload of maliciousPayloads) {
      expect(() => compileSafeFormula(payload)).toThrow();
    }

    const safe = compileSafeFormula('-(k * x + 2 * x^3) / m');
    expect(safe.evaluate({ x: 1, k: 4, m: 2 })).toBeCloseTo(-3, 12);
  }, 20000);

  it('conserves Kepler energy and angular momentum < 1e-5 and executes 50-step headless ParameterSweep', () => {
    const kepParams = resolvePluginParams<CustomOdeParams>(builderCustomOdeLabPlugin.paramSchema, {
      template: 'kepler-2d',
      stiffness: 6.0,
      initialPos: 1.4,
      initialVel: 1.7
    });

    let state = createInitialState(kepParams);
    const e0 = state.initialEnergy;
    const l0 = state.initialAngularMom;
    const dt = 0.005;
    for (let i = 0; i < 1200; i++) {
      state = stepCustomOde(state, kepParams, dt).nextState;
    }
    const obs = computeObservables(state, kepParams);
    expect(Math.abs(obs.energy! - e0) / Math.abs(e0)).toBeLessThan(1e-5);
    expect(Math.abs(obs.angularMomentum! - l0) / Math.abs(l0)).toBeLessThan(1e-6);

    // 50-step parameter sweep over stiffness k in harmonic-custom
    const sweepValues = Array.from({ length: 50 }, (_, i) => 2 + i * 0.5);
    const sweep = runParameterSweep(builderCustomOdeLabPlugin, {
      paramKey: 'stiffness',
      values: sweepValues,
      baseParams: { template: 'harmonic-custom', damping: 0, driveAmp: 0, initialPos: 1, initialVel: 0 },
      steps: 40,
      dt: 0.01
    });
    expect(sweep.points).toHaveLength(50);
  });
});
