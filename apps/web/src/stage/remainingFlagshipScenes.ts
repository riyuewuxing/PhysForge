import * as THREE from 'three';
import type { FlagshipSceneDriver } from './planarFlagshipScenes.js';
import type { EmDevicesParams, EmDevicesState } from '../../../../simulations/stse-em-devices-suite/engine.js';
import { computeLagrangePoints, extractRocheIsolines, type AstroOrbitalParams, type AstroOrbitalState } from '../../../../simulations/astro-orbital-mechanics/engine.js';
import { anodizedRailMaterial, brushedCopperMaterial, dielectricGlassMaterial, magneticFluxMaterial, obsidianStageFloorMaterial } from './spatialMaterials.js';

function dispose(root: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      geometry.add(child.geometry);
      for (const m of Array.isArray(child.material) ? child.material : [child.material]) materials.add(m);
    }
  });
  for (const g of geometry) g.dispose();
  for (const m of materials) m.dispose();
  root.removeFromParent();
}
function clear(group: THREE.Group) {
  for (const child of [...group.children]) dispose(child);
}
function mesh(group: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material) {
  const object = new THREE.Mesh(geo, mat); object.name = name; group.add(object); return object;
}
function bufferedTrail(group: THREE.Group, capacity: number, color: number) {
  const geometry = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attr); geometry.setDrawRange(0, 0);
  const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  trail.name = 'engine-trail'; trail.frustumCulled = false; group.add(trail);
  return {trail, update(points: readonly {x:number;y:number}[], project: (x:number,y:number)=>THREE.Vector3) {
    const start = Math.max(0, points.length - capacity), count = points.length - start;
    for(let i=0;i<count;i++) { const p=points[start+i]!;const w=project(p.x,p.y); attr.setXYZ(i,w.x,w.y,w.z); }
    attr.needsUpdate=true; geometry.setDrawRange(0,count); trail.visible=count>1;
  }};
}
/** The S02 engine explicitly uses schematic, normalized particle positions; preserve the exact canvas map. */
export function deviceDisplayPoint(x:number,y:number) {
  return new THREE.Vector3(-0.25+0.7*x,0,-0.7*y);
}
export function orbitDisplayPoint(x:number,y:number,t:number,corotating:boolean) {
  const theta=corotating?-t:0, c=Math.cos(theta),s=Math.sin(theta);
  return new THREE.Vector3(x*c-y*s,0,-(x*s+y*c));
}
function deeShape(side: -1|1) {
  const shape=new THREE.Shape(), r=0.85;
  const first=side===-1?Math.PI/2:-Math.PI/2, last=first+Math.PI;
  shape.moveTo(0,Math.sin(first)*r); shape.absarc(0,0,r,first,last,false); shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth:0.13,bevelEnabled:false,curveSegments:48});
}
function deviceDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed=new THREE.Group(), moving=new THREE.Group();root.add(fixed,moving);
  const marker=mesh(moving,'device-particle',new THREE.SphereGeometry(0.035,16,12),magneticFluxMaterial(0x4ade80));
  const track=bufferedTrail(moving,121,0x38bdf8);
  const gap=mesh(moving,'accelerating-gap',new THREE.BoxGeometry(0.045,0.035,1.55),magneticFluxMaterial(0xfbbf24));
  gap.position.set(-0.25,-0.025,0);
  let signature='';
  return {sync(raw,rawParams,layers) {
    const state=raw as EmDevicesState|null, p=rawParams as EmDevicesParams;
    if(!state?.particlePos)return;
    root.visible=layers.has('main');
    if(signature!==p.device) {
      signature=p.device;clear(fixed);
      const base=mesh(fixed,'device-base',new THREE.BoxGeometry(3.15,0.09,1.95),obsidianStageFloorMaterial());base.position.set(-0.25,-0.23,0);
      if(p.device==='cyclotron') {
        for(const side of [-1,1] as const) {
          const dee=mesh(fixed,side===-1?'dee-left':'dee-right',deeShape(side),brushedCopperMaterial());
          dee.rotation.x=-Math.PI/2;dee.position.set(-0.25+side*0.04,-0.16,0);
        }
      } else {
        // Device housing is schematic, exactly the bounds of the existing classroom diagram.
        const enclosure=mesh(fixed,'device-housing',new THREE.BoxGeometry(2.4,0.32,1.2),dielectricGlassMaterial());
        enclosure.position.set(-0.25,-0.02,0);
        for(const sign of [-1,1]) {
          const electrode=mesh(fixed,'electrode',new THREE.BoxGeometry(2.4,0.10,0.055),brushedCopperMaterial());
          electrode.position.set(-0.25,-0.02,sign*0.6);
        }
      }
      for(const x of [-1.65,1.28]) {
        const guide=mesh(fixed,'field-guide',new THREE.BoxGeometry(0.025,0.025,1.2),anodizedRailMaterial());
        guide.position.set(x,0,0);
      }
    }
    marker.position.copy(deviceDisplayPoint(state.particlePos.x,state.particlePos.y));
    const material=marker.material as THREE.MeshStandardMaterial;
    material.color.set(p.carrierType==='hole'?0xf43f5e:0x4ade80);
    material.emissive.copy(material.color);
    track.update(state.trail,deviceDisplayPoint);
    // Gap highlights only proximity of the engine's schematic particle, not an invented RF phase.
    gap.visible=p.device==='cyclotron'&&Math.abs(state.particlePos.x*0.7)<=0.07;
  },dispose(){dispose(root);}};
}
function ring(group:THREE.Group,name:string,radius:number,color:number) {
  const points=Array.from({length:128},(_,i)=>new THREE.Vector3(radius*Math.cos(i*Math.PI/64),0,-radius*Math.sin(i*Math.PI/64)));
  const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity:0.45}));
  line.name=name;group.add(line);return line;
}
function orbitDriver(root:THREE.Group):FlagshipSceneDriver {
  const fixed=new THREE.Group(), moving=new THREE.Group(), guides=new THREE.Group();root.add(fixed,moving,guides);
  const primary=mesh(moving,'primary-star',new THREE.SphereGeometry(0.13,24,16),magneticFluxMaterial(0xfbbf24));
  const secondary=mesh(moving,'secondary-star',new THREE.SphereGeometry(0.065,20,14),magneticFluxMaterial(0x60a5fa));
  const satellite=mesh(moving,'orbiting-body',new THREE.SphereGeometry(0.05,18,12),magneticFluxMaterial(0x4ade80));
  const trail=bufferedTrail(moving,421,0x38bdf8);
  const contours=new THREE.Group();fixed.add(contours);
  let signature='',sectorSignature:readonly unknown[]|null=null,sectorVisible=false;
  let corotating=false;
  return {sync(raw,rawParams,layers) {
    const s=raw as AstroOrbitalState|null,p=rawParams as AstroOrbitalParams;
    if(!s||!Number.isFinite(s.xNorm))return;
    corotating=p.mode==='binary-lagrange'&&layers.has('corotatingView');
    const project=(x:number,y:number)=>orbitDisplayPoint(x,y,s.tNorm,corotating);
    const sig=JSON.stringify([p.mode,p.massRatioQ,p.r2OverR1,layers.has('rocheIsolines')]);
    if(signature!==sig){
      signature=sig;clear(guides);clear(contours);
      const extent=p.mode==='hohmann-transfer'?p.r2OverR1+0.5:2.8;
      const disk=mesh(guides,'orbit-plane',new THREE.CylinderGeometry(extent,extent,0.018,96),new THREE.MeshStandardMaterial({color:0x1e293b,transparent:true,opacity:0.22,depthWrite:false}));
      disk.position.y=-0.09;
      if(p.mode==='hohmann-transfer'){ring(guides,'parking-orbit',1,0x94a3b8);ring(guides,'target-orbit',p.r2OverR1,0x94a3b8);}
      if(p.mode==='binary-lagrange'&&layers.has('rocheIsolines')){
        for(const c of extractRocheIsolines(p.massRatioQ)){
          const vertices=c.segments.flatMap(seg=>[orbitDisplayPoint(seg.a.x,seg.a.y,0,false),orbitDisplayPoint(seg.b.x,seg.b.y,0,false)]);
          contours.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(vertices),new THREE.LineBasicMaterial({color:0x94a3b8,transparent:true,opacity:0.35})));
        }
        for(const pt of computeLagrangePoints(p.massRatioQ)){const dot=mesh(contours,pt.id,new THREE.SphereGeometry(0.025,10,8),magneticFluxMaterial(0xfbbf24));dot.position.copy(orbitDisplayPoint(pt.x,pt.y,0,false));}
      }
    }
    contours.rotation.y=corotating?0:s.tNorm;
    const showOrbit=layers.has('orbit');
    moving.visible=showOrbit;guides.visible=showOrbit;
    secondary.visible=p.mode==='binary-lagrange';
    if(secondary.visible){
      const q=p.massRatioQ,c=Math.cos(s.tNorm),sin=Math.sin(s.tNorm);
      primary.position.copy(project(-q*c,-q*sin));secondary.position.copy(project((1-q)*c,(1-q)*sin));
    }else primary.position.set(0,0,0);
    satellite.position.copy(project(s.xNorm,s.yNorm));trail.update(s.trailNorm,project);
    const showSectors=p.mode==='kepler-ellipse'&&layers.has('keplerSectors');
    if(sectorSignature!==s.sectors||showSectors!==sectorVisible){
      sectorSignature=s.sectors;sectorVisible=showSectors;
      // The engine owns the swept polygons. Render a fan, never infer an orbital area.
      const existing=fixed.getObjectByName('swept-sectors');
      if(existing)dispose(existing);
      if(showSectors){
        const group=new THREE.Group();group.name='swept-sectors';fixed.add(group);
        s.sectors.forEach((sector,i)=>{
          const vertices:number[]=[];
          for(let j=1;j<sector.vertices.length;j++){
            const a=sector.vertices[j-1]!,b=sector.vertices[j]!;
            vertices.push(0,-0.035,0,a.x,-0.035,-a.y,b.x,-0.035,-b.y);
          }
          const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
          mesh(group,'area-'+i,g,new THREE.MeshBasicMaterial({color:i%2?0xf472b6:0x38bdf8,transparent:true,opacity:0.24,side:THREE.DoubleSide,depthWrite:false}));
        });
      }
    }
  },dispose(){dispose(root);}};
}
export function createRemainingFlagshipScene(id:string,scene:THREE.Scene):FlagshipSceneDriver|null {
  if(id!=='stse-em-devices-suite'&&id!=='astro-orbital-mechanics')return null;
  const root=new THREE.Group();root.name='physforge-flagship-'+id;scene.add(root);
  return id==='stse-em-devices-suite'?deviceDriver(root):orbitDriver(root);
}
