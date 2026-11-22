import { describe, expect, it } from 'vitest';
import type { Viewport } from '@physforge/sim-sdk';
import { CommandStack } from './CommandStack.js';
import {
  DEFAULT_CAMERA_TRANSFORM,
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  panViewport,
  screenToWorld,
  worldToScreen,
  zoomViewportAtCursor
} from './ViewportController.js';

describe('apps/web stage controllers', () => {
  it('zoomViewportAtCursor keeps exact world coordinate under the cursor and clamps [0.1, 20]', () => {
    const width = 1000;
    const height = 600;
    const cursor = { x: 640, y: 210 };

    const makeVp = (cam: typeof DEFAULT_CAMERA_TRANSFORM): Viewport => ({
      width,
      height,
      dpr: 1,
      scale: cam.scale,
      offsetX: cam.offsetX,
      offsetY: cam.offsetY
    });

    const wBefore = screenToWorld(cursor.x, cursor.y, makeVp(DEFAULT_CAMERA_TRANSFORM));
    const zoomed = zoomViewportAtCursor(DEFAULT_CAMERA_TRANSFORM, cursor.x, cursor.y, width, height, 2.5);
    expect(zoomed.scale).toBeCloseTo(2.5, 8);

    const wAfter = screenToWorld(cursor.x, cursor.y, makeVp(zoomed));
    expect(wAfter.x).toBeCloseTo(wBefore.x, 8);
    expect(wAfter.y).toBeCloseTo(wBefore.y, 8);

    const sCheck = worldToScreen(wBefore.x, wBefore.y, makeVp(zoomed));
    expect(sCheck.x).toBeCloseTo(cursor.x, 8);
    expect(sCheck.y).toBeCloseTo(cursor.y, 8);

    const panned = panViewport(zoomed, 30, -20);
    expect(panned.offsetX).toBeCloseTo(zoomed.offsetX + 30, 8);

    const maxZoom = zoomViewportAtCursor(zoomed, 500, 300, width, height, 500);
    expect(maxZoom.scale).toBe(MAX_ZOOM_SCALE);
    const minZoom = zoomViewportAtCursor(zoomed, 500, 300, width, height, 0.001);
    expect(minZoom.scale).toBe(MIN_ZOOM_SCALE);
  });

  it('CommandStack manages 50-step undo/redo scoped cleanly per modelId', () => {
    const stack = new CommandStack(50);
    for (let i = 1; i <= 55; i++) {
      stack.push({
        modelId: 'm1',
        label: `step-${i}`,
        beforeParams: { x: i - 1 },
        afterParams: { x: i }
      });
    }
    expect(stack.canUndo('m1')).toBe(true);
    expect(stack.canUndo('m2')).toBe(false);

    const undone = stack.undo('m1');
    expect(undone?.afterParams.x).toBe(55);
    expect(stack.canRedo('m1')).toBe(true);

    const redone = stack.redo('m1');
    expect(redone?.afterParams.x).toBe(55);

    // Cap at 50 entries: undoing all should yield 50 entries
    let count = 0;
    while (stack.undo('m1')) {
      count += 1;
    }
    expect(count).toBe(50);
  });
});
