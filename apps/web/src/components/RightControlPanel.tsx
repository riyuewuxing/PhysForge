import React, { useMemo, useState } from 'react';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { TelemetrySummary } from '../store/useClassroomStore.js';
import { KatexFormulaCard } from './KatexFormulaCard.js';
import { EnergyBarChart } from './EnergyBarChart.js';

interface RightControlPanelProps {
  plugin: AnySimulationPlugin;
  activePresetId: string | null;
  params: ParamRecord;
  activeLayers: readonly string[];
  telemetry: TelemetrySummary;
  onApplyPreset: (presetId: string) => void;
  onUpdateParam: (key: string, value: number | boolean | string) => void;
  onToggleLayer: (layerId: string) => void;
  onClose: () => void;
}

const CONTEXT_CORE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'em-induction-double-rod': ['batteryEmf', 'magneticB', 'resistorR', 'externalForce'],
  'builder-optics-ray': ['incidentAngleDeg', 'n1', 'n2', 'objectDistanceM'],
  'optics-ray-studio': ['incidentAngleDeg', 'n1', 'n2', 'objectDistanceM'],
  'builder-circuit-mna': ['emf', 'sliderR', 'internalR'],
  'circuit-dc-capacitor-mna': ['emf', 'sliderR', 'internalR'],
  'em-3d-magnetic-fields': ['currentI', 'radiusR', 'solenoidTurns']
};

export const RightControlPanel: React.FC<RightControlPanelProps> = ({
  plugin,
  activePresetId,
  params,
  activeLayers,
  telemetry,
  onApplyPreset,
  onUpdateParam,
  onToggleLayer
}) => {
  const [showLiveSubstituted, setShowLiveSubstituted] = useState(false);

  const { coreFields, extraFields } = useMemo(() => {
    const preferred = plugin.meta.id === 'modern-photoelectric-compton'
      ? params.mode === 'compton' ? ['xrayWavelengthNm', 'scatterAngleDeg'] : ['wavelengthNm', 'intensityRel', 'anodeVoltageV']
      : CONTEXT_CORE_KEYS[plugin.meta.id];
    const numericFields = plugin.paramSchema.filter((field) => field.kind === 'number');
    const core = preferred
      ? preferred.flatMap((key) => {
          const field = plugin.paramSchema.find((candidate) => candidate.key === key);
          return field?.kind === 'number' ? [field] : [];
        }).slice(0, 3)
      : numericFields.slice(0, 3);
    const coreKeys = new Set(core.map((field) => field.key));
    return {
      coreFields: core,
      extraFields: plugin.paramSchema.filter((field) => !coreKeys.has(field.key))
    };
  }, [plugin, params.mode]);

  const renderField = (field: (typeof plugin.paramSchema)[number]) => {
    const value = params[field.key] ?? field.defaultValue;
    if (field.kind === 'number') {
      const numberValue = typeof value === 'number' ? value : field.defaultValue;
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      const progress = max > min ? Math.max(0, Math.min(100, ((numberValue - min) / (max - min)) * 100)) : 0;
      const decimals = String(field.step ?? '').split('.')[1]?.length ?? 1;
      const shortLabel = field.label.replace(/（[^）]*）/g, '');
      return (
        <div key={field.key} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px] font-medium">
            <label htmlFor={`param-${field.key}`} className="min-w-0 truncate text-slate-300">{shortLabel}</label>
            <span data-testid={`param-value-${field.key}`} className="shrink-0 font-mono tabular-nums text-slate-100">
              {numberValue.toFixed(Math.min(Math.max(decimals, 1), field.key === 'xrayWavelengthNm' ? 3 : 2))} {field.unit ?? ''}
            </span>
          </div>
          <input
            id={`param-${field.key}`}
            type="range"
            data-testid={`param-slider-${field.key}`}
            min={field.min}
            max={field.max}
            step={field.step}
            value={numberValue}
            onChange={(event) => onUpdateParam(field.key, Number(event.target.value))}
            className="pf-slider pf-touch-target"
            style={{ '--pf-progress': `${progress}%` } as React.CSSProperties}
          />
        </div>
      );
    }
    if (field.kind === 'boolean') {
      const checked = typeof value === 'boolean' ? value : field.defaultValue;
      return (
        <label key={field.key} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5 text-[11px] text-slate-200">
          <span>{field.label}</span>
          <input type="checkbox" checked={checked} onChange={(event) => onUpdateParam(field.key, event.target.checked)} className="h-4 w-4 accent-sky-400" />
        </label>
      );
    }
    const selected = typeof value === 'string' ? value : field.defaultValue;
    return (
      <div key={field.key} className="space-y-1">
        <label htmlFor={`param-${field.key}`} className="block text-[10px] text-slate-400">{field.label}</label>
        <select id={`param-${field.key}`} value={selected} onChange={(event) => onUpdateParam(field.key, event.target.value)} className="h-8 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 text-xs text-slate-100">
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    );
  };

  const isCircuit = plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna';
  const emf = typeof params.emf === 'number' ? params.emf : 12;
  const kineticEnergy = telemetry.observables.kineticEnergy;
  const dissipatedOrStoredEnergy = telemetry.observables.jouleHeat ?? telemetry.observables.capacitorEnergy;
  const hasEnergyMetrics = (typeof kineticEnergy === 'number' && Number.isFinite(kineticEnergy))
    || (typeof dissipatedOrStoredEnergy === 'number' && Number.isFinite(dissipatedOrStoredEnergy));
  const kineticPct = Math.max(0, Math.min(100, Math.round(((kineticEnergy ?? 0) / 10) * 100)));
  const heatPct = Math.max(0, Math.min(100, Math.round(((dissipatedOrStoredEnergy ?? 0) / 10) * 100)));

  return (
    <aside
      data-testid="right-control-panel"
      className="pf-floating-glass absolute right-3 top-[22px] z-20 flex max-h-[calc(100%-34px)] w-[272px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-white/10 text-slate-100 shadow-2xl"
      style={{ borderColor: 'var(--pf-border)' }}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-2.5 py-1.5">
          <label htmlFor="preset-select" className="shrink-0 text-[11px] font-medium text-slate-400">预设</label>
          <select
            id="preset-select"
            data-testid="preset-select"
            aria-label="课堂预设"
            value={activePresetId ?? ''}
            onChange={(event) => onApplyPreset(event.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-slate-100 outline-none cursor-pointer"
          >
            {!activePresetId && <option value="" className="bg-slate-900">自定义参数</option>}
            {plugin.presets.map((preset, index) => (
              <option key={preset.id} value={preset.id} data-testid={`preset-btn-${preset.id}`} className="bg-slate-900 text-slate-100">
                {/^[0-9]+\s*[.、]/.test(preset.name) ? preset.name : `${index + 1}. ${preset.name}`}
              </option>
            ))}
          </select>
          {activePresetId && <span data-testid="active-preset-description" className="sr-only">{plugin.presets.find((preset) => preset.id === activePresetId)?.description}</span>}
        </div>

        <section className="space-y-1.5">{coreFields.map(renderField)}</section>

        <section data-testid="formula-card" className="relative rounded-xl border border-white/10 bg-slate-950/75 px-3 pb-3 pt-7 shadow-inner">
          <button
            type="button"
            data-testid="btn-toggle-formula-values"
            aria-label={showLiveSubstituted ? '隐藏代入数值' : '显示代入数值'}
            aria-pressed={showLiveSubstituted}
            onClick={() => setShowLiveSubstituted((shown) => !shown)}
            title={showLiveSubstituted ? '切换纯符号公式' : '显示实时代入数值'}
            className="absolute right-2 top-1.5 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-sky-300 cursor-pointer"
          >
            {showLiveSubstituted ? '仅符号' : '显示数值'}
          </button>
          <KatexFormulaCard items={telemetry.formulaItems} compact showSubstituted={showLiveSubstituted} />
        </section>

        {isCircuit ? (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex justify-between font-mono text-[10px] text-slate-400"><span>0V</span><span>电势分布</span><span>{emf.toFixed(0)}V</span></div>
            <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-rose-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]" />
          </div>
        ) : hasEnergyMetrics ? (
          <div className="space-y-2 pt-0.5">
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>动能 / 场能</span><span className="font-mono">{kineticPct}%</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-sky-400/80 transition-all" style={{ width: `${kineticPct}%` }} /></div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>耗散 / 储能转化</span><span className="font-mono">{heatPct}%</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-amber-400/75 transition-all" style={{ width: `${heatPct}%` }} /></div>
            </div>
          </div>
        ) : null}

        {(extraFields.length > 0 || telemetry.invariants.length > 0 || plugin.layers.length > 0) && (
          <details className="rounded-xl border border-white/10 bg-slate-950/35 px-2.5">
            <summary className="cursor-pointer list-none py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200">更多参数与图层 <span className="float-right">⌄</span></summary>
            <div className="space-y-2.5 pb-3">
              {extraFields.map(renderField)}
              <EnergyBarChart observables={telemetry.observables} invariants={telemetry.invariants} />
              <div className="space-y-1 pt-1">
                {plugin.layers.map((layer) => (
                  <label key={layer.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                    <input type="checkbox" checked={activeLayers.includes(layer.id)} onChange={() => onToggleLayer(layer.id)} className="h-3.5 w-3.5 accent-sky-400" />
                    <span>{layer.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </aside>
  );
};
