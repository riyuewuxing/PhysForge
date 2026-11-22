declare module '@physforge/target-plugin' {
  import type { ParamRecord, SimulationPlugin } from '@physforge/sim-sdk';
  const plugin: SimulationPlugin<ParamRecord, unknown>;
  export default plugin;
}

declare const __INITIAL_PRESET_ID__: string | null;
declare const __INITIAL_PRESET_DATA__: {
  presetId?: string;
  name?: string;
  params?: Record<string, number | boolean | string>;
  visibleLayers?: string[];
} | null;
