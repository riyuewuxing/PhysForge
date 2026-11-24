import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  ChevronDown,
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
  Undo2,
  Wrench,
} from 'lucide-react';
import { isSimulationPluginV3, type ParamRecord, type SimulationPluginV2 } from '@physforge/sim-sdk';
import { getStoryDecks, resolvePresentationHotkey, useClassroomStore } from './store/useClassroomStore.js';
import { SimulationStage, type RecordedTelemetryFrame, type StoryNavigation } from './components/SimulationStage.js';
import { LeftCatalogSidebar } from './components/LeftCatalogSidebar.js';
import { RightControlPanel } from './components/RightControlPanel.js';
import { TeachingPackDrawer } from './components/TeachingPackDrawer.js';
import type { MeasureToolKind } from './stage/RulerToolboxOverlay.js';
import { KatexFormulaCard } from './components/KatexFormulaCard.js';
import { buildPresenterWindowUrl, PresenterSyncBridge, type StageSnapshotPayload } from './presentation/presenterSync.js';

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

const LazyLiveFormulaCard = React.lazy(() => import('./presentation/LiveFormulaCard.js'));

const LazyPresenterView = React.lazy(() => import('./presentation/PresenterView.js'));

const LazyStoryStageHud = React.lazy(() => import('./presentation/StoryStageHud.js').then((m) => ({ default: m.StoryStageHud })));

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 1, 2] as const;
const WORKBENCH_TITLES: Readonly<Record<string, string>> = {
  'em-induction-double-rod': '电磁感应·单杆切割',
  'builder-optics-ray': '几何光学·全反射与折射',
  'optics-ray-studio': '几何光学·全反射与折射',
  'builder-circuit-mna': '自由拓扑电路·非线性 MNA',
  'circuit-dc-capacitor-mna': '自由拓扑电路·非线性 MNA',
  'em-3d-magnetic-fields': '3D空间电磁场·螺旋轨迹'
};

const ClassroomApp: React.FC = () => {
  const store = useClassroomStore();
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotsGetterRef = useRef<() => readonly RecordedTelemetryFrame[]>(() => []);
  const [teachingPackOpen, setTeachingPackOpen] = useState(false);
  const [analysisLabOpen, setAnalysisLabOpen] = useState(false);
  const [exportStudioOpen, setExportStudioOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [aiCopilotOpen, setAiCopilotOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [labFrames, setLabFrames] = useState<readonly RecordedTelemetryFrame[]>([]);
  const [presenterSession, setPresenterSession] = useState(() => new URLSearchParams(window.location.search).get('session'));
  const [presenterError, setPresenterError] = useState<string | null>(null);
  const [laserPointer, setLaserPointer] = useState<{ x: number; y: number } | null>(null);
  const laserLastAtRef = useRef(-Infinity);

  const handleRegisterSnapshotsGetter = useCallback(
    (getter: () => readonly RecordedTelemetryFrame[]) => {
      snapshotsGetterRef.current = getter;
    },
    []
  );

  const plugin = store.loadedPlugin;
  const v2Plugin = plugin as SimulationPluginV2<ParamRecord, unknown>;
  const liveFormulas = isSimulationPluginV3(plugin) ? plugin.liveFormulas ?? [] : [];
  const storyNavigationRef = useRef<StoryNavigation | null>(null);
  const morphProgressRef = useRef(store.view3dEnabled ? 0 : 1);
  const decks = useMemo(() => getStoryDecks(plugin), [plugin]);
  const storyDeck = store.appMode === 'story' ? decks.find((deck) => deck.id === store.activeDeckId) : undefined;
  const highlightedFormulaId = storyDeck?.beats[store.storyBeatIndex]?.layerOverrides?.highlightFormulaId;
  const highlightedReadOnly = highlightedFormulaId && !liveFormulas.some((spec) => spec.id === highlightedFormulaId)
    ? store.telemetry.formulaItems.filter((item) => item.id === highlightedFormulaId) : [];
  const has3dView =
    v2Plugin.renderMode === 'three3d' ||
    v2Plugin.renderMode === 'hybrid' ||
    Boolean(v2Plugin.mountThreeScene);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const modelId = search.get('model');
    if (modelId) {
      void store.applyExternalState(modelId, search.get('preset') ?? undefined);
    }
  }, [store.applyExternalState]);

  const openPresenter = () => {
    if (typeof BroadcastChannel === 'undefined') { setPresenterError('当前浏览器不支持双屏通信'); return; }
    const session = presenterSession ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join('');
    const url = new URL(window.location.href);
    url.searchParams.set('session', session);
    window.history.replaceState(null, '', url);
    setPresenterSession(session);
    const popup = window.open(buildPresenterWindowUrl(session, plugin.meta.id), `physforge-presenter-${session}`, 'popup,width=1100,height=800');
    setPresenterError(popup ? null : '副屏窗口被浏览器拦截，请允许弹窗或使用手动打开链接');
  };

  useEffect(() => {
    if (!presenterSession) return;
    let bridge: PresenterSyncBridge;
    const snapshot = (): StageSnapshotPayload => {
      const state = useClassroomStore.getState();
      const p = state.loadedPlugin;
      const v2 = p as SimulationPluginV2<ParamRecord, unknown>;
      const deck = state.appMode === 'story' ? getStoryDecks(p).find((d) => d.id === state.activeDeckId) : undefined;
      const beat = deck?.beats[state.storyBeatIndex];
      const observables = Object.fromEntries(Object.entries(state.telemetry.observables).filter(([, value]) => Number.isFinite(value)));
      return { modelId: p.meta.id, modelTitle: p.meta.title, appMode: state.appMode,
        isPlaying: state.isPlaying, isBlackout: state.isBlackout, morphT: morphProgressRef.current,
        simTime: state.telemetry.t, deckId: deck?.id ?? null, beatIndex: deck ? state.storyBeatIndex : -1,
        totalBeats: deck?.beats.length ?? 0, currentCaption: beat?.caption ?? '', speakerNotes: beat?.speakerNotes ?? '',
        nextBeatTitle: deck?.beats[state.storyBeatIndex + 1]?.title ?? null, observables, params: state.params,
        paramSchema: p.paramSchema, canMorph: v2.renderMode === 'three3d' || v2.renderMode === 'hybrid' || Boolean(v2.mountThreeScene),
        freezeBadge: state.autoFreezeBadge };
    };
    try {
      bridge = new PresenterSyncBridge(presenterSession, 'stage', (envelope) => {
        if (envelope.sender !== 'presenter') return;
        const cmd = envelope.msg;
        if (cmd.type === 'CMD_REQUEST_SYNC') { bridge.broadcastSnapshot(snapshot(), true); return; }
        const state = useClassroomStore.getState();
        if (state.appMode === 'studio') return;
        switch (cmd.type) {
          case 'CMD_NEXT_BEAT': if (state.appMode === 'story') storyNavigationRef.current?.next(); break;
          case 'CMD_PREV_BEAT': if (state.appMode === 'story') storyNavigationRef.current?.prev(); break;
          case 'CMD_GOTO_BEAT': if (state.appMode === 'story') storyNavigationRef.current?.goTo(cmd.index); break;
          case 'CMD_TOGGLE_PLAY': state.togglePlaying(); break;
          case 'CMD_RESET_SIM': state.triggerReset(); break;
          case 'CMD_TOGGLE_MORPH_2D': if (snapshot().canMorph) state.toggleView3d(); break;
          case 'CMD_TOGGLE_BLACKOUT': state.toggleBlackout(); break;
          case 'CMD_SET_PARAM': {
            const field = state.loadedPlugin.paramSchema.find((item) => item.key === cmd.paramKey);
            if (!field) break;
            if (field.kind === 'number' && typeof cmd.value === 'number' && cmd.value >= field.min && cmd.value <= field.max ||
                field.kind === 'boolean' && typeof cmd.value === 'boolean' ||
                field.kind === 'select' && typeof cmd.value === 'string' && field.options.some((option) => option.value === cmd.value)) {
              state.updateParam(cmd.paramKey, cmd.value);
            }
            break;
          }
          case 'CMD_LASER_POINTER':
            laserLastAtRef.current = performance.now();
            setLaserPointer(cmd.active ? { x: cmd.normX, y: cmd.normY } : null);
            break;
        }
      });
    } catch {
      setPresenterError('双屏通信通道创建失败');
      return;
    }
    const timer = window.setInterval(() => {
      bridge.broadcastSnapshot(snapshot());
      if (performance.now() - laserLastAtRef.current > 2000) setLaserPointer((current) => current ? null : current);
    }, 1000 / 15);
    bridge.broadcastSnapshot(snapshot(), true);
    return () => { window.clearInterval(timer); bridge.close(); setLaserPointer(null); };
  }, [presenterSession]);

  // 同步文档主题属性
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', store.theme);
  }, [store.theme]);

  // 课堂快捷键支持（Ctrl+K 全局检索、Ctrl+Z/Shift+Z 撤销重做、1-9 预设、Space 播放、S 单步、R 重置、P 遮罩、B 大屏、F 演说）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (store.annotationOpen || commandPaletteOpen || teachingPackOpen || analysisLabOpen || exportStudioOpen || aiCopilotOpen) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key === 'F5') {
        e.preventDefault();
        store.setAppMode('story', decks[0]?.id);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'F11') {
        e.preventDefault();
        store.setAppMode(store.appMode === 'studio' ? 'stage' : 'studio');
        return;
      }
      if (store.appMode !== 'studio' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const command = resolvePresentationHotkey(store.appMode, e.key);
        if (command) {
          e.preventDefault();
          if (command === 'next') storyNavigationRef.current?.next();
          else if (command === 'prev') storyNavigationRef.current?.prev();
          else if (command === 'play-toggle') store.togglePlaying();
          else if (command === 'blackout') store.toggleBlackout();
          else if (command === 'mirror' && has3dView) store.toggleView3d();
          else if (command === 'exit') store.setAppMode('studio');
        }
        return;
      }
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

      if (store.appMode !== 'studio') return;

      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        store.toggleFullscreenPresentation();
        return;
      }

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
  }, [plugin, store.appMode, store.annotationOpen, commandPaletteOpen, teachingPackOpen, analysisLabOpen, exportStudioOpen, aiCopilotOpen, has3dView, decks]);

  const toggleMeasureTool = (tool: Exclude<MeasureToolKind, 'none'>) => {
    store.setMeasureTool(store.measureTool === tool ? 'none' : tool);
  };

  const handleParamUpdate = (key: string, value: number | boolean | string) => {
    if (plugin.meta.id === 'builder-optics-ray' && key === 'incidentAngleDeg') {
      store.updateParamsBatch({ incidentAngleDeg: value as number, animateSweep: false }, '手动调整入射角');
      return;
    }
    store.updateParam(key, value);
  };

  return (
    <div
      data-testid="app-shell"
      data-model-id={plugin.meta.id}
      data-app-mode={store.appMode}
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
        data-testid="topbar"
        className={`relative z-40 flex h-12 shrink-0 items-center justify-between border-b pl-[68px] pr-4 ${store.fullscreenPresentation ? 'hidden' : ''}`}
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-topbar-bg)'
        }}
      >
        <div className="min-w-0 max-w-[34%]">
          <div className="truncate text-[14px] font-medium tracking-tight text-slate-100">
            {WORKBENCH_TITLES[plugin.meta.id] ?? plugin.meta.title.replace(/\s*\([A-Z]\d+\)$/, '')}
          </div>
          <div className="font-mono text-[11px] tabular-nums text-slate-400">
            t = {store.telemetry.t.toFixed(2)} s
          </div>
        </div>

        <div className="pf-floating-glass absolute left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 p-1">
          <button
            type="button"
            data-testid="btn-play-pause"
            onClick={store.togglePlaying}
            aria-label={store.isPlaying ? '暂停' : '运行'}
            className="grid h-7 w-7 place-items-center rounded-full bg-sky-400 text-slate-950 shadow-[0_0_20px_rgba(56,189,248,0.7)] transition hover:bg-sky-300 cursor-pointer"
          >
            {store.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
          </button>
          <button type="button" data-testid="btn-step" onClick={store.triggerStepOnce} className="h-7 rounded-full px-2.5 text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer">前移</button>
          <button type="button" data-testid="btn-reset" onClick={store.triggerReset} className="h-7 rounded-full px-2.5 text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer">重置</button>
          <select aria-label="播放倍速" value={store.playbackSpeed} onChange={(e) => store.setPlaybackSpeed(Number(e.target.value))} className="h-7 rounded-full bg-transparent px-1.5 font-mono text-[11px] text-slate-300 outline-none cursor-pointer">
            {SPEED_OPTIONS.map((speed) => <option key={speed} value={speed}>{speed.toFixed(1)}x</option>)}
          </select>
        </div>

        <div data-testid="topbar-actions" className="relative flex shrink-0 items-center gap-2">
          <button type="button" data-testid="btn-tools-menu" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)} className="pf-top-pill">
            <Wrench className="h-4 w-4" /> <span>工具</span> <ChevronDown className="h-3 w-3 text-slate-500" />
          </button>
          <button type="button" data-testid="btn-export-studio" onClick={() => setExportStudioOpen(true)} className="pf-top-pill">
            <ImageIcon className="h-4 w-4" /> <span>导出</span>
          </button>
          <button type="button" data-testid="btn-fullscreen-speech" onClick={store.toggleFullscreenPresentation} className="pf-top-pill pf-top-pill-primary">
            <Maximize2 className="h-4 w-4" /> <span>全屏演说</span>
          </button>
        </div>

        {toolsOpen && (
          <div data-testid="tools-menu" className="pf-floating-glass absolute right-3 top-11 z-50 max-h-[calc(100vh-64px)] w-80 space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-2xl">
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">课堂工具</div>
            <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            data-testid="menu-btn-play-pause"
            onClick={store.togglePlaying}
            className="pf-touch-target inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold hover:bg-sky-400 transition cursor-pointer"
          >
            {store.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{store.isPlaying ? '暂停' : '运行'}</span>
          </button>

          <button
            type="button"
            data-testid="menu-btn-step"
            onClick={store.triggerStepOnce}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <StepForward className="w-4 h-4" />
            <span>单步</span>
          </button>

          <button
            type="button"
            data-testid="menu-btn-reset"
            onClick={store.triggerReset}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <RotateCcw className="w-4 h-4" />
            <span>复位</span>
          </button>

          <select
            aria-label="工具菜单播放倍速"
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
            data-testid="btn-menu-tool-ruler"
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
            data-testid="btn-menu-tool-protractor"
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
            data-testid="btn-menu-tool-compass"
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
            data-testid="btn-analysis-lab-menu"
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
            data-testid="btn-command-palette-menu"
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
            data-testid="btn-export-studio-menu"
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
            data-testid="btn-ai-copilot-menu"
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
            data-testid="btn-teaching-pack-menu"
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
          </div>
        )}
      </header>

      {/* 主三栏工作区 */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {!store.fullscreenPresentation && (
          <LeftCatalogSidebar
            selectedPluginId={store.selectedPluginId}
            isOpen={store.leftSidebarOpen}
            theme={store.theme}
            bigScreenMode={store.bigScreenMode}
            onSelectPlugin={store.selectPlugin}
            onOpen={() => store.setLeftSidebarOpen(true)}
            onClose={() => store.setLeftSidebarOpen(false)}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onOpenTeachingPack={() => setTeachingPackOpen(true)}
            onOpenAnalysisLab={() => {
              setLabFrames(snapshotsGetterRef.current());
              setAnalysisLabOpen(true);
            }}
            onOpenAiCopilot={() => setAiCopilotOpen(true)}
            onToggleTheme={store.toggleTheme}
            onToggleBigScreen={store.toggleBigScreenMode}
          />
        )}

        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
            oscilloscopeCollapsed={store.oscilloscopeCollapsed}
            presentationMode={store.fullscreenPresentation}
            resetViewNonce={store.resetViewNonce}
            resetNonce={store.resetNonce}
            stepOnceNonce={store.stepOnceNonce}
            scrubTime={store.scrubTime}
            canvasRefExternal={simCanvasRef}
            onResetView={store.triggerResetView}
            onToggleOscilloscope={() => store.setOscilloscopeCollapsed(!store.oscilloscopeCollapsed)}
            onToggleMeasureTool={toggleMeasureTool}
            onUpdateParamsBatch={store.updateParamsBatch}
            onRegisterSnapshotsGetter={handleRegisterSnapshotsGetter}
            onScrubTime={store.setScrubTime}
            onTogglePoeMask={store.togglePoeMask}
            onTelemetryUpdate={store.setTelemetry}
            storyDeck={storyDeck}
            storyNavigationRef={storyNavigationRef}
            onStoryParams={store.syncStoryParams}
            onStoryBeat={store.setStoryBeat}
            onStoryFreeze={store.setAutoFreezeBadge}
            onStoryPlaying={(playing) => { store.setScrubTime(null); store.setPlaying(playing); }}
            onStoryFbd={(enabled) => { if (useClassroomStore.getState().autoFbdEnabled !== enabled) store.toggleAutoFbd(); }}
            onStoryFrame={store.setActiveFrameId}
            onStoryLayers={store.setStoryLayers}
            onStoryView3d={store.setView3d}
            onMorphProgress={(progress) => { morphProgressRef.current = progress; }}
            onWebGLFallback={() => useClassroomStore.getState().setView3d(false)}
          />

          {store.fullscreenPresentation && (
            <>
              <div data-testid="fullscreen-title" className="pointer-events-none absolute left-[68px] top-6 z-20 max-w-[min(44vw,620px)] text-slate-100 drop-shadow-lg">
                <div className="truncate text-2xl font-semibold tracking-tight">{storyDeck?.title ?? (plugin.meta.id === 'em-induction-double-rod' && store.params.rodMode === 'double' ? '电磁感应·双杆切割' : WORKBENCH_TITLES[plugin.meta.id] ?? plugin.meta.title)}</div>
                <div className="mt-1 text-xs tracking-wide text-slate-400">{store.appMode === 'story' ? '分镜讲课模式' : '全屏课堂演说模式'}</div>
              </div>
              {(store.telemetry.formulaItems.length > 0 || liveFormulas.length > 0) && (
                <div data-testid="fullscreen-formula" className="pf-presentation-formula absolute right-6 top-6 z-20 w-[min(250px,36vw)] rounded-2xl border border-white/15 bg-slate-950/75 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
                  {liveFormulas.length ? <Suspense fallback={<KatexFormulaCard items={store.telemetry.formulaItems} compact showSubstituted={false} highlightedId={highlightedFormulaId} />}>
                    <LazyLiveFormulaCard key={plugin.meta.id} specs={liveFormulas} params={store.params} schema={plugin.paramSchema} highlightedId={highlightedFormulaId}
                      onBegin={(key) => store.beginLiveFormula(plugin.meta.id, key)}
                      onChange={(key, value) => store.updateLiveFormula(plugin.meta.id, key, value)}
                      onEnd={(key) => store.endLiveFormula(plugin.meta.id, key)} />
                    {highlightedReadOnly.length > 0 && <KatexFormulaCard items={highlightedReadOnly} compact showSubstituted={false} highlightedId={highlightedFormulaId} />}
                  </Suspense> : <KatexFormulaCard items={store.telemetry.formulaItems} compact showSubstituted={false} highlightedId={highlightedFormulaId} />}
                </div>
              )}
              <div data-testid="fullscreen-controls" className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/80 p-2 text-slate-100 shadow-2xl backdrop-blur-2xl">
                <button type="button" data-testid="btn-play-pause" onClick={store.togglePlaying} aria-label={store.isPlaying ? '暂停' : '运行'} className="grid h-9 w-9 place-items-center rounded-full bg-sky-400 text-slate-950 hover:bg-sky-300">
                  {store.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                </button>
                <button type="button" data-testid="btn-reset" onClick={store.triggerReset} className="grid h-9 w-9 place-items-center rounded-full text-slate-200 hover:bg-white/10" aria-label="复位" title="复位"><RotateCcw className="h-4 w-4" /></button>
                {has3dView && (
                  <button type="button" data-testid="btn-view-3d-fullscreen" onClick={store.toggleView3d} className="rounded-full px-3 py-2 text-xs hover:bg-white/10">
                    {store.view3dEnabled ? '2D 剖面' : '3D 空间'}
                  </button>
                )}
                {v2Plugin.getForceVectors && (
                  <button type="button" data-testid="btn-stage-fbd" aria-pressed={store.autoFbdEnabled && !store.view3dEnabled}
                    title="切换二维受力图" className={`rounded-full px-3 py-2 text-xs hover:bg-white/10 ${store.autoFbdEnabled && !store.view3dEnabled ? 'bg-sky-400/20 text-sky-200' : ''}`}
                    onClick={() => {
                      if (store.view3dEnabled) { store.setView3d(false); if (!store.autoFbdEnabled) store.toggleAutoFbd(); }
                      else store.toggleAutoFbd();
                    }}>受力</button>
                )}
                {store.appMode === 'story' && decks.length > 1 && <select aria-label="选择教学分镜" data-testid="story-deck-select" value={store.activeDeckId ?? ''}
                  onChange={(event) => store.setAppMode('story', event.target.value)}
                  className="max-w-[140px] rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-100">
                  {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.title}</option>)}
                </select>}
                <button type="button" data-testid="btn-toggle-story" disabled={!decks.length} onClick={() => store.setAppMode(store.appMode === 'story' ? 'stage' : 'story', decks[0]?.id)} className="rounded-full px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40">
                  {store.appMode === 'story' ? '自由演说' : '分镜讲课'}
                </button>
                <button type="button" data-testid="btn-stage-blackout" onClick={store.toggleBlackout} className="rounded-full px-3 py-2 text-xs hover:bg-white/10">黑屏</button>
                <button type="button" data-testid="btn-presenter" onClick={openPresenter} className="rounded-full px-3 py-2 text-xs hover:bg-white/10">副屏</button>
                <button type="button" data-testid="btn-exit-fullscreen-speech" onClick={store.toggleFullscreenPresentation} className="rounded-full border border-white/10 px-3 py-2 text-xs hover:bg-white/10">退出全屏</button>
              </div>
              {laserPointer && !store.isBlackout && <div data-testid="stage-laser-pointer" aria-hidden="true" className="pointer-events-none absolute z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_14px_5px_rgba(239,68,68,0.7)]" style={{ left: `${laserPointer.x * 100}%`, top: `${laserPointer.y * 100}%` }} />}
              {presenterError && <div role="status" className="absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-xl bg-slate-950 p-3 text-xs text-amber-300">{presenterError} {presenterSession && <a className="underline" href={buildPresenterWindowUrl(presenterSession, plugin.meta.id)} target="_blank" rel="noreferrer">手动打开副屏</a>}</div>}
              <Suspense fallback={null}>
                <LazyStoryStageHud deck={storyDeck} index={store.storyBeatIndex} blackout={store.isBlackout}
                  freezeBadge={store.autoFreezeBadge} onPrev={() => storyNavigationRef.current?.prev()}
                  onNext={() => storyNavigationRef.current?.next()} onGoTo={(index) => storyNavigationRef.current?.goTo(index)}
                  onUnblackout={store.toggleBlackout} />
              </Suspense>
            </>
          )}

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

        {store.rightSidebarOpen && !store.fullscreenPresentation && (
          <RightControlPanel
            plugin={plugin}
            activePresetId={store.activePresetId}
            params={store.params}
            activeLayers={store.activeLayers}
            telemetry={store.telemetry}
            onApplyPreset={store.applyPreset}
            onUpdateParam={handleParamUpdate}
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

export const App: React.FC = () => {
  const query = new URLSearchParams(window.location.search);
  if (query.get('mode') === 'presenter') {
    return <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-950 text-sky-300">正在加载教师副屏…</div>}>
      <LazyPresenterView sessionId={query.get('session') ?? ''} />
    </Suspense>;
  }
  return <ClassroomApp />;
};

export default App;
