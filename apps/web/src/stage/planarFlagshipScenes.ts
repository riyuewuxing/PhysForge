import * as THREE from 'three';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { InductionParams, InductionState } from '../../../../simulations/em-induction-double-rod/engine.js';
import { rodDisplayX, inductionDiagramGeometry, inductionDiagramCurrent, inductionFieldPoints, inductionLoadDimensions } from '../../../../simulations/em-induction-double-rod/diagramGeometry.js';
import { fieldSignedDistance, type BoundedMagneticParams, type BoundedMagneticState, type ParticleTrack } from '../../../../simulations/em-bounded-magnetic-field/engine.js';
import { DynamicTubeTrail } from './dynamicTubeTrail.js';
import { CameraMorphController,project3DToScreen } from './cameraMorphController.js';
import { type B1Bounds,type B1SafeRect,b1VelocityDisplay,displayLarmorCircleForTrack } from '../../../../simulations/em-bounded-magnetic-field/plugin.js';
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
  const particle = new THREE.Mesh(new THREE.SphereGeometry(0.045,16,12),
    new THREE.MeshBasicMaterial({color,toneMapped:false}));
  // Primary/secondary beam identity is encoded by color, not scene lighting.
  const particleHalo=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),new THREE.MeshBasicMaterial({color,toneMapped:false,transparent:true,opacity:.14,depthWrite:false,blending:THREE.AdditiveBlending}));
  particle.name='b1-particle-'+track.id;particleHalo.name='b1-particle-halo-'+track.id;particle.add(particleHalo);
  const geometry = new THREE.BufferGeometry();
  const trailBuffer = new THREE.BufferAttribute(new Float32Array(TRAIL_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', trailBuffer); geometry.setDrawRange(0, 0);
  const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95,toneMapped:false,fog:false }));
  trail.frustumCulled = false;
  const points = Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 48), Math.sin(i * Math.PI / 48), 0));
  const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
  // Boundary event positions are provided by the numerical solver, not inferred from the rendered trail.
  const entry = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.075, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,toneMapped:false }));
  const exit = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,toneMapped:false }));
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

/** Camera test uses projected physical content, including the field depth.
 * It never scales or translates the physical scene itself. */
export function b1ProjectedBounds(bounds:B1Bounds,camera:THREE.Camera,width:number,height:number){
  const points=[];
  for(const x of [bounds.minX,bounds.maxX])for(const y of [bounds.minY,bounds.maxY])for(const z of [-.22,.22])
    points.push(project3DToScreen({x,y,z},camera,width,height));
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
    top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)),visible:points.every(p=>p.visible)};
}
export function b1ProjectionFits(bounds:B1Bounds,camera:THREE.Camera,width:number,height:number,safe:B1SafeRect,margin=8){
  const p=b1ProjectedBounds(bounds,camera,width,height);
  return p.visible&&p.left>=safe.left+margin&&p.right<=safe.right-margin&&p.top>=safe.top+margin&&p.bottom<=safe.bottom-margin;
}
/** Keep the orbit orientation, fit the actual XY envelope, and put its center
 * into the safe rectangle by intersecting the desired view ray with XY.
 * Iteration accounts for perspective/depth rather than assuming a flat view. */
export function fitB1SpatialFrame(morph:CameraMorphController,bounds:B1Bounds,width:number,height:number,safe:B1SafeRect){
  const center=new THREE.Vector3((bounds.minX+bounds.maxX)/2,(bounds.minY+bounds.maxY)/2,0);
  const spanX=Math.max(1,bounds.maxX-bounds.minX),spanY=Math.max(1,bounds.maxY-bounds.minY);
  const screenX=(safe.left+safe.right)/2,screenY=(safe.top+safe.bottom)/2;
  const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
  let visibleHeight=Math.max(3.6,1.15*Math.max((spanX+.65)*height/Math.max(1,safe.right-safe.left-48),(spanY+.65)*height/Math.max(1,safe.bottom-safe.top-48)));
  for(let i=0;i<8;i++){
    morph.setFraming(center,visibleHeight);
    const camera=morph.getActiveCamera();
    ray.setFromCamera(new THREE.Vector2(2*screenX/width-1,1-2*screenY/height),camera);
    const hit=ray.ray.intersectPlane(plane,new THREE.Vector3());
    if(hit)morph.setFraming(center.clone().multiplyScalar(2).sub(hit),visibleHeight);
    if(b1ProjectionFits(bounds,morph.getActiveCamera(),width,height,safe,18))break;
    visibleHeight*=1.25;
  }
  return b1ProjectedBounds(bounds,morph.getActiveCamera(),width,height);
}

/** B1 field geometry follows exactly the engine's signed-distance region. Infinite regions are shown as a finite viewing window. */
function boundedDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed = new THREE.Group();
  const fieldWindow=new THREE.Group();
  const tracks = new Map<number, TrackVisual>();
  root.add(fixed);
  let signature = '';
  return {
    sync(raw, rawParams, layers) {
      const state = raw as BoundedMagneticState, params = rawParams as BoundedMagneticParams;
      const next = JSON.stringify([params.mode, params.fieldScale, params.magneticFieldZ, params.electricFieldY, layers.has('fieldRegion')]);
      if (next !== signature) {
        signature = next; clear(fixed);clear(fieldWindow);fieldWindow.position.set(0,0,0);fixed.add(fieldWindow);
        if (layers.has('fieldRegion')) {
          const radius = Math.max(params.fieldScale,params.mode==='circular'?.05:.1);
          // A field is not glass matter. Use a faint, depth-write-free local
          // tint only for bounded regions; infinite crossed fields have no box.
          if(params.mode==='circular'||params.mode==='rectangular'){
            const mat=new THREE.MeshBasicMaterial({color:0x2b8db4,transparent:true,opacity:.085,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
            const region=params.mode==='circular'?new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,.44,64,1,true),mat):
              new THREE.Mesh(new THREE.BoxGeometry(radius,Math.max(params.fieldScale*1.6,.2),.44),mat);
            if(params.mode==='circular')region.rotation.x=Math.PI/2;else region.position.x=radius/2;
            region.name='b1-bounded-field-tint';fixed.add(region);
          }
          if (params.mode === 'circular') {
            for (const [index, zPlane] of [-0.22, 0.22].entries()) {
              const rimPoints = Array.from({ length: 72 }, (_, pointIndex) => {
                const angle = (pointIndex / 72) * Math.PI * 2;
                return new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), zPlane);
              });
              const rim = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(rimPoints),
                new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.82,toneMapped:false })
              );
              rim.name = `b1-field-rim-${index}`;
              fixed.add(rim);
              const core=new THREE.Mesh(new THREE.TorusGeometry(radius,.007,6,72),new THREE.MeshBasicMaterial({color:0x7dd3fc,toneMapped:false}));
              const halo=new THREE.Mesh(new THREE.TorusGeometry(radius,.018,6,72),new THREE.MeshBasicMaterial({color:0x38bdf8,toneMapped:false,transparent:true,opacity:.12,depthWrite:false,blending:THREE.AdditiveBlending}));
              core.position.z=halo.position.z=zPlane;fixed.add(core,halo);
            }
          } else if(params.mode==='rectangular') {
            const width=radius,height=Math.max(params.fieldScale*1.6,.2),centerX=width/2;
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
            const positions:{x:number;y:number}[]=[];
            if(params.mode==='circular'){
              const spacing=radius*.45;
              for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++){
                const x=i*spacing,y=j*spacing;
                if(fieldSignedDistance({x,y,z:0},params.mode,params.fieldScale)<-radius*.06)positions.push({x,y});
              }
            }else if(params.mode==='rectangular'){
              const height=Math.max(params.fieldScale*1.6,.2);
              for(let i=1;i<=3;i++)for(let j=-1;j<=1;j++)positions.push({x:i*radius/4,y:j*height/3});
            }else{
              for(let i=params.mode==='half-space'?1:-2;i<=3;i++)for(let j=-2;j<=2;j++)positions.push({x:i*.78,y:j*.78});
            }
            for(const {x,y} of positions){
              const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,sign),new THREE.Vector3(x,y,-.18*sign),.36,0x38bdf8,.08,.04);
              arrow.name='b1-field-arrow';
              const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.28,6),new THREE.MeshBasicMaterial({color:0x7dd3fc,toneMapped:false}));
              shaft.position.y=.14;arrow.line.visible=false;arrow.add(shaft);fieldWindow.add(arrow);
            }
          }
          if (params.mode === 'crossed-eb' && Math.abs(params.electricFieldY) > 1e-9) {
            const sign = Math.sign(params.electricFieldY);
            for (let x=-2;x<=2;x+=1)fieldWindow.add(new THREE.ArrowHelper(
              new THREE.Vector3(0,sign,0),new THREE.Vector3(x,-sign*.46,0),.92,0xfbbf24,.15,.065));
          }
        }
      }
      // Recenter only the visual sample lattice of the all-space field; no
      // physical positions or real boundaries are moved or reconstructed.
      if(params.mode==='crossed-eb'&&state.particles[0]){
        const p=state.particles[0].state.position;
        fieldWindow.position.set(Math.round(p.x/1.56)*1.56,Math.round(p.y/1.56)*1.56,0);
      }
      const ids = new Set(state.particles.map(track => track.id));
      for (const [id, visual] of tracks) if (!ids.has(id)) { disposeTree(visual.root); tracks.delete(id); }
      for (const track of state.particles) {
        let visual = tracks.get(track.id);
        if (!visual) { visual = trackVisual(track); tracks.set(track.id, visual); root.add(visual.root); }
        const pos = track.state.position;
        visual.particle.position.set(pos.x, pos.y, pos.z);
        const points=track.trail;
        if(layers.has('trajectory')&&visual.lastTrail!==points){
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
        const {vx,vy,vd,rx:rotX,ry:rotY,decomposition,scale}=b1VelocityDisplay(track,params,layers);
        const showVelocity=layers.has('velocityVector')&&(track.id===0||state.particles.length<=5);
        const setArrow=(arrow:THREE.ArrowHelper,x:number,y:number,show:boolean,offsetX=0)=>{
          const magnitude=Math.hypot(x,y),length=magnitude*scale;
          arrow.visible=show&&length>1e-6;arrow.position.set(pos.x+offsetX,pos.y,0.04);
          if(arrow.visible){arrow.setDirection(new THREE.Vector3(x/magnitude,y/magnitude,0));
            arrow.setLength(length,Math.min(0.12,length*0.3),Math.min(0.07,length*0.2));}
        };
        setArrow(visual.velocity,vx,vy,showVelocity);setArrow(visual.drift,vd,0,decomposition);setArrow(visual.rotation,rotX,rotY,decomposition,vd*scale);
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
