import React, { useMemo } from 'react';
import katex from 'katex';
import type { FormulaDisplayItem } from '@physforge/sim-sdk';

interface KatexFormulaCardProps {
  items: readonly FormulaDisplayItem[];
  compact?: boolean;
  showSubstituted?: boolean;
  highlightedId?: string;
}

function renderLatex(latex: string): string {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: false
  });
}

/** Numeric values are a separate subtree. Updating telemetry cannot replace live scrub tokens. */
const StageReadoutLine = React.memo(({ id, latex }: { id: string; latex: string }) => {
  const html = useMemo(() => renderLatex(latex), [latex]);
  return <div data-readout-id={id} className="overflow-x-auto py-0.5 text-xs text-emerald-300"
    dangerouslySetInnerHTML={{ __html: html }} />;
});
export const StageFormulaReadouts: React.FC<{ items: readonly FormulaDisplayItem[] }> = ({ items }) => {
  const [expanded, setExpanded] = React.useState(true);
  const results = items.filter(item => Boolean(item.substitutedLatex));
  if (!results.length) return null;
  return <section className="mt-2 border-t border-white/10 pt-2" data-testid="stage-formula-readouts">
    <button type="button" className="mb-1 flex w-full items-center justify-between text-xs text-slate-300"
      data-testid="btn-stage-readouts" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span>实时数值</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="max-h-[24vh] space-y-1 overflow-y-auto text-center" data-testid="stage-formula-values">
      {results.map(item => <StageReadoutLine key={item.id} id={item.id} latex={item.substitutedLatex!} />)}
    </div>}
  </section>;
};

export const KatexFormulaCard: React.FC<KatexFormulaCardProps> = ({
  items,
  compact = false,
  showSubstituted = true,
  highlightedId
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
        <div key={item.id} data-formula-id={item.id} data-highlighted={highlightedId === item.id ? "true" : undefined}
          className={`space-y-1 ${highlightedId === item.id ? 'rounded-lg ring-2 ring-amber-300 bg-amber-400/10' : ''}`}>
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
