import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {e10FluxRole,E10ParticleProjection,e10ProjectedCloudOverlaps,e10FrameSamples} from './e10SceneFocus.js';
import {getMagneticDisplayFieldLines,type Magnetic3dParams} from '@physforge/simulations/em-3d-magnetic-fields/engine';
import {e10ConductorRadius,e10CopperMaterial,e10FluxCoreMaterial,e10FluxHaloMaterial,e10GridLineGeometry,coilCopperMaterial,applyFluxEndpointFade} from './spatialMaterials.js';
describe('E10 visual-only geometry and materials',()=>{
  it('preserves air gaps at all supported turn counts and coil radii',()=>{
    for(const R of [.4,.7,1,1.6])for(let n=4;n<=16;n+=2){
      const r=e10ConductorRadius('finite-solenoid',R,n);
      expect(r).toBeGreaterThan(0);expect(2*r).toBeLessThanOrEqual(.64*2.4*R/(n-1)+1e-12);
    }
  });
  it('owns isolated E10 copper and magnetic-field materials',()=>{
    const legacy=coilCopperMaterial(),c=e10CopperMaterial(),next=e10CopperMaterial(),core=e10FluxCoreMaterial(true),halo=e10FluxHaloMaterial(),arrow=e10FluxCoreMaterial();
    expect(c).not.toBe(next);expect(c).not.toBe(legacy);expect(legacy.envMapIntensity).toBe(.92);
    expect(c.envMapIntensity).toBeLessThan(legacy.envMapIntensity);
    expect(halo.opacity).toBeLessThan(core.opacity);expect(core.vertexColors).toBe(true);expect(arrow.vertexColors).toBe(false);expect(arrow.opacity).toBeGreaterThan(core.opacity);
    for(const m of [legacy,c,next,core,halo,arrow])m.dispose();
  });
  it('fades scenery continuously to zero at the visible domain edges',()=>{
    const g=e10GridLineGeometry(new THREE.Vector3(-7,-.025,0),new THREE.Vector3(7,-.025,0)),color=g.getAttribute('color');
    expect(color.itemSize).toBe(4);expect(color.getW(0)).toBe(0);expect(color.getW(16)).toBe(1);expect(color.getW(32)).toBe(0);
    expect(color.getW(8)).toBeGreaterThan(0);expect(color.getW(8)).toBeLessThan(1);expect(color.getW(8)).toBeCloseTo(color.getW(24),7);g.dispose();
  });
  it('open field endpoint fade does not remove closed field-line geometry',()=>{
    const curve=new THREE.LineCurve3(new THREE.Vector3(0,0,0),new THREE.Vector3(1,0,0));
    const g=new THREE.TubeGeometry(curve,20,.005,5,false);
    applyFluxEndpointFade(g,false);let a=g.getAttribute('color');expect(a.getW(0)).toBe(0);expect(a.getW(a.count-1)).toBe(0);
    applyFluxEndpointFade(g,true);a=g.getAttribute('color');for(let i=0;i<a.count;i++)expect(a.getW(i)).toBe(1);
    g.dispose();
  });
});

describe('H70 E10 teaching hierarchy and real depth',()=>{
  it('keeps all actual field samples and gives the true meridian higher contrast',()=>{
    const p:Magnetic3dParams={geometryType:'finite-solenoid',radiusR:.7,currentI:2,solenoidTurns:10,qOverM:1.5,vPerp:.8,vParallel:.9,uniformBz:2};
    const lines=getMagneticDisplayFieldLines(p),roles=lines.map(l=>e10FluxRole(p.geometryType,l));
    expect(lines.length).toBe(33);
    expect(roles.filter(x=>x==='meridian').length).toBe(11);
    expect(roles.filter(x=>x==='context').length).toBe(22);
    expect(getMagneticDisplayFieldLines({...p,currentI:0})).toHaveLength(0);
    const bright=e10FluxCoreMaterial(true,'meridian'),dim=e10FluxCoreMaterial(true,'context'),halo=e10FluxHaloMaterial('context');
    expect(dim.opacity).toBeGreaterThan(.2);expect(dim.opacity).toBeLessThan(bright.opacity);expect(halo.opacity).toBeGreaterThan(0);
    expect(bright.color.equals(dim.color)).toBe(true);
    bright.dispose();dim.dispose();halo.dispose();
  });
  it('projects the real center and distinguishes nearer, farther and hidden meshes',()=>{
    const camera=new THREE.PerspectiveCamera(42,1.5,.05,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const center=new THREE.Vector3(0,0,0),projection=new E10ParticleProjection();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
    mesh.position.z=2;mesh.updateMatrixWorld(true);
    let r=projection.read(center,.05,camera,[mesh],1200,800);
    expect(r.visible).toBe(true);expect(r.occluded).toBe(true);expect(r.x).toBeCloseTo(600,8);expect(r.y).toBeCloseTo(400,8);expect(r.hitDistance).toBeLessThan(r.centerDistance!);
    mesh.position.z=-2;mesh.updateMatrixWorld(true);
    expect(projection.read(center,.05,camera,[mesh],1200,800).occluded).toBe(false);
    mesh.position.z=2;mesh.visible=false;mesh.updateMatrixWorld(true);
    expect(projection.read(center,.05,camera,[mesh],1200,800).occluded).toBe(false);
    expect(projection.read(new THREE.Vector3(100,0,0),.05,camera,[mesh],1200,800).visible).toBe(false);
    mesh.geometry.dispose();mesh.material.dispose();
  });
  it('detects an actual circular conductor silhouette in orthographic projection',()=>{
    const camera=new THREE.OrthographicCamera(-2,2,2,-2,.05,100);camera.position.z=8;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const mesh=new THREE.Mesh(new THREE.TorusGeometry(1,.06,12,64),new THREE.MeshBasicMaterial());
    mesh.position.z=1;mesh.updateMatrixWorld(true);
    const focus=new E10ParticleProjection();
    expect(focus.read(new THREE.Vector3(1,0,0),.05,camera,[mesh],800,800).occluded).toBe(true);
    expect(focus.read(new THREE.Vector3(0,0,0),.05,camera,[mesh],800,800).occluded).toBe(false);
    mesh.geometry.dispose();mesh.material.dispose();
  });
});

describe('H71 E10 clip-aware occlusion',()=>{
  it('does not show a locator for an occluder wholly clipped by the perspective near plane',()=>{
    const camera=new THREE.PerspectiveCamera(42,1.5,1,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const focus=new E10ParticleProjection(),center=new THREE.Vector3(0,0,0);
    const clipped=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshBasicMaterial());
    clipped.position.z=7.6;clipped.updateMatrixWorld(true);
    const rendered=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshBasicMaterial());
    rendered.position.z=3;rendered.updateMatrixWorld(true);
    expect(focus.read(center,.05,camera,[clipped],1200,800).occluded).toBe(false);
    const q=focus.read(center,.05,camera,[clipped,rendered],1200,800);
    expect(q.occluded).toBe(true);expect(q.hitDistance).toBeCloseTo(4.85,6);
    for(const m of [clipped,rendered]){m.geometry.dispose();m.material.dispose();}
  });
  it('compares clipping in camera depth rather than oblique ray length',()=>{
    const camera=new THREE.PerspectiveCamera(90,1,1,100);camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld(true);
    const focus=new E10ParticleProjection(),center=new THREE.Vector3(3,0,-4);
    const clipped=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.08),new THREE.MeshBasicMaterial());
    clipped.position.set(.675,0,-.9);clipped.updateMatrixWorld(true);
    // Ray distance to this mesh exceeds near=1, but view depth is <1.
    expect(clipped.position.length()).toBeGreaterThan(camera.near);
    expect(focus.read(center,.05,camera,[clipped],800,800).occluded).toBe(false);
    clipped.position.set(1.5,0,-2);clipped.updateMatrixWorld(true);
    expect(focus.read(center,.05,camera,[clipped],800,800).occluded).toBe(true);
    clipped.geometry.dispose();clipped.material.dispose();
  });
  it('also respects the orthographic near plane',()=>{
    const camera=new THREE.OrthographicCamera(-2,2,2,-2,1,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const focus=new E10ParticleProjection(),center=new THREE.Vector3(.5,0,0);
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshBasicMaterial());
    mesh.position.set(.5,0,7.6);mesh.updateMatrixWorld(true);
    expect(focus.read(center,.05,camera,[mesh],800,800).occluded).toBe(false);
    mesh.position.z=3;mesh.updateMatrixWorld(true);
    expect(focus.read(center,.05,camera,[mesh],800,800).occluded).toBe(true);
    mesh.geometry.dispose();mesh.material.dispose();
  });
});

describe('H71 E10 screen-space obstacle fit',()=>{
  it('detects actual visible projected points and keeps screen-space margins',()=>{
    const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,20);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const rect={left:600,right:790,top:20,bottom:300};
    expect(e10ProjectedCloudOverlaps([{x:1.2,y:1,z:0}],camera,800,800,rect)).toBe(true);
    expect(e10ProjectedCloudOverlaps([{x:.95,y:1,z:0}],camera,800,800,rect,12)).toBe(true);
    expect(e10ProjectedCloudOverlaps([{x:.8,y:1,z:0}],camera,800,800,rect,12)).toBe(false);
    expect(e10ProjectedCloudOverlaps([{x:1.2,y:-1,z:0}],camera,800,800,rect)).toBe(false);
    expect(e10ProjectedCloudOverlaps([{x:1.2,y:1,z:6}],camera,800,800,rect)).toBe(false);
  });
});

describe('H72 E10 camera crop contract',()=>{
  it('selects actual conductor samples without removing domain samples',()=>{
    const body=[{x:1,y:2,z:3}],domain=[...body,{x:4,y:5,z:6}];
    expect(e10FrameSamples('body',body,domain)).toBe(body);
    expect(e10FrameSamples('domain',body,domain)).toBe(domain);
    expect(domain).toHaveLength(2);
    expect(e10FrameSamples('body',[],domain)).toBe(domain);
  });
});
