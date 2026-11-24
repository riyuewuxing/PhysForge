import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachFormulaScrubber, clampAndQuantize, getScrubGear, renderInteractiveLatex, type ScrubVisualState } from './liveFormulaEngine.js';
import type { LiveFormulaSpec } from '@physforge/sim-sdk';

describe('live formula scrubber', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses correct gears and quantizes arbitrary decimal and tiny SI steps', () => {
    expect(getScrubGear(0)).toEqual({ factor: 1, label: '1×' });
    expect(getScrubGear(-70)).toEqual({ factor: 0.25, label: '0.25×' });
    expect(getScrubGear(120)).toEqual({ factor: 0.1, label: '0.1×' });
    expect(getScrubGear(0, true).factor).toBe(0.1);
    expect(clampAndQuantize(0.26, 0, 1, 0.25)).toBe(0.25);
    expect(clampAndQuantize(2.6, 0, 10, 2.5)).toBe(2.5);
    expect(clampAndQuantize(0.03, -0.15, 0.15, 0.02)).toBe(0.03);
    expect(clampAndQuantize(2.2e-10, 0, 1e-9, 1e-10)).toBe(2e-10);
    expect(clampAndQuantize(100, -1, 1, 0.1)).toBe(1);
    expect(() => clampAndQuantize(NaN, 0, 1, 0.1)).toThrow();
  });

  it('allows only the interactive KaTeX commands and not external links or images', () => {
    const html = renderInteractiveLatex('r=\\htmlClass{pf-live-var}{\\htmlData{param=B}{B}}');
    expect(html).toContain('data-param="B"');
    expect(html).toContain('pf-live-var');
    const blocked = renderInteractiveLatex('\\href{https://example.test}{bad}\\includegraphics{https://example.test/a.png}');
    expect(blocked).not.toContain('href="https://example.test"');
    expect(blocked).not.toContain('src="https://example.test/a.png"');
  });

  it('captures one pointer, emits the final pending value, resets on double click, and preserves token identity', () => {
    type Handler = (event: unknown) => void;
    class FakeElement {
      dataset = { param: 'B' };
      classes = new Set<string>();
      classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
      captured: number | null = null;
      listeners = new Map<string, Handler>();
      closest() { return this; }
      contains() { return true; }
      setPointerCapture(id: number) { this.captured = id; }
      hasPointerCapture(id: number) { return this.captured === id; }
      releasePointerCapture() { this.captured = null; }
      getBoundingClientRect() { return { left: 10, width: 20, top: 30 }; }
      addEventListener(name: string, handler: Handler) { this.listeners.set(name, handler); }
      removeEventListener(name: string) { this.listeners.delete(name); }
    }
    vi.stubGlobal('HTMLElement', FakeElement);
    const queued = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queued.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { queued.delete(id); });
    const container = new FakeElement();
    const token = new FakeElement();
    const spec: LiveFormulaSpec = { id: 'r', latex: '', bindings: [
      { tokenKey: 'B', paramKey: 'magneticB', label: 'B', unit: 'T', min: 0, max: 10, step: 0.25, sensitivity: 1 }
    ] };
    let current = 2;
    const visual: ScrubVisualState[] = [];
    const changed = vi.fn((_key: string, value: number) => { current = value; });
    const begin = vi.fn(), end = vi.fn();
    const dispose = attachFormulaScrubber(container as unknown as HTMLElement, spec, {
      getParamValue: () => current, getDefaultValue: () => 2, onParamChange: changed,
      onVisualUpdate: (state) => visual.push(state), onBegin: begin, onEnd: end
    });
    const event = (name: string, x: number, y: number, pointerId = 1) => container.listeners.get(name)?.({
      target: token, pointerId, button: 0, isPrimary: true, clientX: x, clientY: y, shiftKey: false,
      preventDefault() {}, stopPropagation() {}
    });
    event('pointerdown', 0, 0);
    event('pointermove', 2, 70, 2);
    expect(changed).not.toHaveBeenCalled();
    event('pointermove', 4, 70);
    expect(visual.at(-1)?.gearLabel).toBe('0.25×');
    event('pointerup', 4, 70);
    expect(changed).toHaveBeenLastCalledWith('magneticB', 3);
    expect(token.captured).toBeNull();
    expect(token.classes.size).toBe(0);
    expect(begin).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    event('dblclick', 0, 0);
    expect(changed).toHaveBeenLastCalledWith('magneticB', 2);
    expect(queued.size).toBe(0);
    dispose();
    expect(container.listeners.size).toBe(0);
  });
});
