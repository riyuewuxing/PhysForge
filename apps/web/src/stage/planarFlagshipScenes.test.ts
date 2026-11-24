import * as THREE from 'three';
import type { InductionParams } from '../../../../simulations/em-induction-double-rod/engine.js';
import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { emInductionDoubleRodPlugin, rodDisplayX } from '@physforge/simulations/em-induction-double-rod';
import { stseEmDevicesSuitePlugin } from '../../../../simulations/stse-em-devices-suite/plugin.js';
import { astroOrbitalMechanicsPlugin } from '../../../../simulations/astro-orbital-mechanics/plugin.js';
import { stseTokamakMagneticMirrorPlugin } from '../../../../simulations/stse-tokamak-magnetic-mirror/plugin.js';
import type { EmDevicesParams } from '../../../../simulations/stse-em-devices-suite/engine.js';
import type { AstroOrbitalParams } from '../../../../simulations/astro-orbital-mechanics/engine.js';
import type { TokamakMirrorParams } from '../../../../simulations/stse-tokamak-magnetic-mirror/engine.js';
import { createPlanarFlagshipScene, inductionDisplayPoint, deviceDisplayPoint, astroDisplayPoint } from './planarFlagshipScenes.js';
import { CameraMorphController, alignedCanvasViewport } from './cameraMorphController.js';

describe('flagship physical display alignment', () => {
  it('shares the moving E04 origin between actual rod, force and flat projection', () => {
    const p = emInductionDoubleRodPlugin;
    const params = resolvePluginParams<InductionParams>(p.paramSchema, { externalForce: 2 });
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
    const params = resolvePluginParams<InductionParams>(p.paramSchema);
    driver?.sync(p.engine.createInitialState(params), params, new Set(p.layers.map(layer => layer.id)));
    expect(scene.children.length).toBe(1);
    driver?.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('Wave 4A flagship alignment', () => {
  it('projects S02 carrier through exactly the existing normalized Canvas mapping', () => {
    const p = stseEmDevicesSuitePlugin, params = resolvePluginParams<EmDevicesParams>(p.paramSchema, { device: 'cyclotron' });
    const state = p.engine.createInitialState(params), point = state.particlePos;
    const camera = new CameraMorphController(p.spatial3D, 1280, 720);
    camera.startMorphTo(1, 0, 0);
    const projected = camera.project3DToScreen(deviceDisplayPoint(point));
    const canvas = createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(-0.25 + 0.7 * point.x, 0.7 * point.y);
    expect(Math.hypot(canvas.x - projected.x, canvas.y - projected.y)).toBeLessThan(0.5);
    const scene = new THREE.Scene(), driver = createPlanarFlagshipScene(p.meta.id, scene);
    expect(driver).not.toBeNull();
    driver?.sync(state, params, new Set(['main']));
    driver?.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('projects M10 normalized orbit and rotates binary coordinates consistently', () => {
    const p = astroOrbitalMechanicsPlugin, params = resolvePluginParams<AstroOrbitalParams>(p.paramSchema, { mode: 'binary-lagrange' });
    const state = p.engine.createInitialState(params), point = {x: state.xNorm, y: state.yNorm}, angle = -0.7;
    const x = point.x * Math.cos(angle) - point.y * Math.sin(angle);
    const y = point.x * Math.sin(angle) + point.y * Math.cos(angle);
    const camera = new CameraMorphController(p.spatial3D, 1024, 768);
    camera.startMorphTo(1, 0, 0);
    const projected = camera.project3DToScreen(astroDisplayPoint(point, angle));
    const canvas = createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(x,y);
    expect(Math.hypot(canvas.x - projected.x, canvas.y - projected.y)).toBeLessThan(0.5);
    const scene = new THREE.Scene(), driver = createPlanarFlagshipScene(p.meta.id, scene);
    expect(driver).not.toBeNull();
    driver?.sync(state, params, new Set(['orbit', 'corotatingView']));
    driver?.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('projects S01 physical x,z into the same force and reference origin', () => {
    const p = stseTokamakMagneticMirrorPlugin, params = resolvePluginParams<TokamakMirrorParams>(p.paramSchema);
    const state = p.engine.createInitialState(params);
    const camera = new CameraMorphController(p.spatial3D, 900, 650);
    camera.startMorphTo(1, 0, 0);
    const point = new THREE.Vector3(state.position.x, state.position.z, state.position.y);
    const projected = camera.project3DToScreen(point);
    const canvas = createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(state.position.x, state.position.z);
    expect(Math.hypot(canvas.x - projected.x, canvas.y - projected.y)).toBeLessThan(0.5);
    expect(p.getForceVectors?.(state, params)[0]?.origin).toEqual({x: state.position.x, y: state.position.z});
  });
});
