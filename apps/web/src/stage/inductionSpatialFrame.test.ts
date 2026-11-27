import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {inductionOpeningPoints,inductionOpeningSafeRect} from './inductionSpatialFrame.js';

describe('E04 actual opening geometry and overlay safe region',()=>{
  it('uses transformed visible mesh bounds and excludes invisible subtrees',()=>{
    const root=new THREE.Group();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,1,1),new THREE.MeshBasicMaterial());
    mesh.position.x=3;mesh.scale.x=2;root.add(mesh);
    const hidden=new THREE.Group();hidden.visible=false;
    const child=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial());child.position.x=100;hidden.add(child);root.add(hidden);
    const points=inductionOpeningPoints(root);
    expect(points).toHaveLength(8);expect(Math.min(...points.map(p=>p.x))).toBe(1);
    expect(Math.max(...points.map(p=>p.x))).toBe(5);
    mesh.geometry.dispose();mesh.material.dispose();child.geometry.dispose();child.material.dispose();
  });
  it('reserves real formula, controls and story HUD',()=>{
    expect(inductionOpeningSafeRect(1024,768,{left:690,right:1010,top:12,bottom:400},{left:300,right:800,top:705,bottom:760},{left:330,right:750,top:620,bottom:700})).toEqual({left:24,right:674,top:88,bottom:606});
  });
});
