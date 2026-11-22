import { create } from 'zustand';
import {
  resolvePluginParams,
  type FormulaDisplayItem,
  type InvariantReport,
  type ParamRecord,
  type PhysicsEvent
} from '@physforge/sim-sdk';
import { getSimulationById, simulationPlugins, type AnySimulationPlugin } from '@physforge/simulations/registry';

export type ClassroomTheme = 'chalkboard' | 'projector';

export interface TelemetrySummary {
  t: number;
  observables: Record<string, number>;
  events: PhysicsEvent[];
  invariants: InvariantReport[];
  formulaItems: FormulaDisplayItem[];
}

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
  resetNonce: number;
  stepOnceNonce: number;
  scrubTime: number | null;
  telemetry: TelemetrySummary;

  selectPlugin: (pluginId: string) => void;
  applyPreset: (presetId: string) => void;
  updateParam: (key: string, value: number | boolean | string) => void;
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
      resetNonce: s.resetNonce + 1
    }));
  },

  applyPreset: (presetId) => {
    const plugin = getSimulationById(get().selectedPluginId);
    if (!plugin) return;
    const preset = plugin.presets.find((p) => p.id === presetId);
    if (!preset) return;
    const params = resolvePluginParams(plugin.paramSchema, preset.params);
    set((s) => ({
      activePresetId: preset.id,
      params,
      activeLayers: getDefaultLayers(plugin, preset.visibleLayers),
      isPlaying: false,
      scrubTime: null,
      resetNonce: s.resetNonce + 1
    }));
  },

  updateParam: (key, value) => {
    const plugin = getSimulationById(get().selectedPluginId);
    if (!plugin) return;
    const merged = { ...get().params, [key]: value };
    const resolved = resolvePluginParams(plugin.paramSchema, merged);
    set((s) => ({
      activePresetId: null,
      params: resolved,
      scrubTime: null,
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
