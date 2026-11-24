import { createWorldMapper, resolvePluginParams, type Viewport } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { createInitialState, type Magnetic3dParams } from './engine.js';
import { em3dMagneticFieldsPlugin } from './plugin.js';

const viewport: Viewport = { width: 680, height: 440, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };

function renderCoil(currentI: number) {
  const params: Magnetic3dParams = {
    ...resolvePluginParams(em3dMagneticFieldsPlugin.paramSchema, {
      geometryType: 'helmholtz-coil', currentI: 2, radiusR: 1
    }),
    currentI
  };
  const state = createInitialState(params);
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  let closedPaths = 0;
  const context = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() { closedPaths += 1; }, stroke() {}, fill() {},
    arc(x: number, y: number, radius: number) { arcs.push({ x, y, radius }); }
  } as unknown as CanvasRenderingContext2D;
  em3dMagneticFieldsPlugin.renderCanvas?.(
    context, state, params, viewport, new Set(['conductors', 'fieldLines3d'])
  );
  return { arcs, closedPaths };
}

describe('em-3d-magnetic-fields 2D fallback', () => {
  it('marks opposite coil cross-sections with current direction and arrows each projected field line', () => {
    const mapper = createWorldMapper(viewport);
    const dotRadius = Math.max(1.5, mapper.len(0.055) * 0.18);
    const hasDotAt = (arcs: ReturnType<typeof renderCoil>['arcs'], x: number, y: number) =>
      arcs.some(arc => arc.radius === dotRadius && Math.hypot(arc.x - x, arc.y - y) < 1e-8);
    const top = mapper.toScreen(0.5, 1);
    const bottom = mapper.toScreen(0.5, -1);

    const positive = renderCoil(2);
    expect(hasDotAt(positive.arcs, top.x, top.y)).toBe(true);
    expect(hasDotAt(positive.arcs, bottom.x, bottom.y)).toBe(false);
    expect(positive.closedPaths).toBeGreaterThan(0);

    const reversed = renderCoil(-2);
    expect(hasDotAt(reversed.arcs, top.x, top.y)).toBe(false);
    expect(hasDotAt(reversed.arcs, bottom.x, bottom.y)).toBe(true);
  });
});
