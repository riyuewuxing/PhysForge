import type { StoryCameraKeyframe, Spatial3DFlattenSpec, Viewport } from '@physforge/sim-sdk';
import { clampZoomScale, getPixelsPerMeter, type CameraTransform } from '../stage/ViewportController.js';

export type StoryView2D = NonNullable<StoryCameraKeyframe['view2D']>;
export type StoryView3D = NonNullable<StoryCameraKeyframe['view3D']>;
export interface StorySpatialCommand {
  readonly modelId: string;
  readonly view: StoryView3D;
  readonly durationMs: number;
}

export function storyCameraDuration(duration: number | undefined): number {
  return typeof duration === 'number' && Number.isFinite(duration) ? Math.max(0, duration) : 750;
}
export function validStoryView2D(view: StoryView2D): boolean {
  return [view.centerX, view.centerY, view.zoom].every(Number.isFinite) && view.zoom > 0;
}
export function validStoryView3D(view: StoryView3D): boolean {
  return [view.azimuthRad, view.polarRad, ...view.target, view.visibleHeight, view.morphT].every(Number.isFinite)
    && view.visibleHeight > 0 && view.morphT >= 0 && view.morphT <= 1;
}
/** The 2D mapper's origin is at 45% width; frame the authored point at the viewport center. */
export function storyViewToCamera(view: StoryView2D, vp: Viewport, baseScale: number): CameraTransform {
  const scale = clampZoomScale(baseScale * view.zoom);
  const ppm = getPixelsPerMeter({ ...vp, scale });
  return { scale, offsetX: vp.width * 0.05 - view.centerX * ppm, offsetY: view.centerY * ppm };
}
export function cameraToStoryView(camera: CameraTransform, vp: Viewport, baseScale: number): StoryView2D {
  const ppm = getPixelsPerMeter({ ...vp, scale: camera.scale });
  return { centerX: (vp.width * 0.05 - camera.offsetX) / ppm, centerY: camera.offsetY / ppm,
    zoom: camera.scale / Math.max(1e-6, baseScale) };
}
/** Interpolate in physical center/zoom space so resizing does not stale the pixel offsets. */
export function interpolateStoryView(from: StoryView2D, to: StoryView2D, progress: number): StoryView2D {
  const t = Math.max(0, Math.min(1, progress));
  const u = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return { centerX: from.centerX * (1 - u) + to.centerX * u,
    centerY: from.centerY * (1 - u) + to.centerY * u,
    zoom: Math.exp(Math.log(from.zoom) * (1 - u) + Math.log(to.zoom) * u) };
}
export function flatStoryView(view: StoryView3D, spec: Spatial3DFlattenSpec, vp: Viewport, baseScale: number): StoryView2D {
  const ppm = vp.height / view.visibleHeight;
  return { centerX: view.target[0], centerY: spec.flattenPlane === 'xy' ? view.target[1] : -view.target[2],
    zoom: ppm / getPixelsPerMeter({ ...vp, scale: Math.max(1e-6, baseScale) }) };
}
export function spatialStoryView(view: StoryView2D, spec: Spatial3DFlattenSpec, vp: Viewport, baseScale: number): StoryView3D {
  const camera = storyViewToCamera(view, vp, baseScale);
  const ppm = getPixelsPerMeter({ ...vp, scale: camera.scale });
  return { azimuthRad: spec.default3DAzimuthRad, polarRad: spec.default3DPolarRad,
    target: spec.flattenPlane === 'xy' ? [view.centerX, view.centerY, 0] : [view.centerX, 0, -view.centerY],
    visibleHeight: vp.height / ppm, morphT: 1 };
}
