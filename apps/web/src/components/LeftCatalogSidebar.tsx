import React, { useMemo, useState } from 'react';
import { Activity, BookOpen, Bot, Layers, Maximize2, Menu, Search, Settings, SunMoon, X } from 'lucide-react';
import { simulationCatalog, type SimulationCatalogEntry } from '@physforge/simulations/catalog';
import type { CurriculumTag, DifficultyLevel } from '@physforge/sim-sdk';
import type { ClassroomTheme } from '../store/useClassroomStore.js';

interface LeftCatalogSidebarProps {
  selectedPluginId: string;
  isOpen: boolean;
  theme: ClassroomTheme;
  bigScreenMode: boolean;
  onSelectPlugin: (id: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onOpenCommandPalette: () => void;
  onOpenTeachingPack: () => void;
  onOpenAnalysisLab: () => void;
  onOpenAiCopilot: () => void;
  onToggleTheme: () => void;
  onToggleBigScreen: () => void;
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
  isOpen,
  theme,
  bigScreenMode,
  onSelectPlugin,
  onOpen,
  onClose,
  onOpenCommandPalette,
  onOpenTeachingPack,
  onOpenAnalysisLab,
  onOpenAiCopilot,
  onToggleTheme,
  onToggleBigScreen
}) => {
  const [search, setSearch] = useState('');
  const [textbookFilter, setTextbookFilter] = useState<string>('全部教材');
  const [tagFilter, setTagFilter] = useState<'全部素养' | CurriculumTag>('全部素养');
  const [diffFilter, setDiffFilter] = useState<'全部难度' | DifficultyLevel>('全部难度');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filtered = useMemo<readonly SimulationCatalogEntry[]>(() => {
    const q = search.trim().toLowerCase();
    return simulationCatalog.filter((plugin) => {
      if (textbookFilter !== '全部教材' && !plugin.meta.textbookRef.includes(textbookFilter)) return false;
      if (tagFilter !== '全部素养' && !plugin.meta.curriculumTags.includes(tagFilter)) return false;
      if (diffFilter !== '全部难度' && plugin.meta.difficulty !== diffFilter) return false;
      if (
        q &&
        !plugin.meta.title.toLowerCase().includes(q) &&
        !plugin.meta.id.toLowerCase().includes(q) &&
        !plugin.meta.textbookRef.toLowerCase().includes(q)
      ) return false;
      return true;
    });
  }, [search, textbookFilter, tagFilter, diffFilter]);

  const railButton = (
    testId: string,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    active = false
  ) => (
    <button
      key={testId}
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative grid h-10 w-12 place-items-center transition cursor-pointer ${active ? 'text-sky-400' : 'text-slate-400 hover:text-slate-100'}`}
    >
      {active && <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.9)]" />}
      {icon}
    </button>
  );

  return (
    <>
      <aside
        data-testid="left-catalog-rail"
        className="relative z-30 flex h-full w-12 shrink-0 flex-col items-center justify-between border-r py-2"
        style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-rail-bg)' }}
      >
        <div className="flex flex-col items-center">
          <button
            type="button"
            data-testid="rail-btn-catalog"
            aria-label={isOpen ? '收起物理模型目录' : '展开物理模型目录'}
            title="物理模型目录"
            onClick={isOpen ? onClose : onOpen}
            className={`grid h-10 w-12 place-items-center transition cursor-pointer ${isOpen ? 'text-sky-400' : 'text-slate-300 hover:text-white'}`}
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="mt-4 flex flex-col items-center gap-1.5">
            {railButton('rail-btn-stages', '仿真舞台', <Layers className="h-4 w-4" />, isOpen ? onClose : onOpen, true)}
            {railButton('btn-command-palette', '全局检索 Ctrl+K', <Search className="h-4 w-4" />, onOpenCommandPalette)}
            {railButton('btn-teaching-pack', '教研导学案', <BookOpen className="h-4 w-4" />, onOpenTeachingPack)}
            {railButton('btn-analysis-lab', '数据分析', <Activity className="h-4 w-4" />, onOpenAnalysisLab)}
            {railButton('btn-ai-copilot', 'AI 建模', <Bot className="h-4 w-4" />, onOpenAiCopilot)}
          </div>
        </div>

        <div className="relative">
          {railButton('btn-rail-settings', '显示与主题设置', <Settings className="h-4 w-4" />, () => setSettingsOpen((open) => !open), settingsOpen)}
          {settingsOpen && (
            <div className="pf-floating-glass absolute bottom-1 left-14 z-50 w-48 space-y-1.5 rounded-xl border border-white/10 p-2 shadow-2xl">
              <button type="button" data-testid="btn-rail-theme" onClick={() => { onToggleTheme(); setSettingsOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10 cursor-pointer">
                <SunMoon className="h-3.5 w-3.5 text-sky-400" />
                <span>{theme === 'chalkboard' ? '切换投影白底' : '切换黑板深蓝'}</span>
              </button>
              <button type="button" data-testid="btn-rail-big-screen" onClick={() => { onToggleBigScreen(); setSettingsOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10 cursor-pointer">
                <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
                <span>{bigScreenMode ? '关闭大屏字号' : '开启大屏字号'}</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {isOpen && (
        <>
          <button
            type="button"
            data-testid="catalog-backdrop"
            aria-label="关闭模型目录"
            onClick={onClose}
            className="fixed inset-0 z-30 bg-slate-950/25"
          />
          <aside
            data-testid="left-catalog-sidebar"
            className="pf-floating-glass fixed bottom-0 left-12 top-12 z-40 flex w-80 max-w-[calc(100vw-48px)] flex-col overflow-hidden border-r border-white/10 bg-slate-900/85 text-slate-100 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
              <div>
                <div className="text-sm font-semibold">物理仿真目录</div>
                <div className="text-[10px] text-slate-500">2025 修订课标 · {filtered.length} 个模型</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="收起模型目录"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 border-b border-white/10 p-3">
              <input
                type="search"
                aria-label="搜索物理模型"
                placeholder="搜索模型名称或章节..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/70"
              />
              <select aria-label="按教材分册筛选" value={textbookFilter} onChange={(e) => setTextbookFilter(e.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-slate-950/45 px-2 text-xs text-slate-200">
                {TEXTBOOKS.map((textbook) => <option key={textbook}>{textbook}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="按核心素养筛选" value={tagFilter} onChange={(e) => setTagFilter(e.target.value as '全部素养' | CurriculumTag)} className="h-9 min-w-0 rounded-lg border border-white/10 bg-slate-950/45 px-2 text-[11px] text-slate-200">
                  {TAGS.map((tag) => <option key={tag}>{tag}</option>)}
                </select>
                <select aria-label="按教学难度筛选" value={diffFilter} onChange={(e) => setDiffFilter(e.target.value as '全部难度' | DifficultyLevel)} className="h-9 min-w-0 rounded-lg border border-white/10 bg-slate-950/45 px-2 text-[11px] text-slate-200">
                  {DIFFICULTIES.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
                </select>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
              {filtered.map((plugin) => {
                const active = plugin.meta.id === selectedPluginId;
                return (
                  <button
                    key={plugin.meta.id}
                    type="button"
                    data-testid={`model-card-${plugin.meta.id}`}
                    onClick={() => onSelectPlugin(plugin.meta.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-sky-400/70 bg-sky-400/10' : 'border-white/10 bg-slate-950/25 hover:border-white/20 hover:bg-white/5'}`}
                  >
                    <div className="mb-1 text-sm font-semibold leading-snug">{plugin.meta.title}</div>
                    <div className="mb-2 text-[10px] text-slate-500">{plugin.meta.textbookRef}</div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">{plugin.meta.difficulty}</span>
                      {plugin.meta.curriculumTags.map((tag) => (
                        <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{tag}</span>
                      ))}
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="p-4 text-center text-xs text-slate-500">当前筛选条件下暂无匹配模型</div>}
            </div>
          </aside>
        </>
      )}
    </>
  );
};
