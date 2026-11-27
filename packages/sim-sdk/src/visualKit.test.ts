import { describe, expect, it, vi } from 'vitest';
import type { ParamRecord, Viewport } from './index.js';
import {
  createWorldMapper,
  drawGlowVectorArrow,
  drawMetallicRail,
  getPixelsPerMeter,
  resolveInitialCameraTransform,
  resolveLabelBoxes,
  screenToWorld,
  worldToScreen
} from './visualKit.js';

describe('Canvas visual kit', () => {
  it('maps screen and world coordinates as exact inverses, including pan and frame origins', () => {
    const viewport: Viewport = {
      width: 1440,
      height: 900,
      dpr: 1,
      scale: 1.75,
      offsetX: 135,
      offsetY: -72
    };
    const frameOrigin = { x: 2.5, y: -1.25 };
    const mapper = createWorldMapper(viewport, frameOrigin);
    const world = { x: -3.75, y: 4.125 };
    const expectedPpm = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
    const screen = mapper.toScreen(world.x, world.y);

    expect(getPixelsPerMeter(viewport)).toBe(expectedPpm);
    expect(mapper.ppm).toBe(expectedPpm);
    expect(mapper.toX(world.x)).toBe(screen.x);
    expect(mapper.toY(world.y)).toBe(screen.y);
    expect(mapper.len(2)).toBe(2 * expectedPpm);
    expect(screen).toEqual(worldToScreen(world.x, world.y, viewport, frameOrigin));
    expect(screenToWorld(screen.x, screen.y, viewport, frameOrigin).x).toBeCloseTo(world.x, 10);
    expect(screenToWorld(screen.x, screen.y, viewport, frameOrigin).y).toBeCloseTo(world.y, 10);
  });

  it('resolves model default views from parameters and clamps invalid camera transforms', () => {
    const params: ParamRecord = { scale: 0.42, xRatio: -0.25, yRatio: -0.05 };
    const camera = resolveInitialCameraTransform(
      {
        defaultView: {
          scale: (values) => Number(values.scale),
          offsetRatioX: (values) => Number(values.xRatio),
          offsetRatioY: (values) => Number(values.yRatio)
        }
      },
      params,
      1440,
      900
    );

    expect(camera).toEqual({ scale: 0.42, offsetX: -360, offsetY: -45 });
    expect(resolveInitialCameraTransform(undefined, params, 1440, 900)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0
    });
    expect(resolveInitialCameraTransform(
      { defaultView: { scale: 100, offsetRatioX: Number.POSITIVE_INFINITY } },
      params,
      0,
      Number.NaN
    )).toEqual({ scale: 20, offsetX: 0, offsetY: 0 });
  });

  it('places overlapping labels without overlap and keeps them inside the canvas', () => {
    const labels = resolveLabelBoxes(
      [
        { id: 'first', x: 80, y: 60, text: 'same point', color: '#fff' },
        { id: 'second', x: 80, y: 60, text: 'same point', color: '#0ff' },
        { id: 'edge', x: -50, y: 5, text: 'edge label', color: '#f00' }
      ],
      (text) => text.length * 7,
      180,
      120
    );

    expect(labels).toHaveLength(3);
    const first = labels[0]!;
    const second = labels[1]!;
    const separatedHorizontally = Math.abs(first.x - second.x) >= (first.width + second.width) / 2;
    const separatedVertically = Math.abs(first.y - second.y) >= (first.height + second.height) / 2;
    expect(separatedHorizontally || separatedVertically).toBe(true);
    for (const label of labels) {
      expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(180);
      expect(label.y - label.height / 2).toBeGreaterThanOrEqual(0);
      expect(label.y + label.height / 2).toBeLessThanOrEqual(120);
    }
  });

  it('avoids fixed geometry without moving or drawing it', () => {
    const obstacles = [{x:100,y:80,width:44,height:44},{x:150,y:80,width:28,height:28}];
    const original=JSON.stringify(obstacles);
    const labels=resolveLabelBoxes([
      {id:'near-bob',x:100,y:80,text:'F projected',color:'#fff'},
      {id:'near-second',x:150,y:80,text:'v',color:'#0ff'}
    ],text=>text.length*7,260,180,obstacles);
    expect(labels.map(l=>l.id)).toEqual(['near-bob','near-second']);
    for(const l of labels)for(const o of obstacles){
      expect(Math.abs(l.x-o.x)*2>=l.width+o.width||Math.abs(l.y-o.y)*2>=l.height+o.height).toBe(true);
    }
    expect(JSON.stringify(obstacles)).toBe(original);
  });

  it('draws rail material without erasing the stage or circuit junctions', () => {
    const addColorStop = vi.fn();
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      fillRect: vi.fn(), createLinearGradient: vi.fn(() => ({ addColorStop })),
      globalCompositeOperation: 'source-over'
    } as unknown as CanvasRenderingContext2D;
    drawMetallicRail(ctx, 20, 60, 200, 8);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenCalledWith(20, expect.any(Number), 180, expect.any(Number));
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('ignores degenerate arrows and draws a finite arrow head for valid vectors', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    drawGlowVectorArrow(ctx, 4, 6, 5, 7, '#fff');
    expect(ctx.beginPath).not.toHaveBeenCalled();

    drawGlowVectorArrow(ctx, 0, 0, 20, 0, '#fff');
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalledOnce();
  });
});
