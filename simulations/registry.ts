import type { ParamRecord, SimulationPlugin } from '@physforge/sim-sdk';
import { emBoundedMagneticFieldPlugin } from './em-bounded-magnetic-field/plugin.js';
import { waveVibrationCouplingPlugin } from './wave-vibration-coupling/plugin.js';
import { emInductionDoubleRodPlugin } from './em-induction-double-rod/plugin.js';
import { mechBlockConveyorPlugin } from './mech-block-conveyor/plugin.js';
import { opticsRayStudioPlugin } from './optics-ray-studio/plugin.js';
import { mechFreeSandboxPlugin } from './mech-free-sandbox/plugin.js';
import { circuitDcCapacitorMnaPlugin } from './circuit-dc-capacitor-mna/plugin.js';
import { builderCustomOdeLabPlugin } from './builder-custom-ode-lab/plugin.js';
import { mechKinematicsChasePlugin } from './mech-kinematics-chase/plugin.js';
import { mechDynamicEquilibriumPlugin } from './mech-dynamic-equilibrium/plugin.js';
import { mechConstrainedVelocityPlugin } from './mech-constrained-velocity/plugin.js';
import { mechProjectileCouplingPlugin } from './mech-projectile-coupling/plugin.js';
import { mechVerticalCircularPlugin } from './mech-vertical-circular/plugin.js';
import { mechConicalTurntablePlugin } from './mech-conical-turntable/plugin.js';
import { mechSpringSeparationPlugin } from './mech-spring-separation/plugin.js';
import { mechCollisionRecoilPlugin } from './mech-collision-recoil/plugin.js';
import { astroOrbitalMechanicsPlugin } from './astro-orbital-mechanics/plugin.js';
import { mechShmResonancePlugin } from './mech-shm-resonance/plugin.js';

export type AnySimulationPlugin = SimulationPlugin<ParamRecord, unknown>;

function erasePluginType<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): AnySimulationPlugin {
  return plugin as unknown as AnySimulationPlugin;
}

/**
 * V1.0 旧模型 ID 到 V2.0 自由建模器规范 ID 的兼容别名映射表（保障教研包与既有预设 100% 不崩）
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'em-bounded-magnetic-field': 'builder-composite-em-field',
  'circuit-dc-capacitor-mna': 'builder-circuit-mna',
  'optics-ray-studio': 'builder-optics-ray',
  'mech-free-sandbox': 'builder-mechanics-lab'
};

export function resolveCanonicalModelId(id: string): string {
  return LEGACY_MODEL_ALIASES[id] ?? id;
}

/**
 * 全局物理仿真模型注册表（V2-W2：五大自由建模器 B1–B5 + W01 / E04 / M05）
 */
export const simulationPlugins: readonly AnySimulationPlugin[] = [
  erasePluginType(emBoundedMagneticFieldPlugin),
  erasePluginType(waveVibrationCouplingPlugin),
  erasePluginType(emInductionDoubleRodPlugin),
  erasePluginType(mechBlockConveyorPlugin),
  erasePluginType(opticsRayStudioPlugin),
  erasePluginType(mechFreeSandboxPlugin),
  erasePluginType(circuitDcCapacitorMnaPlugin),
  erasePluginType(builderCustomOdeLabPlugin),
  erasePluginType(mechKinematicsChasePlugin),
  erasePluginType(mechDynamicEquilibriumPlugin),
  erasePluginType(mechConstrainedVelocityPlugin),
  erasePluginType(mechProjectileCouplingPlugin),
  erasePluginType(mechVerticalCircularPlugin),
  erasePluginType(mechConicalTurntablePlugin),
  erasePluginType(mechSpringSeparationPlugin),
  erasePluginType(mechCollisionRecoilPlugin),
  erasePluginType(astroOrbitalMechanicsPlugin),
  erasePluginType(mechShmResonancePlugin)
];

export function getSimulationById(id: string): AnySimulationPlugin | undefined {
  const canonical = resolveCanonicalModelId(id);
  return simulationPlugins.find((p) => p.meta.id === canonical);
}

export {
  emBoundedMagneticFieldPlugin,
  emBoundedMagneticFieldPlugin as builderCompositeEmFieldPlugin,
  waveVibrationCouplingPlugin,
  emInductionDoubleRodPlugin,
  mechBlockConveyorPlugin,
  opticsRayStudioPlugin,
  opticsRayStudioPlugin as builderOpticsRayPlugin,
  mechFreeSandboxPlugin,
  mechFreeSandboxPlugin as builderMechanicsLabPlugin,
  circuitDcCapacitorMnaPlugin,
  circuitDcCapacitorMnaPlugin as builderCircuitMnaPlugin,
  builderCustomOdeLabPlugin,
  mechCollisionRecoilPlugin,
  astroOrbitalMechanicsPlugin,
  mechShmResonancePlugin
};
