import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AnyParamFieldSpec, LiveFormulaSpec, ParamRecord } from '@physforge/sim-sdk';
import { attachFormulaScrubber, renderInteractiveLatex } from './liveFormulaEngine.js';

interface Props {
  specs: readonly LiveFormulaSpec[];
  params: ParamRecord;
  schema: readonly AnyParamFieldSpec[];
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
        const node = hud.current;
        const text = hudText.current;
        const fill = bar.current;
        if (!node || !text || !fill) return;
        if (!state.active || !state.binding) { node.hidden = true; return; }
        const binding = state.binding;
        const digits = Math.min(12, Math.max(0, binding.precision ?? 3));
        text.textContent = `${binding.label}: ${state.value.toFixed(digits)} ${binding.unit} · ${state.gearLabel}`;
        const ratio = binding.max === binding.min ? 0 : (state.value - binding.min) / (binding.max - binding.min);
        fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
        node.style.left = `${state.anchorX}px`;
        node.style.top = `${state.anchorY}px`;
        node.hidden = false;
      }
    });
  }, [spec]);

  return <div className="pf-live-formula-tile">
    {spec.title && <div className="mb-1 text-xs text-slate-400">{spec.title}</div>}
    <div ref={markup} data-testid={`live-formula-${spec.id}`} className="pf-live-formula-markup" />
    {createPortal(<div ref={hud} hidden className="pf-live-formula-hud" data-testid="live-formula-hud" aria-hidden="true">
      <div ref={hudText} className="whitespace-nowrap" />
      <div className="mt-1 h-1 overflow-hidden rounded bg-slate-600"><div ref={bar} className="h-full rounded bg-sky-400" /></div>
    </div>, document.body)}
  </div>;
};

export const LiveFormulaCard: React.FC<Props> = ({ specs, ...props }) => <div className="space-y-2" data-testid="live-formula-card">
  {specs.map((spec) => <FormulaTile key={spec.id} spec={spec} {...props} />)}
  <div className="text-[10px] text-slate-400">拖动带虚线的字母调参，垂直偏移或 Shift 精调，双击恢复默认。</div>
</div>;

export default LiveFormulaCard;
