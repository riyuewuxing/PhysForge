import {
  LEGACY_MODEL_ALIASES,
  resolveCanonicalModelId,
  type AnySimulationPlugin
} from './catalog.js';
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
import { emElectrostaticFieldPlugin } from './em-electrostatic-field/plugin.js';
import { emCapacitorMillikanPlugin } from './em-capacitor-millikan/plugin.js';
import { emAcFieldOscilloscopePlugin } from './em-ac-field-oscilloscope/plugin.js';
import { emWireframeRotationPlugin } from './em-wireframe-rotation/plugin.js';
import { emEddyVortexFieldPlugin } from './em-eddy-vortex-field/plugin.js';
import { emAcGeneratorRmsPlugin } from './em-ac-generator-rms/plugin.js';
import { emTransformerGridPlugin } from './em-transformer-grid/plugin.js';
import { emLcRlcOscillationPlugin } from './em-lc-rlc-oscillation/plugin.js';
import { em3dMagneticFieldsPlugin } from './em-3d-magnetic-fields/plugin.js';
import { wave2dRippleFdtdPlugin } from './wave-2d-ripple-fdtd/plugin.js';
import { opticsWaveInterferencePlugin } from './optics-wave-interference/plugin.js';
import { thermoPistonGasLawsPlugin } from './thermo-piston-gas-laws/plugin.js';
import { thermoCyclesKineticMdPlugin } from './thermo-cycles-kinetic-md/plugin.js';
import { modernPhotoelectricComptonPlugin } from './modern-photoelectric-compton/plugin.js';
import { modernRutherfordBohrPlugin } from './modern-rutherford-bohr/plugin.js';
import { modernNuclearRecoilDecayPlugin } from './modern-nuclear-recoil-decay/plugin.js';

import type { ParamRecord, SimulationPlugin } from '@physforge/sim-sdk';

export type { AnySimulationPlugin };
export { LEGACY_MODEL_ALIASES, resolveCanonicalModelId };

function erasePluginType<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): AnySimulationPlugin {
  return plugin as unknown as AnySimulationPlugin;
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
  erasePluginType(mechShmResonancePlugin),
  erasePluginType(emElectrostaticFieldPlugin),
  erasePluginType(emCapacitorMillikanPlugin),
  erasePluginType(emAcFieldOscilloscopePlugin),
  erasePluginType(emWireframeRotationPlugin),
  erasePluginType(emEddyVortexFieldPlugin),
  erasePluginType(emAcGeneratorRmsPlugin),
  erasePluginType(emTransformerGridPlugin),
  erasePluginType(emLcRlcOscillationPlugin),
  erasePluginType(em3dMagneticFieldsPlugin),
  erasePluginType(wave2dRippleFdtdPlugin),
  erasePluginType(opticsWaveInterferencePlugin),
  erasePluginType(thermoPistonGasLawsPlugin),
  erasePluginType(thermoCyclesKineticMdPlugin),
  erasePluginType(modernPhotoelectricComptonPlugin),
  erasePluginType(modernRutherfordBohrPlugin),
  erasePluginType(modernNuclearRecoilDecayPlugin)
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
