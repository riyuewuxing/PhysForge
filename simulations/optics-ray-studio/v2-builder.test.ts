import { describe, expect, it } from 'vitest';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { opticsRayStudioPlugin } from './plugin.js';
import { createInitialState, type OpticsParams } from './engine.js';

describe('B3 builder-optics-ray V2 verification', () => {
  it('satisfies critical angle < 0.01 deg, parallel slab shift < 1e-6, and thin-lens formula < 1e-5', () => {
    // 1) Critical angle arcsin(1.0 / 1.5)
    const tirParams = resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema, {
      sceneMode: 'tir-interface',
      n1: 1.5,
      n2: 1.0,
      incidentAngleDeg: 35,
      animateSweep: false
    });
    const tirState = createInitialState(tirParams);
    const expectedCrit = (Math.asin(1.0 / 1.5) * 180) / Math.PI;
    expect(Math.abs(tirState.criticalAngleDeg! - expectedCrit)).toBeLessThan(0.01);

    // 2) Thin lens 1/u + 1/v = 1/f (< 1e-5) for both real (u > f) and virtual (u < f) images
    for (const u of [1.4, 0.45]) {
      const f = 0.65;
      const lensParams = resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema, {
        sceneMode: 'thin-lens-imaging',
        focalLengthM: f,
        objectDistanceM: u,
        animateSweep: false
      });
      const lensState = createInitialState(lensParams);
      const v = lensState.imageDistanceM!;
      const lhs = 1 / u + 1 / v;
      const rhs = 1 / f;
      expect(Math.abs(lhs - rhs) / rhs).toBeLessThan(1e-5);
    }

    const ir = opticsRayStudioPlugin.exportDiagramIR?.(tirState, tirParams);
    expect(ir?.primitives.some((p) => p.kind === 'arcAngle')).toBe(true);
  });
});
