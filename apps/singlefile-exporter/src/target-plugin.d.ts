declare module '@physforge/target-plugin' {
  import type { ParamRecord, SimulationPlugin } from '@physforge/sim-sdk';
  const plugin: SimulationPlugin<ParamRecord, unknown>;
  export default plugin;
}

declare const __INITIAL_PRESET_ID__: string | null;
