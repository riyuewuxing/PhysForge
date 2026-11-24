import React, { useMemo } from 'react';
import katex from 'katex';
import type { FormulaDisplayItem } from '@physforge/sim-sdk';

interface KatexFormulaCardProps {
  items: readonly FormulaDisplayItem[];
  compact?: boolean;
  showSubstituted?: boolean;
}

function renderLatex(latex: string): string {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: false
  });
}

export const KatexFormulaCard: React.FC<KatexFormulaCardProps> = ({
  items,
  compact = false,
  showSubstituted = true
}) => {
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
      className={compact ? 'space-y-2 text-center' : 'space-y-2.5'}
      style={{
        ...(compact ? {} : {
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-surface-elevated)'
        })
      }}
    >
      {rendered.map((item) => (
        <div key={item.id} className="space-y-1">
          {!compact && <div className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>{item.label}</div>}
          <div
            className={`overflow-x-auto py-0.5 ${compact ? 'pf-right-formula text-slate-100' : 'text-sm'}`}
            dangerouslySetInnerHTML={{ __html: item.baseHtml }}
          />
          {showSubstituted && item.subHtml && (
            <div
              className="overflow-x-auto py-0.5 text-[11px] text-emerald-400/95"
              dangerouslySetInnerHTML={{ __html: item.subHtml }}
            />
          )}
        </div>
      ))}
    </div>
  );
};
