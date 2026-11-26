import { create } from 'zustand';
import {
  resolvePluginParams,
  isSimulationPluginV3,
  type StoryDeck,
  type FormulaDisplayItem,
  type InvariantReport,
  type ParamRecord,
  type ParamValue,
  type PhysicsEvent
} from '@physforge/sim-sdk';
import {
  loadSimulationById,
  resolveCanonicalModelId,
  type AnySimulationPlugin
} from '@physforge/simulations/catalog';
import { emInductionDoubleRodPlugin } from '@physforge/simulations/em-induction-double-rod';
import { CommandStack } from '../stage/CommandStack.js';
import type { MeasureToolKind } from '../stage/RulerToolboxOverlay.js';

export type ClassroomTheme = 'chalkboard' | 'projector';
export type AppMode = 'studio' | 'stage' | 'story';
export type PresentationCommand = 'next' | 'prev' | 'play-toggle' | 'blackout' | 'mirror' | 'exit';

export function resolvePresentationHotkey(mode: AppMode, key: string): PresentationCommand | null {
  if (mode === 'studio') return null;
  if (key === 'Escape') return 'exit';
  if (key.toLowerCase() === 'b' || key === '.') return 'blackout';
  if (key.toLowerCase() === 'f') return 'play-toggle';
  if (key.toLowerCase() === 'm') return 'mirror';
  if (key === ' ') return mode === 'story' ? 'next' : 'play-toggle';
  if (mode === 'story') {
    if (key === 'ArrowRight' || key === 'PageDown') return 'next';
    if (key === 'ArrowLeft' || key === 'PageUp') return 'prev';
  }
  return null;
}

/** Legacy plugins inherit real preset-based beats, never fabricated observables. */
export function getStoryDecks(plugin: AnySimulationPlugin): readonly StoryDeck[] {
  if (isSimulationPluginV3(plugin) && plugin.storyDecks?.length) {
    const authored = plugin.storyDecks.filter((deck) => deck.modelId === plugin.meta.id && deck.beats.length > 0);
    if (authored.length) return authored;
  }
  if (!plugin.presets.length) return [];
  return [{
    id: `${plugin.meta.id}:presets`, modelId: plugin.meta.id, title: plugin.meta.title,
    beats: plugin.presets.map((preset) => ({
      id: preset.id, title: preset.name, caption: preset.name,
      speakerNotes: preset.curriculumNotes ?? preset.description,
      paramPatch: resolvePluginParams(plugin.paramSchema, preset.params),
      paramTweenMs: 0, simAction: 'reset-pause',
      layerOverrides: { visibleLayerIds: getDefaultLayers(plugin, preset.visibleLayers) }
    }))
  }];
}

export interface TelemetrySummary {
  t: number;
  observables: Record<string, number>;
  events: PhysicsEvent[];
  invariants: InvariantReport[];
  formulaItems: FormulaDisplayItem[];
}

const paramCommandStack = new CommandStack(50);
let liveFormulaGesture: { modelId: string; key: string; epoch: number; before: ParamRecord } | null = null;

interface ClassroomStore {
  selectedPluginId: string;
  loadedPlugin: AnySimulationPlugin;
  isLoadingPlugin: boolean;
  activePresetId: string | null;
  params: ParamRecord;
  activeLayers: string[];
  isPlaying: boolean;
  playbackSpeed: number;
  strobeEnabled: boolean;
  poeMasked: boolean;
  theme: ClassroomTheme;
  bigScreenMode: boolean;
  fullscreenPresentation: boolean;
  appMode: AppMode;
  isBlackout: boolean;
  activeDeckId: string | null;
  storyBeatIndex: number;
  /** Changes only at a lesson/experiment context boundary, not on every drag sample. */
  paramContextEpoch: number;
  autoFreezeBadge: string | null;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  oscilloscopeCollapsed: boolean;
  annotationOpen: boolean;
  measureTool: MeasureToolKind;
  autoFbdEnabled: boolean;
  fbdComponentsEnabled: boolean;
  activeFrameId: string;
  view3dEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  resetViewNonce: number;
  resetNonce: number;
  stepOnceNonce: number;
  scrubTime: number | null;
  telemetry: TelemetrySummary;

  selectPlugin: (pluginId: string) => Promise<void> | void;
  applyPreset: (presetId: string) => void;
  applyExternalState: (
    pluginId: string,
    presetId?: string,
    overrideParams?: ParamRecord
  ) => Promise<void> | void;
  updateParam: (key: string, value: number | boolean | string) => void;
  updateParamsBatch: (patch: Record<string, ParamValue>, label?: string) => void;
  undoParam: () => void;
  redoParam: () => void;
  toggleLayer: (layerId: string) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setPlaybackSpeed: (speed: number) => void;
  toggleStrobe: () => void;
  togglePoeMask: () => void;
  setTheme: (theme: ClassroomTheme) => void;
  toggleTheme: () => void;
  toggleBigScreenMode: () => void;
  toggleFullscreenPresentation: () => void;
  setAppMode: (mode: AppMode, deckId?: string) => void;
  toggleBlackout: () => void;
  setStoryBeat: (index: number) => void;
  setAutoFreezeBadge: (badge: string | null) => void;
  syncStoryParams: (modelId: string, params: ParamRecord) => void;
  setStoryLayers: (modelId: string, layerIds: readonly string[]) => void;
  beginLiveFormula: (modelId: string, key: string, epoch: number) => void;
  updateLiveFormula: (modelId: string, key: string, value: number, epoch: number) => void;
  endLiveFormula: (modelId: string, key: string, epoch: number) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  setOscilloscopeCollapsed: (collapsed: boolean) => void;
  toggleAnnotation: () => void;
  setMeasureTool: (tool: MeasureToolKind) => void;
  toggleAutoFbd: () => void;
  toggleFbdComponents: () => void;
  setActiveFrameId: (frameId: string) => void;
  toggleView3d: () => void;
  setView3d: (enabled: boolean) => void;
  triggerResetView: () => void;
  triggerReset: () => void;
  triggerStepOnce: () => void;
  setScrubTime: (t: number | null) => void;
  setTelemetry: (summary: TelemetrySummary) => void;
}

function getDefaultLayers(plugin: AnySimulationPlugin, visibleLayers?: string[]): string[] {
  if (visibleLayers && visibleLayers.length > 0) {
    return [...visibleLayers];
  }
  return plugin.layers.filter((l) => l.defaultVisible).map((l) => l.id);
}

const NON_TIME_SERIES_MODEL_IDS = new Set([
  'builder-optics-ray',
  'optics-wave-interference',
  'mech-dynamic-equilibrium',
  'mech-constrained-velocity',
  'exp-electrical-error-lab',
  'em-transformer-grid'
]);

export function isNonTimeSeriesModel(modelId: string, params: ParamRecord): boolean {
  if (NON_TIME_SERIES_MODEL_IDS.has(modelId)) return true;
  if(modelId==='thermo-piston-gas-laws')return params.mode!=='stop-pin-cylinder';
  if (modelId === 'circuit-dc-capacitor-mna' || modelId === 'builder-circuit-mna') {
    const dynamicTopologies = new Set(['rc-transient', 'rc-bridge-charge', 'series-parallel-dynamic']);
    return !dynamicTopologies.has(String(params.topology ?? ''));
  }
  return false;
}

const initialPlugin = emInductionDoubleRodPlugin as unknown as AnySimulationPlugin;
const initialPreset = initialPlugin.presets.find((preset) => preset.id === 'single-rod-battery-drive')
  ?? initialPlugin.presets[0]
  ?? null;
const initialParams = resolvePluginParams(initialPlugin.paramSchema, initialPreset?.params);
const pluginCache = new Map<string, AnySimulationPlugin>([[initialPlugin.meta.id, initialPlugin]]);
let pluginSelectionSeq = 0;

function applyLoadedPluginState(
  set: (fn: (state: ClassroomStore) => Partial<ClassroomStore>) => void,
  plugin: AnySimulationPlugin,
  presetId?: string,
  overrideParams?: ParamRecord
): void {
  const preset = presetId
    ? plugin.presets.find((p) => p.id === presetId) ?? null
    : plugin.presets[0] ?? null;
  const mergedOverrides = overrideParams ?? preset?.params;
  const params = resolvePluginParams(plugin.paramSchema, mergedOverrides);
  // A named preset describes its authored parameters, not arbitrary overrides.
  // Preserve the existing parameter and layer initialization contract.
  const presetParams = preset ? resolvePluginParams(plugin.paramSchema, preset.params) : null;
  const activePresetId = preset && presetParams
    && plugin.paramSchema.every(field => params[field.key] === presetParams[field.key])
    ? preset.id : null;
  liveFormulaGesture = null;
  set((s) => ({
    selectedPluginId: plugin.meta.id,
    loadedPlugin: plugin,
    isLoadingPlugin: false,
    telemetry: { t: 0, observables: {}, events: [], invariants: [], formulaItems: [] },
    activePresetId,
    params,
    activeLayers: getDefaultLayers(plugin, preset?.visibleLayers),
    isPlaying: false,
    appMode: s.appMode === 'story' ? 'stage' : s.appMode,
    activeDeckId: null,
    storyBeatIndex: -1,
    paramContextEpoch: s.paramContextEpoch + 1,
    autoFreezeBadge: null,
    isBlackout: false,
    leftSidebarOpen: false,
    oscilloscopeCollapsed: isNonTimeSeriesModel(plugin.meta.id, params),
    scrubTime: null,
    activeFrameId: 'ground',
    view3dEnabled: (plugin as { renderMode?: string }).renderMode === 'three3d',
    canUndo: paramCommandStack.canUndo(plugin.meta.id),
    canRedo: paramCommandStack.canRedo(plugin.meta.id),
    resetViewNonce: s.resetViewNonce + 1,
    resetNonce: s.resetNonce + 1
  }));
}

export const useClassroomStore = create<ClassroomStore>((set, get) => ({
  selectedPluginId: initialPlugin.meta.id,
  loadedPlugin: initialPlugin,
  isLoadingPlugin: false,
  activePresetId: initialPreset?.id ?? null,
  params: initialParams,
  activeLayers: getDefaultLayers(initialPlugin, initialPreset?.visibleLayers),
  isPlaying: false,
  playbackSpeed: 1,
  strobeEnabled: false,
  poeMasked: false,
  theme: 'chalkboard',
  bigScreenMode: false,
  fullscreenPresentation: false,
  appMode: 'studio',
  isBlackout: false,
  activeDeckId: null,
  storyBeatIndex: -1,
  paramContextEpoch: 0,
  autoFreezeBadge: null,
  leftSidebarOpen: false,
  rightSidebarOpen: true,
  oscilloscopeCollapsed: false,
  annotationOpen: false,
  measureTool: 'none',
  autoFbdEnabled: false,
  fbdComponentsEnabled: true,
  activeFrameId: 'ground',
  view3dEnabled: false,
  canUndo: false,
  canRedo: false,
  resetViewNonce: 0,
  resetNonce: 0,
  stepOnceNonce: 0,
  scrubTime: null,
  telemetry: {
    t: 0,
    observables: {},
    events: [],
    invariants: [],
    formulaItems: []
  },

  selectPlugin: async (pluginId) => {
    const canonical = resolveCanonicalModelId(pluginId);
    const seq = ++pluginSelectionSeq;
    const cached = pluginCache.get(canonical);
    if (cached) {
      applyLoadedPluginState(set, cached);
      return;
    }
    set({ isLoadingPlugin: true });
    const loaded = await loadSimulationById(canonical);
    if (!loaded) {
      if (seq === pluginSelectionSeq) set({ isLoadingPlugin: false });
      return;
    }
    pluginCache.set(loaded.meta.id, loaded);
    if (seq !== pluginSelectionSeq) return;
    applyLoadedPluginState(set, loaded);
  },

  applyPreset: (presetId) => {
    const cur = get();
    const plugin = cur.loadedPlugin;
    const preset = plugin.presets.find((p) => p.id === presetId);
    if (!preset) return;
    const params = resolvePluginParams(plugin.paramSchema, preset.params);
    liveFormulaGesture = null;
    paramCommandStack.push({
      modelId: plugin.meta.id,
      label: `预设 ${preset.name}`,
      beforeParams: cur.params,
      afterParams: params
    });
    set((s) => ({
      activePresetId: preset.id,
      paramContextEpoch: s.paramContextEpoch + 1,
      autoFreezeBadge: null,
      params,
      telemetry: { t: 0, observables: {}, events: [], invariants: [], formulaItems: [] },
      activeLayers: getDefaultLayers(plugin, preset.visibleLayers),
      isPlaying: false,
      oscilloscopeCollapsed: isNonTimeSeriesModel(plugin.meta.id, params),
      scrubTime: null,
      canUndo: paramCommandStack.canUndo(plugin.meta.id),
      canRedo: paramCommandStack.canRedo(plugin.meta.id),
      resetNonce: s.resetNonce + 1,
      resetViewNonce: s.resetViewNonce + 1
    }));
  },

  applyExternalState: async (pluginId, presetId, overrideParams) => {
    const canonical = resolveCanonicalModelId(pluginId);
    const seq = ++pluginSelectionSeq;
    let plugin = pluginCache.get(canonical);
    if (!plugin) {
      set({ isLoadingPlugin: true });
      const loaded = await loadSimulationById(canonical);
      if (!loaded) {
        if (seq === pluginSelectionSeq) set({ isLoadingPlugin: false });
        return;
      }
      pluginCache.set(loaded.meta.id, loaded);
      plugin = loaded;
    }
    if (seq !== pluginSelectionSeq) return;
    applyLoadedPluginState(set, plugin, presetId, overrideParams);
  },

  updateParam: (key, value) => {
    get().updateParamsBatch({ [key]: value }, `调整 ${key}`);
  },

  updateParamsBatch: (patch, label = '画布参数调整') => {
    const cur = get();
    const plugin = cur.loadedPlugin;
    const merged = { ...cur.params, ...patch };
    const resolved = resolvePluginParams(plugin.paramSchema, merged);
    const changed = plugin.paramSchema.filter(field => resolved[field.key] !== cur.params[field.key]);
    if (!changed.length) return;
    const interruptedGesture = liveFormulaGesture !== null;
    if (liveFormulaGesture) get().endLiveFormula(liveFormulaGesture.modelId, liveFormulaGesture.key, liveFormulaGesture.epoch);
    const contextChanged = interruptedGesture || changed.some(field => field.kind !== 'number');
    paramCommandStack.push({
      modelId: plugin.meta.id,
      label,
      beforeParams: cur.params,
      afterParams: resolved
    });
    set((s) => ({
      activePresetId: null,
      params: resolved,
      scrubTime: null,
      autoFreezeBadge: null,
      paramContextEpoch: s.paramContextEpoch + (contextChanged ? 1 : 0),
      ...((plugin.getParamFields||plugin.meta.id==='mech-kinematics-chase')?{isPlaying:false}:{}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'topology')||(plugin.meta.id==='thermo-piston-gas-laws'&&Object.prototype.hasOwnProperty.call(patch,'mode'))
        ? { oscilloscopeCollapsed: isNonTimeSeriesModel(plugin.meta.id, resolved) }
        : {}),
      canUndo: paramCommandStack.canUndo(plugin.meta.id),
      canRedo: paramCommandStack.canRedo(plugin.meta.id),
      resetNonce: s.resetNonce + 1
    }));
  },

  undoParam: () => {
    const cur = get();
    if (liveFormulaGesture) get().endLiveFormula(liveFormulaGesture.modelId, liveFormulaGesture.key, liveFormulaGesture.epoch);
    const entry = paramCommandStack.undo(cur.selectedPluginId);
    if (!entry) return;
    set((s) => ({
      activePresetId: null,
      params: entry.beforeParams,
      ...(s.loadedPlugin.meta.id==='thermo-piston-gas-laws'?{isPlaying:false,oscilloscopeCollapsed:isNonTimeSeriesModel(s.loadedPlugin.meta.id,entry.beforeParams)}:{}),
      scrubTime: null,
      autoFreezeBadge: null,
      paramContextEpoch: s.paramContextEpoch + 1,
      canUndo: paramCommandStack.canUndo(cur.selectedPluginId),
      canRedo: paramCommandStack.canRedo(cur.selectedPluginId),
      resetNonce: s.resetNonce + 1
    }));
  },

  redoParam: () => {
    const cur = get();
    if (liveFormulaGesture) get().endLiveFormula(liveFormulaGesture.modelId, liveFormulaGesture.key, liveFormulaGesture.epoch);
    const entry = paramCommandStack.redo(cur.selectedPluginId);
    if (!entry) return;
    set((s) => ({
      activePresetId: null,
      params: entry.afterParams,
      ...(s.loadedPlugin.meta.id==='thermo-piston-gas-laws'?{isPlaying:false,oscilloscopeCollapsed:isNonTimeSeriesModel(s.loadedPlugin.meta.id,entry.afterParams)}:{}),
      scrubTime: null,
      autoFreezeBadge: null,
      paramContextEpoch: s.paramContextEpoch + 1,
      canUndo: paramCommandStack.canUndo(cur.selectedPluginId),
      canRedo: paramCommandStack.canRedo(cur.selectedPluginId),
      resetNonce: s.resetNonce + 1
    }));
  },

  toggleLayer: (layerId) =>
    set((s) => ({
      activeLayers: s.activeLayers.includes(layerId)
        ? s.activeLayers.filter((id) => id !== layerId)
        : [...s.activeLayers, layerId]
    })),

  setPlaying: (playing) => set((s) => ({ isPlaying: (s.loadedPlugin.meta.id==='optics-wave-interference'||(s.loadedPlugin.meta.id==='thermo-piston-gas-laws'&&s.params.mode!=='stop-pin-cylinder'))?false:playing, scrubTime: playing ? null : s.scrubTime,
    autoFreezeBadge: playing ? null : s.autoFreezeBadge })),
  togglePlaying: () =>
    set((s) => ({
      isPlaying: (s.loadedPlugin.meta.id==='optics-wave-interference'||(s.loadedPlugin.meta.id==='thermo-piston-gas-laws'&&s.params.mode!=='stop-pin-cylinder'))?false:!s.isPlaying,
      scrubTime: !s.isPlaying ? null : s.scrubTime,
      autoFreezeBadge: !s.isPlaying ? null : s.autoFreezeBadge
    })),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  toggleStrobe: () => set((s) => ({ strobeEnabled: !s.strobeEnabled })),
  togglePoeMask: () => set((s) => ({ poeMasked: !s.poeMasked })),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'chalkboard' ? 'projector' : 'chalkboard' })),
  toggleBigScreenMode: () =>
    set((s) => {
      const next = !s.bigScreenMode;
      return {
        bigScreenMode: next,
        leftSidebarOpen: next ? false : true,
        rightSidebarOpen: true
      };
    }),
  toggleFullscreenPresentation: () => get().setAppMode(get().appMode === 'studio' ? 'stage' : 'studio'),
  setAppMode: (requested, deckId) => {
    const cur = get();
    const decks = requested === 'story' ? getStoryDecks(cur.loadedPlugin) : [];
    const deck = decks.find((item) => item.id === deckId) ?? decks[0];
    const appMode = requested === 'story' && !deck ? 'stage' : requested;
    const activeDeckId = appMode === 'story' ? deck?.id ?? null : null;
    if (cur.appMode === appMode && cur.activeDeckId === activeDeckId) return;
    liveFormulaGesture = null;
    set({ appMode, fullscreenPresentation: appMode !== 'studio', activeDeckId,
      storyBeatIndex: -1, paramContextEpoch: cur.paramContextEpoch + 1, autoFreezeBadge: null, isBlackout: false });
  },
  toggleBlackout: () => set((s) => ({ isBlackout: s.appMode === 'studio' ? false : !s.isBlackout })),
  setStoryBeat: (storyBeatIndex) => {
    liveFormulaGesture = null;
    set((s) => ({ storyBeatIndex, paramContextEpoch: s.paramContextEpoch + 1, autoFreezeBadge: null }));
  },
  setAutoFreezeBadge: (autoFreezeBadge) => set({ autoFreezeBadge }),
  syncStoryParams: (modelId, params) => {
    if (get().selectedPluginId !== modelId || get().params === params) return;
    // Already normalized by the imperative stage; no reset/undo entry per animation frame.
    set({ params, activePresetId: null, scrubTime: null });
  },
  setStoryLayers: (modelId, layerIds) => {
    const state = get();
    if (state.selectedPluginId !== modelId) return;
    const allowed = new Set(state.loadedPlugin.layers.map((layer) => layer.id));
    set({ activeLayers: [...new Set(layerIds.filter((id) => allowed.has(id)))] });
  },
  beginLiveFormula: (modelId, key, epoch) => {
    const cur = get();
    if (cur.selectedPluginId !== modelId || cur.paramContextEpoch !== epoch) return;
    if (liveFormulaGesture) get().endLiveFormula(liveFormulaGesture.modelId, liveFormulaGesture.key, liveFormulaGesture.epoch);
    liveFormulaGesture = { modelId, key, epoch, before: cur.params };
  },
  updateLiveFormula: (modelId, key, value, epoch) => {
    const cur = get();
    if (cur.selectedPluginId !== modelId || cur.paramContextEpoch !== epoch || !Number.isFinite(value)) return;
    const field = cur.loadedPlugin.paramSchema.find((item) => item.key === key);
    if (field?.kind !== 'number') return;
    if (liveFormulaGesture?.modelId !== modelId || liveFormulaGesture.key !== key || liveFormulaGesture.epoch !== epoch) {
      if (cur.params[key] !== value) get().updateParam(key, value);
      return;
    }
    const params = resolvePluginParams(cur.loadedPlugin.paramSchema, { ...cur.params, [key]: value });
    if (params[key] === cur.params[key]) return;
    // Same reset semantics as a normal workbench slider; gesture is coalesced to one undo entry.
    set((s) => ({ params, activePresetId: null, scrubTime: null, autoFreezeBadge: null, resetNonce: s.resetNonce + 1 }));
  },
  endLiveFormula: (modelId, key, epoch) => {
    const gesture = liveFormulaGesture;
    if (!gesture || gesture.modelId !== modelId || gesture.key !== key || gesture.epoch !== epoch) return;
    liveFormulaGesture = null;
    const cur = get();
    if (cur.selectedPluginId !== modelId || cur.paramContextEpoch !== epoch || cur.params[key] === gesture.before[key]) return;
    paramCommandStack.push({ modelId, label: `活公式调整 ${key}`, beforeParams: gesture.before, afterParams: cur.params });
    set({ canUndo: paramCommandStack.canUndo(modelId), canRedo: paramCommandStack.canRedo(modelId) });
  },
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  setOscilloscopeCollapsed: (collapsed) => set({ oscilloscopeCollapsed: collapsed }),
  toggleAnnotation: () =>
    set((s) => ({
      annotationOpen: !s.annotationOpen,
      isPlaying: !s.annotationOpen ? false : s.isPlaying
    })),
  setMeasureTool: (measureTool) => set({ measureTool }),
  toggleAutoFbd: () => set((s) => ({ autoFbdEnabled: !s.autoFbdEnabled })),
  toggleFbdComponents: () => set((s) => ({ fbdComponentsEnabled: !s.fbdComponentsEnabled })),
  setActiveFrameId: (activeFrameId) => set({ activeFrameId }),
  toggleView3d: () => get().setView3d(!get().view3dEnabled),
  setView3d: (enabled) => set({ view3dEnabled: enabled, ...(enabled ? { activeFrameId: 'ground', scrubTime: null } : {}) }),
  triggerResetView: () => set((s) => ({ resetViewNonce: s.resetViewNonce + 1 })),
  triggerReset: () => {
    liveFormulaGesture = null;
    set((s) => ({
      isPlaying: false,
      scrubTime: null,
      autoFreezeBadge: null,
      paramContextEpoch: s.paramContextEpoch + 1,
      resetNonce: s.resetNonce + 1
    }));
  },
  triggerStepOnce: () =>
    set((s) => ({
      isPlaying: false,
      scrubTime: null,
      stepOnceNonce: (s.loadedPlugin.meta.id==='optics-wave-interference'||(s.loadedPlugin.meta.id==='thermo-piston-gas-laws'&&s.params.mode!=='stop-pin-cylinder'))?s.stepOnceNonce:s.stepOnceNonce + 1
    })),
  setScrubTime: (t) => set({ scrubTime: t }),
  setTelemetry: (telemetry) => set({ telemetry })
}));
