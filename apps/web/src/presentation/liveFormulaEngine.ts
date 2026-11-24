import katex from 'katex';
import type { LiveFormulaSpec, LiveFormulaVarBinding } from '@physforge/sim-sdk';

export function renderInteractiveLatex(latex: string): string {
  return katex.renderToString(latex, {
    throwOnError: false, displayMode: true, strict: 'ignore',
    trust: (context) => context.command === '\\htmlClass' || context.command === '\\htmlData'
  });
}

export type GearLabel = '1×' | '0.25×' | '0.1×';
export interface ScrubVisualState {
  active: boolean;
  binding: LiveFormulaVarBinding | null;
  value: number;
  gearLabel: GearLabel;
  anchorX: number;
  anchorY: number;
}

export function getScrubGear(verticalDistance: number, shift = false): { factor: number; label: GearLabel } {
  const distance = Math.abs(verticalDistance);
  if (shift || distance > 110) return { factor: 0.1, label: '0.1×' };
  if (distance > 55) return { factor: 0.25, label: '0.25×' };
  return { factor: 1, label: '1×' };
}

export function clampAndQuantize(raw: number, min: number, max: number, step: number): number {
  if (![raw, min, max].every(Number.isFinite) || min > max) throw new RangeError('Invalid live formula range or value');
  const clamped = Math.max(min, Math.min(max, raw));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  // Significant digits, not -log10(step): 0.25/2.5 and tiny SI values must stay on their grids.
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.max(min, Math.min(max, Number(snapped.toPrecision(15))));
}

export interface FormulaScrubberHooks {
  getParamValue: (key: string) => number;
  getDefaultValue: (key: string) => number;
  onParamChange: (key: string, value: number) => void;
  onVisualUpdate: (state: ScrubVisualState) => void;
  onBegin?: (key: string) => void;
  onEnd?: (key: string) => void;
}

/** Delegated pointer capture; never renders KaTeX or replaces token nodes. */
export function attachFormulaScrubber(container: HTMLElement, spec: LiveFormulaSpec, hooks: FormulaScrubberHooks): () => void {
  const bindings = new Map(spec.bindings.map((binding) => [binding.tokenKey, binding]));
  let active: { pointerId: number; binding: LiveFormulaVarBinding; element: HTMLElement; startY: number; lastX: number; accum: number; emitted: number } | null = null;
  let raf = 0;
  let lastEmitAt = -Infinity;
  let pending: { key: string; value: number } | null = null;

  const findToken = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return null;
    const element = target.closest<HTMLElement>('[data-param]');
    if (!element || !container.contains(element)) return null;
    const binding = bindings.get(element.dataset.param ?? '');
    return binding ? { element, binding } : null;
  };
  const flush = (now: number) => {
    if (!pending) return;
    const { key, value } = pending;
    pending = null;
    lastEmitAt = now;
    if (active) active.emitted = value;
    hooks.onParamChange(key, value);
  };
  const onFrame = (now: number) => {
    raf = 0;
    if (!pending) return;
    if (now - lastEmitAt >= 1000 / 15) flush(now);
    else raf = requestAnimationFrame(onFrame);
  };
  const schedule = (key: string, value: number) => {
    pending = active?.emitted === value ? null : { key, value };
    if (pending && !raf) raf = requestAnimationFrame(onFrame);
  };
  const show = (binding: LiveFormulaVarBinding, element: HTMLElement, value: number, gearLabel: GearLabel) => {
    const rect = element.getBoundingClientRect();
    hooks.onVisualUpdate({ active: true, binding, value, gearLabel, anchorX: rect.left + rect.width / 2, anchorY: rect.top });
  };
  const hide = () => hooks.onVisualUpdate({ active: false, binding: null, value: 0, gearLabel: '1×', anchorX: 0, anchorY: 0 });

  const onPointerDown = (event: PointerEvent) => {
    if (active || event.isPrimary === false || event.button !== 0) return;
    const token = findToken(event.target);
    if (!token) return;
    const { binding, element } = token;
    const value = hooks.getParamValue(binding.paramKey);
    if (!Number.isFinite(value) || !Number.isFinite(binding.min) || !Number.isFinite(binding.max) || binding.min > binding.max) return;
    event.preventDefault();
    event.stopPropagation();
    try { element.setPointerCapture(event.pointerId); } catch { return; }
    active = { pointerId: event.pointerId, binding, element, startY: event.clientY, lastX: event.clientX, accum: value, emitted: value };
    lastEmitAt = -Infinity;
    element.classList.add('pf-live-var--dragging');
    hooks.onBegin?.(binding.paramKey);
    show(binding, element, value, '1×');
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { binding, element } = active;
    const dx = event.clientX - active.lastX;
    active.lastX = event.clientX;
    const gear = getScrubGear(event.clientY - active.startY, event.shiftKey);
    const sensitivity = binding.sensitivity ?? (binding.max - binding.min) / 240;
    active.accum = Math.max(binding.min, Math.min(binding.max, active.accum + dx * sensitivity * gear.factor));
    const value = clampAndQuantize(active.accum, binding.min, binding.max, binding.step);
    if (dx !== 0) schedule(binding.paramKey, value);
    show(binding, element, value, gear.label);
  };
  const end = (pointerId: number) => {
    if (!active || active.pointerId !== pointerId) return;
    const { element, binding } = active;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    flush(performance.now()); // Do not lose a final event waiting for the next frame.
    active = null;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    element.classList.remove('pf-live-var--dragging');
    hooks.onEnd?.(binding.paramKey);
    hide();
  };
  const onPointerEnd = (event: PointerEvent) => end(event.pointerId);
  const onDoubleClick = (event: MouseEvent) => {
    const token = findToken(event.target);
    if (!token) return;
    event.preventDefault();
    const value = hooks.getDefaultValue(token.binding.paramKey);
    if (Number.isFinite(value)) hooks.onParamChange(token.binding.paramKey, value);
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerEnd);
  container.addEventListener('pointercancel', onPointerEnd);
  container.addEventListener('lostpointercapture', onPointerEnd);
  container.addEventListener('dblclick', onDoubleClick);
  return () => {
    if (active) end(active.pointerId);
    if (raf) cancelAnimationFrame(raf);
    pending = null;
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerEnd);
    container.removeEventListener('pointercancel', onPointerEnd);
    container.removeEventListener('lostpointercapture', onPointerEnd);
    container.removeEventListener('dblclick', onDoubleClick);
  };
}
