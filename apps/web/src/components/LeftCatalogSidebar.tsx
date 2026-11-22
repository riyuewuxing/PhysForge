import React, { useMemo, useState } from 'react';
import { simulationPlugins, type AnySimulationPlugin } from '@physforge/simulations/registry';
import type { CurriculumTag, DifficultyLevel } from '@physforge/sim-sdk';

interface LeftCatalogSidebarProps {
  selectedPluginId: string;
  onSelectPlugin: (id: string) => void;
  onClose: () => void;
}

const TEXTBOOKS = [
  '全部教材',
  '必修第一册',
  '必修第二册',
  '必修第三册',
  '选择性必修一',
  '选择性必修二',
  '选择性必修三'
] as const;
const TAGS: readonly ('全部素养' | CurriculumTag)[] = [
  '全部素养',
  '物理观念',
  '科学思维',
  '科学探究',
  '科学态度与责任'
];
const DIFFICULTIES: readonly ('全部难度' | DifficultyLevel)[] = [
  '全部难度',
  '基础新授',
  '高三一轮',
  '压轴专题'
];

export const LeftCatalogSidebar: React.FC<LeftCatalogSidebarProps> = ({
  selectedPluginId,
  onSelectPlugin,
  onClose
}) => {
  const [search, setSearch] = useState('');
  const [textbookFilter, setTextbookFilter] = useState<string>('全部教材');
  const [tagFilter, setTagFilter] = useState<'全部素养' | CurriculumTag>('全部素养');
  const [diffFilter, setDiffFilter] = useState<'全部难度' | DifficultyLevel>('全部难度');

  const filtered = useMemo<readonly AnySimulationPlugin[]>(() => {
    const q = search.trim().toLowerCase();
    return simulationPlugins.filter((p) => {
      if (textbookFilter !== '全部教材' && !p.meta.textbookRef.includes(textbookFilter)) {
        return false;
      }
      if (tagFilter !== '全部素养' && !p.meta.curriculumTags.includes(tagFilter)) {
        return false;
      }
      if (diffFilter !== '全部难度' && p.meta.difficulty !== diffFilter) {
        return false;
      }
      if (
        q &&
        !p.meta.title.toLowerCase().includes(q) &&
        !p.meta.id.toLowerCase().includes(q) &&
        !p.meta.textbookRef.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [search, textbookFilter, tagFilter, diffFilter]);

  return (
    <aside
      data-testid="left-catalog-sidebar"
      className="w-72 shrink-0 border-r flex flex-col min-h-0 overflow-hidden"
      style={{
        borderColor: 'var(--pf-border)',
        backgroundColor: 'var(--pf-surface)'
      }}
    >
      <div
        className="px-3 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--pf-border)' }}
      >
        <div>
          <div className="font-bold text-sm">人教版仿真大厅</div>
          <div className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>
            2025 修订课标索引
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起模型目录"
          className="pf-touch-target px-2.5 py-1 rounded-lg border text-xs cursor-pointer"
          style={{ borderColor: 'var(--pf-border)' }}
        >
          收起
        </button>
      </div>

      <div className="p-3 space-y-2 border-b" style={{ borderColor: 'var(--pf-border)' }}>
        <input
          type="search"
          aria-label="搜索物理模型"
          placeholder="搜索模型名称或章节..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--pf-border)',
            backgroundColor: 'var(--pf-surface-elevated)',
            color: 'var(--pf-text)'
          }}
        />
        <div className="grid grid-cols-1 gap-1.5">
          <select
            aria-label="按教材分册筛选"
            value={textbookFilter}
            onChange={(e) => setTextbookFilter(e.target.value)}
            className="w-full rounded-lg border px-2.5 py-2 text-xs"
            style={{
              borderColor: 'var(--pf-border)',
              backgroundColor: 'var(--pf-surface-elevated)',
              color: 'var(--pf-text)'
            }}
          >
            {TEXTBOOKS.map((tb) => (
              <option key={tb} value={tb}>
                {tb}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <select
              aria-label="按核心素养筛选"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value as '全部素养' | CurriculumTag)}
              className="w-full rounded-lg border px-2 py-2 text-xs"
              style={{
                borderColor: 'var(--pf-border)',
                backgroundColor: 'var(--pf-surface-elevated)',
                color: 'var(--pf-text)'
              }}
            >
              {TAGS.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
            <select
              aria-label="按教学难度筛选"
              value={diffFilter}
              onChange={(e) => setDiffFilter(e.target.value as '全部难度' | DifficultyLevel)}
              className="w-full rounded-lg border px-2 py-2 text-xs"
              style={{
                borderColor: 'var(--pf-border)',
                backgroundColor: 'var(--pf-surface-elevated)',
                color: 'var(--pf-text)'
              }}
            >
              {DIFFICULTIES.map((df) => (
                <option key={df} value={df}>
                  {df}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {filtered.map((plugin) => {
          const active = plugin.meta.id === selectedPluginId;
          return (
            <button
              key={plugin.meta.id}
              type="button"
              data-testid={`model-card-${plugin.meta.id}`}
              onClick={() => onSelectPlugin(plugin.meta.id)}
              className="pf-touch-target w-full text-left rounded-xl border p-3 transition cursor-pointer"
              style={{
                borderColor: active ? 'var(--pf-accent)' : 'var(--pf-border)',
                backgroundColor: active
                  ? 'rgba(56, 189, 248, 0.14)'
                  : 'var(--pf-surface-elevated)'
              }}
            >
              <div className="font-bold text-sm leading-snug mb-1">{plugin.meta.title}</div>
              <div className="text-xs mb-2" style={{ color: 'var(--pf-text-muted)' }}>
                {plugin.meta.textbookRef}
              </div>
              <div className="flex flex-wrap gap-1">
                <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[11px]">
                  {plugin.meta.difficulty}
                </span>
                {plugin.meta.curriculumTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 rounded bg-slate-500/20 text-[11px]"
                    style={{ color: 'var(--pf-text-muted)' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-4 text-center text-xs" style={{ color: 'var(--pf-text-muted)' }}>
            当前筛选条件下暂无匹配模型
          </div>
        )}
      </div>
    </aside>
  );
};
