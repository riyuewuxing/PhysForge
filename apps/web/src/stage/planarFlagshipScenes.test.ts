import * as THREE from 'three';
import type { InductionParams } from '../../../../simulations/em-induction-double-rod/engine.js';
import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { emInductionDoubleRodPlugin, rodDisplayX } from '@physforge/simulations/em-induction-double-rod';
import { emBoundedMagneticFieldPlugin } from '../../../../simulations/em-bounded-magnetic-field/plugin.js';
import type { BoundedMagneticParams } from '../../../../simulations/em-bounded-magnetic-field/engine.js';
import { createPlanarFlagshipScene, inductionDisplayPoint } from './planarFlagshipScenes.js';
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
  it('renders opposite Ampere forces, reverses current, and stops pulses at zero current', () => {
    const scene = new THREE.Scene();
    const driver = createPlanarFlagshipScene('em-induction-double-rod', scene);
    const p = emInductionDoubleRodPlugin;
    const params = resolvePluginParams<InductionParams>(p.paramSchema, { rodMode: 'double', magneticB: 1, railWidth: 1, railWidth2: 1 });
    const state = { ...p.engine.createInitialState(params), current: 2 };
    const layers = new Set(p.layers.map(layer => layer.id));
    driver?.sync(state, params, layers);
    const f1 = scene.getObjectByName('induction-ampere-1');
    const f2 = scene.getObjectByName('induction-ampere-2');
    const arrow = scene.getObjectByName('induction-current-0');
    const pulse = scene.getObjectByName('induction-charge-pulse-0');
    expect(f1?.visible).toBe(true);
    expect(f2?.visible).toBe(true);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(f1!.quaternion).x).toBeCloseTo(-1);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(f2!.quaternion).x).toBeCloseTo(1);
    const before = pulse!.position.clone();
    driver?.sync({ ...state, qTotalIntegral: state.qTotalIntegral + 0.5 }, params, layers);
    expect(pulse!.position.distanceTo(before)).toBeGreaterThan(0);
    driver?.sync({ ...state, current: -2 }, params, layers);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(arrow!.quaternion).z).toBeCloseTo(1);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(f1!.quaternion).x).toBeCloseTo(1);
    driver?.sync({ ...state, current: 0 }, params, layers);
    expect(arrow?.visible).toBe(false);
    expect(pulse?.visible).toBe(false);
    expect(f1?.visible).toBe(false);
    expect(f2?.visible).toBe(false);
    driver?.dispose();
  });

  it('uses the battery current convention consistently with the engine force', () => {
    const scene = new THREE.Scene();
    const driver = createPlanarFlagshipScene('em-induction-double-rod', scene);
    const p = emInductionDoubleRodPlugin;
    const params = resolvePluginParams<InductionParams>(p.paramSchema, { rodMode: 'single', circuitLoad: 'battery', magneticB: 1, railWidth: 1 });
    const state = { ...p.engine.createInitialState(params), current: 2 };
    driver?.sync(state, params, new Set(['rods', 'forceVectors', 'currentFlow']));
    const f1 = scene.getObjectByName('induction-ampere-1');
    const f2 = scene.getObjectByName('induction-ampere-2');
    const arrow = scene.getObjectByName('induction-current-0');
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(f1!.quaternion).x).toBeCloseTo(1);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(arrow!.quaternion).z).toBeCloseTo(1);
    expect(f2?.visible).toBe(false);
    driver?.dispose();
  });

  it('uses both widths for the motional emf and force overlays', () => {
    const p = emInductionDoubleRodPlugin;
    const params = resolvePluginParams<InductionParams>(p.paramSchema, { rodMode: 'double', magneticB: 1, railWidth: 1, railWidth2: 0.5 });
    const state = { ...p.engine.createInitialState(params), v1: 4, v2: 2, current: 2 };
    const forces = p.getForceVectors?.(state, params);
    expect(forces?.find(f => f.id === 'ampere-1')?.force.x).toBe(-2);
    expect(forces?.find(f => f.id === 'ampere-2')?.force.x).toBe(1);
    expect(p.formatFormulas?.(state, params)[0]?.substitutedLatex).toContain('=3.00');
  });

  it('shows only boundary events reported by the particle engine', () => {
    const scene = new THREE.Scene();
    const driver = createPlanarFlagshipScene('builder-composite-em-field', scene);
    const p = emBoundedMagneticFieldPlugin;
    const params = resolvePluginParams<BoundedMagneticParams>(p.paramSchema, { mode: 'circular', family: 'single' });
    const state = p.engine.createInitialState(params);
    const track = state.particles[0]!;
    const layers = new Set(['trajectory', 'fieldRegion']);
    driver?.sync(state, params, layers);
    const exit = scene.getObjectByName('magnetic-exit-' + track.id);
    expect(exit?.visible).toBe(false);
    driver?.sync({ ...state, particles: [{ ...track, hasEntered: true, hasExited: true, entryPoint: { x: -1, y: 0 }, exitPoint: { x: 1, y: 0 } }] }, params, layers);
    const entry = scene.getObjectByName('magnetic-entry-' + track.id);
    expect(entry?.visible).toBe(true);
    expect(exit?.visible).toBe(true);
    expect(exit?.position.x).toBe(1);
    driver?.sync(state, params, new Set());
    expect(exit?.visible).toBe(false);
    driver?.dispose();
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
