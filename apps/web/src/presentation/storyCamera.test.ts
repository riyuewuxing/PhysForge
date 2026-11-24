import { describe, expect, it } from 'vitest';
import { createWorldMapper, type Spatial3DFlattenSpec, type Viewport } from '@physforge/sim-sdk';
import { cameraToStoryView, flatStoryView, interpolateStoryView, spatialStoryView,
  storyCameraDuration, storyViewToCamera, validStoryView2D, validStoryView3D } from './storyCamera.js';

const viewport = (width = 1200, height = 800): Viewport => ({ width, height, dpr: 2, scale: 1, offsetX: 0, offsetY: 0 });
const spatial = (flattenPlane: Spatial3DFlattenSpec['flattenPlane']): Spatial3DFlattenSpec =>
  ({ flattenPlane, defaultVisibleHeight: 5, sceneDepthRadius: 8, default3DAzimuthRad: 0.6, default3DPolarRad: 1.1 });
describe('authored camera keyframes', () => {
  it('places physical target at the center and round-trips scale for each viewport size', () => {
    const view = { centerX: 0.7, centerY: -0.8, zoom: 1.5 };
    for (const vp of [viewport(), viewport(720, 1000)]) {
      const camera = storyViewToCamera(view, vp, 1.2);
      const mapper = createWorldMapper({ ...vp, ...camera });
      const p = mapper.toScreen(view.centerX, view.centerY);
      expect(p.x).toBeCloseTo(vp.width / 2, 9);
      expect(p.y).toBeCloseTo(vp.height / 2, 9);
      const restored = cameraToStoryView(camera, vp, 1.2);
      expect(restored.centerX).toBeCloseTo(view.centerX, 9);
      expect(restored.centerY).toBeCloseTo(view.centerY, 9);
      expect(restored.zoom).toBeCloseTo(view.zoom, 9);
    }
  });
  it('uses physical centers and positive zoom through a reversible transition', () => {
    const from = { centerX: -2, centerY: 1, zoom: 0.5 };
    const to = { centerX: 2, centerY: -1, zoom: 2 };
    const mid = interpolateStoryView(from, to, 0.5);
    expect(mid).toEqual({ centerX: 0, centerY: 0, zoom: 1 });
    const reverse = interpolateStoryView(mid, from, 0);
    expect(reverse).toEqual(mid);
    expect(interpolateStoryView(mid, from, 1).zoom).toBeCloseTo(0.5);
  });
  it.each(['xy', 'xz'] as const)('round-trips %s projection, respecting the shared axis convention', plane => {
    const vp = viewport();
    const view = { centerX: 0.2, centerY: -0.5, zoom: 1.25 };
    const spec = spatial(plane);
    const three = spatialStoryView(view, spec, vp, 1.5);
    expect(three.morphT).toBe(1);
    expect(three.target).toEqual(plane === 'xy' ? [0.2, -0.5, 0] : [0.2, 0, 0.5]);
    const restored = flatStoryView(three, spec, vp, 1.5);
    expect(restored.centerX).toBeCloseTo(view.centerX);
    expect(restored.centerY).toBeCloseTo(view.centerY);
    expect(restored.zoom).toBeCloseTo(view.zoom);
  });
  it('rejects non-finite or nonphysical camera inputs', () => {
    expect(validStoryView2D({ centerX: 0, centerY: 0, zoom: 0 })).toBe(false);
    expect(validStoryView2D({ centerX: NaN, centerY: 0, zoom: 1 })).toBe(false);
    expect(validStoryView3D({ azimuthRad: 0, polarRad: 0, target: [0, 0, 0], visibleHeight: 1, morphT: 2 })).toBe(false);
    expect(storyCameraDuration(undefined)).toBe(750);
    expect(storyCameraDuration(-1)).toBe(0);
  });
});
