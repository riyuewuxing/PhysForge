import * as THREE from 'three';
import {describe,it,expect} from 'vitest';
import {createWorldMapper,resolvePluginParams} from '@physforge/sim-sdk';
import {stseEmDevicesSuitePlugin} from '@physforge/simulations/stse-em-devices-suite';
import {astroOrbitalMechanicsPlugin,orbitDisplayXY} from '@physforge/simulations/astro-orbital-mechanics';
import {magnetic3dDisplayPoint} from '@physforge/simulations/em-3d-magnetic-fields';
import type {EmDevicesParams} from '../../../../simulations/stse-em-devices-suite/engine.js';
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
