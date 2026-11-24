import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { emInductionDoubleRodPlugin, rodDisplayX } from '@physforge/simulations/em-induction-double-rod';
import { createPlanarFlagshipScene, inductionDisplayPoint } from './planarFlagshipScenes.js';
import { CameraMorphController, alignedCanvasViewport } from './cameraMorphController.js';

describe('flagship physical display alignment', () => {
  it('shares the moving E04 origin between actual rod, force and flat projection', () => {
    const p = emInductionDoubleRodPlugin;
    const params = resolvePluginParams(p.paramSchema, { externalForce: 2 });
    const initial = p.engine.createInitialState(params);
    const state = { ...initial, x1: 8.2, x2: 7 };
    const x = rodDisplayX(state, state.x1);
    const force = p.getForceVectors?.(state, params)[0];
    expect(force?.origin.x).toBe(x);
    expect(p.getControlHandles?.(state, params)[0]?.origin?.x).toBe(x);
    const camera = new CameraMorphController(p.spatial3D, 1280, 720);
    camera.startMorphTo(1, 0, 0);
    const world = inductionDisplayPoint(state, state.x1);
    const projected = camera.project3DToScreen(world);
    const canvas = createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(x, 0);
    expect(Math.hypot(canvas.x - projected.x, canvas.y - projected.y)).toBeLessThan(0.5);
  });
  it('removes the owned Three scene graph on dispose', () => {
    const scene = new THREE.Scene();
    const driver = createPlanarFlagshipScene('em-induction-double-rod', scene);
    expect(driver).not.toBeNull();
    const p = emInductionDoubleRodPlugin;
    const params = resolvePluginParams(p.paramSchema);
    driver?.sync(p.engine.createInitialState(params), params, new Set(p.layers.map(layer => layer.id)));
    expect(scene.children.length).toBe(1);
    driver?.dispose();
    expect(scene.children.length).toBe(0);
  });
});
