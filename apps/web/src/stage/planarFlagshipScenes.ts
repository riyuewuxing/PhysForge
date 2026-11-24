import * as THREE from 'three';
import type { EmDevicesParams, EmDevicesState } from '../../../../simulations/stse-em-devices-suite/engine.js';
import { computeLagrangePoints, extractRocheIsolines, type AstroOrbitalParams, type AstroOrbitalState } from '../../../../simulations/astro-orbital-mechanics/engine.js';
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

/** E04 uses actual engine rod positions; only the finite visible rail window follows rod 1. */
function inductionDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed = new THREE.Group(), moving = new THREE.Group();
  root.add(fixed, moving);
  const rod1 = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 1), brushedCopperMaterial());
  const rod2 = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 1), brushedCopperMaterial());
  const current = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.7, 0xfbbf24, 0.14, 0.08);
  const force = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.7, 0xfb7185, 0.15, 0.1);
  moving.add(rod1, rod2, current, force);
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
      current.visible = layers.has('currentFlow') && Math.abs(state.current) > 0.02;
      current.position.copy(rod1.position).add(new THREE.Vector3(-0.35 * Math.sign(state.current), 0.11, l1 / 2));
      if (current.visible) current.setDirection(new THREE.Vector3(Math.sign(state.current), 0, 0));
      const f = (params.rodMode === 'single' && params.circuitLoad === 'battery' ? 1 : -1) * params.magneticB * l1 * state.current;
      force.visible = layers.has('forceVectors') && Math.abs(f) > 0.05;
      force.position.copy(rod1.position).add(new THREE.Vector3(0, 0.12, 0));
      if (force.visible) { force.setDirection(new THREE.Vector3(Math.sign(f), 0, 0)); force.setLength(Math.min(1.4, 0.2 + Math.abs(f) * 0.1), 0.15, 0.09); }
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
  root.add(particle, trail, circle);
  return { root, particle, trail, trailBuffer, circle };
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
            const height = params.mode === 'rectangular' ? radius * 1.6 : 5;
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
        const orbit = layers.has('larmorCircle') && (track.inField || params.mode === 'crossed-eb') ? computeLarmorCircleForTrack(track, params) : null;
        visual.circle.visible = orbit !== null;
        if (orbit) { visual.circle.position.set(orbit.center.x, orbit.center.y, 0); visual.circle.scale.setScalar(orbit.radius); }
      }
    },
    dispose: () => { disposeTree(root); tracks.clear(); }
  };
}

type PlanarPoint = { x: number; y: number };
function xz(x: number, y: number, elevation = 0): THREE.Vector3 {
  return new THREE.Vector3(x, elevation, -y);
}
export function deviceDisplayPoint(p: PlanarPoint): THREE.Vector3 {
  return xz(-0.25 + 0.7 * p.x, 0.7 * p.y);
}
export function astroDisplayPoint(p: PlanarPoint, angle = 0): THREE.Vector3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return xz(p.x * c - p.y * s, p.x * s + p.y * c);
}
function reusableTrail(color: number, capacity: number) {
  const geo = new THREE.BufferGeometry();
  const data = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', data); geo.setDrawRange(0, 0);
  const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.88 }));
  mesh.frustumCulled = false;
  return { mesh, sync(points: readonly PlanarPoint[], project: (p: PlanarPoint) => THREE.Vector3) {
    const tail = points.slice(-capacity);
    tail.forEach((p, i) => { const v = project(p); data.setXYZ(i, v.x, v.y, v.z); });
    data.needsUpdate = true; geo.setDrawRange(0, tail.length);
  } };
}
function sphere(radius: number, color: number, glow = 0.2) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.48 }));
}
function planarRing(radius: number, color: number): THREE.LineLoop {
  const vertices = Array.from({ length: 128 }, (_, i) => xz(radius * Math.cos(i * Math.PI / 64), radius * Math.sin(i * Math.PI / 64)));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(vertices), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
}
/** Existing normalized instructional illustration, not an SI orbit. */
function deviceDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed = new THREE.Group(), carrier = sphere(0.03, 0x4ade80, 1.1), trail = reusableTrail(0x38bdf8, 128);
  root.add(fixed, carrier, trail.mesh);
  let mode = '';
  let gap: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | undefined;
  return {
    sync(raw, rawParams, layers) {
      const state = raw as EmDevicesState, params = rawParams as EmDevicesParams;
      root.visible = layers.has('main');
      if (mode !== params.device) {
        mode = params.device; clear(fixed); gap = undefined;
        for (const x of [1.28, -1.65]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 1.2), anodizedRailMaterial());
          rail.position.set(x, -0.06, 0); fixed.add(rail);
        }
        if (mode === 'cyclotron') {
          for (const side of [-1, 1]) {
            const shape = new THREE.Shape(), a = side < 0 ? Math.PI / 2 : -Math.PI / 2;
            shape.moveTo(0, 0.85 * Math.sin(a));
            for (let i = 1; i <= 64; i++) {
              const t = a + Math.PI * i / 64; shape.lineTo(0.85 * Math.cos(t), 0.85 * Math.sin(t));
            }
            shape.closePath();
            const material = brushedCopperMaterial();
            material.transparent = true; material.opacity = 0.58; material.depthWrite = false;
            const dee = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }), material);
            dee.rotation.x = -Math.PI / 2; dee.position.set(-0.25 + side * 0.04, -0.12, 0); fixed.add(dee);
          }
          gap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 1.7), magneticFluxMaterial(0xfbbf24));
          gap.position.set(-0.25, -0.015, 0); fixed.add(gap);
        } else {
          for (const y of [-0.6, 0.6]) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.04), anodizedRailMaterial());
            plate.position.copy(xz(-0.25, y, -0.08)); fixed.add(plate);
          }
          const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.2), dielectricGlassMaterial());
          panel.position.set(-0.25, -0.12, 0); fixed.add(panel);
        }
      }
      // Display-only RF cue, synchronized to the existing schematic angular rate.
      if (gap) gap.material.opacity = 0.22 + 0.5 * Math.abs(Math.sin(state.t * 6));
      carrier.material.color.set(params.carrierType === 'hole' ? 0xf43f5e : 0x4ade80);
      carrier.material.emissive.copy(carrier.material.color);
      carrier.position.copy(deviceDisplayPoint(state.particlePos)); trail.sync(state.trail, deviceDisplayPoint);
    },
    dispose: () => disposeTree(root)
  };
}
/** Normalized engine positions remain the single source of truth, including binary corotation. */
function astroDriver(root: THREE.Group): FlagshipSceneDriver {
  const fixed = new THREE.Group(), contours = new THREE.Group(), sectors = new THREE.Group();
  const primary = sphere(0.11, 0xfbbf24, 0.7), secondary = sphere(0.075, 0x60a5fa), satellite = sphere(0.035, 0x4ade80, 0.9);
  const trail = reusableTrail(0x38bdf8, 2400);
  root.add(fixed, contours, sectors, primary, secondary, satellite, trail.mesh);
  let signature = '', contourQ = -1;
  let previousSectors: AstroOrbitalState['sectors'] | undefined;
  return {
    sync(raw, rawParams, layers) {
      const state = raw as AstroOrbitalState, params = rawParams as AstroOrbitalParams;
      const binary = params.mode === 'binary-lagrange', rotating = binary && layers.has('corotatingView');
      const project = (p: PlanarPoint) => astroDisplayPoint(p, rotating ? -state.tNorm : 0);
      const next = JSON.stringify([params.mode, params.r2OverR1]);
      if (next !== signature) {
        signature = next; clear(fixed);
        const radius = params.mode === 'hohmann-transfer' ? params.r2OverR1 + 0.25 : 2.6;
        const plane = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), new THREE.MeshBasicMaterial({ color: 0x164e63, opacity: 0.11, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        plane.rotation.x = -Math.PI / 2; plane.position.y = -0.045; fixed.add(plane);
        if (params.mode === 'hohmann-transfer') fixed.add(planarRing(1, 0x94a3b8), planarRing(params.r2OverR1, 0x94a3b8));
      }
      const showOrbit = layers.has('orbit');
      fixed.visible = primary.visible = satellite.visible = trail.mesh.visible = showOrbit;
      secondary.visible = showOrbit && binary;
      const q = params.massRatioQ, t = state.tNorm;
      primary.position.copy(project(binary ? { x: -q * Math.cos(t), y: -q * Math.sin(t) } : { x: 0, y: 0 }));
      secondary.position.copy(project({ x: (1 - q) * Math.cos(t), y: (1 - q) * Math.sin(t) }));
      satellite.position.copy(project({ x: state.xNorm, y: state.yNorm })); trail.sync(state.trailNorm, project);
      contours.visible = binary && layers.has('rocheIsolines');
      if (contours.visible && contourQ !== q) {
        contourQ = q; clear(contours);
        const vertices: THREE.Vector3[] = [];
        for (const contour of extractRocheIsolines(q)) for (const seg of contour.segments) vertices.push(xz(seg.a.x, seg.a.y), xz(seg.b.x, seg.b.y));
        contours.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(vertices), new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 })));
        for (const p of computeLagrangePoints(q)) { const dot = sphere(0.025, 0xfbbf24); dot.position.copy(xz(p.x, p.y)); contours.add(dot); }
      }
      contours.rotation.y = rotating ? 0 : t;
      sectors.visible = params.mode === 'kepler-ellipse' && layers.has('keplerSectors');
      if (sectors.visible && previousSectors !== state.sectors) {
        previousSectors = state.sectors; clear(sectors);
        for (const [i, sector] of state.sectors.entries()) {
          const points = sector.vertices, vertices: number[] = [];
          for (let j = 1; j < points.length; j++) {
            const a = points[j - 1], b = points[j]; if (!a || !b) continue;
            vertices.push(0, -0.02, 0, a.x, -0.02, -a.y, b.x, -0.02, -b.y);
          }
          const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
          sectors.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x22d3ee : 0xfbbf24, opacity: 0.19, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
        }
      }
    },
    dispose: () => disposeTree(root)
  };
}

export function createPlanarFlagshipScene(id: string, scene: THREE.Scene): FlagshipSceneDriver | null {
  if (!['em-induction-double-rod', 'builder-composite-em-field', 'stse-em-devices-suite', 'astro-orbital-mechanics'].includes(id)) return null;
  const root = new THREE.Group();
  root.name = 'physforge-flagship-' + id;
  scene.add(root);
  if (id === 'em-induction-double-rod') return inductionDriver(root);
  if (id === 'builder-composite-em-field') return boundedDriver(root);
  return id === 'stse-em-devices-suite' ? deviceDriver(root) : astroDriver(root);
}
