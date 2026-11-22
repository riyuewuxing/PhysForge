import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Download, FileText, Printer, X } from 'lucide-react';
import { parseTeachingPack, type TeachingPack } from '@physforge/pedagogy-schema';
import { resolveCanonicalModelId } from '@physforge/simulations/catalog';

interface TeachingPackDrawerProps {
  modelId: string;
  onLoadPreset: (presetId: string, enablePoeMask?: boolean) => void;
  onClose: () => void;
}

const rawPackModules = import.meta.glob<{ default: unknown }>(
  '../../../../content/teaching-packs/*.json',
  { eager: true }
);

function loadAllPacks(): TeachingPack[] {
  const list: TeachingPack[] = [];
  for (const mod of Object.values(rawPackModules)) {
    const candidate = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
    list.push(parseTeachingPack(candidate));
  }
  return list;
}

function buildHandoutMarkdown(pack: TeachingPack): string {
  const lines: string[] = [
    `# ${pack.title} — 循证物理导学案`,
    '',
    `- **教材章节**：${pack.curriculum.textbook} · ${pack.curriculum.chapter}（${pack.curriculum.section ?? ''}）`,
    `- **核心素养**：${pack.curriculum.curriculumTags.join('、')} ｜ **难度**：${pack.curriculum.difficulty}`,
    '',
    '## 一、学习目标',
    ...pack.curriculum.learningObjectives.map((obj, idx) => `${idx + 1}. ${obj}`),
    '',
    '## 二、POE 课堂探究任务单'
  ];

  for (const poe of pack.poeWorksheets) {
    lines.push(
      `### ${poe.title}`,
      `- **Predict（预测）**：${poe.predictPrompt}`,
      `- **Observe（观察步骤）**：`,
      ...poe.observeSteps.map((st, idx) => `  ${idx + 1}. ${st}`),
      `- **Explain（解释思考）**：${poe.explainPrompt}`,
      `- **探究结论**：${poe.conclusionSummary}`,
      ''
    );
  }

  lines.push('## 三、母题与分层变式训练（物理内核验算无误）');
  for (const q of pack.variantQuestions) {
    lines.push(`### [${q.tier}] ${q.stem}`);
    if (q.options) {
      q.options.forEach((opt, i) => {
        lines.push(`- ${String.fromCharCode(65 + i)}. ${opt}`);
      });
    }
    lines.push(`- **参考答案**：${q.answer}`, `- **解析**：${q.analysis}`, '');
  }

  lines.push('## 四、前概念误区辨析');
  for (const mis of pack.misconceptions) {
    lines.push(
      `### ${mis.title}`,
      `- **常见直觉误区**：${mis.misconception}`,
      `- **科学物理图景**：${mis.scientificConcept}`,
      ''
    );
  }
  return lines.join('\n');
}

export const TeachingPackDrawer: React.FC<TeachingPackDrawerProps> = ({
  modelId,
  onLoadPreset,
  onClose
}) => {
  const allPacks = useMemo(() => loadAllPacks(), []);
  const activePack = useMemo(() => {
    const canonical = resolveCanonicalModelId(modelId);
    return (
      allPacks.find(
        (pack) =>
          pack.poeWorksheets.some((p) => resolveCanonicalModelId(p.modelId) === canonical) ||
          pack.variantQuestions.some((q) => resolveCanonicalModelId(q.modelId) === canonical)
      ) ?? null
    );
  }, [allPacks, modelId]);

  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});
  const [exportMsg, setExportMsg] = useState('');

  const handleDownloadMarkdown = () => {
    if (!activePack) return;
    const md = buildHandoutMarkdown(activePack);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `physforge-handout-${modelId}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMsg('已导出 Markdown 导学案');
  };

  return (
    <div
      data-testid="teaching-pack-drawer"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-xl border-l shadow-2xl flex flex-col pf-printable-drawer"
      style={{
        backgroundColor: 'var(--pf-surface)',
        borderColor: 'var(--pf-border)',
        color: 'var(--pf-text)'
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0"
        style={{ borderColor: 'var(--pf-border)' }}
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <BookOpen className="w-5 h-5 text-sky-400" />
          <span>循证教研包与课堂导学案</span>
        </div>
        <div className="flex items-center gap-1.5 no-print">
          {activePack && (
            <>
              <button
                type="button"
                data-testid="btn-export-handout-md"
                onClick={handleDownloadMarkdown}
                className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer"
                style={{ borderColor: 'var(--pf-border)' }}
              >
                <Download className="w-4 h-4" />
                <span>导出导学案</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer"
                style={{ borderColor: 'var(--pf-border)' }}
              >
                <Printer className="w-4 h-4" />
                <span>打印</span>
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="关闭教研面板"
            onClick={onClose}
            className="pf-touch-target inline-flex items-center justify-center px-2.5 py-1.5 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {exportMsg && (
          <div
            data-testid="handout-export-status"
            className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-3 py-2 text-xs text-emerald-400"
          >
            {exportMsg}
          </div>
        )}

        {!activePack ? (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--pf-text-muted)' }}>
            当前沙箱模型为开放探究模式，可结合任意力学积木参数自主开展探究实验。
          </div>
        ) : (
          <>
            {/* 课标与目标 */}
            <section
              className="rounded-xl border p-3.5 space-y-2"
              style={{
                borderColor: 'var(--pf-border)',
                backgroundColor: 'var(--pf-surface-elevated)'
              }}
            >
              <div className="font-bold text-base">{activePack.title}</div>
              <div className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>
                {activePack.curriculum.textbook} · {activePack.curriculum.chapter}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {activePack.curriculum.curriculumTags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 text-xs">
                    {tag}
                  </span>
                ))}
              </div>
              <ul className="list-disc pl-5 text-xs space-y-1 pt-1">
                {activePack.curriculum.learningObjectives.map((obj, idx) => (
                  <li key={idx}>{obj}</li>
                ))}
              </ul>
            </section>

            {/* POE 探究任务单 */}
            <section className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                POE 课堂探究任务单
              </div>
              {activePack.poeWorksheets.map((poe) => (
                <div
                  key={poe.id}
                  className="rounded-xl border p-3.5 space-y-2"
                  style={{
                    borderColor: 'var(--pf-border)',
                    backgroundColor: 'var(--pf-surface-elevated)'
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm">{poe.title}</div>
                    <button
                      type="button"
                      data-testid={`poe-launch-${poe.id}`}
                      onClick={() => {
                        onLoadPreset(poe.presetId, true);
                        onClose();
                      }}
                      className="pf-touch-target no-print px-3 py-1 rounded-lg bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                    >
                      启动 POE 遮罩探究
                    </button>
                  </div>
                  <div className="text-xs leading-relaxed">
                    <strong className="text-amber-300">Predict 预测：</strong>
                    {poe.predictPrompt}
                  </div>
                  <div className="text-xs space-y-1">
                    <strong className="text-sky-300">Observe 观察步骤：</strong>
                    {poe.observeSteps.map((st, idx) => (
                      <div key={idx} className="pl-2">
                        {idx + 1}. {st}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs leading-relaxed">
                    <strong className="text-emerald-400">Explain 归纳：</strong>
                    {poe.explainPrompt}
                  </div>
                </div>
              ))}
            </section>

            {/* 母题与三层变式 */}
            <section className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-sky-400">
                母题与分层变式题组（零幻觉物理内核验算）
              </div>
              {activePack.variantQuestions.map((q) => {
                const shown = Boolean(revealedAnswers[q.id]);
                return (
                  <div
                    key={q.id}
                    className="rounded-xl border p-3.5 space-y-2"
                    style={{
                      borderColor: 'var(--pf-border)',
                      backgroundColor: 'var(--pf-surface-elevated)'
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-xs font-bold">
                        {q.tier}
                      </span>
                      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{q.verification.verifier} 已验算</span>
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed">{q.stem}</p>
                    {q.options && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                        {q.options.map((opt, idx) => (
                          <div key={idx} className="opacity-90">
                            {String.fromCharCode(65 + idx)}. {opt}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1 no-print">
                      <button
                        type="button"
                        data-testid={`run-question-preset-${q.id}`}
                        onClick={() => {
                          onLoadPreset(q.presetId, false);
                          onClose();
                        }}
                        className="pf-touch-target inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-sky-500 text-slate-950 font-bold text-xs cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>运行本题仿真 Preset</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedAnswers((prev) => ({ ...prev, [q.id]: !prev[q.id] }))
                        }
                        className="pf-touch-target px-3 py-1 rounded-lg border text-xs cursor-pointer"
                        style={{ borderColor: 'var(--pf-border)' }}
                      >
                        {shown ? '收起答案解析' : '查看答案解析'}
                      </button>
                    </div>
                    {shown && (
                      <div className="rounded-lg bg-slate-950/40 p-2.5 text-xs space-y-1">
                        <div>
                          <strong>答案：</strong>
                          {q.answer}
                        </div>
                        <div style={{ color: 'var(--pf-text-muted)' }}>
                          <strong>解析：</strong>
                          {q.analysis}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            {/* 误区诊断卡 */}
            <section className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-rose-400">
                前概念误区反例诊断卡
              </div>
              {activePack.misconceptions.map((mis) => (
                <div
                  key={mis.id}
                  className="rounded-xl border border-rose-500/30 p-3.5 space-y-2"
                  style={{ backgroundColor: 'var(--pf-surface-elevated)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm text-rose-300">{mis.title}</div>
                    <button
                      type="button"
                      onClick={() => {
                        onLoadPreset(mis.counterExamplePresetId, false);
                        onClose();
                      }}
                      className="pf-touch-target no-print px-3 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-400/40 text-xs font-semibold cursor-pointer"
                    >
                      加载反例演示
                    </button>
                  </div>
                  <div className="text-xs">
                    <strong className="text-rose-400">误区直觉：</strong>
                    {mis.misconception}
                  </div>
                  <div className="text-xs">
                    <strong className="text-emerald-400">科学图景：</strong>
                    {mis.scientificConcept}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
