import * as THREE from 'three';
import type { InductionParams } from '../../../../simulations/em-induction-double-rod/engine.js';
import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolvePluginParams } from '@physforge/sim-sdk';
import { emInductionDoubleRodPlugin, rodDisplayX } from '@physforge/simulations/em-induction-double-rod';
import {inductionDiagramGeometry,inductionDiagramCurrent,inductionFieldPoints,inductionLoadDimensions} from '../../../../simulations/em-induction-double-rod/diagramGeometry.js';
import { emBoundedMagneticFieldPlugin,b1FrameBounds,b1SafeRect } from '../../../../simulations/em-bounded-magnetic-field/plugin.js';
import type { BoundedMagneticParams } from '../../../../simulations/em-bounded-magnetic-field/engine.js';
import { createPlanarFlagshipScene, inductionDisplayPoint, fitB1SpatialFrame,b1ProjectionFits } from './planarFlagshipScenes.js';
import { stseTokamakMagneticMirrorPlugin,fusionFramePoints,fusionSafeRect,fusionScreenFits,fitFusionFlatViewport,fusionFlatScreenBounds } from '../../../../simulations/stse-tokamak-magnetic-mirror/plugin.js';
import { fitFusionSpatialFrame,projectFusionFrame } from './fusionFraming.js';
import { CameraMorphController, alignedCanvasViewport } from './cameraMorphController.js';

describe('flagship physical display alignment', () => {
  it('frames S01 real coils, toroidal depth, escaped particle and velocity endpoints inside safe regions',()=>{
    const plugin=stseTokamakMagneticMirrorPlugin;
    for(const mode of ['magnetic-mirror','tokamak'] as const){
      const params=resolvePluginParams(plugin.paramSchema,{mode,pitchAngleDeg:22});
      const initial=plugin.engine.createInitialState(params);
      const state=plugin.engine.step(initial,params,1.35).nextState;
      const layers=new Set(['conductors','fieldLines3d','velocityComponents','eventPins']);
      const points=fusionFramePoints(state,params,layers);
      const before=JSON.stringify(state);
      for(const [width,height] of [[1440,900],[1024,768]] as const){
        for(const presentation of [true,false]){
          const safe=fusionSafeRect(width,height,presentation);
          const camera=new CameraMorphController(plugin.spatial3D,width,height);
          fitFusionSpatialFrame(camera,points,width,height,safe);
          expect(fusionScreenFits(projectFusionFrame(points,camera.getActiveCamera(),width,height),safe)).toBe(true);
          const vp=fitFusionFlatViewport(points,{width,height,dpr:1,scale:1,offsetX:0,offsetY:0},safe);
          expect(fusionScreenFits(fusionFlatScreenBounds(points,vp),safe)).toBe(true);
        }
      }
      expect(JSON.stringify(state)).toBe(before);
    }
  });
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

  it('outlines both ends of the circular B1 field volume and keeps the flat radius aligned', () => {
    const scene = new THREE.Scene();
    const driver = createPlanarFlagshipScene('builder-composite-em-field', scene)!;
    const plugin = emBoundedMagneticFieldPlugin;
    const params = resolvePluginParams<BoundedMagneticParams>(plugin.paramSchema, {
      mode: 'circular', fieldScale: 1.2, magneticFieldZ: 0
    });
    driver.sync(plugin.engine.createInitialState(params), params, new Set(['fieldRegion']));

    const rims = ['b1-field-rim-0', 'b1-field-rim-1'].map(name => scene.getObjectByName(name));
    expect(rims.every((rim): rim is THREE.LineLoop => rim instanceof THREE.LineLoop)).toBe(true);
    scene.updateMatrixWorld(true);
    const camera = new CameraMorphController(plugin.spatial3D, 1280, 720);
    camera.startMorphTo(1, 0, 0);
    const mapper = createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics()));
    for (const [index, z] of [-0.22, 0.22].entries()) {
      const rim = scene.getObjectByName(`b1-field-rim-${index}`) as THREE.LineLoop;
      const vertex = rim.geometry.getAttribute('position');
      expect(vertex.count).toBe(72);
      const world = rim.localToWorld(new THREE.Vector3().fromBufferAttribute(vertex, 0));
      expect(world.z).toBeCloseTo(z, 8);
      expect(Math.hypot(world.x, world.y)).toBeCloseTo(params.fieldScale, 6);
      const spatial = camera.project3DToScreen(world);
      const planar = mapper.toScreen(world.x, world.y);
      expect(Math.hypot(spatial.x - planar.x, spatial.y - planar.y)).toBeLessThan(0.5);
    }

    driver.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('shows B1 drift-frame radius and consistent velocity components without a fake neutral-particle drift',()=>{
    const p=emBoundedMagneticFieldPlugin,params=resolvePluginParams<BoundedMagneticParams>(p.paramSchema,{mode:'crossed-eb',family:'single',electricFieldY:2,magneticFieldZ:1,mass:2,charge:1});
    const initial=p.engine.createInitialState(params),first=initial.particles[0]!;
    const track={...first,state:{...first.state,velocity:{x:2,y:1,z:0}}};
    const state={...initial,particles:[track]},scene=new THREE.Scene(),driver=createPlanarFlagshipScene('builder-composite-em-field',scene)!;
    const layers=new Set(['larmorCircle','velocityVector','speedDecomposition']);
    driver.sync(state,params,layers);
    const center=scene.getObjectByName('magnetic-circle-center-'+track.id)!;
    expect(center.visible).toBe(true);
    expect(center.position.x).toBeCloseTo(track.state.position.x+2);
    expect(scene.getObjectByName('magnetic-radius-'+track.id)?.visible).toBe(true);
    const drift=scene.getObjectByName('magnetic-drift-'+track.id)!;
    const rotation=scene.getObjectByName('magnetic-rotation-'+track.id)!;
    expect(new THREE.Vector3(0,1,0).applyQuaternion(drift.quaternion).x).toBeCloseTo(1);
    expect(new THREE.Vector3(0,1,0).applyQuaternion(rotation.quaternion).y).toBeCloseTo(1);
    driver.sync(state,{...params,charge:0},layers);
    expect(center.visible).toBe(false);expect(drift.visible).toBe(false);expect(rotation.visible).toBe(false);
    driver.dispose();
  });
  it('uses actual B1 trajectory samples and signed field arrows; no fictitious walls in infinite fields',()=>{
    const p=emBoundedMagneticFieldPlugin,params=resolvePluginParams<BoundedMagneticParams>(p.paramSchema,{mode:'half-space',family:'single',magneticFieldZ:-2});
    const scene=new THREE.Scene(),driver=createPlanarFlagshipScene('builder-composite-em-field',scene)!;
    const state=p.engine.step(p.engine.createInitialState(params),params,.8).nextState;
    const layers=new Set(['fieldRegion','trajectory']);
    driver.sync(state,params,layers);
    expect(scene.getObjectByName('b1-halfspace-boundary')).toBeDefined();
    expect(scene.getObjectByName('b1-field-wire')).toBeUndefined();
    const arrow=scene.getObjectByName('b1-field-arrow') as THREE.ArrowHelper;
    expect(new THREE.Vector3(0,1,0).applyQuaternion(arrow.quaternion).z).toBeCloseTo(-1,10);
    const tube=scene.getObjectByName('b1-primary-trajectory') as THREE.Mesh;
    expect(tube.visible).toBe(true);expect(tube.geometry.drawRange.count).toBeGreaterThan(0);
    driver.sync(state,{...params,mode:'crossed-eb',magneticFieldZ:0},new Set(['fieldRegion']));
    expect(scene.getObjectByName('b1-halfspace-boundary')).toBeUndefined();
    expect(scene.getObjectByName('b1-field-wire')).toBeUndefined();
    expect(scene.getObjectByName('b1-field-arrow')).toBeUndefined();
    expect(tube.visible).toBe(false);driver.dispose();
  });
  it('frames real B1 motion in the unoccluded region and leaves full-space field free of a fake solid',()=>{
    const plugin=emBoundedMagneticFieldPlugin;
    const p=resolvePluginParams<BoundedMagneticParams>(plugin.paramSchema,{mode:'crossed-eb',family:'single',initialSpeed:0,magneticFieldZ:2,electricFieldY:3});
    const state=plugin.engine.step(plugin.engine.createInitialState(p),p,3.8).nextState;
    const layers=new Set(['fieldRegion','trajectory','velocityVector','speedDecomposition']);
    const bounds=b1FrameBounds(state,p,layers);
    for(const [width,height] of [[1440,900],[1024,768]] as const){
      const camera=new CameraMorphController(plugin.spatial3D,width,height),safe=b1SafeRect(width,height,true);
      fitB1SpatialFrame(camera,bounds,width,height,safe);
      expect(b1ProjectionFits(bounds,camera.getActiveCamera(),width,height,safe)).toBe(true);
      const position=state.particles[0]!.state.position,screen=camera.project3DToScreen(position);
      expect(screen.x).toBeGreaterThan(safe.left);expect(screen.x).toBeLessThan(safe.right);
      expect(screen.y).toBeGreaterThan(safe.top);expect(screen.y).toBeLessThan(safe.bottom);
      camera.startMorphTo(1,0,0);
      const flat=camera.project3DToScreen(position),mapper=createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics()));
      const actual=mapper.toScreen(position.x,position.y);
      expect(Math.hypot(actual.x-flat.x,actual.y-flat.y)).toBeLessThan(.5);
    }
    const scene=new THREE.Scene(),driver=createPlanarFlagshipScene('builder-composite-em-field',scene)!;
    driver.sync(state,p,layers);
    let glass=0;scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshPhysicalMaterial)glass++;});
    expect(glass).toBe(0);expect(scene.getObjectByName('b1-bounded-field-tint')).toBeUndefined();
    const particle=scene.getObjectByName('b1-particle-0') as THREE.Mesh;
    expect(particle.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((particle.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
    expect(scene.getObjectByName('b1-particle-halo-0')).toBeDefined();
    let arrows=0;scene.traverse(o=>{if(o.name==='b1-field-arrow')arrows++;});
    expect(arrows).toBeGreaterThan(0);expect(arrows).toBeLessThanOrEqual(30);
    driver.dispose();
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
