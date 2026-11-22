import React from 'react';
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

export const RightControlPanel: React.FC<RightControlPanelProps> = ({
  plugin,
  activePresetId,
  params,
  activeLayers,
  telemetry,
  onApplyPreset,
  onUpdateParam,
  onToggleLayer,
  onClose
}) => {
  const formulaItems = telemetry.formulaItems;

  return (
    <aside
      data-testid="right-control-panel"
      className="w-80 xl:w-96 shrink-0 border-l flex flex-col min-h-0 overflow-hidden"
      style={{
        borderColor: 'var(--pf-border)',
        backgroundColor: 'var(--pf-surface)'
      }}
    >
      <div
        className="px-3 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--pf-border)' }}
      >
        <div className="font-bold text-sm">预设剧本与参数控制台</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起参数控制栏"
          className="pf-touch-target px-2.5 py-1 rounded-lg border text-xs cursor-pointer"
          style={{ borderColor: 'var(--pf-border)' }}
        >
          收起
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 课堂预设剧本 */}
        <section className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--pf-accent)' }}>
            课堂预设剧本（按数字键 1–{plugin.presets.length} 速切）
          </div>
          <div className="space-y-1.5">
            {plugin.presets.map((preset, idx) => {
              const active = preset.id === activePresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`preset-btn-${preset.id}`}
                  onClick={() => onApplyPreset(preset.id)}
                  className="pf-touch-target w-full text-left rounded-xl border p-2.5 transition cursor-pointer"
                  style={{
                    borderColor: active ? 'var(--pf-accent)' : 'var(--pf-border)',
                    backgroundColor: active
                      ? 'rgba(56, 189, 248, 0.14)'
                      : 'var(--pf-surface-elevated)'
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{preset.name}</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-current opacity-70">
                      [{idx + 1}]
                    </span>
                  </div>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--pf-text-muted)' }}>
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* 动态物理公式代入 */}
        <KatexFormulaCard items={formulaItems} />

        {/* 能量柱状图与守恒校验 */}
        <EnergyBarChart observables={telemetry.observables} invariants={telemetry.invariants} />

        {/* 精准事件钉点记录 */}
        {telemetry.events.length > 0 && (
          <section
            className="rounded-xl border p-3 space-y-1.5"
            style={{
              borderColor: 'var(--pf-border)',
              backgroundColor: 'var(--pf-surface-elevated)'
            }}
          >
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
              精确事件捕获日志（bisectEvent）
            </div>
            {telemetry.events.slice(-4).map((ev) => (
              <div key={ev.id} className="text-xs flex justify-between gap-2">
                <span>{ev.label}</span>
                <span className="font-mono text-amber-300">t = {ev.time.toFixed(5)} s</span>
              </div>
            ))}
          </section>
        )}

        {/* 声明式参数触控控制区 */}
        <section className="space-y-2.5">
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--pf-accent)' }}>
            物理参数实时调节
          </div>
          {plugin.paramSchema.map((field) => {
            const val = params[field.key] ?? field.defaultValue;
            if (field.kind === 'number') {
              const numVal = typeof val === 'number' ? val : field.defaultValue;
              return (
                <div key={field.key} className="space-y-0.5">
                  <div className="flex justify-between text-xs font-medium">
                    <label htmlFor={`param-${field.key}`}>{field.label}</label>
                    <span className="font-mono">
                      {numVal} {field.unit ?? ''}
                    </span>
                  </div>
                  <input
                    id={`param-${field.key}`}
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={numVal}
                    onChange={(e) => onUpdateParam(field.key, Number(e.target.value))}
                    className="pf-slider pf-touch-target"
                  />
                </div>
              );
            }

            if (field.kind === 'boolean') {
              const boolVal = typeof val === 'boolean' ? val : field.defaultValue;
              return (
                <label
                  key={field.key}
                  className="pf-touch-target flex items-center justify-between gap-2 rounded-xl border px-3 py-2 cursor-pointer"
                  style={{
                    borderColor: 'var(--pf-border)',
                    backgroundColor: 'var(--pf-surface-elevated)'
                  }}
                >
                  <span className="text-sm">{field.label}</span>
                  <input
                    type="checkbox"
                    checked={boolVal}
                    onChange={(e) => onUpdateParam(field.key, e.target.checked)}
                    className="w-5 h-5 accent-sky-400"
                  />
                </label>
              );
            }

            // select
            const strVal = typeof val === 'string' ? val : field.defaultValue;
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={`param-${field.key}`} className="text-xs font-medium block">
                  {field.label}
                </label>
                <select
                  id={`param-${field.key}`}
                  value={strVal}
                  onChange={(e) => onUpdateParam(field.key, e.target.value)}
                  className="pf-touch-target w-full rounded-xl border px-3 py-2 text-sm"
                  style={{
                    borderColor: 'var(--pf-border)',
                    backgroundColor: 'var(--pf-surface-elevated)',
                    color: 'var(--pf-text)'
                  }}
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </section>

        {/* 图层显隐开关 */}
        <section className="space-y-1.5">
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--pf-accent)' }}>
            矢量与辅助图层
          </div>
          {plugin.layers.map((layer) => {
            const checked = activeLayers.includes(layer.id);
            return (
              <label
                key={layer.id}
                className="pf-touch-target flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer"
                style={{
                  borderColor: 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)'
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleLayer(layer.id)}
                  className="w-5 h-5 accent-sky-400"
                />
                <span>{layer.label}</span>
              </label>
            );
          })}
        </section>
      </div>
    </aside>
  );
};
