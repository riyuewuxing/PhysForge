import { describe, expect, it } from 'vitest';
import {
  resolvePluginParams,
  worldToScreen,
  type ControlHandle,
  type ParamRecord,
  type SimulationPluginV2,
  type Viewport
} from '@physforge/sim-sdk';
import { loadSimulationById, simulationCatalog } from './catalog.js';

interface RecordedGeometry {
  worldXs: number[];
  worldYs: number[];
  points: Array<{ x: number; y: number }>;
}

type Transform = [number, number, number, number, number, number];

function createSpyContext(vp: Viewport, out: RecordedGeometry): CanvasRenderingContext2D {
  const stack: Transform[] = [];
  let transform: Transform = [1, 0, 0, 1, 0, 0];

  const point = (x: number, y: number): void => {
    const [a, b, c, d, e, f] = transform;
    const sx = a * x + c * y + e;
    const sy = b * x + d * y + f;
    expect(Number.isFinite(sx) && Number.isFinite(sy)).toBe(true);
    out.worldXs.push(sx);
    out.worldYs.push(sy);
    out.points.push({ x: sx, y: sy });
  };
  const multiply = (next: Transform): void => {
    const [a, b, c, d, e, f] = transform;
    const [na, nb, nc, nd, ne, nf] = next;
    transform = [
      a * na + c * nb,
      b * na + d * nb,
      a * nc + c * nd,
      b * nc + d * nd,
      a * ne + c * nf + e,
      b * ne + d * nf + f
    ];
  };
  const addRect = (x: number, y: number, width: number, height: number): void => {
    if (width >= vp.width * 0.9 && height >= vp.height * 0.9) return;
    point(x, y);
    point(x + width, y);
    point(x, y + height);
    point(x + width, y + height);
  };
  const gradientStub = { addColorStop: () => undefined };
  const spy = {
    save: () => stack.push([...transform]),
    restore: () => { transform = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
    translate: (x: number, y: number) => multiply([1, 0, 0, 1, x, y]),
    rotate: (angle: number) => multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]),
    scale: (x: number, y: number) => multiply([x, 0, 0, y, 0, 0]),
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => multiply([a, b, c, d, e, f]),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { transform = [a, b, c, d, e, f]; },
    resetTransform: () => { transform = [1, 0, 0, 1, 0, 0]; },
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: (x: number, y: number) => point(x, y),
    lineTo: (x: number, y: number) => point(x, y),
    arc: (x: number, y: number, radius = 0) => {
      point(x, y);
      point(x + radius, y);
      point(x - radius, y);
      point(x, y + radius);
      point(x, y - radius);
    },
    arcTo: (x1: number, y1: number, x2: number, y2: number) => { point(x1, y1); point(x2, y2); },
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => { point(cx, cy); point(x, y); },
    bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
      point(c1x, c1y); point(c2x, c2y); point(x, y);
    },
    ellipse: (x: number, y: number, radiusX = 0, radiusY = 0) => {
      point(x, y); point(x + radiusX, y); point(x - radiusX, y); point(x, y + radiusY); point(x, y - radiusY);
    },
    stroke: () => undefined,
    fill: () => undefined,
    clip: () => undefined,
    setLineDash: () => undefined,
    rect: addRect,
    roundRect: addRect,
    fillRect: addRect,
    strokeRect: addRect,
    clearRect: () => undefined,
    fillText: (text: string, _x: number, _y: number) => expect(typeof text).toBe('string'),
    strokeText: (text: string, _x: number, _y: number) => expect(typeof text).toBe('string'),
    measureText: (text: string) => ({ width: text.length * 7.5 }),
    createLinearGradient: () => gradientStub,
    createRadialGradient: () => gradientStub,
    createPattern: () => null,
    font: '13px sans-serif',
    canvas: { width: vp.width, height: vp.height },
    fillStyle: '#fff',
    strokeStyle: '#fff',
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    globalCompositeOperation: 'source-over',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter'
  };
  return spy as unknown as CanvasRenderingContext2D;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function isScreenCornerHud(x: number, y: number, viewport: Viewport): boolean {
  return (x > viewport.width - 230 && y < 155) || (x < 24 && y < 65);
}

describe('Wave B: 全仓 43 单元坐标系与缩放平移锁死审计', () => {
  it.each(simulationCatalog.map(({ meta }) => ({ modelId: meta.id })))('$modelId responds to pan and zoom without NaN or handle divergence', async ({ modelId }) => {
    const panX = 140;
    const panY = -85;
    const baseVp: Viewport = { width: 1440, height: 900, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
    const pannedVp: Viewport = { ...baseVp, offsetX: panX, offsetY: panY };
    const zoomedVp: Viewport = { ...baseVp, scale: 2 };

    const plugin = await loadSimulationById(modelId) as SimulationPluginV2<ParamRecord, unknown>;
    expect(plugin).toBeDefined();
    const presets = plugin.presets.length > 0 ? plugin.presets : [null];

    for (const preset of presets) {
        const params = resolvePluginParams(plugin.paramSchema, preset?.params);
        const state = plugin.engine.createInitialState(params);
        const layers = new Set(plugin.layers.map((layer) => layer.id));
        const base: RecordedGeometry = { worldXs: [], worldYs: [], points: [] };
        const panned: RecordedGeometry = { worldXs: [], worldYs: [], points: [] };
        const zoomed: RecordedGeometry = { worldXs: [], worldYs: [], points: [] };

        plugin.renderCanvas(createSpyContext(baseVp, base), state, params, baseVp, layers);
        plugin.renderCanvas(createSpyContext(pannedVp, panned), state, params, pannedVp, layers);
        plugin.renderCanvas(createSpyContext(zoomedVp, zoomed), state, params, zoomedVp, layers);

        const context = `${modelId} (${preset?.id ?? 'default'})`;
        expect(base.worldXs.length, `${context} rendered no geometry`).toBeGreaterThan(0);
        const panDeltas = base.points.flatMap((point, index) => {
          const moved = panned.points[index];
          if (!moved || isScreenCornerHud(point.x, point.y, baseVp) || isScreenCornerHud(moved.x, moved.y, pannedVp)) return [];
          return [{ x: moved.x - point.x, y: moved.y - point.y }];
        });
        expect(panDeltas.length, `${context} had no measurable scene geometry`).toBeGreaterThan(0);
        const dxMedian = median(panDeltas.map((point) => point.x));
        const dyMedian = median(panDeltas.map((point) => point.y));
        expect(Math.abs(dxMedian - panX), `${context} failed panX: ${dxMedian.toFixed(1)}`).toBeLessThan(28);
        expect(Math.abs(dyMedian - panY), `${context} failed panY: ${dyMedian.toFixed(1)}`).toBeLessThan(28);

        const zoomRatios = base.points.flatMap((point, index) => {
          const scaled = zoomed.points[index];
          if (!scaled || isScreenCornerHud(point.x, point.y, baseVp) || isScreenCornerHud(scaled.x, scaled.y, zoomedVp)) return [];
          const baseRadius = Math.hypot(point.x - baseVp.width * 0.45, point.y - baseVp.height * 0.5);
          if (baseRadius < 20) return [];
          const zoomRadius = Math.hypot(scaled.x - zoomedVp.width * 0.45, scaled.y - zoomedVp.height * 0.5);
          return [zoomRadius / baseRadius];
        });
        expect(zoomRatios.length, `${context} had no measurable zoom geometry`).toBeGreaterThan(0);
        expect(median(zoomRatios), `${context} failed 2x zoom scaling`).toBeGreaterThan(1.45);

        if (plugin.getControlHandles) {
          const handles: ControlHandle[] = plugin.getControlHandles(state, params);
          for (const handle of handles) {
            const p0 = worldToScreen(handle.position.x, handle.position.y, baseVp);
            const pz = worldToScreen(handle.position.x, handle.position.y, zoomedVp);
            expect(Number.isFinite(p0.x) && Number.isFinite(p0.y), `${context} handle ${handle.id}`).toBe(true);
            expect(Math.hypot(pz.x - 1440 * 0.45, pz.y - 900 * 0.5)).toBeCloseTo(
              2 * Math.hypot(p0.x - 1440 * 0.45, p0.y - 900 * 0.5),
              4
            );
          }
        }
    }
  }, 20000);
});
