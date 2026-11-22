import React, { useMemo } from 'react';
import katex from 'katex';
import type { FormulaDisplayItem } from '@physforge/sim-sdk';

interface KatexFormulaCardProps {
  items: readonly FormulaDisplayItem[];
}

function renderLatex(latex: string): string {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: false
  });
}

export const KatexFormulaCard: React.FC<KatexFormulaCardProps> = ({ items }) => {
  const rendered = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        baseHtml: renderLatex(item.latex),
        subHtml: item.substitutedLatex ? renderLatex(item.substitutedLatex) : null
      })),
    [items]
  );

  if (rendered.length === 0) return null;

  return (
    <div
      className="rounded-xl border p-3 space-y-2.5"
      style={{
        borderColor: 'var(--pf-border)',
        backgroundColor: 'var(--pf-surface-elevated)'
      }}
    >
      <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--pf-accent)' }}>
        实时物理公式代入
      </div>
      {rendered.map((item) => (
        <div key={item.id} className="space-y-1">
          <div className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>
            {item.label}
          </div>
          <div
            className="text-sm overflow-x-auto py-0.5"
            dangerouslySetInnerHTML={{ __html: item.baseHtml }}
          />
          {item.subHtml && (
            <div
              className="text-sm overflow-x-auto py-0.5 text-emerald-400"
              dangerouslySetInnerHTML={{ __html: item.subHtml }}
            />
          )}
        </div>
      ))}
    </div>
  );
};
