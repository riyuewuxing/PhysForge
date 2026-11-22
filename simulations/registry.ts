import type { ParamRecord, SimulationPlugin } from '@physforge/sim-sdk';
import { emBoundedMagneticFieldPlugin } from './em-bounded-magnetic-field/plugin.js';
import { waveVibrationCouplingPlugin } from './wave-vibration-coupling/plugin.js';
import { emInductionDoubleRodPlugin } from './em-induction-double-rod/plugin.js';
import { mechBlockConveyorPlugin } from './mech-block-conveyor/plugin.js';

export type AnySimulationPlugin = SimulationPlugin<ParamRecord, unknown>;

/**
 * 全局物理仿真模型注册表（按教材章节及教学重点组织）
 */
export const simulationPlugins = [
  emBoundedMagneticFieldPlugin as unknown as AnySimulationPlugin,
  waveVibrationCouplingPlugin as unknown as AnySimulationPlugin,
  emInductionDoubleRodPlugin as unknown as AnySimulationPlugin,
  mechBlockConveyorPlugin as unknown as AnySimulationPlugin
] as const;

export function getSimulationById(id: string): AnySimulationPlugin | undefined {
  return simulationPlugins.find((p) => p.meta.id === id);
}

export {
  emBoundedMagneticFieldPlugin,
  waveVibrationCouplingPlugin,
  emInductionDoubleRodPlugin,
  mechBlockConveyorPlugin
};
