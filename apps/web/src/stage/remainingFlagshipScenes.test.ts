import * as THREE from 'three';
import {describe,it,expect} from 'vitest';
import {createWorldMapper,resolvePluginParams} from '@physforge/sim-sdk';
import {stseEmDevicesSuitePlugin} from '@physforge/simulations/stse-em-devices-suite';
import {astroOrbitalMechanicsPlugin,orbitDisplayXY,orbitalBurnMarkers,orbitDisplayVelocity} from '@physforge/simulations/astro-orbital-mechanics';
import {magnetic3dDisplayPoint} from '@physforge/simulations/em-3d-magnetic-fields';
import type {EmDevicesParams} from '../../../../simulations/stse-em-devices-suite/engine.js';
import {deviceDiagramPoint,getDeviceSchematic,deeOutline} from '../../../../simulations/stse-em-devices-suite/deviceGeometry.js';
import type {AstroOrbitalParams} from '../../../../simulations/astro-orbital-mechanics/engine.js';
import {CameraMorphController,alignedCanvasViewport} from './cameraMorphController.js';
import {createRemainingFlagshipScene,deviceDisplayPoint,orbitDisplayPoint} from './remainingFlagshipScenes.js';

describe('remaining planar flagship projections',()=>{
  it('S02 projects the actual normalized particle and cleans up all scene children',()=>{
    const p=stseEmDevicesSuitePlugin,params=resolvePluginParams<EmDevicesParams>(p.paramSchema,{device:'cyclotron'});
    const s=p.engine.createInitialState(params),scene=new THREE.Scene(),driver=createRemainingFlagshipScene(p.meta.id,scene)!;
    driver.sync(s,params,new Set(['main']));
    const object=scene.getObjectByName('device-particle')!;
    expect(object.position.distanceTo(deviceDisplayPoint(s.particlePos.x,s.particlePos.y))).toBeLessThan(1e-9);
    const camera=new CameraMorphController(p.spatial3D,1440,900);camera.startMorphTo(1,0,0);
    const a=camera.project3DToScreen(object.position),b=createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(-0.25+0.7*s.particlePos.x,0.7*s.particlePos.y);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(0.5);
    expect(scene.getObjectByName('dee-left')).toBeDefined();
    driver.dispose();expect(scene.children.length).toBe(0);
  });
  it('switches all six S02 device structures and projects their shared schematic geometry',()=>{
    const p=stseEmDevicesSuitePlugin,scene=new THREE.Scene(),driver=createRemainingFlagshipScene(p.meta.id,scene)!;
    const devices=[
      ['velocity-selector','selector-chamber'],['mass-spectrometer','spectrometer-analyzer'],
      ['cyclotron','dee-left'],['hall-sensor','hall-semiconductor'],
      ['mhd-generator','mhd-load'],['em-flowmeter','flowmeter-pipe']
    ] as const;
    const camera=new CameraMorphController(p.spatial3D,1280,800);camera.startMorphTo(1,0,0);
    const mapper=createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics()));
    let previous:string|null=null;
    for(const [device,expected] of devices){
      const params=resolvePluginParams<EmDevicesParams>(p.paramSchema,{device}),state=p.engine.createInitialState(params);
      driver.sync(state,params,new Set(['main']));
      if(previous)expect(scene.getObjectByName(previous)).toBeUndefined();
      previous=expected;
      const diagram=getDeviceSchematic(device);
      for(const part of diagram.parts){
        const object=scene.getObjectByName(part.id);
        expect(object,part.id).toBeDefined();
        const projected=camera.project3DToScreen(object!.position),canvas=mapper.toScreen(part.x,part.y);
        expect(Math.hypot(projected.x-canvas.x,projected.y-canvas.y),part.id).toBeLessThan(0.5);
      }
      const particle=scene.getObjectByName('device-particle')!;
      const q=deviceDiagramPoint(state.particlePos.x,state.particlePos.y);
      expect(particle.position.distanceTo(new THREE.Vector3(q.x,0,-q.y))).toBeLessThan(1e-9);
      const ir=p.exportDiagramIR?.(state,params);
      expect(ir?.primitives.filter(item=>item.kind==='fieldMarker')).toHaveLength(diagram.fields.length);
      expect(ir?.primitives.filter(item=>item.kind==='rect'||item.kind==='polyline')).toHaveLength(diagram.parts.length);
      expect(ir?.primitives.find(item=>item.kind==='circle')).toMatchObject({cx:q.x,cy:q.y});
      const field=scene.getObjectByName('device-field-0')!;
      expect(new THREE.Vector3(0,1,0).applyQuaternion(field.quaternion).y).toBeCloseTo(1);
    }
    driver.dispose();expect(scene.children.length).toBe(0);
  });
  it('D-shaped footprints open into the same central gap',()=>{
    const [left,right]=getDeviceSchematic('cyclotron').parts;
    expect(left&&right).toBeTruthy();
    const l=deeOutline(left!),r=deeOutline(right!);
    expect(Math.max(...l.map(p=>p.x))).toBeCloseTo(-0.29,12);
    expect(Math.min(...r.map(p=>p.x))).toBeCloseTo(-0.21,12);
  });
  it('incident selector forces use positive particle charge, not Hall carrier type',()=>{
    const p=stseEmDevicesSuitePlugin,params=resolvePluginParams<EmDevicesParams>(p.paramSchema,{
      device:'velocity-selector',carrierType:'electron',eFieldVPerM:2e5,bFieldT:1,particleSpeedMps:2e5
    });
    const state=p.engine.createInitialState(params);
    const forces=p.getForceVectors!(state,params);
    expect(forces[0]!.force.y).toBeGreaterThan(0);
    expect(forces[1]!.force.y).toBeLessThan(0);
    expect(forces[0]!.force.y+forces[1]!.force.y).toBeCloseTo(0,20);
    expect(p.getForceVectors!(state,{...params,carrierType:'hole'})).toEqual(forces);
  });
  it('M10 renders only actual burn events and does not fake a rotating-frame trail',()=>{
    const p=astroOrbitalMechanicsPlugin,params=resolvePluginParams<AstroOrbitalParams>(p.paramSchema,{mode:'hohmann-transfer'});
    const scene=new THREE.Scene(),driver=createRemainingFlagshipScene(p.meta.id,scene)!;
    const initial=p.engine.createInitialState(params);
    driver.sync(initial,params,new Set(['orbit']));
    expect(scene.getObjectByName('orbital-burn-1')).toBeDefined();
    expect(scene.getObjectByName('orbital-burn-2')).toBeUndefined();
    const event={id:'hohmann-burn-2-test',time:1,label:'burn',position:{x:-2.4,y:0},metrics:{deltaV2SI:1000}};
    const next={...initial,events:[...initial.events,event]};
    const marker=orbitalBurnMarkers(next,params).find(burn=>burn.index===2)!;
    expect(marker.x).toBe(-2.4);expect(marker.dy).toBeCloseTo(-1);
    driver.sync(next,params,new Set(['orbit']));
    expect(scene.getObjectByName('orbital-burn-2')?.position.x).toBe(-2.4);
    const binary=resolvePluginParams<AstroOrbitalParams>(p.paramSchema,{mode:'binary-lagrange'});
    const state={...p.engine.createInitialState(binary),tNorm:.5,trailNorm:[{x:1,y:0},{x:1,y:.1}]};
    driver.sync(state,binary,new Set(['orbit','corotatingView']));
    expect(scene.getObjectByName('orbital-burn-1')).toBeUndefined();
    expect(scene.getObjectByName('engine-trail')?.visible).toBe(false);
    const v=orbitDisplayVelocity(state,true);
    const expected=orbitDisplayXY(state.vxNorm+state.yNorm,state.vyNorm-state.xNorm,state.tNorm,true);
    expect(v).toEqual(expected);
    driver.dispose();
  });
  it('M10 co-rotating mode uses the same projection as the 2D view',()=>{
    const p=astroOrbitalMechanicsPlugin,params=resolvePluginParams<AstroOrbitalParams>(p.paramSchema,{mode:'binary-lagrange'});
    const initial=p.engine.createInitialState(params),s={...initial,tNorm:0.61,xNorm:0.3,yNorm:0.9};
    const scene=new THREE.Scene(),driver=createRemainingFlagshipScene(p.meta.id,scene)!;
    driver.sync(s,params,new Set(['orbit','corotatingView']));
    const body=scene.getObjectByName('orbiting-body')!;
    expect(body.position.distanceTo(orbitDisplayPoint(s.xNorm,s.yNorm,s.tNorm,true))).toBeLessThan(1e-9);
    const camera=new CameraMorphController(p.spatial3D,1280,720);camera.startMorphTo(1,0,0);
    const a=camera.project3DToScreen(body.position),c=Math.cos(-s.tNorm),sin=Math.sin(-s.tNorm);
    const b=createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(s.xNorm*c-s.yNorm*sin,s.xNorm*sin+s.yNorm*c);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(0.5);
    driver.dispose();expect(scene.children.length).toBe(0);
  });
  it('M10 analytical Kepler orbit passes through the initial body and rebuilds with orbital speed',()=>{
    const p=astroOrbitalMechanicsPlugin;
    const params=resolvePluginParams<AstroOrbitalParams>(p.paramSchema,{mode:'kepler-ellipse',r1Ratio:1.3,v0Ratio:1.2});
    const state=p.engine.createInitialState(params),scene=new THREE.Scene(),driver=createRemainingFlagshipScene(p.meta.id,scene)!;
    driver.sync(state,params,new Set(['orbit']));

    const orbit=scene.getObjectByName('kepler-analytical-orbit') as THREE.LineLoop;
    const body=scene.getObjectByName('orbiting-body') as THREE.Mesh;
    expect(orbit).toBeInstanceOf(THREE.LineLoop);
    expect(scene.getObjectByName('primary-star-halo')).toBeInstanceOf(THREE.Mesh);
    expect(body.position.distanceTo(new THREE.Vector3(1,0,0))).toBeLessThan(1e-12);
    const positions=orbit.geometry.getAttribute('position');
    expect(new THREE.Vector3().fromBufferAttribute(positions,0).distanceTo(body.position)).toBeLessThan(1e-6);

    const camera=new CameraMorphController(p.spatial3D,1280,720);camera.startMorphTo(1,0,0);
    const a=camera.project3DToScreen(body.position);
    const b=createWorldMapper(alignedCanvasViewport(camera.get2DAlignMetrics())).toScreen(state.xNorm,state.yNorm);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(0.5);

    const slower=resolvePluginParams<AstroOrbitalParams>(p.paramSchema,{mode:'kepler-ellipse',r1Ratio:1.3,v0Ratio:0.9});
    driver.sync(p.engine.createInitialState(slower),slower,new Set(['orbit']));
    const updated=scene.getObjectByName('kepler-analytical-orbit') as THREE.LineLoop;
    expect(updated).not.toBe(orbit);
    expect(updated.geometry.getAttribute('position').getZ(32)).not.toBeCloseTo(positions.getZ(32),4);

    driver.dispose();expect(scene.children.length).toBe(0);
  });
});

describe('spatial physical vector projections',()=>{
  it('E10 side view is a proper rotation, not a mirror of the Lorentz cross product',()=>{
    const v=new THREE.Vector3(2,-3,1), b=new THREE.Vector3(-1,2,4);
    const project=(p:THREE.Vector3)=>{const q=magnetic3dDisplayPoint(p);return new THREE.Vector3(q.x,q.y,q.z);};
    expect(project(v).cross(project(b)).distanceTo(project(v.clone().cross(b)))).toBeLessThan(1e-12);
    expect(project(v).length()).toBeCloseTo(v.length(),12);
    expect(project(v).x).toBe(v.z);
    expect(project(v).y).toBe(v.y);
  });
  it('M10 binary gravity follows both moving stars in either display frame',()=>{
    const p=astroOrbitalMechanicsPlugin,params=resolvePluginParams<AstroOrbitalParams>(p.paramSchema,{mode:'binary-lagrange',massRatioQ:0.2});
    const s={...p.engine.createInitialState(params),tNorm:0.71,xNorm:0.35,yNorm:0.85};
    const inertial=p.getForceVectors!(s,params,new Set(['orbit']));
    const rotating=p.getForceVectors!(s,params,new Set(['orbit','corotatingView']));
    expect(inertial).toHaveLength(2);
    const primaries=[-0.2,0.8];
    for(let i=0;i<2;i++){
      const a=inertial[i]!,b=rotating[i]!,radius=primaries[i]!;
      const dx=radius*Math.cos(s.tNorm)-s.xNorm,dy=radius*Math.sin(s.tNorm)-s.yNorm;
      expect((a.force.x*dx+a.force.y*dy)/(Math.hypot(a.force.x,a.force.y)*Math.hypot(dx,dy))).toBeCloseTo(1,12);
      const expected=orbitDisplayXY(a.force.x,a.force.y,s.tNorm,true);
      expect(b.force.x).toBeCloseTo(expected.x,12);
      expect(b.force.y).toBeCloseTo(expected.y,12);
      expect(b.origin).toEqual(orbitDisplayXY(s.xNorm,s.yNorm,s.tNorm,true));
    }
    expect(p.referenceFrames![0]!.getOrigin(s,params,new Set(['corotatingView']))).toEqual(rotating[0]!.origin);
  });
});
