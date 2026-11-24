import * as THREE from 'three';
import { easeInOutCubic, type Spatial3DFlattenSpec, type Viewport } from '@physforge/sim-sdk';

import type { StoryView3D } from '../presentation/storyCamera.js';

export interface World2DAlignMetrics {
  isFlatOrtho: boolean;
  pxPerWorldUnit: number;
  centerWorldX: number;
  centerWorldY: number;
  viewportWidth: number;
  viewportHeight: number;
}
export type WorldPoint3D = { x: number; y: number; z?: number };
const positive = (v: number, name: string) => {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(name + ' must be finite and positive');
  return v;
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Camera and 2D mapper share CSS pixel coordinates, not framebuffer pixels. */
export function project3DToScreen(world: WorldPoint3D, camera: THREE.Camera, width: number, height: number) {
  positive(width, 'width'); positive(height, 'height');
  camera.updateMatrixWorld(true);
  const point = new THREE.Vector3(world.x, world.y, world.z ?? 0);
  const eye = point.clone().applyMatrix4(camera.matrixWorldInverse);
  const ndc = point.project(camera);
  return {
    x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2,
    visible: eye.z < 0 && [ndc.x, ndc.y, ndc.z].every(Number.isFinite) &&
      Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1
  };
}

/** Canvas +Y up is world +Y (XY) or world -Z (XZ viewed from +Y). */
export function flattenPoint(world: WorldPoint3D, plane: Spatial3DFlattenSpec['flattenPlane']) {
  return { x: world.x, y: plane === 'xy' ? world.y : -(world.z ?? 0) };
}
export function liftPoint(x: number, y: number, plane: Spatial3DFlattenSpec['flattenPlane'], depth = 0) {
  return plane === 'xy' ? new THREE.Vector3(x, y, depth) : new THREE.Vector3(x, depth, -y);
}

/** Match the existing visualKit's 0.24*min(W,H) scale and 0.45W horizontal origin. */
export function alignedCanvasViewport(metrics: World2DAlignMetrics, dpr = 1): Viewport {
  const { viewportWidth: width, viewportHeight: height, pxPerWorldUnit: ppm, centerWorldX, centerWorldY } = metrics;
  positive(width, 'width'); positive(height, 'height'); positive(ppm, 'pixels per unit');
  return {
    width, height, dpr: positive(dpr, 'dpr'),
    scale: ppm / (Math.min(width, height) * 0.24),
    offsetX: 0.05 * width - centerWorldX * ppm,
    offsetY: centerWorldY * ppm
  };
}

/** Equal-plane-height dolly zoom; quaternion interpolation avoids a pole/up-vector roll snap. */
export class CameraMorphController {
  readonly perspCamera: THREE.PerspectiveCamera;
  readonly orthoCamera: THREE.OrthographicCamera;
  private readonly target = new THREE.Vector3();
  private readonly orbitRotation = new THREE.Quaternion();
  private readonly flatRotation = new THREE.Quaternion();
  private readonly lookMatrix = new THREE.Matrix4();
  private visibleHeight: number;
  private width: number;
  private height: number;
  private fovDeg = 42;
  private morphT = 0;
  private tween: { from: number; to: number; start: number; duration: number } | null = null;
  private framingTween: {
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
    fromHeight: number; toHeight: number;
    fromRotation: THREE.Quaternion; toRotation: THREE.Quaternion;
    start: number; duration: number;
  } | null = null;

  constructor(private readonly spec: Spatial3DFlattenSpec, width: number, height: number) {
    this.width = positive(width, 'width'); this.height = positive(height, 'height');
    this.visibleHeight = positive(spec.defaultVisibleHeight, 'visible height');
    positive(spec.sceneDepthRadius, 'depth radius');
    if (![spec.default3DAzimuthRad, spec.default3DPolarRad].every(Number.isFinite)) throw new RangeError('Invalid orbit angles');
    this.perspCamera = new THREE.PerspectiveCamera(this.fovDeg, width / height, 0.05, 100);
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 100);
    const orbit = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1,
      Math.max(0.0001, Math.min(Math.PI - 0.0001, spec.default3DPolarRad)), spec.default3DAzimuthRad));
    this.orbitRotation.setFromRotationMatrix(this.lookMatrix.lookAt(orbit, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    const flat = spec.flattenPlane === 'xy' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const up = spec.flattenPlane === 'xy' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
    this.flatRotation.setFromRotationMatrix(this.lookMatrix.lookAt(flat, new THREE.Vector3(), up));
    this.applyPose();
  }

  getMorphT(): number { return this.morphT; }
  get isAnimating(): boolean { return this.tween !== null || this.framingTween !== null; }
  getOrbitTarget(): THREE.Vector3 { return this.target.clone(); }
  getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.morphT >= 0.999 ? this.orthoCamera : this.perspCamera;
  }

  resize(width: number, height: number): void {
    this.width = positive(width, 'width'); this.height = positive(height, 'height');
    this.applyPose();
  }

  /** Capture the actual OrbitControls camera at the start of a transition. */
  syncFromOrbitPosition(position: THREE.Vector3, target: THREE.Vector3, fovDeg = this.fovDeg): void {
    if (this.morphT !== 0 || this.isAnimating) return;
    const distance = position.distanceTo(target);
    if (!Number.isFinite(distance) || distance <= 1e-8 || !Number.isFinite(fovDeg) || fovDeg <= 2 || fovDeg >= 170 ||
        ![target.x, target.y, target.z].every(Number.isFinite)) return;
    this.target.copy(target);
    this.fovDeg = fovDeg;
    this.visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
    this.orbitRotation.setFromRotationMatrix(this.lookMatrix.lookAt(position, target, new THREE.Vector3(0, 1, 0)));
    this.applyPose();
  }

  /** Set target and height from an authored camera keyframe or a current 2D viewport. */
  setFraming(target: WorldPoint3D, visibleHeight: number): void {
    if (![target.x, target.y, target.z ?? 0].every(Number.isFinite)) throw new RangeError('Invalid camera target');
    this.visibleHeight = positive(visibleHeight, 'visible height');
    this.target.set(target.x, target.y, target.z ?? 0);
    this.applyPose();
  }

  startMorphTo(target: number, nowMs: number, durationMs = 750): void {
    if (![target, nowMs, durationMs].every(Number.isFinite) || durationMs < 0) throw new RangeError('Invalid morph transition');
    this.update(nowMs);
    // Manual morph owns the transition from the current interpolated pose.
    this.framingTween = null;
    const to = clamp01(target);
    if (durationMs === 0 || to === this.morphT) {
      this.tween = null; this.morphT = to; this.applyPose(); return;
    }
    this.tween = { from: this.morphT, to, start: nowMs, duration: durationMs };
  }
  /** Authored pan, orbit, scale and morph use a single clock; rapid navigation starts from the current pose. */
  startKeyframe(view: StoryView3D, nowMs: number, durationMs = 750): void {
    if (![view.azimuthRad, view.polarRad, ...view.target, view.visibleHeight, view.morphT, nowMs, durationMs].every(Number.isFinite)
        || view.visibleHeight <= 0 || durationMs < 0 || view.morphT < 0 || view.morphT > 1) throw new RangeError('Invalid story camera');
    this.update(nowMs);
    const target = new THREE.Vector3(...view.target);
    const direction = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1,
      Math.max(0.0001, Math.min(Math.PI - 0.0001, view.polarRad)), view.azimuthRad));
    const rotation = new THREE.Quaternion().setFromRotationMatrix(this.lookMatrix.lookAt(direction, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    if (durationMs === 0) {
      this.framingTween = null; this.tween = null;
      this.target.copy(target); this.visibleHeight = view.visibleHeight;
      this.orbitRotation.copy(rotation); this.morphT = view.morphT;
      this.applyPose(); return;
    }
    this.framingTween = { fromTarget: this.target.clone(), toTarget: target,
      fromHeight: this.visibleHeight, toHeight: view.visibleHeight,
      fromRotation: this.orbitRotation.clone(), toRotation: rotation,
      start: nowMs, duration: durationMs };
    this.tween = { from: this.morphT, to: view.morphT, start: nowMs, duration: durationMs };
  }
  update(nowMs: number): boolean {
    if (!this.isAnimating || !Number.isFinite(nowMs)) return false;
    if (this.framingTween) {
      const f = this.framingTween;
      const t = clamp01((nowMs - f.start) / f.duration);
      const u = easeInOutCubic(t);
      this.target.copy(f.fromTarget).lerp(f.toTarget, u);
      this.visibleHeight = t >= 1 ? f.toHeight : Math.exp(Math.log(f.fromHeight) * (1 - u) + Math.log(f.toHeight) * u);
      this.orbitRotation.copy(f.fromRotation).slerp(f.toRotation, u);
      if (t >= 1) this.framingTween = null;
    }
    if (this.tween) {
      const { from, to, start, duration } = this.tween;
      const t = clamp01((nowMs - start) / duration);
      this.morphT = t >= 1 ? to : from + (to - from) * easeInOutCubic(t);
      if (t >= 1) this.tween = null;
    }
    this.applyPose();
    return true;
  }

  private applyPose(): void {
    const u = this.morphT;
    const maxTan = Math.tan(THREE.MathUtils.degToRad(this.fovDeg / 2));
    const minTan = Math.tan(THREE.MathUtils.degToRad(1));
    const tan = maxTan + (minTan - maxTan) * u;
    const dist = this.visibleHeight / (2 * tan);
    const span = Math.max(4, this.spec.sceneDepthRadius * 2.5);
    const aspect = this.width / this.height;
    const rotation = this.orbitRotation.clone().slerp(this.flatRotation, u);
    this.perspCamera.position.copy(this.target).add(new THREE.Vector3(0, 0, dist).applyQuaternion(rotation));
    this.perspCamera.quaternion.copy(rotation);
    this.perspCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tan));
    this.perspCamera.aspect = aspect;
    this.perspCamera.near = Math.max(0.05, dist - span);
    this.perspCamera.far = Math.max(this.perspCamera.near + 0.1, dist + span);
    this.perspCamera.updateProjectionMatrix();
    this.perspCamera.updateMatrixWorld(true);

    const halfH = this.visibleHeight / 2, halfW = halfH * aspect;
    this.orthoCamera.left = -halfW; this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH; this.orthoCamera.bottom = -halfH;
    this.orthoCamera.near = 0.05; this.orthoCamera.far = span * 4;
    this.orthoCamera.position.copy(this.target).add(new THREE.Vector3(0, 0, span * 2).applyQuaternion(this.flatRotation));
    this.orthoCamera.quaternion.copy(this.flatRotation);
    this.orthoCamera.updateProjectionMatrix();
    this.orthoCamera.updateMatrixWorld(true);
  }

  project3DToScreen(world: WorldPoint3D, width = this.width, height = this.height) {
    return project3DToScreen(world, this.getActiveCamera(), width, height);
  }
  get2DAlignMetrics(width = this.width, height = this.height): World2DAlignMetrics {
    const center = flattenPoint(this.target, this.spec.flattenPlane);
    return { isFlatOrtho: this.morphT >= 0.999, pxPerWorldUnit: height / this.visibleHeight,
      centerWorldX: center.x, centerWorldY: center.y, viewportWidth: width, viewportHeight: height };
  }
}
