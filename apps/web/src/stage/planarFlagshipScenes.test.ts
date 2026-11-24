import * as THREE from 'three';
import type { InductionParams } from '../../../../simulations/em-induction-double-rod/engine.js';
import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { emInductionDoubleRodPlugin, rodDisplayX } from '@physforge/simulations/em-induction-double-rod';
import {inductionDiagramGeometry,inductionDiagramCurrent,inductionFieldPoints,inductionLoadDimensions} from '../../../../simulations/em-induction-double-rod/diagramGeometry.js';
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

  it('matches both actual rod endpoints and connected unequal-width leads in the flattened view and export',()=>{
    const p=emInductionDoubleRodPlugin,params=resolvePluginParams<InductionParams>(p.paramSchema,{rodMode:'double',railWidth:1.2,railWidth2:0.6});
    const state=p.engine.createInitialState(params),g=inductionDiagramGeometry(state,params);
    expect(g.schematicStep).toBe(true);
    expect(g.rod1.end.y-g.rod1.start.y).toBeCloseTo(1.2);
    expect(g.rod2.end.y-g.rod2.start.y).toBeCloseTo(0.6);
    expect(g.rails).toHaveLength(6);
    expect(g.rails[0]!.end).toEqual(g.rails[1]!.start);
    expect(g.rails[1]!.end).toEqual(g.rails[2]!.start);
    const scene=new THREE.Scene(),driver=createPlanarFlagshipScene(p.meta.id,scene)!;
    driver.sync(state,params,new Set(['rods','railsAndField','currentFlow']));
    const camera=new CameraMorphController(p.spatial3D,1280,720);camera.startMorphTo(1,0,0);
    const mapper=createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics()));
    for(const [index,seg] of [g.rod1,g.rod2].entries()){
      const rod=scene.getObjectByName('induction-rod-'+(index+1))!;
      rod.updateMatrixWorld(true);
      for(const [local,point] of [[0.5,seg.start],[-0.5,seg.end]] as const){
        const q=camera.project3DToScreen(rod.localToWorld(new THREE.Vector3(0,0,local)));
        const expected=mapper.toScreen(point.x,point.y);
        expect(Math.hypot(q.x-expected.x,q.y-expected.y)).toBeLessThan(0.5);
      }
    }
    const rail=scene.getObjectByName('induction-rail-1')!;
    driver.sync({...state,x2:state.x2+0.1},params,new Set(['rods','railsAndField']));
    expect(scene.getObjectByName('induction-rail-1')).toBe(rail);
    const ir=p.exportDiagramIR?.(state,params);
    expect(ir?.primitives.filter(item=>item.kind==='line')).toHaveLength(8);
    expect(inductionFieldPoints({...params,magneticB:0})).toHaveLength(0);
    driver.dispose();
  });
  it('shows battery and capacitor terminals without drawing a conductor through their gap',()=>{
    const p=emInductionDoubleRodPlugin,scene=new THREE.Scene(),driver=createPlanarFlagshipScene(p.meta.id,scene)!;
    const params=resolvePluginParams<InductionParams>(p.paramSchema,{rodMode:'single',circuitLoad:'battery',railWidth:0.5});
    const state={...p.engine.createInitialState(params),current:2,qTotalIntegral:3};
    expect(inductionDiagramCurrent(state,params)).toEqual({current:-2,charge:-3});
    const layers=new Set(['rods','railsAndField','currentFlow']);
    driver.sync(state,params,layers);
    const {halfGap}=inductionLoadDimensions(params.railWidth);
    const upper=scene.getObjectByName('load-upper-plate') as THREE.Mesh<THREE.BoxGeometry>;
    const lower=scene.getObjectByName('load-lower-plate') as THREE.Mesh<THREE.BoxGeometry>;
    expect(upper.position.z).toBeCloseTo(-halfGap);
    expect(lower.position.z).toBeCloseTo(halfGap);
    expect(upper.geometry.parameters.width).toBeGreaterThan(lower.geometry.parameters.width);
    expect(scene.getObjectByName('load-resistor')).toBeUndefined();
    driver.sync(state,{...params,circuitLoad:'capacitor'},layers);
    const a=scene.getObjectByName('load-upper-plate') as THREE.Mesh<THREE.BoxGeometry>;
    const b=scene.getObjectByName('load-lower-plate') as THREE.Mesh<THREE.BoxGeometry>;
    expect(a.geometry.parameters.width).toBe(b.geometry.parameters.width);
    driver.sync(state,{...params,circuitLoad:'resistor'},layers);
    expect(scene.getObjectByName('load-upper-plate')).toBeUndefined();
    expect(scene.getObjectByName('load-resistor')).toBeDefined();
    driver.dispose();
  });
  it('shows only boundary events reported by the particle engine', () => {
    const scene = new THREE.Scene();
    const driver = createPlanarFlagshipScene('builder-composite-em-field', scene);
    const p = emBoundedMagneticFieldPlugin;
    const params = resolvePluginParams<BoundedMagneticParams>(p.paramSchema, { mode: 'circular', family: 'single' });
    const state = p.engine.createInitialState(params);
    const track = state.particles[0]!;
    const layers = new Set(['trajectory', 'fieldRegion','eventPins']);
    driver?.sync(state, params, layers);
    const exit = scene.getObjectByName('magnetic-exit-' + track.id);
    expect(exit?.visible).toBe(false);
    driver?.sync({ ...state, particles: [{ ...track, hasEntered: true, hasExited: true, entryPoint: { x: -1, y: 0 }, exitPoint: { x: 1, y: 0 } }] }, params, layers);
    const entry = scene.getObjectByName('magnetic-entry-' + track.id);
    expect(entry?.visible).toBe(true);
    expect(exit?.visible).toBe(true);
    expect(exit?.position.x).toBe(1);
    driver?.sync({ ...state, particles: [{ ...track, hasExited: true, exitPoint: { x: 1, y: 0 } }] },params,new Set(['trajectory']));
    expect(exit?.visible).toBe(false);
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
