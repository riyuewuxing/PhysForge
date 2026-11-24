import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldMapper, type Spatial3DFlattenSpec } from '@physforge/sim-sdk';
import { CameraMorphController, alignedCanvasViewport, flattenPoint, liftPoint, project3DToScreen, projectCameraDirection } from './cameraMorphController.js';

const spec = (flattenPlane: Spatial3DFlattenSpec['flattenPlane']): Spatial3DFlattenSpec => ({
  flattenPlane, defaultVisibleHeight: 8, sceneDepthRadius: 5, default3DAzimuthRad: 0.7, default3DPolarRad: 1.1
});
describe('3D perspective to orthographic morph', () => {
  it('projects physical axis directions into camera coordinates, preserving depth sign and ignoring translation', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4, 8, 2);
    const direction = new THREE.Vector3(0, 0, -1);
    expect(projectCameraDirection(direction, camera).toArray()).toEqual([0,0,-1]);
    camera.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI/2);
    const projected = projectCameraDirection(direction, camera);
    expect(projected.x).toBeCloseTo(1, 10);
    expect(projected.y).toBeCloseTo(0, 10);
    expect(projected.z).toBeCloseTo(0, 10);
    const towardViewer = projectCameraDirection(new THREE.Vector3(1,0,0), camera);
    expect(towardViewer.z).toBeCloseTo(1, 10);
    expect(towardViewer.length()).toBeCloseTo(1, 10);
  });

  it.each(['xy', 'xz'] as const)('aligns offset, resized %s plane against real 2D mapper within 0.5 CSS px', plane => {
    const c = new CameraMorphController(spec(plane), 1440, 900);
    c.setFraming(liftPoint(0.8, -0.3, plane, 0.6), 7);
    c.startMorphTo(1, 100, 750);
    c.update(850);
    for (const [w, h] of [[1440, 900], [768, 1024], [1920, 1080]] as const) {
      c.resize(w, h);
      const mapper = createWorldMapper(alignedCanvasViewport(c.get2DAlignMetrics(), 2));
      for (const [x, y] of [[0, 0], [1.2, -2.3], [-1, 1.5]] as const) {
        const world = liftPoint(x, y, plane, 0.6);
        expect(flattenPoint(world, plane)).toEqual({ x, y });
        const projected = c.project3DToScreen(world);
        const canvas = mapper.toScreen(x, y);
        expect(Math.hypot(projected.x - canvas.x, projected.y - canvas.y)).toBeLessThan(0.5);
      }
    }
    expect(c.getActiveCamera()).toBe(c.orthoCamera);
  });

  it('preserves center-plane height and keeps clipping planes positive through animation', () => {
    const c = new CameraMorphController(spec('xz'), 1280, 720);
    c.startMorphTo(1, 0, 1000);
    for (let t = 0; t <= 1000; t += 10) {
      c.update(t);
      const camera = c.perspCamera;
      const dist = camera.position.length();
      expect(2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))).toBeCloseTo(8, 9);
      expect(camera.near).toBeGreaterThan(0);
      expect(camera.far).toBeGreaterThan(camera.near);
      expect(camera.far).toBeGreaterThan(dist + 5);
    }
  });

  it('has no roll discontinuity at the XZ pole and exact plane endpoint agreement', () => {
    const c = new CameraMorphController(spec('xz'), 1440, 900);
    c.startMorphTo(1, 0, 1000);
    let prior = c.perspCamera.quaternion.clone();
    for (let t = 1; t <= 1000; t++) {
      c.update(t);
      const next = c.perspCamera.quaternion;
      expect(prior.angleTo(next)).toBeLessThan(0.02);
      prior = next.clone();
    }
    for (const [x, y] of [[0, 0], [2, 2], [-2, -1]] as const) {
      const world = liftPoint(x, y, 'xz');
      const a = project3DToScreen(world, c.perspCamera, 1440, 900);
      const b = c.project3DToScreen(world);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.2);
    }
  });

  it('moves authored target, orbit and projection together, then interrupts without a camera jump', () => {
    const c = new CameraMorphController(spec('xz'), 1000, 700);
    c.startKeyframe({ azimuthRad: 1.2, polarRad: 0.9, target: [2, 0, -1], visibleHeight: 4, morphT: 1 }, 0, 1000);
    c.update(500);
    expect(c.getMorphT()).toBeCloseTo(0.5);
    expect(c.getOrbitTarget().toArray()).toEqual([1, 0, -0.5]);
    const prior = c.perspCamera.position.clone();
    const rotation = c.perspCamera.quaternion.clone();
    c.startKeyframe({ azimuthRad: -0.4, polarRad: 1.4, target: [-1, 0, 2], visibleHeight: 6, morphT: 0 }, 500, 500);
    expect(c.perspCamera.position.distanceTo(prior)).toBeLessThan(1e-9);
    expect(c.perspCamera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    c.update(1000);
    expect(c.getOrbitTarget().toArray()).toEqual([-1, 0, 2]);
    expect(c.getMorphT()).toBe(0);
    expect(c.isAnimating).toBe(false);
    expect(c.get2DAlignMetrics().pxPerWorldUnit).toBeCloseTo(700 / 6);
    c.startKeyframe({ azimuthRad: 0.3, polarRad: 1.1, target: [0.4, 0, -0.8], visibleHeight: 5, morphT: 1 }, 1001, 0);
    const world = liftPoint(0.4, 0.8, 'xz');
    const screen = c.project3DToScreen(world);
    expect(screen.x).toBeCloseTo(500, 8);
    expect(screen.y).toBeCloseTo(350, 8);
  });

  it('reverses mid-flight without jumping, ignores stale orbit input and finishes exactly', () => {
    const c = new CameraMorphController(spec('xy'), 800, 600);
    c.startMorphTo(1, 0, 1000);
    c.update(500);
    const prior = c.perspCamera.position.clone();
    c.startMorphTo(0, 500, 500);
    expect(c.getMorphT()).toBeCloseTo(0.5);
    expect(c.perspCamera.position.distanceTo(prior)).toBeLessThan(1e-9);
    c.syncFromOrbitPosition(new THREE.Vector3(100, 100, 100), new THREE.Vector3());
    c.update(1000);
    expect(c.getMorphT()).toBe(0);
    expect(c.isAnimating).toBe(false);
    c.startMorphTo(1, 1000, 0);
    expect(c.getMorphT()).toBe(1);
    expect(c.isAnimating).toBe(false);
  });
});
