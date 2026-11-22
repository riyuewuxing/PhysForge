import React from 'react';
import type { InvariantReport } from '@physforge/sim-sdk';

interface EnergyBarChartProps {
  observables: Record<string, number>;
  invariants: readonly InvariantReport[];
}

const ENERGY_ITEMS: ReadonlyArray<{
  key: string;
  label: string;
  color: string;
}> = [
  { key: 'kineticEnergy', label: '动能 Ek', color: '#4ade80' },
  { key: 'potentialEnergy', label: '势能 Ep', color: '#38bdf8' },
  { key: 'capacitorEnergy', label: '电容储能 Ec', color: '#a78bfa' },
  { key: 'jouleHeat', label: '焦耳热 Q电', color: '#fb7185' },
  { key: 'frictionHeat', label: '摩擦生热 Q摩', color: '#f472b6' },
  { key: 'groundHeat', label: '地面摩擦热', color: '#fb923c' }
];

export const EnergyBarChart: React.FC<EnergyBarChartProps> = ({ observables, invariants }) => {
  const entries = ENERGY_ITEMS.map((item) => ({
    ...item,
    value: Math.max(0, observables[item.key] ?? 0)
  })).filter((item) => observables[item.key] !== undefined);

  const total = entries.reduce((sum, item) => sum + item.value, 0);
  const scaleRef = Math.max(total, 1e-6);

  return (
    <div
      className="rounded-xl border p-3 space-y-2.5"
      style={{
        borderColor: 'var(--pf-border)',
        backgroundColor: 'var(--pf-surface-elevated)'
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--pf-accent)' }}>
          能量转化实时柱状图
        </span>
        {total > 0 && (
          <span className="text-xs font-mono" style={{ color: 'var(--pf-text-muted)' }}>
            总计 {total.toFixed(2)} J
          </span>
        )}
      </div>

      {entries.length > 0 ? (
        <div className="space-y-1.5">
          {/* 堆叠总能量条 */}
          <div className="h-3.5 w-full rounded-full overflow-hidden flex bg-slate-800/70">
            {entries.map((item) => {
              const pct = (item.value / scaleRef) * 100;
              if (pct <= 0.2) return null;
              return (
                <div
                  key={item.key}
                  style={{ width: `${pct}%`, backgroundColor: item.color }}
                  title={`${item.label}: ${item.value.toFixed(2)} J`}
                />
              );
            })}
          </div>
          {/* 分项数值条 */}
          <div className="space-y-1">
            {entries.map((item) => {
              const pct = Math.min(100, (item.value / scaleRef) * 100);
              return (
                <div key={item.key} className="text-xs">
                  <div className="flex justify-between mb-0.5">
                    <span>{item.label}</span>
                    <span className="font-mono">{item.value.toFixed(2)} J</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: item.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>
          当前波动模型以振幅与相位耦合观测量为主
        </div>
      )}

      {/* 守恒律实时校验徽章 */}
      {invariants.length > 0 && (
        <div className="pt-1.5 border-t space-y-1" style={{ borderColor: 'var(--pf-border)' }}>
          {invariants.map((inv) => (
            <div key={inv.name} className="flex items-center justify-between text-xs">
              <span className="truncate pr-2">{inv.name}</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono shrink-0 ${
                  inv.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {inv.passed ? '✓' : '✗'} {inv.measuredError.toExponential(1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
