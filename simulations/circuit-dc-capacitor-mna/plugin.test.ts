import { describe, expect, it, vi } from 'vitest';
import {
  drawCurrentParticles,
  drawShortCircuitBanner,
  drawShortCircuitGlow,
  voltageToColor
} from './plugin.js';

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn()
  } as unknown as CanvasRenderingContext2D;
}

describe('circuit-dc-capacitor-mna visual helpers', () => {
  it('maps low, middle, high and missing voltages to stable colors', () => {
    expect(voltageToColor(0, 0, 10)).toBe('hsl(215, 88%, 48%)');
    expect(voltageToColor(5, 0, 10)).toBe('hsl(110, 88%, 48%)');
    expect(voltageToColor(10, 0, 10)).toBe('hsl(5, 88%, 48%)');
    expect(voltageToColor(undefined, 0, 10)).toBe('#94a3b8');
    expect(voltageToColor(Number.NaN, 0, 10)).toBe('#94a3b8');
  });

  it('draws current particles in the signed branch direction and skips zero current', () => {
    const forward = createMockContext();
    drawCurrentParticles(forward, 'test-forward-branch', { x: 0, y: 0 }, { x: 100, y: 0 }, 1, 0);
    expect(forward.rotate).toHaveBeenCalledWith(0);
    expect(forward.fill).toHaveBeenCalled();

    const reverse = createMockContext();
    drawCurrentParticles(reverse, 'test-reverse-branch', { x: 0, y: 0 }, { x: 100, y: 0 }, -1, 0);
    expect(reverse.rotate).toHaveBeenCalledWith(-Math.PI);

    const stopped = createMockContext();
    drawCurrentParticles(stopped, 'test-zero-branch', { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 0.05);
    expect(stopped.fill).not.toHaveBeenCalled();
  });

  it('draws short-circuit glow and a readable warning banner without throwing', () => {
    const ctx = createMockContext();

    expect(() => drawShortCircuitGlow(ctx, { x: 0, y: 0 }, { x: 100, y: 0 }, 250)).not.toThrow();
    expect(() => drawShortCircuitBanner(ctx, 640, 'E 与 Rp 接近短接')).not.toThrow();
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('电路短路'),
      expect.any(Number),
      expect.any(Number)
    );
  });
});
