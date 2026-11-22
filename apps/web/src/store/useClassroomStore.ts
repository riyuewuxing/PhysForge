import { create } from 'zustand';
import {
  resolvePluginParams,
  type FormulaDisplayItem,
  type InvariantReport,
  type ParamRecord,
  type ParamValue,
  type PhysicsEvent
} from '@physforge/sim-sdk';
import { getSimulationById, simulationPlugins, type AnySimulationPlugin } from '@physforge/simulations/registry';
import { CommandStack } from '../stage/CommandStack.js';
import type { MeasureToolKind } from '../stage/RulerToolboxOverlay.js';

export type ClassroomTheme = 'chalkboard' | 'projector';

export interface TelemetrySummary {
  t: number;
  observables: Record<string, number>;
  events: PhysicsEvent[];
  invariants: InvariantReport[];
  formulaItems: FormulaDisplayItem[];
}

const paramCommandStack = new CommandStack(50);

interface ClassroomStore {
  selectedPluginId: string;
  activePresetId: string | null;
  params: ParamRecord;
  activeLayers: string[];
  isPlaying: boolean;
  playbackSpeed: number;
  strobeEnabled: boolean;
  poeMasked: boolean;
  theme: ClassroomTheme;
  bigScreenMode: boolean;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
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

  selectPlugin: (pluginId: string) => void;
  applyPreset: (presetId: string) => void;
  applyExternalState: (pluginId: string, presetId?: string, overrideParams?: ParamRecord) => void;
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
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  toggleAnnotation: () => void;
  setMeasureTool: (tool: MeasureToolKind) => void;
  toggleAutoFbd: () => void;
  toggleFbdComponents: () => void;
  setActiveFrameId: (frameId: string) => void;
  toggleView3d: () => void;
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

const initialPlugin = simulationPlugins[0]!;
const initialPreset = initialPlugin.presets[0] ?? null;
const initialParams = resolvePluginParams(initialPlugin.paramSchema, initialPreset?.params);

export const useClassroomStore = create<ClassroomStore>((set, get) => ({
  selectedPluginId: initialPlugin.meta.id,
  activePresetId: initialPreset?.id ?? null,
  params: initialParams,
  activeLayers: getDefaultLayers(initialPlugin, initialPreset?.visibleLayers),
  isPlaying: false,
  playbackSpeed: 1,
  strobeEnabled: false,
  poeMasked: false,
  theme: 'chalkboard',
  bigScreenMode: false,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
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

  selectPlugin: (pluginId) => {
    const plugin = getSimulationById(pluginId);
    if (!plugin) return;
    const preset = plugin.presets[0] ?? null;
    const params = resolvePluginParams(plugin.paramSchema, preset?.params);
    set((s) => ({
      selectedPluginId: plugin.meta.id,
      activePresetId: preset?.id ?? null,
      params,
      activeLayers: getDefaultLayers(plugin, preset?.visibleLayers),
      isPlaying: false,
      scrubTime: null,
      activeFrameId: 'ground',
      view3dEnabled: (plugin as { renderMode?: string }).renderMode === 'three3d',
      canUndo: paramCommandStack.canUndo(plugin.meta.id),
      canRedo: paramCommandStack.canRedo(plugin.meta.id),
      resetViewNonce: s.resetViewNonce + 1,
      resetNonce: s.resetNonce + 1
    }));
  },

  applyPreset: (presetId) => {
    const cur = get();
    const plugin = getSimulationById(cur.selectedPluginId);
    if (!plugin) return;
    const preset = plugin.presets.find((p) => p.id === presetId);
    if (!preset) return;
    const params = resolvePluginParams(plugin.paramSchema, preset.params);
    paramCommandStack.push({
      modelId: plugin.meta.id,
      label: `预设 ${preset.name}`,
      beforeParams: cur.params,
      afterParams: params
    });
    set((s) => ({
      activePresetId: preset.id,
      params,
      activeLayers: getDefaultLayers(plugin, preset.visibleLayers),
      isPlaying: false,
      scrubTime: null,
      canUndo: paramCommandStack.canUndo(plugin.meta.id),
      canRedo: paramCommandStack.canRedo(plugin.meta.id),
      resetNonce: s.resetNonce + 1
    }));
  },

  applyExternalState: (pluginId, presetId, overrideParams) => {
    const plugin = getSimulationById(pluginId);
    if (!plugin) return;
    const preset = presetId
      ? plugin.presets.find((p) => p.id === presetId) ?? null
      : plugin.presets[0] ?? null;
    const mergedOverrides = overrideParams ?? preset?.params;
    const params = resolvePluginParams(plugin.paramSchema, mergedOverrides);
    set((s) => ({
      selectedPluginId: plugin.meta.id,
      activePresetId: presetId ?? null,
      params,
      activeLayers: getDefaultLayers(plugin, preset?.visibleLayers),
      isPlaying: false,
      scrubTime: null,
      activeFrameId: 'ground',
      view3dEnabled: (plugin as { renderMode?: string }).renderMode === 'three3d',
      canUndo: paramCommandStack.canUndo(plugin.meta.id),
      canRedo: paramCommandStack.canRedo(plugin.meta.id),
      resetViewNonce: s.resetViewNonce + 1,
      resetNonce: s.resetNonce + 1
    }));
  },

  updateParam: (key, value) => {
    get().updateParamsBatch({ [key]: value }, `调整 ${key}`);
  },

  updateParamsBatch: (patch, label = '画布参数调整') => {
    const cur = get();
    const plugin = getSimulationById(cur.selectedPluginId);
    if (!plugin) return;
    const merged = { ...cur.params, ...patch };
    const resolved = resolvePluginParams(plugin.paramSchema, merged);
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
      canUndo: paramCommandStack.canUndo(plugin.meta.id),
      canRedo: paramCommandStack.canRedo(plugin.meta.id),
      resetNonce: s.resetNonce + 1
    }));
  },

  undoParam: () => {
    const cur = get();
    const entry = paramCommandStack.undo(cur.selectedPluginId);
    if (!entry) return;
    set((s) => ({
      activePresetId: null,
      params: entry.beforeParams,
      scrubTime: null,
      canUndo: paramCommandStack.canUndo(cur.selectedPluginId),
      canRedo: paramCommandStack.canRedo(cur.selectedPluginId),
      resetNonce: s.resetNonce + 1
    }));
  },

  redoParam: () => {
    const cur = get();
    const entry = paramCommandStack.redo(cur.selectedPluginId);
    if (!entry) return;
    set((s) => ({
      activePresetId: null,
      params: entry.afterParams,
      scrubTime: null,
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

  setPlaying: (playing) => set({ isPlaying: playing, scrubTime: playing ? null : get().scrubTime }),
  togglePlaying: () =>
    set((s) => ({
      isPlaying: !s.isPlaying,
      scrubTime: !s.isPlaying ? null : s.scrubTime
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
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  toggleAnnotation: () =>
    set((s) => ({
      annotationOpen: !s.annotationOpen,
      isPlaying: !s.annotationOpen ? false : s.isPlaying
    })),
  setMeasureTool: (measureTool) => set({ measureTool }),
  toggleAutoFbd: () => set((s) => ({ autoFbdEnabled: !s.autoFbdEnabled })),
  toggleFbdComponents: () => set((s) => ({ fbdComponentsEnabled: !s.fbdComponentsEnabled })),
  setActiveFrameId: (activeFrameId) => set({ activeFrameId }),
  toggleView3d: () => set((s) => ({ view3dEnabled: !s.view3dEnabled })),
  triggerResetView: () => set((s) => ({ resetViewNonce: s.resetViewNonce + 1 })),
  triggerReset: () =>
    set((s) => ({
      isPlaying: false,
      scrubTime: null,
      resetNonce: s.resetNonce + 1
    })),
  triggerStepOnce: () =>
    set((s) => ({
      isPlaying: false,
      scrubTime: null,
      stepOnceNonce: s.stepOnceNonce + 1
    })),
  setScrubTime: (t) => set({ scrubTime: t }),
  setTelemetry: (telemetry) => set({ telemetry })
}));
