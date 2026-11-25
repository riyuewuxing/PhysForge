import * as THREE from 'three';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { InductionParams, InductionState } from '../../../../simulations/em-induction-double-rod/engine.js';
import { rodDisplayX, inductionDiagramGeometry, inductionDiagramCurrent, inductionFieldPoints, inductionLoadDimensions } from '../../../../simulations/em-induction-double-rod/diagramGeometry.js';
import { fieldSignedDistance, type BoundedMagneticParams, type BoundedMagneticState, type ParticleTrack } from '../../../../simulations/em-bounded-magnetic-field/engine.js';
import { DynamicTubeTrail } from './dynamicTubeTrail.js';
import { displayLarmorCircleForTrack } from '../../../../simulations/em-bounded-magnetic-field/plugin.js';
import { anodizedRailMaterial, brushedCopperMaterial, magneticFluxMaterial, dielectricGlassMaterial, obsidianStageFloorMaterial } from './spatialMaterials.js';

export interface FlagshipSceneDriver {
  sync(state: unknown, params: ParamRecord, layers: ReadonlySet<string>): void;
  dispose(): void;
}

function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      geometries.add(child.geometry);
      for (const m of Array.isArray(child.material) ? child.material : [child.material]) materials.add(m);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  root.removeFromParent();
}
function clear(group: THREE.Group): void {
  for (const child of [...group.children]) disposeTree(child);
}

export function inductionDisplayPoint(state: Pick<InductionState, 'x1'>, x: number): THREE.Vector3 {
  return new THREE.Vector3(rodDisplayX(state, x), 0, 0);
}

/** Visual directions use the engine's current sign convention (battery mode reverses it).
 * Pulse motion represents signed transferred charge, not microscopic carrier drift speed. */
function updateSignedArrow(arrow: THREE.ArrowHelper, origin: THREE.Vector3, value: number, enabled: boolean): void {
  arrow.visible = enabled && Math.abs(value) > 0.05;
  arrow.position.copy(origin);
  if (arrow.visible) {
    arrow.setDirection(new THREE.Vector3(Math.sign(value), 0, 0));
    arrow.setLength(Math.min(1.4, 0.2 + Math.abs(value) * 0.1), 0.15, 0.09);
  }
}

/** E04 uses actual engine rod positions; only the finite visible rail window follows rod 1. */
function inductionDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed = new THREE.Group(), moving = new THREE.Group();
  root.add(fixed, moving);
  const rod1 = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 1), brushedCopperMaterial());
  const rod2 = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 1), brushedCopperMaterial());
  rod1.name = 'induction-rod-1'; rod2.name = 'induction-rod-2';
  const arrow = (name: string, color: number) => {
    const object = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.7, color, 0.14, 0.08);
    object.name = name; moving.add(object); return object;
  };
  const force1 = arrow('induction-ampere-1', 0xfb7185);
  const force2 = arrow('induction-ampere-2', 0xf472b6);
  const external = arrow('induction-external-force', 0x4ade80);
  const flow = Array.from({ length: 4 }, (_, i) => {
    const direction = arrow('induction-current-' + i, 0xfbbf24);
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), magneticFluxMaterial(0xfbbf24));
    pulse.name = 'induction-charge-pulse-' + i; moving.add(pulse);
    return { direction, pulse };
  });
  moving.add(rod1, rod2);
  // Stepped leads may move as rods move. Reuse six meshes instead of reallocating every frame.
  const rails=Array.from({length:6},(_,i)=>{
    const rail=new THREE.Mesh(new THREE.BoxGeometry(1,0.09,0.08),anodizedRailMaterial());
    rail.name='induction-rail-'+i;moving.add(rail);return rail;
  });
  const axis=new THREE.Vector3(1,0,0);
  let signature = '';
  return {
    sync(raw, rawParams, layers) {
      const state = raw as InductionState, params = rawParams as InductionParams;
      const geometry=inductionDiagramGeometry(state,params);
      const {l1,l2,double}=geometry;
      const next = JSON.stringify([l1, l2, params.rodMode, params.magneticB, params.circuitLoad, layers.has('railsAndField'),layers.has('rods')]);
      if (next !== signature) {
        signature = next; clear(fixed);
        if (layers.has('railsAndField')) {
          const floor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.045, Math.max(l1, l2) + 1.2), obsidianStageFloorMaterial());
          floor.position.y = -0.11; fixed.add(floor);
          for(const point of inductionFieldPoints(params)){
            const z=-point.y;
            const tube=new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.8,8),magneticFluxMaterial());
            tube.position.set(point.x,0.3,z);fixed.add(tube);
            fixed.add(new THREE.ArrowHelper(new THREE.Vector3(0,-Math.sign(params.magneticB),0),
              new THREE.Vector3(point.x,Math.sign(params.magneticB)*0.4+0.3,z),0.8,0x38bdf8,0.12,0.06));
          }
        }
        if(!double&&layers.has('rods')){
          const load=new THREE.Group();load.name='induction-load';fixed.add(load);
          const {halfGap,halfPlateWidth}=inductionLoadDimensions(l1);
          const leadLength=l1/2-halfGap;
          for(const side of [-1,1]){
            const lead=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.055,leadLength),brushedCopperMaterial());
            lead.name=side===-1?'load-upper-lead':'load-lower-lead';
            lead.position.z=side*(halfGap+leadLength/2);load.add(lead);
          }
          if(params.circuitLoad==='resistor'){
            const body=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.12,2*halfGap),magneticFluxMaterial(0xfbbf24));
            body.name='load-resistor';load.add(body);
          }else for(const side of [-1,1]){
            const plateWidth=2*halfPlateWidth*(params.circuitLoad==='battery'&&side===1?0.55:1);
            const plate=new THREE.Mesh(new THREE.BoxGeometry(plateWidth,0.075,0.025),brushedCopperMaterial());
            plate.name=side===-1?'load-upper-plate':'load-lower-plate';
            plate.position.z=side*halfGap;load.add(plate);
          }
        }
      }
      for(const [i,rail] of rails.entries()){
        const seg=geometry.rails[i];
        rail.visible=Boolean(seg)&&layers.has('railsAndField');
        if(!seg||!rail.visible)continue;
        const a=new THREE.Vector3(seg.start.x,-0.04,-seg.start.y),b=new THREE.Vector3(seg.end.x,-0.04,-seg.end.y);
        const delta=b.clone().sub(a),length=delta.length();
        rail.visible=length>1e-8;
        if(!rail.visible)continue;
        rail.position.copy(a).lerp(b,0.5);rail.scale.x=length;rail.quaternion.setFromUnitVectors(axis,delta.normalize());
      }
      const load=fixed.getObjectByName('induction-load');
      if(load)load.position.set(geometry.x2,0,0);
      rod1.visible = layers.has('rods');
      rod2.visible = rod1.visible && params.rodMode === 'double';
      rod1.position.copy(inductionDisplayPoint(state, state.x1)); rod1.scale.z = l1;
      rod2.position.copy(inductionDisplayPoint(state, state.x2)); rod2.scale.z = l2;
      const {current:signedCurrent,charge:signedCharge}=inductionDiagramCurrent(state,params);
      const flowEnabled = layers.has('currentFlow') && Math.abs(signedCurrent) > 0.02;
      const segments=geometry.currentGuides.map(seg=>({start:new THREE.Vector3(seg.start.x,0.12,-seg.start.y),end:new THREE.Vector3(seg.end.x,0.12,-seg.end.y)}));
      for (let i = 0; i < flow.length; i++) {
        const visual = flow[i]!, segment = segments[i];
        const delta = segment ? segment.end.clone().sub(segment.start) : null;
        const length = delta?.length() ?? 0;
        visual.direction.visible = visual.pulse.visible = flowEnabled && length > 0.08 && (i!==1||double);
        if (!visual.direction.visible || !segment || !delta) continue;
        const direction = delta.normalize().multiplyScalar(Math.sign(signedCurrent));
        const arrowLength = Math.min(0.65, length * 0.65);
        visual.direction.position.copy(segment.start).lerp(segment.end, 0.5).addScaledVector(direction, -arrowLength / 2);
        visual.direction.setDirection(direction);
        visual.direction.setLength(arrowLength, Math.min(0.14, arrowLength * 0.3), 0.07);
        const phase = signedCharge * 0.35 + i * 0.23;
        visual.pulse.position.copy(segment.start).lerp(segment.end, phase - Math.floor(phase));
      }
      const f1 = -params.magneticB * l1 * signedCurrent;
      const f2 = params.magneticB * l2 * signedCurrent;
      const forces = layers.has('forceVectors');
      updateSignedArrow(force1, rod1.position.clone().add(new THREE.Vector3(0, 0.12, 0)), f1, forces);
      updateSignedArrow(force2, rod2.position.clone().add(new THREE.Vector3(0, 0.12, 0)), f2, forces && double);
      updateSignedArrow(external, rod1.position.clone().add(new THREE.Vector3(0, 0.19, l1 * 0.22)), params.externalForce, forces);
    },
    dispose: () => disposeTree(root)
  };
}

interface TrackVisual {
  root: THREE.Group;
  particle: THREE.Mesh;
  trail: THREE.Line;
  trailBuffer: THREE.BufferAttribute;
  tube?:DynamicTubeTrail;
  tubeMesh?:THREE.Mesh;
  halo?:DynamicTubeTrail;
  haloMesh?:THREE.Mesh;
  lastTrail?:ParticleTrack['trail'];
  circle: THREE.LineLoop;
  center: THREE.Mesh;
  radiusLine: THREE.Line;
  velocity: THREE.ArrowHelper;
  drift: THREE.ArrowHelper;
  rotation: THREE.ArrowHelper;
  entry: THREE.Mesh;
  exit: THREE.Mesh;
}
const TRAIL_CAP = 900;
function trackVisual(track: ParticleTrack): TrackVisual {
  const root = new THREE.Group();
  const color = new THREE.Color(track.color);
  const particle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.25 }));
  const geometry = new THREE.BufferGeometry();
  const trailBuffer = new THREE.BufferAttribute(new Float32Array(TRAIL_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', trailBuffer); geometry.setDrawRange(0, 0);
  const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95,toneMapped:false }));
  trail.frustumCulled = false;
  const points = Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 48), Math.sin(i * Math.PI / 48), 0));
  const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
  // Boundary event positions are provided by the numerical solver, not inferred from the rendered trail.
  const entry = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.075, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const exit = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  entry.name = 'magnetic-entry-' + track.id; exit.name = 'magnetic-exit-' + track.id;
  entry.visible = exit.visible = false;
  const center=new THREE.Mesh(new THREE.SphereGeometry(0.025,12,8),magneticFluxMaterial(color.getHex()));
  center.name='magnetic-circle-center-'+track.id;
  const radiusLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),
    new THREE.LineBasicMaterial({color,transparent:true,opacity:0.45}));
  radiusLine.name='magnetic-radius-'+track.id;radiusLine.frustumCulled=false;
  const arrow=(name:string,color:number)=>{
    const a=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),0.5,color,0.12,0.07);
    a.name=name+'-'+track.id;a.visible=false;return a;
  };
  const velocity=arrow('magnetic-velocity',0x4ade80),drift=arrow('magnetic-drift',0xfbbf24),rotation=arrow('magnetic-rotation',0xf472b6);
  root.add(particle,trail,circle,center,radiusLine,velocity,drift,rotation,entry,exit);
  const result:TrackVisual={root,particle,trail,trailBuffer,circle,center,radiusLine,velocity,drift,rotation,entry,exit};
  if(track.id===0){
    result.tube=new DynamicTubeTrail(TRAIL_CAP,.008,6);result.halo=new DynamicTubeTrail(TRAIL_CAP,.022,6);
    result.tubeMesh=new THREE.Mesh(result.tube.geometry,new THREE.MeshBasicMaterial({color,toneMapped:false}));
    result.haloMesh=new THREE.Mesh(result.halo.geometry,new THREE.MeshBasicMaterial({color,toneMapped:false,transparent:true,opacity:.16,depthWrite:false,blending:THREE.AdditiveBlending}));
    result.tubeMesh.name='b1-primary-trajectory';result.haloMesh.name='b1-primary-trajectory-halo';
    result.tubeMesh.frustumCulled=result.haloMesh.frustumCulled=false;
    root.add(result.tubeMesh,result.haloMesh);
  }
  return result;
}

/** B1 field geometry follows exactly the engine's signed-distance region. Infinite regions are shown as a finite viewing window. */
function boundedDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed = new THREE.Group();
  const tracks = new Map<number, TrackVisual>();
  root.add(fixed);
  let signature = '';
  return {
    sync(raw, rawParams, layers) {
      const state = raw as BoundedMagneticState, params = rawParams as BoundedMagneticParams;
      const next = JSON.stringify([params.mode, params.fieldScale, params.magneticFieldZ, params.electricFieldY, layers.has('fieldRegion')]);
      if (next !== signature) {
        signature = next; clear(fixed);
        if (layers.has('fieldRegion')) {
          const radius = Math.max(params.fieldScale,params.mode==='circular'?.05:.1);
          let region: THREE.Mesh;
          if (params.mode === 'circular') {
            region = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.44, 64, 1, true), dielectricGlassMaterial());
            region.rotation.x = Math.PI / 2;
          } else {
            const width = params.mode === 'rectangular' ? radius : params.mode === 'half-space' ? 4 : 8;
            const height = params.mode === 'rectangular' ? Math.max(params.fieldScale * 1.6, 0.2) : 5;
            region = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.44), dielectricGlassMaterial());
            region.position.x = params.mode === 'crossed-eb' ? 0 : width / 2;
          }
          fixed.add(region);
          if (params.mode === 'circular') {
            for (const [index, zPlane] of [-0.22, 0.22].entries()) {
              const rimPoints = Array.from({ length: 72 }, (_, pointIndex) => {
                const angle = (pointIndex / 72) * Math.PI * 2;
                return new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), zPlane);
              });
              const rim = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(rimPoints),
                new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.82 })
              );
              rim.name = `b1-field-rim-${index}`;
              fixed.add(rim);
              const core=new THREE.Mesh(new THREE.TorusGeometry(radius,.007,6,72),new THREE.MeshBasicMaterial({color:0x7dd3fc,toneMapped:false}));
              const halo=new THREE.Mesh(new THREE.TorusGeometry(radius,.018,6,72),new THREE.MeshBasicMaterial({color:0x38bdf8,toneMapped:false,transparent:true,opacity:.12,depthWrite:false,blending:THREE.AdditiveBlending}));
              core.position.z=halo.position.z=zPlane;fixed.add(core,halo);
            }
          } else if(params.mode==='rectangular') {
            const width = params.mode === 'rectangular' ? radius : params.mode === 'half-space' ? 4 : 8;
            const height = params.mode === 'rectangular' ? Math.max(params.fieldScale * 1.6, 0.2) : 5;
            const centerX = params.mode === 'crossed-eb' ? 0 : width / 2;
            const box = new THREE.BoxGeometry(width, height, 0.44);
            const edges = new THREE.EdgesGeometry(box);
            box.dispose();
            const outline = new THREE.LineSegments(
              edges,
              new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.82 })
            );
            outline.name = 'b1-field-wire';
            outline.position.x = centerX;
            fixed.add(outline);
          } else if(params.mode==='half-space'){
            const boundary=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-2.5,0),new THREE.Vector3(0,2.5,0)]),new THREE.LineBasicMaterial({color:0x7dd3fc,toneMapped:false}));
            boundary.name='b1-halfspace-boundary';fixed.add(boundary);
          }
          if (params.magneticFieldZ!==0) {
            const sign = Math.sign(params.magneticFieldZ);
            for (let x = -3; x <= 4; x += 0.6) {
              for (let y = -2.4; y <= 2.4; y += 0.6) {
                if (fieldSignedDistance({ x, y, z: 0 }, params.mode, params.fieldScale) > -0.05) continue;
                const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,sign),new THREE.Vector3(x,y,-.18*sign),.36,0x38bdf8,.08,.04);
                arrow.name='b1-field-arrow';
                const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.28,6),new THREE.MeshBasicMaterial({color:0x7dd3fc,toneMapped:false}));shaft.position.y=.14;arrow.add(shaft);fixed.add(arrow);
              }
            }
          }
          if (params.mode === 'crossed-eb' && Math.abs(params.electricFieldY) > 1e-9) {
            const sign = Math.sign(params.electricFieldY);
            for (let x = -2.4; x <= 2.4; x += 0.8) fixed.add(new THREE.ArrowHelper(
              new THREE.Vector3(0, sign, 0), new THREE.Vector3(x, -sign * 0.5, 0), 1, 0xfbbf24, 0.16, 0.07));
          }
        }
      }
      const ids = new Set(state.particles.map(track => track.id));
      for (const [id, visual] of tracks) if (!ids.has(id)) { disposeTree(visual.root); tracks.delete(id); }
      for (const track of state.particles) {
        let visual = tracks.get(track.id);
        if (!visual) { visual = trackVisual(track); tracks.set(track.id, visual); root.add(visual.root); }
        const pos = track.state.position;
        visual.particle.position.set(pos.x, pos.y, pos.z);
        const points=track.trail;
        if(visual.lastTrail!==points){
          visual.lastTrail=points;
          const recent=points.slice(-TRAIL_CAP);
          for(let i=0;i<recent.length;i++){const p=recent[i]!;visual.trailBuffer.setXYZ(i,p.x,p.y,0);}
          visual.trailBuffer.needsUpdate=true;visual.trail.geometry.setDrawRange(0,recent.length);
          if(visual.tube&&visual.halo){const spatial=recent.map(p=>({x:p.x,y:p.y,z:0}));visual.tube.update(spatial,p=>p);visual.halo.update(spatial,p=>p);}
        }
        const showTrail=layers.has('trajectory')&&points.length>1;
        visual.trail.visible=showTrail&&!visual.tubeMesh;
        if(visual.tubeMesh&&visual.haloMesh)visual.tubeMesh.visible=visual.haloMesh.visible=showTrail;
        visual.entry.visible = layers.has('eventPins') && track.hasEntered && Boolean(track.entryPoint);
        visual.exit.visible = layers.has('eventPins') && track.hasExited && Boolean(track.exitPoint);
        if (track.entryPoint) visual.entry.position.set(track.entryPoint.x, track.entryPoint.y, 0.025);
        if (track.exitPoint) visual.exit.position.set(track.exitPoint.x, track.exitPoint.y, 0.025);
        const orbit = layers.has('larmorCircle') ? displayLarmorCircleForTrack(track, params) : null;
        visual.circle.visible=visual.center.visible=visual.radiusLine.visible=orbit!==null;
        if(orbit){
          visual.circle.position.set(orbit.center.x,orbit.center.y,0);visual.circle.scale.setScalar(orbit.radius);
          visual.center.position.copy(visual.circle.position);
          const buffer=visual.radiusLine.geometry.getAttribute('position');
          buffer.setXYZ(0,orbit.center.x,orbit.center.y,0);buffer.setXYZ(1,pos.x,pos.y,0);buffer.needsUpdate=true;
        }
        const v=track.state.velocity;
        const showVelocity=layers.has('velocityVector')&&(track.id===0||state.particles.length<=5);
        const decomposition=layers.has('speedDecomposition')&&track.id===0&&params.mode==='crossed-eb'&&
          params.charge!==0&&Math.abs(params.magneticFieldZ)>1e-6;
        const vd=decomposition?params.electricFieldY/params.magneticFieldZ:0;
        const rotX=v.x-vd,rotY=v.y;
        const scale=Math.min(0.22,1.5/Math.max(Math.hypot(v.x,v.y),Math.abs(vd),Math.hypot(rotX,rotY),1e-6));
        const setArrow=(arrow:THREE.ArrowHelper,x:number,y:number,show:boolean,offsetX=0)=>{
          const magnitude=Math.hypot(x,y),length=magnitude*scale;
          arrow.visible=show&&length>1e-6;arrow.position.set(pos.x+offsetX,pos.y,0.04);
          if(arrow.visible){arrow.setDirection(new THREE.Vector3(x/magnitude,y/magnitude,0));
            arrow.setLength(length,Math.min(0.12,length*0.3),Math.min(0.07,length*0.2));}
        };
        setArrow(visual.velocity,v.x,v.y,showVelocity);setArrow(visual.drift,vd,0,decomposition);setArrow(visual.rotation,rotX,rotY,decomposition,vd*scale);
      }
    },
    dispose: () => { disposeTree(root); tracks.clear(); }
  };
}

export function createPlanarFlagshipScene(id: string, scene: THREE.Scene): FlagshipSceneDriver | null {
  if (id !== 'em-induction-double-rod' && id !== 'builder-composite-em-field') return null;
  const root = new THREE.Group();
  root.name = 'physforge-flagship-' + id;
  scene.add(root);
  return id === 'em-induction-double-rod' ? inductionDriver(root) : boundedDriver(root);
}
