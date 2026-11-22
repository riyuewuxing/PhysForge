import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Pause,
  PenTool,
  Play,
  RotateCcw,
  Sparkles,
  StepForward,
  SunMoon
} from 'lucide-react';
import { getSimulationById, simulationPlugins } from '@physforge/simulations/registry';
import { useClassroomStore } from './store/useClassroomStore.js';
import { SimulationStage } from './components/SimulationStage.js';
import { LeftCatalogSidebar } from './components/LeftCatalogSidebar.js';
import { RightControlPanel } from './components/RightControlPanel.js';
import { TeachingPackDrawer } from './components/TeachingPackDrawer.js';

const LazyExcalidrawOverlay = React.lazy(() =>
  import('./components/ExcalidrawOverlay.js').then((m) => ({ default: m.ExcalidrawOverlay }))
);

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 1, 2] as const;

export const App: React.FC = () => {
  const store = useClassroomStore();
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [teachingPackOpen, setTeachingPackOpen] = useState(false);

  const plugin = useMemo(
    () => getSimulationById(store.selectedPluginId) ?? simulationPlugins[0]!,
    [store.selectedPluginId]
  );

  // 同步文档主题属性
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', store.theme);
  }, [store.theme]);

  // 课堂快捷键支持（1-5 预设、Space 播放暂停、S 单步、R 重置、P 遮罩、B 大屏、A 批注）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (store.annotationOpen) return;

      if (e.key === ' ') {
        e.preventDefault();
        store.togglePlaying();
      } else if (e.key === 'r' || e.key === 'R') {
        store.triggerReset();
      } else if (e.key === 's' || e.key === 'S') {
        store.triggerStepOnce();
      } else if (e.key === 'p' || e.key === 'P') {
        store.togglePoeMask();
      } else if (e.key === 'b' || e.key === 'B') {
        store.toggleBigScreenMode();
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const targetPreset = plugin.presets[idx];
        if (targetPreset) {
          store.applyPreset(targetPreset.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [plugin, store.annotationOpen]);

  return (
    <div
      data-testid="app-shell"
      className={`h-screen w-screen flex flex-col overflow-hidden select-none ${
        store.bigScreenMode ? 'big-screen-mode' : ''
      }`}
      style={{
        backgroundColor: 'var(--pf-bg)',
        color: 'var(--pf-text)'
      }}
    >
      {/* 顶部课堂控制工具栏 */}
      <header
        className="shrink-0 border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-surface)'
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!store.leftSidebarOpen && (
            <button
              type="button"
              onClick={() => store.setLeftSidebarOpen(true)}
              className="pf-touch-target px-3 py-1.5 rounded-xl border text-sm font-semibold cursor-pointer"
              style={{ borderColor: 'var(--pf-border)' }}
            >
              模型目录
            </button>
          )}
          <div className="truncate">
            <div className="font-bold text-base truncate">{plugin.meta.title}</div>
            <div className="text-xs truncate" style={{ color: 'var(--pf-text-muted)' }}>
              {plugin.meta.textbookRef} · t = {store.telemetry.t.toFixed(3)} s
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="btn-play-pause"
            onClick={store.togglePlaying}
            className="pf-touch-target inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold hover:bg-sky-400 transition cursor-pointer"
          >
            {store.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{store.isPlaying ? '暂停' : '运行'}</span>
          </button>

          <button
            type="button"
            data-testid="btn-step"
            onClick={store.triggerStepOnce}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <StepForward className="w-4 h-4" />
            <span>单步</span>
          </button>

          <button
            type="button"
            data-testid="btn-reset"
            onClick={store.triggerReset}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <RotateCcw className="w-4 h-4" />
            <span>复位</span>
          </button>

          <select
            aria-label="播放倍速"
            value={store.playbackSpeed}
            onChange={(e) => store.setPlaybackSpeed(Number(e.target.value))}
            className="pf-touch-target rounded-xl border px-2.5 py-1.5 text-sm cursor-pointer"
            style={{
              borderColor: 'var(--pf-border)',
              backgroundColor: 'var(--pf-surface-elevated)',
              color: 'var(--pf-text)'
            }}
          >
            {SPEED_OPTIONS.map((sp) => (
              <option key={sp} value={sp}>
                {sp}x
              </option>
            ))}
          </select>

          <button
            type="button"
            data-testid="btn-strobe"
            onClick={store.toggleStrobe}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.strobeEnabled ? 'var(--pf-accent)' : 'var(--pf-border)',
              backgroundColor: store.strobeEnabled ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
            }}
          >
            <Sparkles className="w-4 h-4" />
            <span>频闪</span>
          </button>

          <button
            type="button"
            data-testid="btn-poe-mask"
            onClick={store.togglePoeMask}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.poeMasked ? '#fbbf24' : 'var(--pf-border)',
              backgroundColor: store.poeMasked ? 'rgba(251, 191, 36, 0.16)' : 'transparent'
            }}
          >
            {store.poeMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span>POE 遮罩</span>
          </button>

          <button
            type="button"
            data-testid="btn-annotation"
            onClick={store.toggleAnnotation}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.annotationOpen ? '#fbbf24' : 'var(--pf-border)',
              backgroundColor: store.annotationOpen ? 'rgba(251, 191, 36, 0.2)' : 'transparent'
            }}
          >
            <PenTool className="w-4 h-4" />
            <span>板书批注</span>
          </button>

          <button
            type="button"
            data-testid="btn-theme"
            onClick={store.toggleTheme}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <SunMoon className="w-4 h-4" />
            <span>{store.theme === 'chalkboard' ? '黑板深蓝' : '投影白底'}</span>
          </button>

          <button
            type="button"
            data-testid="btn-big-screen"
            onClick={store.toggleBigScreenMode}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.bigScreenMode ? 'var(--pf-accent)' : 'var(--pf-border)',
              backgroundColor: store.bigScreenMode ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
            }}
          >
            {store.bigScreenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span>大屏模式</span>
          </button>

          <button
            type="button"
            data-testid="btn-teaching-pack"
            onClick={() => setTeachingPackOpen((v) => !v)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: teachingPackOpen ? 'var(--pf-accent)' : 'var(--pf-border)',
              backgroundColor: teachingPackOpen ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
            }}
          >
            <BookOpen className="w-4 h-4" />
            <span>教研导学案</span>
          </button>

          {!store.rightSidebarOpen && (
            <button
              type="button"
              onClick={() => store.setRightSidebarOpen(true)}
              className="pf-touch-target px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
              style={{ borderColor: 'var(--pf-border)' }}
            >
              参数栏
            </button>
          )}
        </div>
      </header>

      {/* 主三栏工作区 */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {store.leftSidebarOpen && (
          <LeftCatalogSidebar
            selectedPluginId={store.selectedPluginId}
            onSelectPlugin={store.selectPlugin}
            onClose={() => store.setLeftSidebarOpen(false)}
          />
        )}

        <section className="flex-1 min-w-0 min-h-0 p-2.5 flex flex-col relative">
          <SimulationStage
            plugin={plugin}
            params={store.params}
            activeLayers={store.activeLayers}
            isPlaying={store.isPlaying}
            playbackSpeed={store.playbackSpeed}
            strobeEnabled={store.strobeEnabled}
            poeMasked={store.poeMasked}
            theme={store.theme}
            resetNonce={store.resetNonce}
            stepOnceNonce={store.stepOnceNonce}
            scrubTime={store.scrubTime}
            canvasRefExternal={simCanvasRef}
            onScrubTime={store.setScrubTime}
            onTogglePoeMask={store.togglePoeMask}
            onTelemetryUpdate={store.setTelemetry}
          />

          {store.annotationOpen && (
            <Suspense
              fallback={
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70 text-amber-300 font-semibold">
                  正在加载离线 Excalidraw 板书层...
                </div>
              }
            >
              <LazyExcalidrawOverlay
                modelId={plugin.meta.id}
                theme={store.theme}
                simCanvasRef={simCanvasRef}
                onClose={store.toggleAnnotation}
              />
            </Suspense>
          )}
        </section>

        {store.rightSidebarOpen && (
          <RightControlPanel
            plugin={plugin}
            activePresetId={store.activePresetId}
            params={store.params}
            activeLayers={store.activeLayers}
            telemetry={store.telemetry}
            onApplyPreset={store.applyPreset}
            onUpdateParam={store.updateParam}
            onToggleLayer={store.toggleLayer}
            onClose={() => store.setRightSidebarOpen(false)}
          />
        )}
      </main>

      {teachingPackOpen && (
        <TeachingPackDrawer
          modelId={plugin.meta.id}
          onLoadPreset={(presetId, enablePoeMask) => {
            store.applyPreset(presetId);
            if (enablePoeMask && !store.poeMasked) {
              store.togglePoeMask();
            } else if (!enablePoeMask && store.poeMasked) {
              store.togglePoeMask();
            }
          }}
          onClose={() => setTeachingPackOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
