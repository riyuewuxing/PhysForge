import * as THREE from 'three';
import type { FlagshipSceneDriver } from './planarFlagshipScenes.js';
import type { EmDevicesParams, EmDevicesState } from '../../../../simulations/stse-em-devices-suite/engine.js';
import { deviceDiagramPoint, getDeviceSchematic, deeOutline, type DevicePart } from '../../../../simulations/stse-em-devices-suite/deviceGeometry.js';
import { orbitDisplayXY, orbitDisplayVelocity, orbitalBurnMarkers } from '@physforge/simulations/astro-orbital-mechanics';
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
/** S02 shares engine display coordinates with Canvas, including physically scaled beam and cyclotron trajectories. */
export function deviceDisplayPoint(x:number,y:number) {
  const p=deviceDiagramPoint(x,y);
  return new THREE.Vector3(p.x,0,-p.y);
}
export function orbitDisplayPoint(x:number,y:number,t:number,corotating:boolean) {
  const p = orbitDisplayXY(x,y,t,corotating);
  return new THREE.Vector3(p.x,0,-p.y);
}
function buildDevicePart(group:THREE.Group,part:DevicePart) {
  const material=part.material==='copper'?brushedCopperMaterial():part.material==='glass'?dielectricGlassMaterial():anodizedRailMaterial();
  if(part.kind==='dee'){
    const shape=new THREE.Shape();
    deeOutline(part).forEach((p,i)=>{if(i===0)shape.moveTo(p.x-part.x,p.y-part.y);else shape.lineTo(p.x-part.x,p.y-part.y);});
    shape.closePath();
    const object=mesh(group,part.id,new THREE.ExtrudeGeometry(shape,{depth:part.depth,bevelEnabled:false}),material);
    object.rotation.x=-Math.PI/2;object.position.set(part.x,-part.depth-0.035,-part.y);
    return;
  }
  if(part.kind==='tube'){
    const object=mesh(group,part.id,new THREE.CylinderGeometry(part.height/2,part.height/2,part.width,48,1,true),material);
    object.rotation.z=Math.PI/2;object.position.set(part.x,-0.035,-part.y);return;
  }
  const object=mesh(group,part.id,new THREE.BoxGeometry(part.width,part.depth,part.height),material);
  object.position.set(part.x,-part.depth/2-0.035,-part.y);
}
function deviceDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed=new THREE.Group(), moving=new THREE.Group();root.add(fixed,moving);
  const marker=mesh(moving,'device-particle',new THREE.SphereGeometry(0.035,16,12),magneticFluxMaterial(0x4ade80));
  const track=bufferedTrail(moving,121,0x38bdf8);
  const gap=mesh(moving,'accelerating-gap',new THREE.BoxGeometry(0.045,0.035,1.55),magneticFluxMaterial(0xfbbf24));
  gap.position.set(-0.25,-0.025,0);
  const rf=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(-0.38,.06,-.95),.26,0xfbbf24,.065,.045);
  rf.name='cyclotron-rf-direction';moving.add(rf);
  let signature='';
  return {sync(raw,rawParams,layers) {
    const state=raw as EmDevicesState|null, p=rawParams as EmDevicesParams;
    if(!state?.particlePos)return;
    root.visible=layers.has('main');
    if(signature!==p.device) {
      signature=p.device;clear(fixed);
      const base=mesh(fixed,'device-base',new THREE.BoxGeometry(3.15,0.09,2.65),obsidianStageFloorMaterial());base.position.set(-0.25,-0.52,0);
      const schematic=getDeviceSchematic(p.device);
      for(const part of schematic.parts)buildDevicePart(fixed,part);
      // B points along +Y, i.e. out of the physical diagram plane (x,y)->(x,0,-y).
      // These are direction markers, not a solved field distribution or a strength scale.
      for(const [i,point] of schematic.fields.entries()){
        const field=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(point.x,-0.04,-point.y),0.28,0x38bdf8,0.07,0.045);
        field.name='device-field-'+i;fixed.add(field);
      }
      for(const cue of schematic.cues){
        const delta=new THREE.Vector3(cue.dx,0,-cue.dy),length=delta.length();
        if(length<=0)continue;
        const direction=new THREE.ArrowHelper(delta.normalize(),new THREE.Vector3(cue.x,0.10,-cue.y),length,
          cue.kind==='electric'?0xfbbf24:0x4ade80,Math.min(0.13,length*0.25),0.07);
        direction.name=cue.id;fixed.add(direction);
      }
      for(const x of [-1.65,1.28]) {
        const guide=mesh(fixed,'field-guide',new THREE.BoxGeometry(0.025,0.025,1.2),anodizedRailMaterial());
        guide.position.set(x,0,0);
      }
    }
    marker.position.copy(deviceDisplayPoint(state.particlePos.x,state.particlePos.y));
    const material=marker.material as THREE.MeshStandardMaterial;
    material.color.set(p.device==='hall-sensor'&&p.carrierType==='hole'?0xf43f5e:0x4ade80);
    material.emissive.copy(material.color);
    track.update(state.trail,deviceDisplayPoint);
    const f=state.cyclotron;
    gap.visible=!!f&&Math.abs(state.particlePos.x*0.7)<=0.04;
    rf.visible=!!f&&Math.abs(f.rfVoltageV)>1e-6;
    if(f&&rf.visible){const sign=Math.sign(f.rfVoltageV);rf.position.set(-0.25-sign*.13,.06,-.95);rf.setDirection(new THREE.Vector3(sign,0,0));}
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
  const stellarHalo=new THREE.Mesh(new THREE.RingGeometry(0.16,0.28,32),new THREE.MeshBasicMaterial({
    color:0xfbbf24,transparent:true,opacity:0.28,side:THREE.DoubleSide,depthWrite:false
  }));
  stellarHalo.name='primary-star-halo';stellarHalo.rotation.x=-Math.PI/2;primary.add(stellarHalo);
  const secondary=mesh(moving,'secondary-star',new THREE.SphereGeometry(0.065,20,14),magneticFluxMaterial(0x60a5fa));
  const satellite=mesh(moving,'orbiting-body',new THREE.SphereGeometry(0.05,18,12),magneticFluxMaterial(0x4ade80));
  const trail=bufferedTrail(moving,421,0x38bdf8);
  const contours=new THREE.Group(),burns=new THREE.Group();fixed.add(contours,burns);
  const velocity=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),0.5,0x4ade80,0.12,0.07);velocity.name='orbit-velocity';moving.add(velocity);
  let burnEvents:AstroOrbitalState['events']|null=null,burnMode:AstroOrbitalParams['mode']|null=null;
  let signature='',sectorSignature:readonly unknown[]|null=null,sectorVisible=false;
  let corotating=false;
  return {sync(raw,rawParams,layers) {
    const s=raw as AstroOrbitalState|null,p=rawParams as AstroOrbitalParams;
    if(!s||!Number.isFinite(s.xNorm))return;
    corotating=p.mode==='binary-lagrange'&&layers.has('corotatingView');
    const project=(x:number,y:number)=>orbitDisplayPoint(x,y,s.tNorm,corotating);
    const sig=JSON.stringify([p.mode,p.r1Ratio,p.v0Ratio,p.massRatioQ,p.r2OverR1,layers.has('rocheIsolines')]);
    if(signature!==sig){
      signature=sig;clear(guides);clear(contours);
      const extent=p.mode==='hohmann-transfer'?p.r2OverR1+0.5:2.8;
      const disk=mesh(guides,'orbit-plane',new THREE.CylinderGeometry(extent,extent,0.018,96),new THREE.MeshStandardMaterial({color:0x1e293b,transparent:true,opacity:0.22,depthWrite:false}));
      disk.position.y=-0.09;
      if(p.mode==='hohmann-transfer'){ring(guides,'parking-orbit',1,0x94a3b8);ring(guides,'target-orbit',p.r2OverR1,0x94a3b8);}
      if(p.mode==='kepler-ellipse'){
        const speed=Math.max(0.5,p.v0Ratio),eccentricityX=speed*speed-1,semilatusRectum=speed*speed;
        const eccentricity=Math.abs(eccentricityX),closed=eccentricity<0.98;
        const samples=closed?128:256,points:THREE.Vector3[]=[];
        for(let i=0;i<(closed?samples:samples+1);i++){
          const theta=closed?(i/samples)*Math.PI*2:-Math.PI+(i/samples)*Math.PI*2;
          const denominator=1+eccentricityX*Math.cos(theta);
          if(!closed&&denominator<=0.08)continue;
          const radius=semilatusRectum/denominator;
          if(!closed&&Math.abs(radius)>6)continue;
          points.push(orbitDisplayPoint(radius*Math.cos(theta),radius*Math.sin(theta),0,false));
        }
        const geometry=new THREE.BufferGeometry().setFromPoints(points);
        const material=new THREE.LineBasicMaterial({color:0x38bdf8,transparent:true,opacity:0.48});
        const analytical=closed?new THREE.LineLoop(geometry,material):new THREE.Line(geometry,material);
        analytical.name='kepler-analytical-orbit';guides.add(analytical);
      }
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
    satellite.position.copy(project(s.xNorm,s.yNorm));trail.update(corotating?[]:s.trailNorm,project);
    const v=orbitDisplayVelocity(s,corotating),speed=Math.hypot(v.x,v.y);
    velocity.visible=speed>1e-8;velocity.position.copy(satellite.position);
    if(velocity.visible){velocity.setDirection(new THREE.Vector3(v.x/speed,0,-v.y/speed));const len=speed*.35;velocity.setLength(len,Math.min(.12,len*.3),Math.min(.07,len*.2));}
    if(burnEvents!==s.events||burnMode!==p.mode){
      burnEvents=s.events;burnMode=p.mode;clear(burns);
      for(const burn of orbitalBurnMarkers(s,p)){
        const dot=mesh(burns,'orbital-burn-'+burn.index,new THREE.TorusGeometry(.08,.016,8,24),magneticFluxMaterial(0xfb923c));
        dot.rotation.x=-Math.PI/2;dot.position.set(burn.x,.025,-burn.y);
        if(Math.hypot(burn.dx,burn.dy)>0){
          const arrow=new THREE.ArrowHelper(new THREE.Vector3(burn.dx,0,-burn.dy),new THREE.Vector3(burn.x,.06,-burn.y),.45,0xfb923c,.12,.07);
          arrow.name='orbital-impulse-'+burn.index;burns.add(arrow);
        }
      }
    }
    burns.visible=showOrbit;
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
