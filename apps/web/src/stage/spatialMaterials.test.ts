import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
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
