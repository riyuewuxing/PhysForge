import * as THREE from 'three';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { InductionParams, InductionState } from '../../../../simulations/em-induction-double-rod/engine.js';
import { getEffectiveL2 } from '../../../../simulations/em-induction-double-rod/engine.js';
import { rodDisplayX } from '@physforge/simulations/em-induction-double-rod';
import { computeLarmorCircleForTrack, fieldSignedDistance, type BoundedMagneticParams, type BoundedMagneticState, type ParticleTrack } from '../../../../simulations/em-bounded-magnetic-field/engine.js';
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

interface FlowSegment { start: THREE.Vector3; end: THREE.Vector3 }
function inductionFlowSegments(x1: number, x2: number, l1: number, l2: number, double: boolean): FlowSegment[] {
  const point = (x: number, z: number) => new THREE.Vector3(x, 0.12, z);
  const segments: FlowSegment[] = [{ start: point(x1, l1 / 2), end: point(x1, -l1 / 2) }];
  if (double) segments.push({ start: point(x2, -l2 / 2), end: point(x2, l2 / 2) });
  // Equal-width rails form the displayed closed circuit. Unequal rails are schematic:
  // do not draw a fictitious diagonal connection between the two rod widths.
  if (!double || Math.abs(l1 - l2) < 1e-8) {
    segments.push({ start: point(x2, l1 / 2), end: point(x1, l1 / 2) },
      { start: point(x1, -l1 / 2), end: point(x2, -l1 / 2) });
  }
  return segments;
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
  let signature = '';
  return {
    sync(raw, rawParams, layers) {
      const state = raw as InductionState, params = rawParams as InductionParams;
      const l1 = params.railWidth, l2 = getEffectiveL2(params);
      const next = JSON.stringify([l1, l2, params.rodMode, params.magneticB, params.circuitLoad, layers.has('railsAndField')]);
      if (next !== signature) {
        signature = next; clear(fixed);
        if (layers.has('railsAndField')) {
          const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.045, Math.max(l1, l2) + 1.2), obsidianStageFloorMaterial());
          floor.position.y = -0.11; fixed.add(floor);
          for (const width of new Set(params.rodMode === 'double' ? [l1, l2] : [l1])) {
            for (const sign of [-1, 1]) {
              const rail = new THREE.Mesh(new THREE.BoxGeometry(8, 0.09, 0.08), anodizedRailMaterial());
              rail.position.set(0, -0.04, sign * width / 2); fixed.add(rail);
            }
          }
          if (params.rodMode === 'single') {
            const load = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, l1), brushedCopperMaterial());
            load.position.set(-3.8, 0, 0); fixed.add(load);
            const label = params.circuitLoad === 'capacitor' ? 0x38bdf8 : params.circuitLoad === 'battery' ? 0x4ade80 : 0xfbbf24;
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.3), magneticFluxMaterial(label));
            body.position.copy(load.position); fixed.add(body);
          }
          if (Math.abs(params.magneticB) > 1e-9) {
            for (let x = -3.5; x <= 3.5; x += 0.7) {
              for (const z of [-l1 * 0.32, 0, l1 * 0.32]) {
                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.8, 8), magneticFluxMaterial());
                tube.position.set(x, 0.3, z); fixed.add(tube);
                fixed.add(new THREE.ArrowHelper(new THREE.Vector3(0, -Math.sign(params.magneticB), 0),
                  new THREE.Vector3(x, Math.sign(params.magneticB) * 0.4 + 0.3, z), 0.8, 0x38bdf8, 0.12, 0.06));
              }
            }
          }
        }
      }
      rod1.visible = layers.has('rods');
      rod2.visible = rod1.visible && params.rodMode === 'double';
      rod1.position.copy(inductionDisplayPoint(state, state.x1)); rod1.scale.z = l1;
      rod2.position.copy(inductionDisplayPoint(state, state.x2)); rod2.scale.z = l2;
      const double = params.rodMode === 'double';
      const signConvention = !double && params.circuitLoad === 'battery' ? -1 : 1;
      const signedCurrent = signConvention * state.current;
      const flowEnabled = layers.has('currentFlow') && Math.abs(signedCurrent) > 0.02;
      const segments = inductionFlowSegments(rod1.position.x, double ? rod2.position.x : -3.8, l1, l2, double);
      for (let i = 0; i < flow.length; i++) {
        const visual = flow[i]!, segment = segments[i];
        const delta = segment ? segment.end.clone().sub(segment.start) : null;
        const length = delta?.length() ?? 0;
        visual.direction.visible = visual.pulse.visible = flowEnabled && length > 0.08;
        if (!visual.direction.visible || !segment || !delta) continue;
        const direction = delta.normalize().multiplyScalar(Math.sign(signedCurrent));
        const arrowLength = Math.min(0.65, length * 0.65);
        visual.direction.position.copy(segment.start).lerp(segment.end, 0.5).addScaledVector(direction, -arrowLength / 2);
        visual.direction.setDirection(direction);
        visual.direction.setLength(arrowLength, Math.min(0.14, arrowLength * 0.3), 0.07);
        const phase = signConvention * state.qTotalIntegral * 0.35 + i * 0.23;
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
  circle: THREE.LineLoop;
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
  const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  const points = Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 48), Math.sin(i * Math.PI / 48), 0));
  const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
  // Boundary event positions are provided by the numerical solver, not inferred from the rendered trail.
  const entry = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.075, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const exit = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  entry.name = 'magnetic-entry-' + track.id; exit.name = 'magnetic-exit-' + track.id;
  entry.visible = exit.visible = false;
  root.add(particle, trail, circle, entry, exit);
  return { root, particle, trail, trailBuffer, circle, entry, exit };
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
          const radius = Math.max(params.fieldScale, 0.1);
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
          if (Math.abs(params.magneticFieldZ) > 1e-9) {
            const sign = Math.sign(params.magneticFieldZ);
            for (let x = -3; x <= 4; x += 0.6) {
              for (let y = -2.4; y <= 2.4; y += 0.6) {
                if (fieldSignedDistance({ x, y, z: 0 }, params.mode, params.fieldScale) > -0.05) continue;
                fixed.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, sign), new THREE.Vector3(x, y, -0.25 * sign), 0.5, 0x38bdf8, 0.1, 0.05));
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
        const points = track.trail.slice(-TRAIL_CAP);
        for (let i = 0; i < points.length; i++) {
          const p = points[i]; if (p) visual.trailBuffer.setXYZ(i, p.x, p.y, 0);
        }
        visual.trailBuffer.needsUpdate = true;
        visual.trail.geometry.setDrawRange(0, points.length);
        visual.trail.visible = layers.has('trajectory') && points.length > 1;
        visual.entry.visible = layers.has('trajectory') && track.hasEntered && Boolean(track.entryPoint);
        visual.exit.visible = layers.has('trajectory') && track.hasExited && Boolean(track.exitPoint);
        if (track.entryPoint) visual.entry.position.set(track.entryPoint.x, track.entryPoint.y, 0.025);
        if (track.exitPoint) visual.exit.position.set(track.exitPoint.x, track.exitPoint.y, 0.025);
        const orbit = layers.has('larmorCircle') && (track.inField || params.mode === 'crossed-eb') ? computeLarmorCircleForTrack(track, params) : null;
        visual.circle.visible = orbit !== null;
        if (orbit) { visual.circle.position.set(orbit.center.x, orbit.center.y, 0); visual.circle.scale.setScalar(orbit.radius); }
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
