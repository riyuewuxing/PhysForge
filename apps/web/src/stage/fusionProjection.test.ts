import { describe, it, expect } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { stseTokamakMagneticMirrorPlugin, fusionDisplayPoint } from '@physforge/simulations/stse-tokamak-magnetic-mirror';
import type { TokamakMirrorParams } from '../../../../simulations/stse-tokamak-magnetic-mirror/engine.js';
import { CameraMorphController, alignedCanvasViewport } from './cameraMorphController.js';

describe('S01 shared physical projection', () => {
  it.each(['tokamak', 'magnetic-mirror'] as const)('%s particle, FBD and orthographic handoff agree', mode => {
    const p = stseTokamakMagneticMirrorPlugin, params = resolvePluginParams<TokamakMirrorParams>(p.paramSchema, { mode });
    let s = p.engine.createInitialState(params);
    for (let i = 0; i < 20; i++) s = p.engine.step(s, params, 1/240).nextState;
    const world = fusionDisplayPoint(s.position, mode);
    const f = p.getForceVectors?.(s, params)[0];
    expect(f?.origin.x).toBe(world.x); expect(f?.origin.y).toBe(world.y);
    const a = fusionDisplayPoint({
      x: (s.velocity.y*s.bField.z-s.velocity.z*s.bField.y)*params.qOverM,
      y: (s.velocity.z*s.bField.x-s.velocity.x*s.bField.z)*params.qOverM,
      z: (s.velocity.x*s.bField.y-s.velocity.y*s.bField.x)*params.qOverM
    }, mode);
    expect(f?.force.x).toBeCloseTo(a.x, 10); expect(f?.force.y).toBeCloseTo(a.y, 10);
    const camera = new CameraMorphController(p.spatial3D, 1280, 720); camera.startMorphTo(1, 0, 0);
    const a2 = camera.project3DToScreen(world);
    const b = createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(world.x, world.y);
    expect(Math.hypot(a2.x-b.x, a2.y-b.y)).toBeLessThan(0.5);
    const handle = p.getControlHandles?.(s, params)[0];
    expect(handle?.position.x).toBe(mode === 'tokamak' ? params.majorRadiusM : params.coilHalfSpanM);
    expect(p.referenceFrames?.[0]?.getOrigin(s, params)).toEqual(world);
  });
});
