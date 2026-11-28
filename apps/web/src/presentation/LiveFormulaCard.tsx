import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AnyParamFieldSpec, LiveFormulaSpec, ParamRecord } from '@physforge/sim-sdk';
import { attachFormulaScrubber, formatLiveFormulaValue, renderInteractiveLatex, type ScrubVisualState } from './liveFormulaEngine.js';

interface Props {
  specs: readonly LiveFormulaSpec[];
  params: ParamRecord;
  schema: readonly AnyParamFieldSpec[];
  highlightedId?: string;
  showPaintedSelector?: boolean;
  paintedSelector?: Readonly<{ eFieldVPerM: number; bFieldT: number }>;
  onChange: (key: string, value: number) => void;
  onBegin: (key: string) => void;
  onEnd: (key: string) => void;
}

const FormulaTile: React.FC<Omit<Props, 'specs'> & { spec: LiveFormulaSpec }> = (props) => {
  const { spec } = props;
  const latest = useRef(props);
  latest.current = props;
  const markup = useRef<HTMLDivElement | null>(null);
  const lastLatex = useRef<string | null>(null);
  const hud = useRef<HTMLDivElement | null>(null);
  const hudText = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const appliedText = useRef<HTMLDivElement | null>(null);
  const activeVisual = useRef<ScrubVisualState | null>(null);

  // Pointer intent is not an acknowledgement of a completed physical draw.
  // Keep the 15 Hz parameter/undo policy and refresh the second line only
  // when the stage publishes the parameters from its actual painted frame.
  const paintHud = (state: ScrubVisualState) => {
    const node = hud.current, text = hudText.current, fill = bar.current, applied = appliedText.current;
    if (!node || !text || !fill || !applied) return;
    if (!state.active || !state.binding) {
      node.hidden = true;
      applied.hidden = true;
      delete node.dataset.appliedValue; delete node.dataset.pending;
      return;
    }
    const binding = state.binding;
    const digits = Math.min(12, Math.max(0, binding.precision ?? 3));
    text.textContent = `预览 · ${binding.label}: ${formatLiveFormulaValue(state.value, digits)} ${binding.unit} · ${state.gearLabel}`;
    const ratio = binding.max === binding.min ? 0 : (state.value - binding.min) / (binding.max - binding.min);
    fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    const key = binding.paramKey;
    const showApplied = latest.current.showPaintedSelector && (key === 'eFieldVPerM' || key === 'bFieldT');
    if (showApplied) {
      const value = latest.current.paintedSelector?.[key];
      const known = typeof value === 'number' && Number.isFinite(value);
      const pending = !known || value !== state.value;
      applied.hidden = false;
      applied.textContent = known ? `画面 · ${binding.label}: ${formatLiveFormulaValue(value, digits)} ${binding.unit}${pending ? ' · 等待应用' : ' · 已同步'}` : '画面 · 等待绘制确认';
      node.dataset.pending = String(pending);
      if (known) node.dataset.appliedValue = String(value); else delete node.dataset.appliedValue;
    } else {
      applied.hidden = true;
      delete node.dataset.appliedValue; delete node.dataset.pending;
    }
    node.style.left = `${state.anchorX}px`;
    node.style.top = `${state.anchorY}px`;
    node.style.transform = '';
    node.hidden = false;
    if (showApplied) {
      const half = node.offsetWidth / 2 + 6;
      node.style.left = `${Math.max(half, Math.min(window.innerWidth - half, state.anchorX))}px`;
      // A second row must not move the HUD above the viewport.
      if (state.anchorY < node.offsetHeight + 12) {
        node.style.top = `${state.anchorY + 30}px`;
        node.style.transform = 'translateX(-50%)';
      }
    }
  };


  useLayoutEffect(() => {
    const container = markup.current;
    if (!container) return;
    // Exactly one DOM write per immutable formula spec, independent of params/telemetry updates.
    if (lastLatex.current !== spec.latex) {
      container.innerHTML = renderInteractiveLatex(spec.latex);
      lastLatex.current = spec.latex;
    }
    return attachFormulaScrubber(container, spec, {
      getParamValue: (key) => {
        const value = latest.current.params[key];
        return typeof value === 'number' ? value : NaN;
      },
      getDefaultValue: (key) => {
        const field = latest.current.schema.find((item) => item.key === key);
        return field?.kind === 'number' ? field.defaultValue : NaN;
      },
      onBegin: (key) => latest.current.onBegin(key),
      onParamChange: (key, value) => latest.current.onChange(key, value),
      onEnd: (key) => latest.current.onEnd(key),
      onVisualUpdate: (state) => {
        activeVisual.current = state.active ? state : null;
        paintHud(state);
      }
    });
  }, [spec]);
  useLayoutEffect(() => {
    if (activeVisual.current) paintHud(activeVisual.current);
  }, [props.showPaintedSelector, props.paintedSelector]);

  return <div data-formula-id={spec.id} data-highlighted={props.highlightedId === spec.id ? "true" : undefined}
    className={`pf-live-formula-tile ${props.highlightedId === spec.id ? 'rounded-lg ring-2 ring-amber-300 bg-amber-400/10' : ''}`}>
    {spec.title && <div className="mb-1 text-xs text-slate-400">{spec.title}</div>}
    <div ref={markup} data-testid={`live-formula-${spec.id}`} className="pf-live-formula-markup" />
    {createPortal(<div ref={hud} hidden className="pf-live-formula-hud" data-testid="live-formula-hud" aria-hidden="true">
      <div ref={hudText} className="whitespace-nowrap" />
      <div ref={appliedText} hidden className="mt-0.5 whitespace-nowrap text-slate-300" data-testid="live-formula-painted-value" />
      <div className="mt-1 h-1 overflow-hidden rounded bg-slate-600"><div ref={bar} className="h-full rounded bg-sky-400" /></div>
    </div>, document.body)}
  </div>;
};

export const LiveFormulaCard: React.FC<Props> = ({ specs, ...props }) => <div className="space-y-2" data-testid="live-formula-card">
  {specs.map((spec) => <FormulaTile key={spec.id} spec={spec} {...props} />)}
  <div className="text-[10px] text-slate-400">拖动虚线字母预览参数，实时数值随仿真更新；松手提交最终值。垂直偏移或 Shift 精调，双击恢复默认。</div>
</div>;

export default LiveFormulaCard;
