import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  Compass,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  MoveDiagonal2,
  Pause,
  PenTool,
  Play,
  Redo2,
  RotateCcw,
  Ruler,
  Search,
  Sparkles,
  StepForward,
  SunMoon,
  Undo2
} from 'lucide-react';
import type { ParamRecord, SimulationPluginV2 } from '@physforge/sim-sdk';
import { useClassroomStore } from './store/useClassroomStore.js';
import { SimulationStage, type RecordedTelemetryFrame } from './components/SimulationStage.js';
import { LeftCatalogSidebar } from './components/LeftCatalogSidebar.js';
import { RightControlPanel } from './components/RightControlPanel.js';
import { TeachingPackDrawer } from './components/TeachingPackDrawer.js';
import type { MeasureToolKind } from './stage/RulerToolboxOverlay.js';

const LazyExcalidrawOverlay = React.lazy(() =>
  import('./components/ExcalidrawOverlay.js').then((m) => ({ default: m.ExcalidrawOverlay }))
);

const LazyAnalysisLabDrawer = React.lazy(() =>
  import('./components/AnalysisLabDrawer.js').then((m) => ({ default: m.AnalysisLabDrawer }))
);

const LazyCommandPalette = React.lazy(() =>
  import('./components/CommandPalette.js').then((m) => ({ default: m.CommandPalette }))
);

const LazyExportStudioDrawer = React.lazy(() =>
  import('./components/ExportStudioDrawer.js').then((m) => ({ default: m.ExportStudioDrawer }))
);

const LazyAiCopilotDrawer = React.lazy(() =>
  import('./components/AiCopilotDrawer.js').then((m) => ({ default: m.AiCopilotDrawer }))
);

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 1, 2] as const;

export const App: React.FC = () => {
  const store = useClassroomStore();
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotsGetterRef = useRef<() => readonly RecordedTelemetryFrame[]>(() => []);
  const [teachingPackOpen, setTeachingPackOpen] = useState(false);
  const [analysisLabOpen, setAnalysisLabOpen] = useState(false);
  const [exportStudioOpen, setExportStudioOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [aiCopilotOpen, setAiCopilotOpen] = useState(false);
  const [labFrames, setLabFrames] = useState<readonly RecordedTelemetryFrame[]>([]);

  const handleRegisterSnapshotsGetter = useCallback(
    (getter: () => readonly RecordedTelemetryFrame[]) => {
      snapshotsGetterRef.current = getter;
    },
    []
  );

  const plugin = store.loadedPlugin;
  const v2Plugin = plugin as SimulationPluginV2<ParamRecord, unknown>;

  // 同步文档主题属性
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', store.theme);
  }, [store.theme]);

  // 课堂快捷键支持（Ctrl+K 全局检索、Ctrl+Z/Shift+Z 撤销重做、1-9 预设、Space 播放、S 单步、R 重置、P 遮罩、B 大屏）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redoParam();
        else store.undoParam();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redoParam();
        return;
      }

      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (store.annotationOpen || commandPaletteOpen) return;

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
  }, [plugin, store.annotationOpen, commandPaletteOpen]);

  const toggleMeasureTool = (tool: Exclude<MeasureToolKind, 'none'>) => {
    store.setMeasureTool(store.measureTool === tool ? 'none' : tool);
  };

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
            data-testid="btn-undo"
            disabled={!store.canUndo}
            onClick={store.undoParam}
            title="撤销 (Ctrl+Z)"
            className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer disabled:opacity-40"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <Undo2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-testid="btn-redo"
            disabled={!store.canRedo}
            onClick={store.redoParam}
            title="重做 (Ctrl+Shift+Z)"
            className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer disabled:opacity-40"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-testid="btn-tool-ruler"
            onClick={() => toggleMeasureTool('ruler')}
            title="虚拟直尺"
            className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.measureTool === 'ruler' ? 'var(--pf-accent)' : 'var(--pf-border)',
              backgroundColor: store.measureTool === 'ruler' ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
            }}
          >
            <Ruler className="w-4 h-4" />
            <span>直尺</span>
          </button>

          <button
            type="button"
            data-testid="btn-tool-protractor"
            onClick={() => toggleMeasureTool('protractor')}
            title="0.1° 量角器"
            className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.measureTool === 'protractor' ? '#fbbf24' : 'var(--pf-border)',
              backgroundColor: store.measureTool === 'protractor' ? 'rgba(251, 191, 36, 0.16)' : 'transparent'
            }}
          >
            <MoveDiagonal2 className="w-4 h-4" />
            <span>量角器</span>
          </button>

          <button
            type="button"
            data-testid="btn-tool-compass"
            onClick={() => toggleMeasureTool('compass')}
            title="三点圆规"
            className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: store.measureTool === 'compass' ? '#34d399' : 'var(--pf-border)',
              backgroundColor: store.measureTool === 'compass' ? 'rgba(52, 211, 153, 0.16)' : 'transparent'
            }}
          >
            <Compass className="w-4 h-4" />
            <span>圆规</span>
          </button>

          {v2Plugin.getForceVectors && (
            <button
              type="button"
              data-testid="btn-auto-fbd"
              onClick={store.toggleAutoFbd}
              className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer"
              style={{
                borderColor: store.autoFbdEnabled ? '#fb7185' : 'var(--pf-border)',
                backgroundColor: store.autoFbdEnabled ? 'rgba(244, 63, 94, 0.16)' : 'transparent'
              }}
            >
              <span>受力FBD</span>
            </button>
          )}

          {v2Plugin.referenceFrames && v2Plugin.referenceFrames.length > 0 && (
            <select
              aria-label="观察参考系"
              data-testid="select-reference-frame"
              value={store.activeFrameId}
              onChange={(e) => store.setActiveFrameId(e.target.value)}
              className="pf-touch-target rounded-xl border px-2.5 py-1.5 text-sm cursor-pointer"
              style={{
                borderColor: 'var(--pf-border)',
                backgroundColor: 'var(--pf-surface-elevated)',
                color: 'var(--pf-text)'
              }}
            >
              <option value="ground">地面参考系</option>
              {v2Plugin.referenceFrames.map((rf) => (
                <option key={rf.id} value={rf.id}>
                  {rf.label}
                </option>
              ))}
            </select>
          )}

          {(v2Plugin.renderMode === 'three3d' || v2Plugin.renderMode === 'hybrid' || v2Plugin.mountThreeScene) && (
            <button
              type="button"
              data-testid="btn-view-3d"
              onClick={store.toggleView3d}
              className="pf-touch-target inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-sm cursor-pointer"
              style={{
                borderColor: store.view3dEnabled ? 'var(--pf-accent)' : 'var(--pf-border)',
                backgroundColor: store.view3dEnabled ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
              }}
            >
              <span>{store.view3dEnabled ? '切回 2D' : '3D 视角'}</span>
            </button>
          )}

          <button
            type="button"
            data-testid="btn-analysis-lab"
            onClick={() => {
              setLabFrames(snapshotsGetterRef.current());
              setAnalysisLabOpen(true);
            }}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: analysisLabOpen ? 'var(--pf-accent)' : 'var(--pf-border)',
              backgroundColor: analysisLabOpen ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
            }}
          >
            <Activity className="w-4 h-4" />
            <span>数据分析</span>
          </button>

          <button
            type="button"
            data-testid="btn-command-palette"
            onClick={() => setCommandPaletteOpen(true)}
            title="全局检索与 Vault (Ctrl+K)"
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <Search className="w-4 h-4" />
            <span>检索 Ctrl+K</span>
          </button>

          <button
            type="button"
            data-testid="btn-export-studio"
            onClick={() => setExportStudioOpen(true)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: exportStudioOpen ? '#fbbf24' : 'var(--pf-border)',
              backgroundColor: exportStudioOpen ? 'rgba(251, 191, 36, 0.16)' : 'transparent'
            }}
          >
            <ImageIcon className="w-4 h-4" />
            <span>导出配图</span>
          </button>

          <button
            type="button"
            data-testid="btn-ai-copilot"
            onClick={() => setAiCopilotOpen(true)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{
              borderColor: aiCopilotOpen ? '#38bdf8' : 'var(--pf-border)',
              backgroundColor: aiCopilotOpen ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
            }}
          >
            <Bot className="w-4 h-4" />
            <span>AI 建模</span>
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
            measureTool={store.measureTool}
            autoFbdEnabled={store.autoFbdEnabled}
            fbdComponentsEnabled={store.fbdComponentsEnabled}
            activeFrameId={store.activeFrameId}
            view3dEnabled={store.view3dEnabled}
            resetViewNonce={store.resetViewNonce}
            resetNonce={store.resetNonce}
            stepOnceNonce={store.stepOnceNonce}
            scrubTime={store.scrubTime}
            canvasRefExternal={simCanvasRef}
            onResetView={store.triggerResetView}
            onUpdateParamsBatch={store.updateParamsBatch}
            onRegisterSnapshotsGetter={handleRegisterSnapshotsGetter}
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

      {analysisLabOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 text-sky-300 font-semibold">
              正在按需加载数据分析实验室...
            </div>
          }
        >
          <LazyAnalysisLabDrawer
            plugin={plugin}
            params={store.params}
            frames={labFrames}
            theme={store.theme}
            onScrubTime={store.setScrubTime}
            onClose={() => setAnalysisLabOpen(false)}
          />
        </Suspense>
      )}

      {commandPaletteOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 text-sky-300 font-semibold">
              正在加载全局索引与 Vault 资产库...
            </div>
          }
        >
          <LazyCommandPalette
            currentModelId={plugin.meta.id}
            currentModelTitle={plugin.meta.title}
            currentParams={store.params}
            onSelectModelPreset={(modelId, presetId, overrideParams) =>
              store.applyExternalState(modelId, presetId, overrideParams)
            }
            onClose={() => setCommandPaletteOpen(false)}
          />
        </Suspense>
      )}

      {exportStudioOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 text-amber-300 font-semibold">
              正在按需加载试卷矢量配图与媒体导出工坊...
            </div>
          }
        >
          <LazyExportStudioDrawer
            plugin={plugin}
            params={store.params}
            activeLayers={store.activeLayers}
            simCanvasRef={simCanvasRef}
            getSnapshotStates={() =>
              snapshotsGetterRef.current().map((s) => ({ t: s.t, state: s.state ?? null }))
            }
            onClose={() => setExportStudioOpen(false)}
          />
        </Suspense>
      )}

      {aiCopilotOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 text-sky-300 font-semibold">
              正在加载 AI 逆向建模与物理防幻觉审计台...
            </div>
          }
        >
          <LazyAiCopilotDrawer
            onApplyScene={(modelId, presetId, params) =>
              store.applyExternalState(modelId, presetId, params)
            }
            onClose={() => setAiCopilotOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
