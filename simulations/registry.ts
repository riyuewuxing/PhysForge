import type { ParamRecord, SimulationPlugin } from '@physforge/sim-sdk';
import { emBoundedMagneticFieldPlugin } from './em-bounded-magnetic-field/plugin.js';
import { waveVibrationCouplingPlugin } from './wave-vibration-coupling/plugin.js';
import { emInductionDoubleRodPlugin } from './em-induction-double-rod/plugin.js';
import { mechBlockConveyorPlugin } from './mech-block-conveyor/plugin.js';
import { opticsRayStudioPlugin } from './optics-ray-studio/plugin.js';
import { mechFreeSandboxPlugin } from './mech-free-sandbox/plugin.js';
import { circuitDcCapacitorMnaPlugin } from './circuit-dc-capacitor-mna/plugin.js';

export type AnySimulationPlugin = SimulationPlugin<ParamRecord, unknown>;

function erasePluginType<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): AnySimulationPlugin {
  return plugin as unknown as AnySimulationPlugin;
}

/**
 * 全局物理仿真模型注册表（覆盖 Wave 1 旗舰与 Wave 2 生态集成模型）
 */
export const simulationPlugins: readonly AnySimulationPlugin[] = [
  erasePluginType(emBoundedMagneticFieldPlugin),
  erasePluginType(waveVibrationCouplingPlugin),
  erasePluginType(emInductionDoubleRodPlugin),
  erasePluginType(mechBlockConveyorPlugin),
  erasePluginType(opticsRayStudioPlugin),
  erasePluginType(mechFreeSandboxPlugin),
  erasePluginType(circuitDcCapacitorMnaPlugin)
];

export function getSimulationById(id: string): AnySimulationPlugin | undefined {
  return simulationPlugins.find((p) => p.meta.id === id);
}

export {
  emBoundedMagneticFieldPlugin,
  waveVibrationCouplingPlugin,
  emInductionDoubleRodPlugin,
  mechBlockConveyorPlugin,
  opticsRayStudioPlugin,
  mechFreeSandboxPlugin,
  circuitDcCapacitorMnaPlugin
};
