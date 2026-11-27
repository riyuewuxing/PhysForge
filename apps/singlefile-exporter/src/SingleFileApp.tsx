import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import uPlot from 'uplot';
import { Play, Pause, RotateCcw, StepForward, Eye, EyeOff, SunMoon, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import targetPlugin from '@physforge/target-plugin';
import type {ThermoCycleMdState} from '../../../simulations/thermo-cycles-kinetic-md/engine.js';
import type {ThermoGasState} from '../../../simulations/thermo-piston-gas-laws/engine.js';
import type {OpticsParams} from '../../../simulations/optics-ray-studio/engine.js';
type OpticsSlicePlugin=typeof import('../../../simulations/optics-ray-studio/plugin.js').opticsRayStudioPlugin;
import type {Magnetic3dParams} from '../../../simulations/em-3d-magnetic-fields/engine.js';
type MagneticSlicePlugin=typeof import('../../../simulations/em-3d-magnetic-fields/plugin.js').em3dMagneticFieldsPlugin;
import type {CircuitParams} from '../../../simulations/circuit-dc-capacitor-mna/engine.js';
type CircuitSlicePlugin=typeof import('../../../simulations/circuit-dc-capacitor-mna/plugin.js').circuitDcCapacitorMnaPlugin;
import type { KinematicsChaseState,KinematicsChaseParams } from '../../../simulations/mech-kinematics-chase/engine.js';
type ChaseSlicePlugin=typeof import('../../../simulations/mech-kinematics-chase/plugin.js').mechKinematicsChasePlugin;
import type { BlockConveyorState,BlockConveyorParams } from '../../../simulations/mech-block-conveyor/engine.js';
import type {InductionParams,InductionState} from '../../../simulations/em-induction-double-rod/engine.js';
type InductionSlicePlugin=typeof import('../../../simulations/em-induction-double-rod/plugin.js').emInductionDoubleRodPlugin;
type ContactSlicePlugin=typeof import('../../../simulations/mech-block-conveyor/plugin.js').mechBlockConveyorPlugin;
import type { VerticalCircularParams,VerticalCircularState } from '../../../simulations/mech-vertical-circular/engine.js';
type VerticalSlicePlugin=typeof import('../../../simulations/mech-vertical-circular/plugin.js').mechVerticalCircularPlugin;
import type { ConicalTurntableParams,ConicalTurntableState } from '../../../simulations/mech-conical-turntable/engine.js';
type TurntableSlicePlugin=typeof import('../../../simulations/mech-conical-turntable/plugin.js').mechConicalTurntablePlugin;
import type { SpringSepParams,SpringSepState } from '../../../simulations/mech-spring-separation/engine.js';
type SpringSlicePlugin=typeof import('../../../simulations/mech-spring-separation/plugin.js').mechSpringSeparationPlugin;
import type { CollisionRecoilParams,CollisionRecoilState } from '../../../simulations/mech-collision-recoil/engine.js';
type CollisionSlicePlugin=typeof import('../../../simulations/mech-collision-recoil/plugin.js').mechCollisionRecoilPlugin;
import type { RigidRollingParams } from '../../../simulations/comp-rigid-rolling-slip/engine.js';
type RollingSlicePlugin=typeof import('../../../simulations/comp-rigid-rolling-slip/plugin.js').compRigidRollingSlipPlugin;
import type { ChaosNormalCoriolisParams,ChaosNormalCoriolisState } from '../../../simulations/comp-chaos-normal-coriolis/engine.js';
import type {RelativityQuantumParams} from '../../../simulations/comp-relativity-quantum-tunneling/engine.js';
type RelativitySlicePlugin=typeof import('../../../simulations/comp-relativity-quantum-tunneling/plugin.js').compRelativityQuantumTunnelingPlugin;
type AdvancedSlicePlugin=typeof import('../../../simulations/comp-chaos-normal-coriolis/plugin.js').compChaosNormalCoriolisPlugin;
import type {CapacitorMillikanParams,CapacitorMillikanState} from '../../../simulations/em-capacitor-millikan/engine.js';
type CapacitorSlicePlugin=typeof import('../../../simulations/em-capacitor-millikan/plugin.js').emCapacitorMillikanPlugin;
import type {AcScopeParams,AcScopeState} from '../../../simulations/em-ac-field-oscilloscope/engine.js';
type AcSlicePlugin=typeof import('../../../simulations/em-ac-field-oscilloscope/plugin.js').emAcFieldOscilloscopePlugin;
import type {WireframeParams,WireframeState} from '../../../simulations/em-wireframe-rotation/engine.js';
type WireSlicePlugin=typeof import('../../../simulations/em-wireframe-rotation/plugin.js').emWireframeRotationPlugin;
import type {EddyVortexParams,EddyVortexState} from '../../../simulations/em-eddy-vortex-field/engine.js';
type EddySlicePlugin=typeof import('../../../simulations/em-eddy-vortex-field/plugin.js').emEddyVortexFieldPlugin;
import type {AcGeneratorParams} from '../../../simulations/em-ac-generator-rms/engine.js';
type GeneratorSlicePlugin=typeof import('../../../simulations/em-ac-generator-rms/plugin.js').emAcGeneratorRmsPlugin;
type LcSlicePlugin=typeof import('../../../simulations/em-lc-rlc-oscillation/plugin.js').emLcRlcOscillationPlugin;
import type {WaveCouplingParams,WaveCouplingState} from '../../../simulations/wave-vibration-coupling/engine.js';
type WaveSlicePlugin=typeof import('../../../simulations/wave-vibration-coupling/plugin.js').waveVibrationCouplingPlugin;
import type {WaveFdtdState} from '../../../simulations/wave-2d-ripple-fdtd/engine.js';
type RippleSlicePlugin=typeof import('../../../simulations/wave-2d-ripple-fdtd/plugin.js').wave2dRippleFdtdPlugin;
type TransformerSlicePlugin=typeof import('../../../simulations/em-transformer-grid/plugin.js').emTransformerGridPlugin;
import {
  resolvePluginParams,
  resolveInitialCameraTransform,
  worldToScreen,
  getPixelsPerMeter,
  type FormulaDisplayItem,
  type InvariantReport,
  type ParamRecord,
  type PhysicsEvent,
  type SimulationPluginV2,
  type Viewport
} from '@physforge/sim-sdk';

interface SnapshotFrame {
  t: number;
  state: unknown;
  observables: Record<string, number>;
}

const FIXED_DT = 1 / 240;
const SNAPSHOT_INTERVAL = 1 / 60;
const MAX_SNAPSHOTS = 2400;
// Capability detection avoids embedding an unrelated model ID into every
// isolated singlefile bundle (the exporter explicitly rejects those IDs).
const circuitSlice=targetPlugin.paramSchema.some(f=>f.key==='topology'&&f.kind==='select'&&f.options.some(o=>o.value==='divider-lamp'));
const opticalSlice=targetPlugin.paramSchema.some(f=>f.key==='sceneMode'&&f.kind==='select'&&f.options.some(o=>o.value==='thin-lens-imaging'));
function resolveSliceCamera(params:ParamRecord,width:number,height:number){
  if(circuitSlice)return (targetPlugin as unknown as CircuitSlicePlugin).resolveCircuitSliceCamera(params as CircuitParams,width,height);
  if(opticalSlice)return (targetPlugin as unknown as OpticsSlicePlugin).resolveOpticsSliceCamera(params as OpticsParams,width,height);
  if(magneticSlice)return (targetPlugin as unknown as MagneticSlicePlugin).resolveMagneticSliceCamera(params as Magnetic3dParams,width,height);
  return resolveInitialCameraTransform(targetPlugin as SimulationPluginV2<ParamRecord,unknown>,params,width,height);
}
const mechanicsSlice=targetPlugin.paramSchema.some(f=>f.key==='scenario'&&f.kind==='select'&&f.options.some(o=>o.value==='atwood-constrained'));
const odeSlice=Boolean(targetPlugin.getTelemetryChannels)&&targetPlugin.paramSchema.some(f=>f.key==='template');
const chaseSlice=targetPlugin.paramSchema.some(f=>f.key==='vA0')&&targetPlugin.paramSchema.some(f=>f.key==='xB0')&&targetPlugin.paramSchema.some(f=>f.key==='reactionTime');
const equilibriumSlice=targetPlugin.paramSchema.some(f=>f.key==='baseAngleDeg')&&targetPlugin.paramSchema.some(f=>f.key==='sweepAngleDeg')&&targetPlugin.paramSchema.some(f=>f.key==='autoSweep');
const constrainedSlice=targetPlugin.paramSchema.some(f=>f.key==='secondarySpeedRatio')&&targetPlugin.paramSchema.some(f=>f.key==='driveSpeed')&&targetPlugin.paramSchema.some(f=>f.key==='heightOrLength');
const projectileSlice=targetPlugin.paramSchema.some(f=>f.key==='troughRadius')&&targetPlugin.paramSchema.some(f=>f.key==='inclineDeg')&&targetPlugin.paramSchema.some(f=>f.key==='launchAngleDeg')&&targetPlugin.paramSchema.some(f=>f.key==='dragCoeff');
const contactSlice=targetPlugin.paramSchema.some(f=>f.key==='carrierLengthM')&&targetPlugin.paramSchema.some(f=>f.key==='muBlockCarrier');
const verticalSlice=targetPlugin.paramSchema.some(f=>f.key==='trackMode'&&f.kind==='select'&&f.options.some(o=>o.value==='outer-dome'));
const turntableSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='turntable-dual'));
const springSlice=targetPlugin.paramSchema.some(f=>f.key==='initialComp')&&targetPlugin.paramSchema.some(f=>f.key==='externalForce')&&targetPlugin.paramSchema.some(f=>f.key==='springK');
const collisionSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='collision-2d-oblique'));
const shmSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='pendulum-compare'));
const electroSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='uniform-three-point'));
const capacitorSlice=targetPlugin.paramSchema.some(f=>f.key==='switchMode'&&f.kind==='select'&&f.options.some(o=>o.value==='open-const-q'));
const acSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='ac-square-wave'));
const wireSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='wireframe-gravity-fall'));
const eddySlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='betatron-vortex'));
const generatorSlice=targetPlugin.paramSchema.some(f=>f.key==='waveform'&&f.kind==='select'&&f.options.some(o=>o.value==='duty-square'));
const orbitCompareSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='gravity-assist')&&f.options.some(o=>o.value==='rendezvous'));
const regenSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='regen-brake'));
const nuclearSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='cloud-chamber-recoil')&&f.options.some(o=>o.value==='half-life-mc'));
const atomicSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='rutherford')&&f.options.some(o=>o.value==='bohr'));
const quantumSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='photoelectric')&&f.options.some(o=>o.value==='compton'));
const thermalCycleSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='kinetic-md-box'));
const thermoSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='stop-pin-cylinder'));
const waveOpticsSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='thin-film-wedge'));
const transformerSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='multi-tap-transformer'));
const lcSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='lc-undamped'));
const magneticSlice=targetPlugin.paramSchema.some(f=>f.key==='geometryType'&&f.kind==='select'&&f.options.some(o=>o.value==='uniform-helix'));
const waveSlice=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='doppler'));
const rippleSlice=targetPlugin.paramSchema.some(f=>f.key==='wavelengthCells');
const mechanicsErrorSlice=targetPlugin.paramSchema.some(f=>f.key==='rulerOffsetCm')&&targetPlugin.paramSchema.some(f=>f.key==='hangerMassKg')&&targetPlugin.paramSchema.some(f=>f.key==='readingNoiseMm');
const electricalErrorSlice=targetPlugin.paramSchema.some(f=>f.key==='targetVernierMm')&&targetPlugin.paramSchema.some(f=>f.key==='rheostatTapFrac')&&targetPlugin.paramSchema.some(f=>f.key==='halfBiasSupplyV');
const rollingSlice=targetPlugin.paramSchema.some(f=>f.key==='omega0Radps')&&targetPlugin.paramSchema.some(f=>f.key==='shape')&&targetPlugin.paramSchema.some(f=>f.key==='muK');
const relativitySlice=targetPlugin.paramSchema.some(f=>f.key==='lorentzBeta')&&targetPlugin.paramSchema.some(f=>f.key==='waveMomentumK0')&&targetPlugin.paramSchema.some(f=>f.key==='potentialShape');
const advancedSlice=targetPlugin.paramSchema.some(f=>f.key==='theta1Deg')&&targetPlugin.paramSchema.some(f=>f.key==='normalExcite')&&targetPlugin.paramSchema.some(f=>f.key==='diskOmegaRadps');
// These five older slices have the same sampled-clock contract as the newer scopes.
// Detect their schema capabilities rather than shipping unrelated model IDs.
const boundedFieldScope=targetPlugin.paramSchema.some(f=>f.key==='family')&&targetPlugin.paramSchema.some(f=>f.key==='magneticFieldZ')&&targetPlugin.paramSchema.some(f=>f.key==='fieldScale');
const inductionScope=targetPlugin.paramSchema.some(f=>f.key==='rodMode')&&targetPlugin.paramSchema.some(f=>f.key==='railWidth')&&targetPlugin.paramSchema.some(f=>f.key==='rodResistance1');
const deviceScope=targetPlugin.paramSchema.some(f=>f.key==='device'&&f.kind==='select'&&f.options.some(o=>o.value==='hall-sensor')&&f.options.some(o=>o.value==='mass-spectrometer'));
const mirrorScope=targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='magnetic-mirror')&&f.options.some(o=>o.value==='tokamak'));
const astroScope=targetPlugin.paramSchema.some(f=>f.key==='scaleRegime')&&targetPlugin.paramSchema.some(f=>f.key==='mode'&&f.kind==='select'&&f.options.some(o=>o.value==='kepler-ellipse')&&f.options.some(o=>o.value==='binary-lagrange'));
const legacyScope=boundedFieldScope||inductionScope||deviceScope||mirrorScope||astroScope;
const legacyDemoClock=deviceScope||astroScope;
const baseMeasuredScope=legacyScope||relativitySlice||advancedSlice||rollingSlice||electricalErrorSlice||mechanicsErrorSlice||circuitSlice||mechanicsSlice||odeSlice||chaseSlice||equilibriumSlice||constrainedSlice||projectileSlice||contactSlice||verticalSlice||turntableSlice||springSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||magneticSlice||waveSlice||rippleSlice||thermoSlice||thermalCycleSlice||atomicSlice||nuclearSlice||orbitCompareSlice;
const MECHANICS_FIELDS:Record<string,string[]>={
  'elastic-collision':['scenario','gravity','massRatio','restitution','friction'],
  'incline-slide':['scenario','gravity','massRatio','restitution','friction','inclineDeg'],
  'newtons-cradle':['scenario','gravity','restitution','friction'],
  'spring-oscillator':['scenario','gravity','springK'],
  'atwood-constrained':['scenario','gravity','massRatio']
};
const MECHANICS_CHANNELS:Record<string,string[]>={
  'elastic-collision':['totalMomentumX','kineticEnergy','primaryVx'],
  'incline-slide':['kineticEnergy','primaryVx','totalMomentumX'],
  'newtons-cradle':['totalMomentumX','kineticEnergy','primaryVx'],
  'spring-oscillator':['kineticEnergy','springPotentialEnergy','primaryVx'],
  'atwood-constrained':['primaryVy','secondaryVy','constraintTensionN']
};
const OPTICAL_FIELDS:Record<string,string[]>={
  'tir-interface':['sceneMode','incidentAngleDeg','n1','n2','animateSweep'],
  'parallel-slab':['sceneMode','incidentAngleDeg','n1','slabThickness','animateSweep'],
  'prism-dispersion':['sceneMode','incidentAngleDeg','n1','prismApexDeg','animateSweep'],
  'optical-fiber':['sceneMode','incidentAngleDeg','n1','n2','fiberHalfWidth','animateSweep'],
  'double-slit':['sceneMode','wavelengthNm','slitSeparationMm','screenDistanceM'],
  'thin-lens-imaging':['sceneMode','focalLengthM','objectDistanceM']
};
const CIRCUIT_FIELDS:Record<string,string[]>={
  'divider-lamp':['emf','sliderR','internalR','topology'],
  'closed-power':['emf','sliderR','internalR','topology'],
  'series-parallel-dynamic':['emf','sliderR','internalR','r1','r2','topology'],
  'rc-transient':['emf','r1','capacitance','internalR','switchClosed','topology'],
  'rc-bridge-charge':['emf','sliderR','internalR','r1','r2','capacitance','topology'],
  'nonlinear-lamp-diode':['emf','sliderR','internalR','switchClosed','topology']
};
const CIRCUIT_CHANNELS:Record<string,string[]>={
  'divider-lamp':['totalCurrent','lampCurrent','lampVoltage','outputPower'],
  'closed-power':['totalCurrent','outputPower','terminalVoltage'],
  'series-parallel-dynamic':['branchCurrent1','branchCurrent2','totalCurrent','terminalVoltage','outputPower'],
  'rc-transient':['capVoltage','capCurrent'],
  'rc-bridge-charge':['capVoltage','capCurrent','totalCurrent','branchCurrent1','branchCurrent2'],
  'nonlinear-lamp-diode':['totalCurrent','terminalVoltage','outputPower']
};
// Only present observables that describe the selected apparatus. In particular,
// a Hall-sensor trace must not imply that a velocity-selector measurement exists.
const DEVICE_SCOPE_CHANNELS:Record<string,string[]>={
  'velocity-selector':['particleSpeedMps','selectedSpeed'],
  'mass-spectrometer':['particleSpeedMps','spectrometerRadiusM'],
  'cyclotron':['cyclotronEnergyJ','cyclotronPhaseSlipRad'],
  'hall-sensor':['hallVoltageMv','hallCurrentA'],
  'mhd-generator':['mhdOutputWatt','mhdTerminalVoltageV','mhdLoadCurrentA'],
  'em-flowmeter':['flowRateM3ps','flowVoltageMv']
};
function channelsFor(params:ParamRecord){
  if(targetPlugin.getTelemetryChannels)return targetPlugin.getTelemetryChannels(params);
  const keys=circuitSlice?CIRCUIT_CHANNELS[String(params.topology)]:
    mechanicsSlice?MECHANICS_CHANNELS[String(params.scenario)]:
    inductionScope?(params.rodMode==='single'?['v1','current','kineticEnergy','jouleHeat']:['v1','v2','current','kineticEnergy','jouleHeat']):
    deviceScope?DEVICE_SCOPE_CHANNELS[String(params.device)]:
    mirrorScope?(params.mode==='tokamak'?['minorRadiusM','bMagT','z','vParallel','vPerp','muCurrent','maxMuRelDev']:['z','bMagT','muCurrent','maxMuRelDev','vParallel','vPerp']):
    astroScope?(params.mode==='binary-lagrange'?['jacobiConstant','rotatingSpeedNorm','rNorm','speedNorm','energyNorm','angularMomNorm']:['rNorm','speedNorm','energyNorm','angularMomNorm']):
    undefined;
  return keys?keys.flatMap(key=>targetPlugin.telemetryChannels.filter(c=>c.key===key)):targetPlugin.telemetryChannels;
}

function findClosestSnapshot(snapshots: readonly SnapshotFrame[], targetT: number): SnapshotFrame | null {
  if (snapshots.length === 0) return null;
  let lo = 0;
  let hi = snapshots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid]!.t < targetT) lo = mid + 1;
    else hi = mid;
  }
  const cand = snapshots[lo]!;
  if (lo > 0) {
    const prev = snapshots[lo - 1]!;
    if (Math.abs(prev.t - targetT) < Math.abs(cand.t - targetT)) return prev;
  }
  return cand;
}

export const SingleFileApp: React.FC = () => {
  const initialPreset = useMemo(() => {
    if (__INITIAL_PRESET_ID__) {
      const found = targetPlugin.presets.find((p) => p.id === __INITIAL_PRESET_ID__);
      if (found) return found;
    }
    if (__INITIAL_PRESET_DATA__?.presetId) {
      const found = targetPlugin.presets.find((p) => p.id === __INITIAL_PRESET_DATA__?.presetId);
      if (found) return found;
    }
    return targetPlugin.presets[0] ?? null;
  }, []);

  const [activePresetId, setActivePresetId] = useState<string | null>(
    __INITIAL_PRESET_DATA__?.presetId ?? initialPreset?.id ?? null
  );
  const [params, setParams] = useState<ParamRecord>(() =>
    resolvePluginParams(
      targetPlugin.paramSchema,
      __INITIAL_PRESET_DATA__?.params ?? initialPreset?.params
    )
  );
  const measuredScope=baseMeasuredScope||(regenSlice&&params.mode==='regen-brake');
  const thermoStaticSlice=(thermoSlice&&params.mode!=='stop-pin-cylinder')||(thermalCycleSlice&&params.mode!=='kinetic-md-box')||quantumSlice||(atomicSlice&&params.mode==='bohr')||(nuclearSlice&&params.mode!=='half-life-mc')||(relativitySlice&&params.mode==='minkowski-relativity');
  const [activeLayers, setActiveLayers] = useState<string[]>(() =>
    __INITIAL_PRESET_DATA__?.visibleLayers?.length
      ? [...__INITIAL_PRESET_DATA__.visibleLayers]
      : initialPreset?.visibleLayers?.length
        ? [...initialPreset.visibleLayers]
        : targetPlugin.layers.filter((l) => l.defaultVisible).map((l) => l.id)
  );
  const [orbitFrame,setOrbitFrame]=useState<'ground'|'planet-frame'>('ground');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [strobeEnabled, setStrobeEnabled] = useState(false);
  const [poeMasked, setPoeMasked] = useState(false);
  const [theme, setTheme] = useState<'chalkboard' | 'projector'>('chalkboard');
  const [bigScreen, setBigScreen] = useState(false);
  const [dividerScopeOpen,setDividerScopeOpen]=useState(false);
  const staticDivider=circuitSlice&&params.topology==='divider-lamp';
  // A topology switch resets only the presentation preference. The sampled
  // history is still maintained by the existing physical-clock machinery.
  useLayoutEffect(()=>{if(circuitSlice)setDividerScopeOpen(false);},[params.topology]);
  const [resetNonce, setResetNonce] = useState(0);
  const [stepOnceNonce, setStepOnceNonce] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [summary, setSummary] = useState<{
    t: number;
    observables: Record<string, number>;
    events: PhysicsEvent[];
    invariants: InvariantReport[];
    formulas: FormulaDisplayItem[];
  }>({ t: 0, observables: {}, events: [], invariants: [], formulas: [] });

  const channels = useMemo(()=>channelsFor(params),[params.topology,params.scenario,params.template,(electricalErrorSlice||mirrorScope||astroScope||relativitySlice||advancedSlice||turntableSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||waveSlice||thermalCycleSlice||atomicSlice||nuclearSlice||regenSlice||orbitCompareSlice)?params.mode:undefined,inductionScope?params.rodMode:undefined,deviceScope?params.device:undefined,capacitorSlice?params.oilDropEnabled:undefined,magneticSlice?params.geometryType:undefined,atomicSlice?params.excitedLevelN:undefined,atomicSlice?params.populationMode:undefined,atomicSlice?params.probeKind:undefined,atomicSlice?params.probeEnergyEv:undefined,nuclearSlice?params.magneticFieldT:undefined]);
  const [channelA, setChannelA] = useState(channels[0]?.key ?? '');
  const [channelB, setChannelB] = useState(channels[1]?.key ?? channels[0]?.key ?? '');
  useEffect(()=>{if(measuredScope){setChannelA(channels[0]?.key??'');setChannelB(channels[1]?.key??channels[0]?.key??'');}},[channels]);

  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uplotWrapRef = useRef<HTMLDivElement | null>(null);
  const circuitScopeEmptyRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const syncingPlotRef = useRef(false);

  const simStateRef = useRef<unknown>(null);
  // Physics time belongs to the integrator, not the downsampled plot history.
  const simulationTimeRef = useRef(0);
  const initialStateRef = useRef<unknown>(null);
  const eventsRef = useRef<PhysicsEvent[]>([]);
  const snapshotsRef = useRef<SnapshotFrame[]>([]);
  const lastSnapTRef = useRef(0);
  const accRef = useRef(0);
  const lastFrameMsRef = useRef<number | null>(null);
  const lastUiMsRef = useRef(0);
  const capacitorFitKey=useRef('');
  const viewportRef = useRef<Viewport>({
    width: 800,
    height: 460,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });

  const latestRef = useRef({
    params,
    activeLayers,
    isPlaying,
    playbackSpeed,
    strobeEnabled,
    poeMasked,
    theme,
    scrubTime,
    channelA,
    channelB,
    orbitFrame
  });
  latestRef.current = {
    params,
    activeLayers,
    isPlaying,
    playbackSpeed,
    strobeEnabled,
    poeMasked,
    theme,
    scrubTime,
    channelA,
    channelB,
    orbitFrame
  };

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { params: pm, activeLayers: layers, strobeEnabled: strobe, poeMasked: masked, theme: th, scrubTime: scrub } =
      latestRef.current;
    const frame =
      scrub !== null
        ? findClosestSnapshot(snapshotsRef.current, scrub)
        : snapshotsRef.current[snapshotsRef.current.length - 1] ?? null;
    const drawState = frame ? frame.state : simStateRef.current;
    if(chaseSlice&&drawState!==null){
      const model=targetPlugin as unknown as ChaseSlicePlugin,v=viewportRef.current;
      const s=drawState as KinematicsChaseState,p=pm as KinematicsChaseParams,safe=model.chaseSafeRect(v.width,v.height);
      if(!model.chaseBoundsInViewport(s,p,v,safe)){
        const next=model.chaseFitViewport(s,p,v,safe);if(next)viewportRef.current=next;
      }
    }
    if(inductionScope&&drawState!==null){
      const model=targetPlugin as unknown as InductionSlicePlugin,v=viewportRef.current,s=drawState as InductionState,p=pm as InductionParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.inductionBoundsFit(s,p,v,safe)){const next=model.fitInductionViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    if(contactSlice&&drawState!==null){
      const model=targetPlugin as unknown as ContactSlicePlugin,v=viewportRef.current,s=drawState as BlockConveyorState,p=pm as BlockConveyorParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.contactBoundsFit(s,p,v,safe)){const next=model.fitContactViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    if(verticalSlice&&drawState!==null){
      const model=targetPlugin as unknown as VerticalSlicePlugin,v=viewportRef.current,s=drawState as VerticalCircularState,p=pm as VerticalCircularParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.verticalBoundsFit(s,p,v,safe)){const next=model.fitVerticalViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    if(turntableSlice&&drawState!==null){
      const model=targetPlugin as unknown as TurntableSlicePlugin,v=viewportRef.current,s=drawState as ConicalTurntableState,p=pm as ConicalTurntableParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.turntableBoundsFit(s,p,v,safe)){const next=model.fitTurntableViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    if(springSlice&&drawState!==null){
      const model=targetPlugin as unknown as SpringSlicePlugin,v=viewportRef.current,s=drawState as SpringSepState,p=pm as SpringSepParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.springBoundsFit(s,p,v,safe)){const next=model.fitSpringViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    if(collisionSlice&&drawState!==null){
      const model=targetPlugin as unknown as CollisionSlicePlugin,v=viewportRef.current,s=drawState as CollisionRecoilState,p=pm as CollisionRecoilParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.collisionBoundsFit(s,p,v,safe)){const next=model.fitCollisionViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    if(rollingSlice&&drawState!==null){
      const model=targetPlugin as unknown as RollingSlicePlugin,v=viewportRef.current,p=pm as RigidRollingParams;
      const next=model.fitRollingViewport(p,v,{left:26,right:v.width-26,top:28,bottom:v.height-28});
      if(next)viewportRef.current=next;
    }
    if(advancedSlice&&drawState!==null){
      const model=targetPlugin as unknown as AdvancedSlicePlugin,v=viewportRef.current,p=pm as ChaosNormalCoriolisParams,s=drawState as ChaosNormalCoriolisState;
      const next=model.fitAdvancedViewport(s,p,v,{left:26,right:v.width-26,top:28,bottom:v.height-28});
      if(next)viewportRef.current=next;
    }
    if(relativitySlice&&drawState!==null){
      const model=targetPlugin as unknown as RelativitySlicePlugin,v=viewportRef.current,p=pm as RelativityQuantumParams;
      const next=model.fitRelativityViewport(p,v,{left:26,right:v.width-26,top:28,bottom:v.height-28});
      if(next)viewportRef.current=next;
    }
    if(capacitorSlice&&drawState!==null){
      const model=targetPlugin as unknown as CapacitorSlicePlugin,v=viewportRef.current,p=pm as CapacitorMillikanParams;
      const key=JSON.stringify([p,v.width,v.height,v.scale,v.offsetX,v.offsetY]);
      if(capacitorFitKey.current!==key){
        const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
        ctx.save();const next=model.fitCapacitorViewport(p,v,safe,(text,font)=>{ctx.font=font;return ctx.measureText(text).width;});ctx.restore();
        if(next)viewportRef.current=next;
        const q=viewportRef.current;capacitorFitKey.current=JSON.stringify([p,q.width,q.height,q.scale,q.offsetX,q.offsetY]);
      }
    }
    if(acSlice&&drawState!==null){
      const model=targetPlugin as unknown as AcSlicePlugin,v=viewportRef.current,pp=pm as AcScopeParams,ss=drawState as AcScopeState;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.acScopeBoundsFit(ss,pp,v,safe)){const next=model.fitAcScopeViewport(ss,pp,v,safe);if(next)viewportRef.current=next;}
    }
    if(wireSlice&&drawState!==null){
      const model=targetPlugin as unknown as WireSlicePlugin,v=viewportRef.current,pp=pm as WireframeParams,ss=drawState as WireframeState;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.wireBoundsFit(ss,pp,v,safe)){const next=model.fitWireViewport(ss,pp,v,safe);if(next)viewportRef.current=next;}
    }
    if(eddySlice&&drawState!==null){
      const model=targetPlugin as unknown as EddySlicePlugin,v=viewportRef.current,pp=pm as EddyVortexParams,ss=drawState as EddyVortexState;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.eddyBoundsFit(ss,pp,v,safe)){const next=model.fitEddyViewport(ss,pp,v,safe);if(next)viewportRef.current=next;}
    }
    if(generatorSlice&&drawState!==null){
      const model=targetPlugin as unknown as GeneratorSlicePlugin,v=viewportRef.current,pp=pm as AcGeneratorParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.generatorBoundsFit(pp,v,safe)){const next=model.fitGeneratorViewport(pp,v,safe);if(next)viewportRef.current=next;}
    }
    if(rippleSlice&&drawState!==null){
      const model=targetPlugin as unknown as RippleSlicePlugin,v=viewportRef.current,safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.rippleBoundsFit(v,safe)){const next=model.fitRippleViewport(v,safe);if(next)viewportRef.current=next;}
    }
    if(waveSlice&&drawState!==null){
      const model=targetPlugin as unknown as WaveSlicePlugin,v=viewportRef.current,pp=pm as WaveCouplingParams,safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.waveBoundsFit(pp,v,safe)){const next=model.fitWaveViewport(pp,v,safe);if(next)viewportRef.current=next;}
    }
    if(lcSlice&&drawState!==null){
      const model=targetPlugin as unknown as LcSlicePlugin,v=viewportRef.current;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.lcBoundsFit(v,safe)){const next=model.fitLcViewport(v,safe);if(next)viewportRef.current=next;}
    }
    if(transformerSlice&&drawState!==null){
      const model=targetPlugin as unknown as TransformerSlicePlugin,v=viewportRef.current;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.transformerBoundsFit(v,safe)){const next=model.fitTransformerViewport(v,safe);if(next)viewportRef.current=next;}
    }
    const vp = viewportRef.current;
    ctx.save();
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.fillStyle = th === 'projector' ? '#ffffff' : '#091220';
    ctx.fillRect(0, 0, vp.width, vp.height);

    if (drawState !== null) {
      const layerSet = new Set(layers);
      if (masked) {
        layerSet.delete('trajectory');
        layerSet.delete('larmorCircle');
        layerSet.delete('slopeGhost');
        layerSet.delete('vibrationGraph');
        layerSet.delete('eventPins');
      }
      if(orbitCompareSlice){
        const obs=targetPlugin.engine.computeObservables(drawState,pm);
        const relative=pm.mode==='gravity-assist'&&latestRef.current.orbitFrame==='planet-frame';
        const origin=relative?{x:obs.bodyX??0,y:obs.bodyY??0}:{x:0,y:0},ppm=getPixelsPerMeter(vp);
        const observationFrameId=relative?'planet-frame':'ground';
        targetPlugin.renderCanvas(ctx,drawState,pm,{...vp,theme:th,observationFrameId,offsetX:vp.offsetX-origin.x*ppm,offsetY:vp.offsetY+origin.y*ppm},layerSet);
        if(frame)canvas.dataset.orbitCompareRendered=JSON.stringify({mode:pm.mode,flybySide:pm.flybySide,rendezvousBurn:pm.rendezvousBurn,outerTime:frame.t,observationFrame:observationFrameId,frameOrigin:origin,...obs});
      }else targetPlugin.renderCanvas(ctx, drawState, pm, measuredScope||opticalSlice||transformerSlice||waveOpticsSlice||thermoSlice||quantumSlice||atomicSlice||(regenSlice&&pm.mode==='regen-brake')?{...vp,theme:th}:vp, layerSet);
      if(regenSlice&&pm.mode==='regen-brake'&&frame)canvas.dataset.regenRendered=JSON.stringify({mode:pm.mode,v0Mps:pm.v0Mps,loadResOhm:pm.loadResOhm,mechBrakeN:pm.mechBrakeN,aeroDragCoeff:pm.aeroDragCoeff,outerTime:frame.t,...targetPlugin.engine.computeObservables(drawState,pm)});
      if(nuclearSlice&&frame)canvas.dataset.nuclearRendered=JSON.stringify({...pm,outerTime:frame.t,...targetPlugin.engine.computeObservables(drawState,pm)});
      if(atomicSlice&&frame)canvas.dataset.atomicRendered=JSON.stringify({...pm,outerTime:frame.t,...targetPlugin.engine.computeObservables(drawState,pm)});
      if(quantumSlice&&frame)canvas.dataset.quantumRendered=JSON.stringify({...pm,outerTime:frame.t,...targetPlugin.engine.computeObservables(drawState,pm)});
      if(thermalCycleSlice&&frame){
      const s=drawState as ThermoCycleMdState;
      canvas.dataset.thermalRendered=JSON.stringify({...pm,outerTime:frame.t,cycle:s.cycle,initialKineticEnergy:s.initialKineticEnergy,boxSize:s.boxSize,gasSpeeds:s.particles.filter(q=>q.mass===1).map(q=>Math.hypot(q.vx,q.vy)),pollenCount:s.particles.filter(q=>q.mass>2).length,wallGap:s.particles.reduce((m,q)=>Math.min(m,q.x-q.radius,q.y-q.radius,s.boxSize-q.x-q.radius,s.boxSize-q.y-q.radius),s.boxSize),trailCount:s.brownianTrail.length,...targetPlugin.engine.computeObservables(drawState,pm)});
      }
      if(thermoSlice&&frame){const s=drawState as ThermoGasState;canvas.dataset.thermoRendered=JSON.stringify({...pm,outerTime:frame.t,pvHistory:s.pvHistory,pumpStages:s.pumpStages,events:s.events,...targetPlugin.engine.computeObservables(drawState,pm)});}
      if(waveOpticsSlice&&frame)canvas.dataset.waveOpticsRendered=JSON.stringify({...pm,outerTime:frame.t,...targetPlugin.engine.computeObservables(drawState,pm)});
      if(opticalSlice&&frame)canvas.dataset.b3Rendered=JSON.stringify({t:frame.t,mode:pm.sceneMode,...frame.observables});
      if(circuitSlice&&frame)canvas.dataset.b2Rendered=JSON.stringify({t:frame.t,topology:pm.topology,...frame.observables});
      if(chaseSlice&&frame){canvas.dataset.chaseRendered=JSON.stringify({t:frame.t,...frame.observables});canvas.dataset.chaseViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(inductionScope&&frame){const model=targetPlugin as unknown as InductionSlicePlugin,s=drawState as InductionState,p=pm as InductionParams;
        canvas.dataset.inductionRendered=JSON.stringify({t:frame.t,rodMode:p.rodMode,x1:s.x1,x2:s.x2,v1:s.v1,v2:s.v2,current:s.current,railWidth:p.railWidth,railWidth2:p.railWidth2,magneticB:p.magneticB});
        canvas.dataset.inductionView=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY,bounds:model.inductionScreenBounds(s,p,vp),safe:{left:26,right:vp.width-26,top:28,bottom:vp.height-28}});}
      if(contactSlice&&frame){canvas.dataset.contactRendered=JSON.stringify({t:frame.t,mode:pm.systemMode,...frame.observables});canvas.dataset.contactViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(verticalSlice&&frame){canvas.dataset.verticalRendered=JSON.stringify({t:frame.t,mode:pm.trackMode,...frame.observables});canvas.dataset.verticalViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(turntableSlice&&frame){canvas.dataset.turntableRendered=JSON.stringify({t:frame.t,mode:pm.mode,...frame.observables});canvas.dataset.turntableViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(springSlice&&frame){canvas.dataset.springRendered=JSON.stringify({t:frame.t,inclineDeg:pm.inclineDeg,initialComp:pm.initialComp,externalForce:pm.externalForce,...frame.observables});canvas.dataset.springViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(wireSlice&&frame){
        const model=targetPlugin as unknown as WireSlicePlugin,st=drawState as WireframeState;
        canvas.dataset.wireRendered=JSON.stringify({t:frame.t,mode:pm.mode,loopShape:pm.loopShape,fieldProfile:pm.fieldProfile,magneticB:pm.magneticB,loopSizeL:pm.loopSizeL,omegaRadS:pm.omegaRadS,eventCount:st.events.length,...frame.observables});
        canvas.dataset.wireView=JSON.stringify({bounds:model.wireDiagramBounds(st,pm as WireframeParams),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});
      }
      if(eddySlice&&frame){
        const model=targetPlugin as unknown as EddySlicePlugin,st=drawState as EddyVortexState;
        canvas.dataset.eddyRendered=JSON.stringify({t:frame.t,mode:pm.mode,cylinderRadiusR:pm.cylinderRadiusR,bDotRate:pm.bDotRate,particleChargeRatio:pm.particleChargeRatio,pendulumLengthL:pm.pendulumLengthL,eventCount:st.events.length,eventTime:st.events.at(-1)?.time,...frame.observables});
        canvas.dataset.eddyView=JSON.stringify({bounds:model.eddyDiagramBounds(st,pm as EddyVortexParams),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});
      }
      if(generatorSlice&&frame){
        const model=targetPlugin as unknown as GeneratorSlicePlugin;
        canvas.dataset.generatorRendered=JSON.stringify({t:frame.t,waveform:pm.waveform,freqHz:pm.freqHz,dutyCycleD:pm.dutyCycleD,loadR:pm.loadR,...frame.observables});
        canvas.dataset.generatorView=JSON.stringify({bounds:model.generatorDiagramBounds(pm as AcGeneratorParams),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});
      }
      if(rippleSlice&&frame){
        const st=drawState as WaveFdtdState,model=targetPlugin as unknown as RippleSlicePlugin;
        canvas.dataset.rippleRendered=JSON.stringify({outerTime:frame.t,mode:pm.mode,waveSpeed:pm.waveSpeed,amplitude:pm.amplitude,wavelengthCells:pm.wavelengthCells,slitWidthCells:pm.slitWidthCells,slitSepCells:pm.slitSepCells,refractiveIndexN:pm.refractiveIndexN,geometry:st.geometry,nx:st.nx,ny:st.ny,wallI:st.wallI,screenI:st.screenI,screenIntensity:Array.from(st.screenIntensity),screenField:Array.from({length:st.ny},(_,j)=>st.fieldSnapshot[j*st.nx+st.screenI]),...frame.observables});
        canvas.dataset.rippleView=JSON.stringify({bounds:model.rippleDiagramBounds(),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY,safe:{left:26,right:vp.width-26,top:28,bottom:vp.height-28}});
      }
      if(waveSlice&&frame){
        const st=drawState as WaveCouplingState,model=targetPlugin as unknown as WaveSlicePlugin;
        canvas.dataset.waveRendered=JSON.stringify({t:frame.t,mode:pm.mode,amplitude:pm.amplitude,frequency:pm.frequency,wavelength:pm.wavelength,direction:pm.direction,causalFront:pm.causalFront,probeX:pm.probeX,receiverY:pm.probeY,sourceSeparation:pm.sourceSeparation,phaseDiffDeg:pm.phaseDiffDeg,sourceSpeedRatio:pm.sourceSpeedRatio,retardedTimes:st.retardedTimes,wavefronts:st.wavefronts,historyLast:st.probeHistory.at(-1),...frame.observables});
        canvas.dataset.waveView=JSON.stringify({bounds:model.waveDiagramBounds(pm as WaveCouplingParams),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY,safe:{left:26,right:vp.width-26,top:28,bottom:vp.height-28}});
      }
      if(magneticSlice&&frame)canvas.dataset.magneticRendered=JSON.stringify({t:frame.t,geometryType:pm.geometryType,uniformBz:pm.uniformBz,qOverM:pm.qOverM,currentI:pm.currentI,vPerp:pm.vPerp,vParallel:pm.vParallel,radiusR:pm.radiusR,...frame.observables});
      if(lcSlice&&frame){
        const model=targetPlugin as unknown as LcSlicePlugin;
        canvas.dataset.lcRendered=JSON.stringify({t:frame.t,mode:pm.mode,inductanceH:pm.inductanceH,capacitanceF:pm.capacitanceF,resistanceR:pm.resistanceR,initialChargeC:pm.initialChargeC,driveVoltAmpUm:pm.driveVoltAmpUm,driveOmega:pm.driveOmega,...frame.observables});
        canvas.dataset.lcView=JSON.stringify({bounds:model.lcDiagramBounds(),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});
      }
      if(transformerSlice&&frame){
        const model=targetPlugin as unknown as TransformerSlicePlugin;
        canvas.dataset.transformerRendered=JSON.stringify({t:frame.t,mode:pm.mode,sourceU0:pm.sourceU0,primaryR0:pm.primaryR0,n1Ratio:pm.n1Ratio,n2Ratio:pm.n2Ratio,n3Ratio:pm.n3Ratio,loadR2:pm.loadR2,loadR3:pm.loadR3,parallelUsersCount:pm.parallelUsersCount,branch3Closed:pm.branch3Closed,genPowerKw:pm.genPowerKw,stepUpRatioK1:pm.stepUpRatioK1,lineResistanceR:pm.lineResistanceR,...frame.observables});
        canvas.dataset.transformerView=JSON.stringify({bounds:model.transformerDiagramBounds(),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});
      }
      if(acSlice&&frame){
        const model=targetPlugin as unknown as AcSlicePlugin,st=drawState as AcScopeState;
        canvas.dataset.acRendered=JSON.stringify({t:frame.t,mode:pm.mode,periodT:pm.periodT,accelA0:pm.accelA0,uAccelV:pm.uAccelV,phaseDeltaDeg:pm.phaseDeltaDeg,eqFieldAccelX:pm.eqFieldAccelX,eqFieldAccelY:pm.eqFieldAccelY,trailCount:st.scopeTrail.length,...frame.observables});
        canvas.dataset.acView=JSON.stringify({bounds:model.acDiagramBounds(st,pm as AcScopeParams),width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});
      }
      if(capacitorSlice&&frame){
        const model=targetPlugin as unknown as CapacitorSlicePlugin;
        ctx.save();const layout=model.capacitorLayout(drawState as CapacitorMillikanState,pm as CapacitorMillikanParams,vp,layerSet,(text,font)=>{ctx.font=font;return ctx.measureText(text).width;});ctx.restore();
        canvas.dataset.capacitorView=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY,boxes:layout.boxes,safe:{left:26,right:vp.width-26,top:28,bottom:vp.height-28}});
        canvas.dataset.capacitorRendered=JSON.stringify({t:frame.t,switchMode:pm.switchMode,groundMode:pm.groundMode,sourceVoltageU0:pm.sourceVoltageU0,distanceMm:pm.distanceMm,areaRatioS:pm.areaRatioS,dielectricEr:pm.dielectricEr,oilDropEnabled:pm.oilDropEnabled,dropChargeSteps:pm.dropChargeSteps,...frame.observables});}
      if(electroSlice&&frame)canvas.dataset.electroRendered=JSON.stringify({t:frame.t,mode:pm.mode,q1MicroC:pm.q1MicroC,q2MicroC:pm.q2MicroC,phiA:pm.phiA,phiB:pm.phiB,phiC:pm.phiC,testChargeRatio:pm.testChargeRatio,uAccelV:pm.uAccelV,uDeflectV:pm.uDeflectV,...frame.observables});
      if(shmSlice&&frame)canvas.dataset.shmRendered=JSON.stringify({t:frame.t,mode:pm.mode,lengthL:pm.lengthL,initialAngleDeg:pm.initialAngleDeg,gravityG:pm.gravityG,massM:pm.massM,dampingGamma:pm.dampingGamma,driveAccelAmp:pm.driveAccelAmp,driveOmega:pm.driveOmega,...frame.observables});
      if(collisionSlice&&frame){canvas.dataset.collisionRendered=JSON.stringify({t:frame.t,mode:pm.mode,impactParamB:pm.impactParamB,blockLength:pm.blockLength,v10:pm.v10,dragForceF:pm.dragForceF,...frame.observables});canvas.dataset.collisionViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(equilibriumSlice&&frame){canvas.dataset.equilibriumRendered=JSON.stringify({t:frame.t,...frame.observables});canvas.dataset.equilibriumView=layerSet.has('angle-curve')?'angle-curve':layerSet.has('aux-circle')?'aux-circle':layerSet.has('triangle')?'triangle':'none';}
      if(projectileSlice&&frame)canvas.dataset.projectileRendered=JSON.stringify({t:frame.t,mode:pm.mode,...frame.observables});
      if(constrainedSlice&&frame)canvas.dataset.constrainedRendered=JSON.stringify({t:frame.t,mode:pm.mode,...frame.observables});
      if(odeSlice&&frame)canvas.dataset.odeRendered=JSON.stringify({t:frame.t,template:pm.template,...frame.observables});
      if(mechanicsSlice&&frame)canvas.dataset.b4Rendered=JSON.stringify({t:frame.t,scenario:pm.scenario,...frame.observables});

      if (strobe && !masked && snapshotsRef.current.length > 2) {
        const curT = frame ? frame.t : 0;
        let lastT = -1;
        for (const s of snapshotsRef.current) {
          if (s.t > curT) break;
          if (s.t - lastT < 0.08) continue;
          lastT = s.t;
          if (typeof s.observables.x === 'number' && typeof s.observables.y === 'number') {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.72)';
            ctx.beginPath();
            const point = worldToScreen(s.observables.x, s.observables.y, vp);
            ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  const syncPlot = () => {
    const plot = uplotRef.current;
    if (!plot) return;
    const snaps = snapshotsRef.current;
    const { channelA: chA, channelB: chB } = latestRef.current;
    const measuredScope=baseMeasuredScope||(regenSlice&&latestRef.current.params.mode==='regen-brake');
    const sampleValue=(s:SnapshotFrame,ch:string)=>{
      const value=ch?s.observables[ch]:undefined;
      if(!measuredScope)return value??0;
      return typeof value==='number'&&Number.isFinite(value)?value:null;
    };
    syncingPlotRef.current = true;
    try {
      plot.setData([
        snaps.map((s) => s.t),
        snaps.map((s) => sampleValue(s,chA)),
        snaps.map((s) => sampleValue(s,chB))
      ]);
    } finally { syncingPlotRef.current = false; }
    if (measuredScope && uplotWrapRef.current) {
      uplotWrapRef.current.dataset.lastSampleT = String(snaps.at(-1)?.t ?? '');
      if(legacyScope||relativitySlice||advancedSlice||rollingSlice||electricalErrorSlice||mechanicsErrorSlice||contactSlice||verticalSlice||turntableSlice||springSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||magneticSlice||waveSlice||rippleSlice||thermoSlice||thermalCycleSlice||atomicSlice||nuclearSlice||orbitCompareSlice||(regenSlice&&latestRef.current.params.mode==='regen-brake'))uplotWrapRef.current.dataset.sampleCount=String(snaps.length);
      const empty = snaps.length < 2;
      uplotWrapRef.current.style.visibility = empty ? 'hidden' : '';
      if (circuitScopeEmptyRef.current) circuitScopeEmptyRef.current.style.display = empty ? 'grid' : 'none';
    } else if (uplotWrapRef.current && regenSlice) {
      uplotWrapRef.current.style.visibility='';
      delete uplotWrapRef.current.dataset.lastSampleT;delete uplotWrapRef.current.dataset.sampleCount;delete uplotWrapRef.current.dataset.scopeTimeType;
    }
  };

  const emitSummary = (force = false) => {
    const now = performance.now();
    if (!force && now - lastUiMsRef.current < 90) return;
    lastUiMsRef.current = now;
    const snaps = snapshotsRef.current;
    const snap =
      latestRef.current.scrubTime !== null
        ? findClosestSnapshot(snaps, latestRef.current.scrubTime)
        : snaps[snaps.length - 1] ?? null;
    if (!snap || initialStateRef.current === null) return;
    setSummary({
      t: snap.t,
      observables: snap.observables,
      events: eventsRef.current,
      invariants: targetPlugin.engine.checkInvariants
        ? targetPlugin.engine.checkInvariants(snap.state, initialStateRef.current, latestRef.current.params)
        : [],
      formulas: targetPlugin.formatFormulas
        ? targetPlugin.formatFormulas(snap.state, latestRef.current.params)
        : []
    });
  };

  // Commit a discrete display transition before the browser paints; continuous
  // integration still uses rAF and the existing throttled React summaries.
  useLayoutEffect(() => {
    const camera = resolveSliceCamera(latestRef.current.params,viewportRef.current.width,viewportRef.current.height);
    viewportRef.current = { ...viewportRef.current, ...camera };
    if(simStateRef.current!==null)targetPlugin.engine.disposeState?.(simStateRef.current);
    const init = targetPlugin.engine.createInitialState(params);
    const obs0 = targetPlugin.engine.computeObservables(init, params);
    simStateRef.current = init;
    simulationTimeRef.current = 0;
    initialStateRef.current = init;
    eventsRef.current = [];
    snapshotsRef.current = [{ t: 0, state: init, observables: obs0 }];
    lastSnapTRef.current = 0;
    accRef.current = 0;
    lastFrameMsRef.current = null;
    drawCanvas();
    syncPlot();
    emitSummary(true);
  }, [resetNonce]);
  useEffect(()=>()=>{if(simStateRef.current!==null)targetPlugin.engine.disposeState?.(simStateRef.current);},[]);

  // Preserve the exact final integration sample on pause. A frame may have
  // advanced fewer than SNAPSHOT_INTERVAL seconds since the last plot sample.
  useLayoutEffect(() => {
    if (isPlaying) return;
    const state = simStateRef.current;
    const t = simulationTimeRef.current;
    if (state !== null && t > lastSnapTRef.current) {
      snapshotsRef.current.push({ t, state, observables: targetPlugin.engine.computeObservables(state, latestRef.current.params) });
      if (snapshotsRef.current.length > (rippleSlice?480:MAX_SNAPSHOTS)) snapshotsRef.current.shift();
      lastSnapTRef.current = t;
    }
    drawCanvas();
    syncPlot();
    emitSummary(true);
  }, [isPlaying]);

  useLayoutEffect(() => {
    if (stepOnceNonce === 0) return;
    let cur = simStateRef.current;
    if (cur === null) return;
    let simT = simulationTimeRef.current;
    for (let i = 0; i < 4; i++) {
      const res = targetPlugin.engine.step(cur, params, FIXED_DT);
      cur = res.nextState;
      simT += res.advancedTime??FIXED_DT;
      if (res.events.length > 0) eventsRef.current = [...eventsRef.current, ...res.events];
      if(res.halt||res.advancedTime===0)break;
    }
    simStateRef.current = cur;
    simulationTimeRef.current = simT;
    const sample={t:simT,state:cur,observables:targetPlugin.engine.computeObservables(cur,params)};
    if(simT===lastSnapTRef.current)snapshotsRef.current[snapshotsRef.current.length-1]=sample;
    else snapshotsRef.current.push(sample);
    if (snapshotsRef.current.length > (rippleSlice?480:MAX_SNAPSHOTS)) snapshotsRef.current.shift();
    lastSnapTRef.current = simT;
    drawCanvas();
    syncPlot();
    emitSummary(true);
  }, [stepOnceNonce]);

  useLayoutEffect(() => {
    drawCanvas();
    emitSummary(true);
  }, [activeLayers, strobeEnabled, poeMasked, theme, scrubTime,orbitFrame]);

  useEffect(() => {
    syncPlot();
  }, [channelA, channelB]);

  useEffect(() => {
    const box = stageBoxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const updateSize = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(300, Math.floor(rect.width));
      const height = Math.max(220, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current = { ...viewportRef.current, width, height, dpr };
      const camera = resolveSliceCamera(latestRef.current.params,width,height);
      viewportRef.current = { ...viewportRef.current, ...camera };
      drawCanvas();
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let rafId = 0;
    const tick = (nowMs: number) => {
      rafId = requestAnimationFrame(tick);
      if (!latestRef.current.isPlaying) {
        lastFrameMsRef.current = null;
        return;
      }
      if (lastFrameMsRef.current === null) {
        lastFrameMsRef.current = nowMs;
        return;
      }
      const rawDt = Math.min((nowMs - lastFrameMsRef.current) / 1000, 0.05);
      lastFrameMsRef.current = nowMs;
      accRef.current += rawDt * latestRef.current.playbackSpeed;

      let stepped = false;
      let cur = simStateRef.current;
      let simT = simulationTimeRef.current;

      while (accRef.current >= FIXED_DT && cur !== null) {
        const res = targetPlugin.engine.step(cur, latestRef.current.params, FIXED_DT);
        cur = res.nextState;
        const advanced=res.advancedTime??FIXED_DT;
        simT += advanced;
        accRef.current -= FIXED_DT;
        stepped = true;
        if (res.events.length > 0) eventsRef.current = [...eventsRef.current, ...res.events];
        if (res.halt||simT - lastSnapTRef.current >= (rippleSlice?1/20:SNAPSHOT_INTERVAL)-1e-10) {
          const sample={t:simT,state:cur,observables:targetPlugin.engine.computeObservables(cur,latestRef.current.params)};
          if(simT===lastSnapTRef.current)snapshotsRef.current[snapshotsRef.current.length-1]=sample;
          else snapshotsRef.current.push(sample);
          if (snapshotsRef.current.length > (rippleSlice?480:MAX_SNAPSHOTS)) snapshotsRef.current.shift();
          lastSnapTRef.current = simT;
        }
        if(res.halt){latestRef.current.isPlaying=false;setIsPlaying(false);}
        if(res.halt||advanced===0){accRef.current=0;lastFrameMsRef.current=null;break;}
      }

      if (stepped && cur !== null) {
        simStateRef.current = cur;
        simulationTimeRef.current = simT;
        drawCanvas();
        syncPlot();
        emitSummary(false);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const wrap = uplotWrapRef.current;
    if (!wrap) return;
    const specA = channels.find((c) => c.key === channelA) ?? channels[0];
    const specB = channels.find((c) => c.key === channelB) ?? channels[1] ?? channels[0];
    const split=measuredScope&&specA?.unit!==specB?.unit;
    const contactPair=contactSlice&&((channelA==='vBlock'&&channelB==='vCarrier')||(channelA==='vCarrier'&&channelB==='vBlock'));
    const colors:Record<string,string>={'#38bdf8':'#0369a1','#fbbf24':'#92400e','#f472b6':'#9d174d','#4ade80':'#166534'};
    const paint=(c:string)=>measuredScope&&theme==='projector'?colors[c]??'#334155':c;
    wrap.dataset.scopeUnits=split?'separate':'shared';
    const textColor = theme === 'projector' ? '#0f172a' : '#cbd5e1';
    const gridColor = theme === 'projector' ? 'rgba(15,23,42,0.12)' : 'rgba(148,163,184,0.16)';
    // Small physical residuals must not become several indistinguishable zero ticks.
    const advancedAxis = (key: 'A'|'B') => (legacyScope||advancedSlice||relativitySlice) ? {size:96,values: (_u: uPlot, splits: number[]) => {
      const labels=splits.map(v=>v===0?'0':Math.abs(v)<.001||Math.abs(v)>=1e5?v.toExponential(3):String(Number(v.toPrecision(5))));
      wrap.dataset['scopeYTicks'+key]=JSON.stringify({splits,labels});return labels;
    }} : {};

    const plot = new uPlot(
      {
        width: Math.max(280, wrap.clientWidth),
        height: 150,
        ...(measuredScope ? { scales: {
          x: { time: false, range: (_u: uPlot, min: number, max: number): [number, number] => {
            const lo = Number.isFinite(min) ? min : 0;
            return [lo, Math.max(lo + .1, Number.isFinite(max) ? max : lo)];
          }},
          y: { auto: true }, ...(split ? { y2: { auto: true } } : {})
        }} : {}),
        axes: [
          { stroke: textColor, grid: { stroke: gridColor }, ...(measuredScope ? {
            values: (_u: uPlot, splits: number[]) => splits.map(v => Number(v.toPrecision(4)) + (thermalCycleSlice||orbitCompareSlice||relativitySlice?'*':'s')),
            ...(atomicSlice||deviceScope?{label:'演示时间（非物理飞行时间）',labelSize:13}:astroScope?{label:'演示时间（非天体物理时长）',labelSize:13}:{})
          } : {}) },
          { stroke: measuredScope ? paint(specA?.color ?? '#38bdf8') : textColor, grid: { stroke: gridColor }, ...(legacyScope?{label:specA?.unit||'无量纲',labelSize:12}:{}), ...advancedAxis('A') },
          ...(split?[{scale:'y2',side:1 as const,stroke:paint(specB?.color??'#f472b6'),grid:{show:false},...(legacyScope?{label:specB?.unit||'无量纲',labelSize:12}:{}),...advancedAxis('B')}]:[])
        ],
        series: [
          { label: thermalCycleSlice||orbitCompareSlice||relativitySlice?'约化时间 t*':equilibriumSlice||atomicSlice||legacyDemoClock?'演示时间 (s)':'t (s)' },
          { label: specA?.label ?? 'A', stroke: paint(specA?.color ?? '#38bdf8'), width: 2 },
          { label: specB?.label ?? 'B', stroke: paint(specB?.color ?? '#f472b6'), width: 2,...(split?{scale:'y2'}:{}) }
        ],
        hooks: {
          // uPlot commits scale changes during its draw; reading immediately
          // after setData may return the previous frame's range.
          draw: [(u) => { if (measuredScope) {wrap.dataset.scopeMax = String(u.scales.x?.max ?? '');wrap.dataset.scopeTimeType=String(u.scales.x?.time===false?'elapsed':'calendar');} if(contactPair){const model=targetPlugin as unknown as ContactSlicePlugin;wrap.dataset.sampledRelativeSlip=String(model.drawRelativeVelocityBand(u.ctx,u.data[0],u.data[1]!,u.data[2]!,t=>u.valToPos(t,'x',true),v=>u.valToPos(v,'y',true),u.bbox,theme==='projector'));}else delete wrap.dataset.sampledRelativeSlip; }],
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              if (idx == null || latestRef.current.isPlaying || syncingPlotRef.current) return;
              const tv = u.data[0]?.[idx];
              if (typeof tv === 'number' && Number.isFinite(tv)) setScrubTime(tv);
            }
          ]
        }
      },
      measuredScope?[[0],[null],[null]]:[[0],[0],[0]],
      wrap
    );
    uplotRef.current = plot;
    syncPlot();
    const ro = new ResizeObserver(() => {
      if (uplotWrapRef.current) plot.setSize({ width: Math.max(280, uplotWrapRef.current.clientWidth), height: 150 });
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      plot.destroy();
      uplotRef.current = null;
    };
  }, [channelA, channelB, theme,channels,measuredScope]);

  return (
    <div
      data-testid="singlefile-shell"
      data-model-id={targetPlugin.meta.id}
      className={`h-screen w-screen flex flex-col overflow-hidden ${bigScreen ? 'big-screen-mode' : ''}`}
      style={{ backgroundColor: 'var(--pf-bg)', color: 'var(--pf-text)' }}
    >
      <header
        className="shrink-0 border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2"
        style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface)' }}
      >
        <div>
          <div className="font-bold text-base">{targetPlugin.meta.title}</div>
          <div className="text-xs" data-testid="sf-summary-clock" data-sample-time={summary.t} style={{ color: 'var(--pf-text-muted)' }}>
            离线课堂单文件切片 · {targetPlugin.meta.textbookRef} · {thermoStaticSlice?(relativitySlice?'静态洛伦兹事件 · 调参比较':nuclearSlice?'静态理想化 · 调参比较':atomicSlice?'静态能级与谱线比较':quantumSlice?'静态量子实验 · 调参比较':thermalCycleSlice?'静态解析循环 · 调参比较':'独立等温状态 · 调参比较'):atomicSlice?`演示时间 ${summary.t.toFixed(3)} s`:thermalCycleSlice||orbitCompareSlice||relativitySlice?`t* = ${summary.t.toFixed(3)}（约化）`:waveOpticsSlice?'静态归一化光强 · 调参比较':transformerSlice?'稳态有效值 · 调参比较':astroScope?`演示时间 ${summary.t.toFixed(3)} s · t* = ${(summary.observables.tNorm??0).toFixed(3)}（约化）`:deviceScope?`演示时间 ${summary.t.toFixed(3)} s（非物理飞行时间）`:`t = ${summary.t.toFixed(3)} s`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {orbitCompareSlice&&params.mode==='gravity-assist'&&<select aria-label="观察参考系" data-testid="sf-orbit-frame" value={orbitFrame} onChange={e=>setOrbitFrame(e.target.value==='planet-frame'?'planet-frame':'ground')}><option value="ground">局部惯性系</option><option value="planet-frame">行星平移系</option></select>}
          <button
            type="button"
            data-testid="sf-play-pause"
            disabled={transformerSlice||waveOpticsSlice||thermoStaticSlice}
            onClick={() => {
              // Freeze the integrator immediately on a user pause, then commit
              // the final sample, canvas, plot and summary before the next paint.
              if(latestRef.current.isPlaying)latestRef.current.isPlaying=false;
              setIsPlaying((p) => !p);
              setScrubTime(null);
            }}
            className={waveOpticsSlice||thermoStaticSlice?"pf-touch-target inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl border opacity-40 cursor-not-allowed":"pf-touch-target inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold cursor-pointer"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{isPlaying ? '暂停' : '运行'}</span>
          </button>
          <button
            type="button"
            disabled={transformerSlice||waveOpticsSlice||thermoStaticSlice}
            onClick={() => {
              setIsPlaying(false);
              setStepOnceNonce((n) => n + 1);
            }}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <StepForward className="w-4 h-4" />
            <span>单步</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setScrubTime(null);
              setResetNonce((n) => n + 1);
            }}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <RotateCcw className="w-4 h-4" />
            <span>复位</span>
          </button>
          <select
            aria-label="播放倍速" disabled={waveOpticsSlice||thermoStaticSlice}
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="pf-touch-target rounded-xl border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
          >
            {[0.1, 0.25, 0.5, 1, 2].map((sp) => (
              <option key={sp} value={sp}>
                {sp}x
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={waveOpticsSlice||thermoStaticSlice}
            onClick={() => setStrobeEnabled((v) => !v)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: strobeEnabled ? 'var(--pf-accent)' : 'var(--pf-border)' }}
          >
            <Sparkles className="w-4 h-4" />
            <span>频闪</span>
          </button>
          <button
            type="button"
            onClick={() => setPoeMasked((v) => !v)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: poeMasked ? '#fbbf24' : 'var(--pf-border)' }}
          >
            {poeMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span>POE 遮罩</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'chalkboard' ? 'projector' : 'chalkboard'))}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <SunMoon className="w-4 h-4" />
            <span>{theme === 'chalkboard' ? '黑板深蓝' : '投影白底'}</span>
          </button>
          <button
            type="button"
            onClick={() => setBigScreen((b) => !b)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: bigScreen ? 'var(--pf-accent)' : 'var(--pf-border)' }}
          >
            {bigScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span>大屏模式</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex min-h-0 overflow-hidden">
        <section className="flex-1 flex flex-col min-w-0 p-2.5 gap-2">
          <div
            ref={stageBoxRef}
            className="relative flex-1 min-h-[220px] rounded-xl overflow-hidden border"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-canvas-bg)' }}
          >
            <canvas ref={canvasRef} data-testid="sf-canvas" className="block w-full h-full" />
            {staticDivider&&!poeMasked&&(
              <button type="button" data-testid="sf-b2-scope-toggle" aria-expanded={dividerScopeOpen} aria-controls="sf-b2-scope-panel"
                onClick={()=>setDividerScopeOpen(v=>!v)}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1.5 text-xs cursor-pointer shadow-md"
                style={{borderColor:'var(--pf-border)',backgroundColor:'var(--pf-surface)',color:'var(--pf-text)'}}>
                {dividerScopeOpen?'收起示波器':'展开示波器'}
              </button>
            )}
            {poeMasked && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 p-6 text-center">
                <button
                  type="button"
                  onClick={() => setPoeMasked(false)}
                  className="pf-touch-target px-5 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold cursor-pointer"
                >
                  POE 预测阶段 · 点击揭晓观察
                </button>
              </div>
            )}
          </div>
          <div
            className="rounded-xl border p-2 shrink-0"
            id={circuitSlice?'sf-b2-scope-panel':undefined}
            data-testid={circuitSlice?'sf-b2-scope-panel':undefined}
            hidden={opticalSlice||transformerSlice||waveOpticsSlice||thermoStaticSlice||(staticDivider&&!dividerScopeOpen)}
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface)' }}
          >
            <div className="flex items-center gap-2 text-xs mb-1">
              <select
                data-testid="sf-scope-channel-a"
                value={channelA}
                onChange={(e) => setChannelA(e.target.value)}
                className="rounded border px-2 py-1"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              >
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}{measuredScope&&c.unit?' ('+c.unit+')':''}
                  </option>
                ))}
              </select>
              <select
                data-testid="sf-scope-channel-b"
                value={channelB}
                onChange={(e) => setChannelB(e.target.value)}
                className="rounded border px-2 py-1"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              >
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}{measuredScope&&c.unit?' ('+c.unit+')':''}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <div ref={uplotWrapRef} data-testid="sf-uplot" />
              {measuredScope && <div ref={circuitScopeEmptyRef} data-testid="sf-scope-empty" className="absolute inset-0 place-items-center text-xs" style={{display:'grid',color:'var(--pf-text-muted)'}}>运行或单步后显示真实采样曲线</div>}
            </div>
          </div>
        </section>

        <aside
          className="w-80 shrink-0 border-l p-3 overflow-y-auto space-y-3"
          style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface)' }}
        >
          {(equilibriumSlice||projectileSlice||contactSlice||verticalSlice||turntableSlice||springSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||magneticSlice||waveSlice||rippleSlice||transformerSlice||waveOpticsSlice||thermoSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice)&&<section className="space-y-1 text-xs" data-testid={nuclearSlice?'sf-f05-layers':atomicSlice?'sf-f04-layers':quantumSlice?'sf-f03-layers':thermalCycleSlice?'sf-f02-layers':thermoSlice?'sf-f01-layers':waveOpticsSlice?'sf-o01-layers':rippleSlice?'sf-ripple-layers':waveSlice?'sf-wave-layers':magneticSlice?'sf-magnetic-layers':lcSlice?'sf-lc-layers':transformerSlice?'sf-transformer-layers':generatorSlice?'sf-generator-layers':eddySlice?'sf-eddy-layers':wireSlice?'sf-wire-layers':acSlice?'sf-ac-layers':capacitorSlice?'sf-capacitor-layers':electroSlice?'sf-electro-layers':shmSlice?'sf-shm-layers':collisionSlice?'sf-collision-layers':springSlice?'sf-spring-layers':turntableSlice?'sf-turntable-layers':verticalSlice?'sf-vertical-layers':contactSlice?'sf-contact-layers':equilibriumSlice?'sf-equilibrium-layers':'sf-projectile-layers'}><div className="font-semibold">图解视图（不复位）</div>{targetPlugin.layers.map(layer=><label key={layer.id} className="flex gap-2 items-center"><input type="checkbox" data-testid={'sf-layer-'+layer.id} checked={activeLayers.includes(layer.id)} onChange={()=>setActiveLayers(ls=>ls.includes(layer.id)?ls.filter(id=>id!==layer.id):[...ls,layer.id])}/>{layer.label}</label>)}</section>}
          <div className="text-xs font-bold" style={{color:"var(--pf-accent)"}}>课堂预设速切</div>
          {(waveOpticsSlice||thermoSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice||orbitCompareSlice||(regenSlice&&params.mode==='regen-brake'))?<select data-testid={orbitCompareSlice?'sf-f07-presets':regenSlice?'sf-f06-presets':nuclearSlice?'sf-f05-presets':atomicSlice?'sf-f04-presets':quantumSlice?'sf-f03-presets':thermalCycleSlice?'sf-f02-presets':thermoSlice?'sf-f01-presets':'sf-o01-presets'} aria-label="课堂预设" value={activePresetId??''} onChange={e=>{
              const preset=targetPlugin.presets.find(p=>p.id===e.target.value);if(!preset)return;
              setActivePresetId(preset.id);setParams(resolvePluginParams(targetPlugin.paramSchema,preset.params));
              if(preset.visibleLayers?.length)setActiveLayers([...preset.visibleLayers]);
              setIsPlaying(false);setScrubTime(null);setResetNonce(n=>n+1);
            }} className="w-full rounded-lg border p-2 text-xs" style={{borderColor:'var(--pf-border)',background:'var(--pf-surface-elevated)'}}>
              {!activePresetId&&<option value="">自定义参数</option>}
              {targetPlugin.presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>:<div className={equilibriumSlice?"grid grid-cols-2 gap-1.5":"space-y-1.5"}>
            {targetPlugin.presets.map((preset) => (
              <button
                key={preset.id}
                data-preset-id={preset.id}
                type="button"
                onClick={() => {
                  setActivePresetId(preset.id);
                  setParams(resolvePluginParams(targetPlugin.paramSchema, preset.params));
                  if (preset.visibleLayers?.length) setActiveLayers([...preset.visibleLayers]);
                  else if(equilibriumSlice)setActiveLayers(targetPlugin.layers.filter(l=>l.defaultVisible).map(l=>l.id));
                  setIsPlaying(false);
                  setScrubTime(null);
                  setResetNonce((n) => n + 1);
                }}
                className="pf-touch-target w-full text-left rounded-xl border p-2 text-xs cursor-pointer"
                style={{
                  borderColor: preset.id === activePresetId ? 'var(--pf-accent)' : 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)'
                }}
              >
                <div className={equilibriumSlice?"font-semibold truncate":"font-semibold"} title={preset.name}>{equilibriumSlice?preset.name.split("：")[0]:preset.name}</div>
              </button>
            ))}
          </div>}

          {equilibriumSlice&&<section data-testid="sf-equilibrium-readouts" className="space-y-1 text-xs rounded-xl border p-2" style={{borderColor:'var(--pf-border)'}}>{summary.observables.solutionDefined===0&&<div data-testid="sf-equilibrium-no-solution" className="font-semibold text-rose-500">当前构型无可靠有限平衡解</div>}{([['requestedInitialAngleDeg','初始请求角','°'],['initialAngleDeg','限幅后初始角','°'],['angleDeg','当前实际角','°'],['force1','F₁ 大小','N'],['force2','F₂ 大小','N'],['minPullForceN','理论拉力下界','N'],['ropeLengthM','实际绳长','m'],['rodAxialForceN','轴力 C（压正）','N'],['reactionXN','支承力 Rₓ','N'],['reactionYN','支承力 Rᵧ','N'],['supportMomentNm','固支力矩 M','N·m']] as const).filter(([key])=>key==='ropeLengthM'?params.mode==='hemisphere-suspension':key==='rodAxialForceN'?params.mode==='hinged-rod':['reactionXN','reactionYN','supportMomentNm'].includes(key)?params.mode==='fixed-rod':key==='minPullForceN'?params.mode!=='fixed-rod':true).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-equilibrium-'+key}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div>准静态演示；无解处曲线留空。</div></section>}
          {chaseSlice&&<section data-testid="sf-chase-readouts" className="space-y-1 text-xs rounded-xl border p-2" style={{borderColor:'var(--pf-border)'}}>{([['deltaX','有向位置差','m'],['gap','实际间距','m'],['minGap','历史最小间距','m'],['firstCoVelocityTime','首次共速','s'],['firstMeetTime','首次相遇','s']] as const).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-chase-'+key}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div>质点模型 · 不模拟碰撞。</div></section>}
          {contactSlice&&<section data-testid="sf-contact-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{([['xBlock','物块位置 x₁','m'],['xCarrier','带/板材料位移 x₂','m'],['relativeDisplacement','有向相对位移','m'],['relativeScratch','累计相对滑移路程','m'],['scratchSpanM','材料划痕覆盖跨度','m'],['frictionOnBlockN','有向摩擦力 f₁','N'],['groundFrictionN','地面对板摩擦力','N'],['kineticEnergy','系统动能 Eₖ','J'],['potentialEnergy','有向重力势能 Eₚ','J'],['frictionHeat','界面生热 Q₁','J'],['groundHeat','地面生热 Q₂','J'],['carrierWork','外力/电机功 W','J']] as const).filter(([key])=>!['groundHeat','groundFrictionN'].includes(key)||params.systemMode==='plank').map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-contact-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">速度双曲线间阴影为可见采样区间的相对滑移路程近似；累计读数由物理事件积分给出。</div>{summary.observables.terminal===1&&<div className="font-semibold text-rose-500">已到承载面端点 · 接触模型结束</div>}</section>}
          {verticalSlice&&<section data-testid="sf-vertical-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{summary.observables.derailed===1?'自由抛体 · 约束已解除':params.trackMode==='light-rod'?'双边约束 · 向内为正':'单边接触'}</div>{([['normalForceN','实际约束力','N'],['speed','速率 v','m/s'],['kineticEnergy','动能 Eₖ','J'],['potentialEnergy','有向势能 Eₚ','J'],['energy','机械能 E','J'],['derailTime','脱轨时刻','s'],['derailAngleDeg','脱轨角','°']] as const).filter(([key])=>!key.startsWith('derail')||summary.observables.derailed===1).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-vertical-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">外凸向外为正；内轨/杆向内为正，杆可为负。脱轨后不模拟再接触或落地。</div></section>}
          {turntableSlice&&<section data-testid="sf-turntable-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='conical-pendulum'?(summary.observables.rotatingCone===1?'定态圆锥摆 · 正投影':'竖直静止支'):summary.observables.terminal===1?'接触模型已到边界':summary.observables.slippingOut===1?'二维滑移 · 库仑动摩擦':'共转 · 最小可行张力'}</div>{((params.mode==='conical-pendulum'?[['tensionN','真实绳张力 T','N'],['coneAngleDeg','真实半顶角 θ','°'],['rA','水平圆周半径','m'],['omega1','非零支临界 ω','rad/s'],['period','实际周期','s']]:[['tensionN','实际张力 T','N'],['frictionAN','A 向内摩擦分量','N'],['frictionBN','B 向内摩擦分量','N'],['staticTMin','共转需求 T下界','N'],['staticTMax','共转需求 T上界','N'],['omega1','首次饱和 ω₁','rad/s'],['omega2','摩擦反号 ω₂','rad/s'],['omega3','静态极限 ω₃','rad/s'],['actualSeparation','实际绳端间距','m'],['kineticEnergy','地面系动能','J'],['heat','摩擦热 Q','J'],['diskWork','盘面做功 W','J']]) as readonly (readonly [string,string,string])[]).filter(([key])=>key!=='period'||summary.observables.rotatingCone===1).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-turntable-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:(key==='omega2'||key==='omega3')?'不存在':'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='conical-pendulum'?'俯视与侧面同相位；正投影不改变真实 T。':'向内分量可为负；静态折线不是滑移力。动静 μ 暂同；盘边或松绳后停止。'}</div></section>}
          {springSlice&&<section data-testid="sf-spring-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{summary.observables.terminal===1?'再接触 · 碰撞前停止':summary.observables.separated===1?'自由相 · 无接触力':'共同运动 · 单边接触'}</div>{([['normalForceN','实际接触力 Fₙ','N'],['a1','m₁ 加速度','m/s²'],['a2','m₂ 加速度','m/s²'],['v1','m₁ 速度','m/s'],['v2','m₂ 速度','m/s'],['gap','实际间隙','m'],['separationTime','分离时刻','s'],['separationS','分离位置','m'],['separationV','分离共同速度','m/s'],['kineticEnergy','动能 K','J'],['springEnergy','弹性势能','J'],['gravityEnergy','有向重力势能','J'],['energy','实际机械能 E','J'],['externalWork','外力功 W','J']] as const).filter(([key])=>!key.startsWith('separation')||summary.observables.separated===1).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-spring-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">沿斜面向上为正。零力切触不必然分离；再接触时停止，不预设碰撞系数。图中光滑面为理想截段。</div></section>}
          {collisionSlice&&<section data-testid="sf-collision-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='boat-recoil'?(summary.observables.phase===2?'到达右端 · 平滑静止':'人船 · 内部驱动'):params.mode==='bullet-block'?(['入靶前','穿行 · 恒定内力','共速 · 阻力停止','穿出 · 阻力停止'][summary.observables.phase??0]??'—'):(summary.observables.collided===1?'冲量后 · 自由运动':'碰撞前 / 未命中')}</div>{([...[ ['px','总动量 pₓ','kg·m/s'],['py','总动量 pᵧ','kg·m/s'],['xCm','质心 x','m'],['yCm','质心 y','m'],['ek','总动能 K','J'] ],...(params.mode==='boat-recoil'?[ ['relativePosition','人相对船位置','m'],['relativeSpeed','相对速度','m/s'],['vx1','人的地面速度','m/s'],['vx2','船的地面速度','m/s'],['walkDuration','行走总时长','s'] ]:params.mode==='bullet-block'?[ ['relativeSpeed','沿 x 相对速度','m/s'],['penetrationDist','实际穿行深度','m'],['heatLostJ','内能损耗 Q','J'],['entryTime','入靶时刻','s'],['phaseEndTime','结束时刻','s'] ]:[ ['vx1','v₁ₓ','m/s'],['vy1','v₁ᵧ','m/s'],['vx2','v₂ₓ','m/s'],['vy2','v₂ᵧ','m/s'],['heatLostJ','内能损耗 Q','J'],['impactTime','碰撞时刻','s'],['normalImpulse','法向冲量 Jₙ','N·s'],['gap','实际球间隙','m'] ])] as readonly (readonly string[])[]).filter(([key])=>key!==undefined&&typeof summary.observables[key]==='number').map(([key,label,unit])=>{const v=summary.observables[key!];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-collision-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='boat-recoil'?'水平质心固定；机械动能由内部驱动改变，不作守恒报告。':params.mode==='bullet-block'?'理想质点，标记半径不参与接触；Q=f d。':'真实瞄准距与球半径；擦边无法向冲量；动量矢量采用地面系。'}</div></section>}
          {shmSlice&&<section data-testid="sf-shm-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">实测角运动与功—能账本</div>{([['thetaDeg','实际摆角 θ','°'],['thetaLinearDeg','线性摆 θlin','°'],['omega','角速度 ω','rad/s'],['tensionN','杆反力 R（向内正）','N'],['mechanicalEnergy','机械能 E','J'],['heatLostJ','累计耗散 Q','J'],['driveWorkJ','有符号外功 W','J'],['energyResidual','功—能残差','J'],['measuredPeriod','相邻向上穿零间隔','s'],['linearResponseAmplitude','线性特解振幅','rad']] as const).filter(([k])=>k==='heatLostJ'?params.mode!=='pendulum-compare':k==='driveWorkJ'?params.mode==='forced-resonance':k==='measuredPeriod'?(summary.observables.measuredPeriod??0)>0:k==='linearResponseAmplitude'?params.mode==='forced-resonance'&&summary.observables.linearResponseDefined===1:true).map(([k,label,unit])=>{const v=summary.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-shm-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(k==='energyResidual'?v.toExponential(2):v.toFixed(3))+' '+unit:'—'}</span></div>;})}{params.mode==='forced-resonance'&&summary.observables.linearResponseDefined===0&&<div data-testid="sf-shm-unbounded">线性理论无有限周期特解</div>}<div className="text-[10px]">理想刚性杆；参考圆与幅频曲线均属线性理论，不是非线性摆的实测曲线。</div></section>}
          {relativitySlice&&<section data-testid="sf-f12-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{channels.map(c=>{const v=summary.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span data-testid={'sf-f12-'+c.key} className="tabular-nums">{typeof v==='number'&&Number.isFinite(v)?(Math.abs(v)>0&&Math.abs(v)<.001?v.toExponential(3):v.toFixed(3))+(c.unit?' '+c.unit:''):'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='minkowski-relativity'?'等比例时空坐标；理想瞬时折返；无运行时钟。':'有限反射盒；左中右占据概率，不是即时 R/T。'}</div></section>}
          {advancedSlice&&<section data-testid="sf-f11-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{channels.map(c=>{const v=summary.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span data-testid={'sf-f11-'+c.key} className="tabular-nums">{typeof v==='number'&&Number.isFinite(v)?(Math.abs(v)>0&&Math.abs(v)<.001?v.toExponential(3):v.toFixed(3))+(c.unit?' '+c.unit:''):'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='normal-modes'?'等质量；独立本征模能量守恒。':params.mode==='coriolis-disk'?'无界自由平面，参考圆不代表碰撞边界。':'独立邻近轨线；主值角距不是李雅普诺夫指数。'}</div></section>}
          {orbitCompareSlice&&<section data-testid="sf-f07-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{channels.map(c=>{const v=summary.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span data-testid={'sf-f07-'+c.key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(c.key==='planetFrameSpeedRelErr'?v.toExponential(3):v.toFixed(4))+(c.unit?' '+c.unit:''):'—'}</span></div>;})}<div className="text-[10px]">归一化教学近似；非真实任务轨迹、非交会对接判据。</div></section>}
          {regenSlice&&params.mode==='regen-brake'&&<section data-testid="sf-f06-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">等效再生制动 · 能量分账</div>{channels.map(c=>{const v=summary.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span data-testid={'sf-f06-'+c.key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(c.key==='ledgerResidualJ'?v.toExponential(3):v.toFixed(3))+(c.unit?' '+c.unit:''):'—'}</span></div>;})}<div className="text-[10px]">等效负载能量不等于真实电池储能；纯电磁阻尼仅渐近趋零。</div></section>}
          {nuclearSlice&&<section data-testid="sf-f05-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{channels.map(c=>{const v=summary.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span data-testid={'sf-f05-'+c.key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(Math.abs(v)>0&&Math.abs(v)<.001?v.toExponential(4):v.toFixed(3))+(c.unit?' '+c.unit:''):'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='cloud-chamber-recoil'?(params.decayKind==='beta-minus'?'β⁻：反中微子能量趋零的端点理想化。':'α：理想静止母核二体运动。')+' 半径为数值拟合；示意标记不按实物尺寸。':params.mode==='half-life-mc'?'样本数与理论期望不同；固定种子可复现。':'仅抽象期望示意。'}</div></section>}
          {atomicSlice&&<section data-testid="sf-f04-readouts" className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='rutherford'?'演示时间与实际核尺度时间分别显示':'独立基态探针与发光初态'}</div>{channels.map(c=>{const v=summary.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span data-testid={'sf-f04-'+c.key} style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+c.unit:'—'}</span></div>;})}</section>}
          {quantumSlice&&<section data-testid="sf-f03-readouts" className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div data-testid="sf-f03-status" className="font-semibold">{params.mode==='compton'?summary.observables.recoilAngleDefined===0?'正向散射 · 无反冲':'静止自由电子 · 相对论解析':summary.observables.thresholdPassed===0?'未超过阈频 · 无光电子':params.intensityRel===0?'无入射光 · 无光电流':summary.observables.currentMa===0?'有逸出 · 未收集':'有逸出 · 有收集电流'}</div>
  {((params.mode==='compton'?[['incidentWavelengthNm','入射 λ','nm'],['scatteredWavelengthNm','散射 λ′','nm'],['deltaLambdaPm','波长偏移 Δλ','pm'],['incidentEnergyKev','入射光子能量','keV'],['scatteredEnergyKev','散射光子能量','keV'],['electronKineticKev','电子动能','keV'],['recoilAngleDeg','电子反冲角 φ','°'],['pElectron','电子动量大小','kg·m/s'],['pElectronX','电子动量 pₓ','kg·m/s'],['pElectronY','电子动量 pᵧ','kg·m/s'],['momentumResidualRel','相对动量残差',''],['massShellResidualRel','相对质壳残差','']]:[['photonEnergyEv','单光子能量 hν','eV'],['workFunctionEv','逸出功 W₀','eV'],['cutoffFreqHz','阈频 ν₀','Hz'],['cutoffWavelengthNm','阈波长 λ₀','nm'],['maxKineticEv','许可最大初动能','eV'],['anodeVoltageV','实际电压 U_AK','V'],['stoppingVoltageV','遏止电压幅值','V'],['currentMa','实际经验光电流','mA'],['saturationCurrentMa','饱和渐近电流','mA']]) as readonly (readonly string[])[]).map(([key,label,unit])=>{const v=summary.observables[key!];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-f03-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(key==='cutoffFreqHz'||key==='pElectron'||key==='pElectronX'||key==='pElectronY'||key?.endsWith('ResidualRel')?v.toExponential(5):v.toFixed(6))+(unit?' '+unit:''):key==='recoilAngleDeg'?'未定义':key==='stoppingVoltageV'?'未测得':'不适用'}</span></div>;})}
  <div className="text-[10px]">{params.mode==='compton'?'能量、动量为解析单次散射结果，不含束缚电子、截面或散射概率；箭长按共同动量标尺。':'I–U 为经验响应；虚线为同材料参考，强度只改变固定频率的电流尺度；无光时不测得遏止电压。装置电子符号为示意。'}</div>
</section>}
          {thermalCycleSlice&&<section data-testid="sf-f02-readouts" className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div data-testid="sf-f02-status" className="font-semibold">{params.mode==='kinetic-md-box'?'二维硬盘 · 约化单位 · 无热浴':summary.observables.cycleValid===0?'无有效热机循环 · 保留输入':summary.observables.cycleValid===1?'单原子理想气体 · 静态解析路径':'等待状态'}</div>
  {((params.mode==='kinetic-md-box'?[['gasCount','实际气体分子数',''],['particleCount','含花粉总数',''],['kineticEnergy','总动能 E*',''],['wallPressure','累计平均壁压 P*',''],['wallImpulseTotal','累计壁冲量 I*',''],['rmsSpeed','方均根速率 v*',''],['temperatureProxy','温度代理 kBT*',''],['maxwellKs','拟合 CDF 距离 D',''],['energyRelativeError','相对能量漂移',''],['maxPenetration','最大残余重叠（约化）',''],['collisions','圆盘碰撞计数','']]:summary.observables.cycleValid===1?[['sumWJ','净功 W','J'],['qInJ','吸热 Qᵢₙ','J'],['qOutJ','放热量 Qₒᵤₜ','J'],['sumDuJ','循环 ΔU','J'],['efficiencyPct','效率 η','%'],['carnotEfficiencyPct','实际温区上限','%'],['minTemperatureK','实际最低温','K'],['maxTemperatureK','实际最高温','K']]:[]) as readonly (readonly string[])[]).map(([key,label,unit])=>{const v=summary.observables[key!];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-f02-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{key==='wallPressure'&&summary.observables.pressureMeasured!==1?'尚未测量':typeof v==='number'&&Number.isFinite(v)?(['gasCount','particleCount','collisions'].includes(key!)?v.toFixed(0):key==='energyRelativeError'||key==='maxPenetration'?v.toExponential(3):v.toFixed(5))+(unit?' '+unit:''):'—'}</span></div>;})}
  <div className="text-[10px]">{params.mode==='kinetic-md-box'?'二维压强为累计壁冲量 / 周长 / 约化时间；不是 Pa。拟合偏差不是显著性检验。有限步长残余重叠可测，不宣称精确多体事件。':params.mode==='cycle-rect-pv'?'矩形最高温由实际角点决定；η 上限为同温区比较，非两热源可逆机。':'W>0 气体对外做功，Q>0 吸热；不为无效热源参数伪造效率。'}</div>
</section>}
          {thermoSlice&&<section data-testid="sf-f01-readouts" className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div data-testid="sf-f01-status" className="font-semibold">{params.mode==='stop-pin-cylinder'?summary.observables.floating===1?'浮起 · 等压过程':'限位 · 等容过程':params.mode==='mercury-tube-tilt'?summary.observables.overflowed===1?'溢出平衡 · 独立等温比较':'无溢出 · 独立等温比较':'定容储气罐 · 离散操作级次'}</div>
  {([['pressureKPa','实际压强 P','kPa'],['volumeL','体积 V','L'],['temperatureK','温度 T','K'],['molesN','物质的量 n','mol'],...(params.mode==='stop-pin-cylinder'?[['criticalTempK','临界温度 Tc','K'],['pinReactionN','卡口支持力','N'],['workByGasJ','气体对外做功 W','J'],['lastEventTime','最近临界事件时刻','s']]:params.mode==='mercury-tube-tilt'?[['referenceAirCm','水平参考气柱 l₀','cm'],['airColumnCm','现气柱 l','cm'],['mercuryColumnCm','剩余水银柱 h','cm'],['spilledMercuryCm','溢出长度','cm']]:[['completedStrokes','已完成次数 k',''],['initialMolesN','初始物质的量 n₀','mol'],['transferredMolesN','净转移物质的量 Δn','mol']])] as readonly (readonly string[])[]).map(([key,label,unit])=>{const v=summary.observables[key!];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-f01-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(key==='completedStrokes'?0:5)+(unit?' '+unit:''):'—'}</span></div>;})}
  <div className="text-[10px]">{params.mode==='stop-pin-cylinder'?'W>0 为气体膨胀对外做功；未指定热容，不推断热量。':params.mode==='mercury-tube-tilt'?'每个角度均从相同水平参考独立比较，不是溢出后可逆回流。':'理想等温、无死体积；不是封闭系统的功或真实时间动画。'}</div>
</section>}
          {waveOpticsSlice&&<section data-testid="sf-o01-readouts" className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div data-testid="sf-o01-status" className="font-semibold">{params.mode==='single-slit-grating'?summary.observables.gratingValid===0?'无效几何：d<a':params.slitCountN===1?'单缝远场 · 无光栅级次':'多缝远场 · 归一化光强':params.mode==='thin-film-wedge'?'薄膜 · 近法线等幅双束':'牛顿环 · 球面精确弓高'}</div>
  {((params.mode==='thin-film-wedge'?[['wedgeFringeSpacingMm','理想条纹间距 Δx','mm'],['centerIntensity','中心截面 I/I₀','']]:params.mode==='newtons-rings'?[['newtonFirstDarkMm','第一正暗环 r₁','mm'],['centerIntensity','中心 I/I₀','']]:summary.observables.gratingValid===0?[]:params.slitCountN===1?[['centerIntensity','中心 I/I₀','']]:[['missingOrderRatio','d/a',''],['gratingMaxOrder','最大可传播级',''],['missingOrderCount','正缺级数',''],['firstMissingOrder','首个正缺级',''],['centerIntensity','中心 I/I₀','']]) as readonly (readonly string[])[]).map(([k,label,unit])=>{const v=summary.observables[k!];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-o01-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(['gratingMaxOrder','missingOrderCount','firstMissingOrder'].includes(k!)?0:5)+(unit?' '+unit:''):'—'}</span></div>;})}
  <div className="text-[10px]">{params.mode==='single-slit-grating'?'横坐标 sin θ，非屏距；光强为相对值，未建模绝对照度。':'相对反射相移由开关设定；无吸收、近法线、等幅双束近似。颜色仅示意。'}</div>
</section>}
          {transformerSlice&&<section data-testid="sf-transformer-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div className="font-semibold" data-testid="sf-transformer-status">{summary.observables.operatingPointValid===0?'请求无有效工作点':summary.observables.operatingPointValid===1?'稳态有效值 · 功率因数 1':'等待工作点'}</div>
  {(summary.observables.operatingPointValid===0?
    [['requestedPowerW','请求送端功率','W'],['maxPowerW','无源受端上限','W'],['requestedCurrentA','请求对应电流','A'],['requestedLossW','请求对应 I²R（非实测）','W']]:
    params.mode==='long-distance-grid'?
    [['lineVoltageV','送端电压','V'],['lineCurrentA','线路电流','A'],['voltageDropV','线路压降','V'],['u2','受端电压','V'],['u3','用户端电压','V'],['pInW','发电机输出','W'],['pLineLossW','线损','W'],['pUserW','用户功率','W'],['efficiencyPct','效率','%']]:
    [['uSourceV','电源电压 U₀','V'],['u1','原边电压 U₁','V'],['i1','原边电流 I₁','A'],['u2','副路2电压 U₂','V'],['i2','副路2总电流 I₂','A'],['u3','副路3电压 U₃','V'],['i3','副路3电流 I₃','A'],['pInW','电源总功率 P₀','W'],['pTransformerInW','理想原边 P₁','W'],['pLineLossW','R₀损耗','W'],['pUserW','副边总功率','W'],['efficiencyPct','系统效率','%']]).map(([key,label,unit])=>{const v=summary.observables[key!];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-transformer-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)&&(key!=='efficiencyPct'||summary.observables.efficiencyDefined===1)?v.toFixed(2)+' '+unit:'—'}</span></div>;})}
  <div className="text-[10px]">{params.mode==='long-distance-grid'?'固定送端功率；受端可调匝比。零输入效率未定义；无解时只列请求，不列伪造测量值。':'理想一原双副；基准为指定户数、S 断开。R₀损耗不属于理想变压器。'}</div>
  <div className="space-y-1">{summary.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)}</div>)}</div>
  </section>}
          {rippleSlice&&<section data-testid="sf-ripple-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div data-testid="sf-ripple-status" className="font-semibold">{summary.observables.geometryValid===0?'无有效几何 · 请求未执行':(summary.observables.screenAverageSamples??0)===0?'传播/等待 · 均方测量尚未开始':'实际屏幕均方采样中'}</div>
  {([['fieldTime','实际场时刻','s'],['fieldLag','未积分余量','s'],['solverDt','内部步长','s'],['stepsRun','内部步数',''],['courantNumber','实际 CFL',''],['incidentWavelength','入射波长','m'],['frequency','源频率','Hz'],['widthMeters','实际开口/障碍宽','m'],['separationMeters','实际双缝中心距','m'],['transmittedWavelength','低速介质波长（理论）','m'],['transmittedSpeed','低速介质波速','m/s'],['maxAmplitude','实际全场峰值','u'],['screenDistance','壁至屏距离','m'],['averageStartTime','计划测量窗起点','s'],['screenAverageSamples','实际平均样本数',''],['screenAverageDuration','实际平均时长','s'],['centerScreenDisplacement','屏中心瞬时位移','u'],['centerScreenIntensity','屏中心均方位移','u²'],['peakScreenIntensity','屏上峰值均方位移','u²']] as const).filter(([k])=>['fieldTime','solverDt','courantNumber','screenAverageSamples','centerScreenIntensity'].includes(k)||summary.observables[k]!==undefined).map(([k,label,unit])=>{const value=summary.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-ripple-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof value==='number'&&Number.isFinite(value)?(['stepsRun','screenAverageSamples'].includes(k)?value.toFixed(0):['solverDt','fieldLag','centerScreenIntensity','peakScreenIntensity'].includes(k)?value.toFixed(5):value.toFixed(3))+(unit?' '+unit:''):'—'}</span></div>;})}
  <div className="text-[10px]">u 为归一化标量位移；⟨u²⟩ 为有限测量窗均方值，并非能流或稳态证明。固定物理色标；海绵边界非无反射 PML。</div>
  <div className="space-y-1">{summary.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)}</div>)}</div>
</section>}
          {waveSlice&&<section data-testid="sf-wave-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div data-testid="sf-wave-status" className="font-semibold">{params.mode==='doppler'?(summary.observables.probeSampleDefined===0?'源点/焦散 · 无定义':(summary.observables.arrivalCount??0)===0?'波尚未到达固定接收点':(summary.observables.arrivalCount??0)>1?'双分支叠加 · 无单一接收频率':'单支延迟接收'):params.mode==='interference'?'已到达波源 '+(summary.observables.activeCount??0)+'/2':params.mode==='standing'?'驻波 · 固定空间包络':'行波 · 固定质点'}</div>
  {([['waveSpeed','波速 c','m/s'],['probeY','实际位移 yP','m'],['probeVy','实际振动速度 vy','m/s'],['probeAy','实际振动加速度 ay','m/s²'],['analyticalAmplitude','局部振幅','m'],['spatialSlope','有符号空间斜率',''],['arrivalTime','首次到达时间','s'],['signedPathDifference','有符号波程差 r₂−r₁','m'],['phaseAtProbeDeg','两源到齐后的相差','°'],['sourceSpeed','波源速度','m/s'],['localFrequencyHz','单支接收频率','Hz'],['machAngleDeg','马赫半顶角','°'],['emittedCount','累计发射标记数','']] as const).filter(([k])=>['waveSpeed','probeY','probeVy','probeAy'].includes(k)||k==='localFrequencyHz'&&params.mode==='doppler'||summary.observables[k]!==undefined).map(([k,label,unit])=>{const v=summary.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-wave-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(k==='emittedCount'?0:3)+(unit?' '+unit:''):'—'}</span></div>;})}
  <div className="text-[10px]">{params.mode==='doppler'?'等幅标量信号；不含声压、扩散衰减或真实激波强度。':params.mode==='interference'?'瞬时位移颜色不等于稳定振幅。只有两波到达处有稳定条纹。':params.mode==='standing'?'包络为 ±2A|sin(kx)|，横坐标 x 与时间 t 不可混用。':'传播方向不是质点振动方向；起振前静止。'}</div>
  <div className="space-y-1">{summary.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)}</div>)}</div>
</section>}
          {magneticSlice&&<section data-testid="sf-magnetic-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div className="font-semibold" data-testid="sf-magnetic-status">{summary.observables.domainHalted===1?'理想丝线奇异域 · 已暂停':params.geometryType==='uniform-helix'?'匀强场 · 有向轨迹':'有限稳恒电流 · 试探粒子'}</div>
  <div className="flex justify-between gap-2"><span>实际荷质比 q/m</span><span data-testid="sf-magnetic-qm" style={{color:'var(--pf-text)'}}>{(Number(params.qOverM)*(params.geometryType==='uniform-helix'?1:1e6)).toExponential(2)} C/kg</span></div>
  {([['x','x 坐标','m'],['y','y 坐标','m'],['z','z 坐标','m'],['vx','有向 vx','m/s'],['vy','有向 vy','m/s'],['vz','有向 vz','m/s'],['bMagT','磁感应强度 |B|','T'],['bMagMicroT','磁感应强度 |B|','μT'],['ke','比动能','J/kg'],['vDotF','磁力比功率','W/kg']] as const).filter(([k])=>k==='bMagT'?params.geometryType==='uniform-helix':k==='bMagMicroT'?params.geometryType!=='uniform-helix':true).map(([k,label,unit])=>{const v=summary.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-magnetic-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(k==='vDotF'?v.toExponential(2):v.toFixed(3))+' '+unit:'—'}</span></div>;})}
  <div className="text-[10px]">矢量长度只示意方向；非匀强场局部回旋公式不代表整条实际轨迹。理想丝线奇点不提供场值。</div>
  <div className="space-y-1">{summary.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)}</div>)}</div>
</section>}
          {lcSlice&&<section data-testid="sf-lc-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
  <div className="font-semibold" data-testid="sf-lc-status">{params.mode==='rlc-ac-resonance'?(['—','有吸引的周期稳态参考','无阻尼特解参考 · 非吸引','理想精确谐振 · 无有限周期稳态','零驱动 · 退化无激发'][summary.observables.responseKind??0]??'—'):(['无阻尼自由振荡','欠阻尼自由振荡','临界阻尼 · 非振荡','过阻尼 · 非振荡'][summary.observables.dampingRegime??0]??'—')}</div>
  {([['chargeQ','上板有向电荷 q','C'],['currentI','有向电流 i','A'],['uCapV','电容有向电压','V'],['uIndV','电感有向电压','V'],['energyElectricJ','电场能 E_C','J'],['energyMagneticJ','磁场能 E_L','J'],['totalEmEnergyJ','电磁储能','J'],['jouleHeatJ','累计焦耳热','J'],['sourceWorkJ','有符号源功','J'],['energyResidualJ','实际功—热残差','J'],['naturalPeriod','无阻尼理论周期','s'],['dampedPeriod','齐次振荡理论周期','s'],['measuredPeriod','实测向上过零间隔','s'],['uDriveV','有向源电压','V'],['referenceCurrentPeak','解析特解电流幅值','A'],['impedanceMag','参考阻抗模','Ω']] as const).filter(([k])=>(k!=='uDriveV'&&k!=='sourceWorkJ'||params.mode==='rlc-ac-resonance')&&(k!=='dampedPeriod'||params.mode==='rlc-damped')&&(k==='measuredPeriod'||typeof summary.observables[k]==='number')).map(([k,label,unit])=>{const v=summary.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-lc-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(k==='energyResidualJ'?v.toExponential(2):v.toFixed(3))+' '+unit:'—'}</span></div>;})}
  <div className="text-[10px]">q 为上板有向电荷；i 正向流入上板。解析特解与实测瞬时量分离，未测周期与无定义幅值不填零。</div>
  <div className="space-y-1">{summary.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)}</div>)}</div>
  </section>}
          {generatorSlice&&<section data-testid="sf-generator-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">纯电阻负载 · 实际采样</div>{([['uInstV','有向负载电压 u','V'],['uRmsV','有效值 Uᵣₘₛ','V'],['currentA','有向负载电流 i','A'],['pInstW','瞬时功率 p','W'],['pAvgW','平均功率 P','W'],['jouleHeatJ','累计焦耳热 Q','J'],['sourceEmfV','参考源电动势 e','V'],['fluxWb','单匝磁通 Φ','Wb']] as const).filter(([k])=>k!=='sourceEmfV'&&k!=='fluxWb'||['sine','half-wave','full-wave'].includes(String(params.waveform))).map(([k,label,unit])=>{const v=summary.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-generator-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{['sine','half-wave','full-wave'].includes(String(params.waveform))?'恒定转速、理想整流器；负载电压不总等于源电动势。':'独立教学波形，幅值由 NBSω 标定，不是该线圈直接输出。'}</div><div className="space-y-1">{summary.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)}</div>)}</div></section>}
          {eddySlice&&<section data-testid="sf-eddy-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='betatron-vortex'?(summary.observables.boundaryAmbiguous===1?'理想边界切向不适定 · 暂停':'有向试探荷质比 · 单位质量功—能'):'整块/开槽 · 各自单位质量能量'}</div>{(params.mode==='betatron-vortex'?[['bCurrent','柱内有向 B','T'],['bLocal','所在处 Bz','T'],['Ex','感生 Eₓ','V/m'],['Ey','感生 Eᵧ','V/m'],['particleRadius','实际径向位置 r','m'],['particleSpeed','速率','m/s'],['specificKineticEnergy','单位质量动能','J/kg'],['specificElectricWork','单位质量电功','J/kg'],['specificEnergyResidual','功—能残差','J/kg']]:[['solidAngleDeg','整块板有向角','°'],['slottedAngleDeg','开槽板有向角','°'],['solidOmega','整块板角速度','rad/s'],['slottedOmega','开槽板角速度','rad/s'],['solidEnergySpecific','整块板机械能/m','J/kg'],['slottedEnergySpecific','开槽板机械能/m','J/kg'],['solidHeatSpecific','整块板耗散热/m','J/kg'],['slottedHeatSpecific','开槽板耗散热/m','J/kg'],['solidResidualSpecific','整块板能量残差','J/kg'],['slottedResidualSpecific','开槽板能量残差','J/kg']]).filter(([k])=>typeof summary.observables[k!]==='number').map(([k,label,unit])=>{const v=summary.observables[k!]!;return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-eddy-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{Number.isFinite(v)?(k!.toLowerCase().includes('residual')?v.toExponential(2):v.toFixed(4))+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='betatron-vortex'?'外加线性时变磁场；示教荷质比并非真实电子值，磁力不做功。':'有限极区与剩余阻尼为等效模型，不从 B 虚构涡流分布。'}</div></section>}
          {wireSlice&&<section data-testid="sf-wire-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='wireframe-gravity-fall'?'平动 · 向上为正 · 磁通解析积分':'恒速转动 · 外部驱动功与力矩'}</div>{(params.mode==='wireframe-gravity-fall'?[['centerY','线框中心 y','m'],['vy','有向速度','m/s'],['fluxWb','实际磁通','Wb'],['cuttingFactorWbPerM','磁通梯度','Wb/m'],['emfV','有向感应电动势','V'],['currentA','有向电流','A'],['ampereForceN','有向安培力','N'],['jouleHeatJ','焦耳热','J'],['energyResidualJ','能量残差','J']]:[['fluxWb','实际盘面磁通','Wb'],['sweptFluxWb','累计扫过磁通','Wb'],['emfV','轴心到外缘电动势','V'],['currentA','有向电流','A'],['emTorqueNm','制动力矩','N·m'],['drivePowerW','外部驱动功率','W'],['driveWorkJ','外部驱动功','J'],['jouleHeatJ','焦耳热','J'],['energyResidualJ','功—热残差','J']]).filter(([k])=>typeof summary.observables[k!]==='number').map(([k,label,unit])=>{const v=summary.observables[k!]!;return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-wire-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{Number.isFinite(v)?v.toFixed(4)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='wireframe-gravity-fall'?'忽略线框自感；安培力反向于速度。':'恒角速度由外部驱动维持；扫过磁通不等于真实闭合回路磁通。'}</div></section>}
          {acSlice&&<section data-testid="sf-ac-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='oscilloscope-lissajous'?(['实际屏幕命中','未加速 · 无电子束','X 板触板 · 断光','Y 板触板 · 断光','两轴触板 · 断光','超出屏幕 · 断光'][summary.observables.beamStatus??0]??'—'):params.mode==='equivalent-gravity'?'单位质量刚性杆摆 · 有向反力':'四相位 · 释放后才有实际读数'}</div>{(params.mode==='oscilloscope-lissajous'?[['signalUxV','X 信号','V'],['signalUyV','Y 信号','V'],['screenXCm','实际屏点 X','cm'],['screenYCm','实际屏点 Y','cm'],['xContactNs','X板首次接触','ns'],['yContactNs','Y板首次接触','ns']]:params.mode==='equivalent-gravity'?[['gEffX','合场加速度 x','m/s²'],['gEffY','合场加速度 y','m/s²'],['gEffMag','合场加速度大小','m/s²'],['eqLowestAngleDeg','等效低点角度','°'],['eqThetaDeg','有向摆角','°'],['eqOmega','角速度','rad/s'],['rodForceN','有向杆反力','N'],['eqTotalEnergy','总能量','J']]:[['fieldAcceleration','当前加速度','m/s²'],['x0','0 相位位移','m'],['v0','0 相位速度','m/s'],['xEighth','T/8 相位位移','m'],['vEighth','T/8 相位速度','m/s'],['xQuarter','T/4 相位位移','m'],['vQuarter','T/4 相位速度','m/s'],['xThreeEighths','3T/8 相位位移','m'],['vThreeEighths','3T/8 相位速度','m/s']]).filter(([k])=>typeof summary.observables[k!]==='number').map(([k,label,unit])=>{const v=summary.observables[k!]!;return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-ac-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='oscilloscope-lissajous'?'准静态独立双轴；屏半径6cm，断光不产生假坐标。':params.mode==='equivalent-gravity'?'向杆内为正，负值为受压。g_eff=0 无唯一等效高低点。':'无限匀强交变场；竖向四分道仅示意，横向为真实位移。'}</div></section>}
          {capacitorSlice&&<section data-testid="sf-capacitor-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{summary.observables.terminal===1?(summary.observables.dropContact===1?'首次触上板 · 停止':'首次触下板 · 停止'):params.switchMode==='open-const-q'?'固定断开前参考电荷 Qref':'恒压电源 · U 不变'}</div>{([['capacitancePF','电容 C','pF'],['chargeNC','上板有符号电荷 Q','nC'],['referenceChargeNC','固定参考电荷 Qref','nC'],['voltageV','电压 U=φ上−φ下','V'],['fieldEy','有向场强 Eᵧ','V/m'],['phiPV','探针 P 电势','V'],['storedEnergyUJ','电容储能','μJ'],['dropHeightMm','油滴高度','mm'],['dropVyMmS','有向速度','mm/s'],['dropAcceleration','有向加速度','m/s²'],['dropChargeC','油滴真实电荷 q','C'],['dropMassKg','示教质量 m','kg'],['dropElectricForceN','有向电场力','N'],['dropWeightN','重力大小','N'],['dropDragForceN','有向线性阻力','N'],['terminalVelocityMmS','无限板间理论终速','mm/s']] as const).filter(([k])=>typeof summary.observables[k]==='number').map(([k,label,unit])=>{const v=summary.observables[k]!;return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-capacitor-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{Number.isFinite(v)?((k==='dropChargeC'||k==='dropMassKg'||k.endsWith('ForceN')||k==='dropWeightN')?v.toExponential(3):v.toFixed(3))+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.switchMode==='open-const-q'?'参考量重设初态；调当前 d/S/εr 才是恒荷比较。':'U 的正负决定上板极性；向上为正。'}{params.oilDropEnabled?' 油滴采用真实 q=−ne、校准质量、线性阻尼；触板不模拟碰撞。':''} 静电计指针仅示意。</div></section>}
          {electroSlice&&<section data-testid="sf-electro-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='deflection-tube'?(['加速后入射','理想板内','已出板 · 匀速','首次触板 · 已停止'][summary.observables.tubePhase??0]??'—'):params.mode==='dipole-point-charges'?'归一化场量 · 单位质量粒子':'匀强场 · SI 场量'}</div>{(params.mode==='deflection-tube'?[['px','位置 x','m'],['py','偏转 y','m'],['vx','速度 vx','m/s'],['vy','速度 vy','m/s'],['ek','动能 K','J'],['tubeWork','板内电场功','J'],['yExit','实际出射偏转','m'],['energyResidual','功—能残差','J']]:[['phi','所在点电势',params.mode==='dipole-point-charges'?'Φ₀':'V'],['Ex','有向 Eₓ',params.mode==='dipole-point-charges'?'E₀':'V/m'],['Ey','有向 Eᵧ',params.mode==='dipole-point-charges'?'E₀':'V/m'],['eMag','场强大小',params.mode==='dipole-point-charges'?'E₀':'V/m'],['ek','动能 K','J'],['totalEnergy','总能量','J'],['energyResidual','能量残差','J']]).filter(row=>typeof summary.observables[row[0]!] === 'number').map(([k,label,unit])=>{const v=summary.observables[k!];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-electro-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(k==='energyResidual'?v.toExponential(2):v.toFixed(3))+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='deflection-tube'?'忽略边缘场；单位质量；触板终止，不模拟碰撞。':params.mode==='dipole-point-charges'?'Φ₀=kₑ·1μC/1m，E₀=Φ₀/1m；软化长度 0.01m。':'三点等势时 E=0；等势线随电势次序重新构造。'}</div></section>}
          {summary.formulas.map((f) => (
            <div
              key={f.id}
              className="rounded-xl border p-2.5 text-xs space-y-1"
              style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
            >
              <div style={{ color: 'var(--pf-text-muted)' }}>{f.label}</div>
              {(relativitySlice||advancedSlice||rollingSlice||electricalErrorSlice||mechanicsErrorSlice||equilibriumSlice||projectileSlice||verticalSlice||turntableSlice||springSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||magneticSlice||waveSlice||rippleSlice||transformerSlice||waveOpticsSlice||thermoSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice)&&f.substitutedLatex&&<div className="overflow-x-auto" dangerouslySetInnerHTML={{__html:katex.renderToString(f.latex,{throwOnError:false})}}/>}
              <div className="overflow-x-auto"
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(f.substitutedLatex ?? f.latex, { throwOnError: false })
                }}
              />
            </div>
          ))}


          <div className="text-xs font-bold text-sky-400">参数调节</div>
          {(targetPlugin.getParamFields?.(params)??targetPlugin.paramSchema).filter(field=>circuitSlice?(CIRCUIT_FIELDS[String(params.topology)]??[]).includes(field.key):opticalSlice?(OPTICAL_FIELDS[String(params.sceneMode)]??[]).includes(field.key):mechanicsSlice?(MECHANICS_FIELDS[String(params.scenario)]??[]).includes(field.key):true).map((field) => {
            const val = params[field.key] ?? field.defaultValue;
            if (field.kind === 'number') {
              return (
                <div key={field.key} className="text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span>{field.label}</span>
                    <span className="font-mono">
                      {val} {field.unit ?? ''}
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid={'sf-param-'+field.key}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={typeof val === 'number' ? val : field.defaultValue}
                    onChange={(e) => {
                      const next = resolvePluginParams(targetPlugin.paramSchema, {
                        ...params,
                        [field.key]: Number(e.target.value)
                      });
                      setActivePresetId(null);
                      setParams(next);
                    if(legacyScope||relativitySlice||advancedSlice||rollingSlice||odeSlice||chaseSlice||equilibriumSlice||constrainedSlice||projectileSlice||contactSlice||verticalSlice||turntableSlice||springSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||magneticSlice||waveSlice||rippleSlice||transformerSlice||waveOpticsSlice||thermoSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice||orbitCompareSlice||(regenSlice&&next.mode==='regen-brake')){setIsPlaying(false);setScrubTime(null);}
                      setResetNonce((n) => n + 1);
                    }}
                    className="w-full h-9"
                  />
                </div>
              );
            }
            if (field.kind === 'boolean') {
              return (
                <label key={field.key} className="flex items-center justify-between text-xs py-1">
                  <span>{field.label}</span>
                  <input
                    type="checkbox"
                    checked={typeof val === 'boolean' ? val : field.defaultValue}
                    onChange={(e) => {
                      setParams(
                        resolvePluginParams(targetPlugin.paramSchema, {
                          ...params,
                          [field.key]: e.target.checked
                        })
                      );
                      if(legacyScope||relativitySlice||equilibriumSlice||waveOpticsSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice||orbitCompareSlice||(regenSlice&&params.mode==='regen-brake')){setIsPlaying(false);setScrubTime(null);}
                      if(legacyScope||relativitySlice||waveOpticsSlice||thermoSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice||regenSlice||orbitCompareSlice)setActivePresetId(null);
                      setResetNonce((n) => n + 1);
                    }}
                  />
                </label>
              );
            }
            if(field.customTextMaxLength!==undefined){const selected=typeof val==='string'?val:field.defaultValue;const apply=(value:string)=>{setActivePresetId(null);setParams(resolvePluginParams(targetPlugin.paramSchema,{...params,[field.key]:value}));setIsPlaying(false);setScrubTime(null);setResetNonce(n=>n+1);};return <div key={field.key} className="space-y-1 text-xs"><span>{field.label}</span><select aria-label="示例方程" value={field.options.some(o=>o.value===selected)?selected:''} onChange={e=>{if(e.target.value)apply(e.target.value);}} className="w-full rounded border px-2 py-1" style={{background:'var(--pf-surface-elevated)'}}><option value="">自定义表达式</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><form key={selected} onSubmit={e=>{e.preventDefault();apply(String(new FormData(e.currentTarget).get('expression')??''));}} className="space-y-1"><textarea data-testid="sf-ode-expression-input" aria-label="加速度表达式" name="expression" defaultValue={selected} rows={3} maxLength={field.customTextMaxLength} className="w-full rounded border p-2 font-mono" style={{background:'var(--pf-surface-elevated)'}}/><button type="submit" data-testid="sf-ode-expression-apply" className="w-full rounded border p-2">应用方程并复位</button></form><div>显式乘法 *；x,v,t,k,m,g,A,w,gamma；量纲由建模者指定。</div></div>;}
            return (
              <div key={field.key} className="text-xs space-y-1">
                <span>{field.label}</span>
                <select
                  data-testid={legacyScope||relativitySlice||advancedSlice||rollingSlice||electricalErrorSlice||atomicSlice||nuclearSlice||regenSlice||orbitCompareSlice?'sf-param-'+field.key:undefined}
                  value={typeof val === 'string' ? val : field.defaultValue}
                  onChange={(e) => {
                    setParams(
                      resolvePluginParams(targetPlugin.paramSchema, {
                        ...params,
                        [field.key]: e.target.value
                      })
                    );
                    if(legacyScope){setActivePresetId(null);}if(legacyScope||relativitySlice||advancedSlice||rollingSlice||odeSlice||chaseSlice||equilibriumSlice||constrainedSlice||projectileSlice||contactSlice||verticalSlice||turntableSlice||springSlice||collisionSlice||shmSlice||electroSlice||capacitorSlice||acSlice||wireSlice||eddySlice||generatorSlice||lcSlice||magneticSlice||waveSlice||rippleSlice||transformerSlice||waveOpticsSlice||thermoSlice||thermalCycleSlice||quantumSlice||atomicSlice||nuclearSlice||orbitCompareSlice||(regenSlice&&(params.mode==='regen-brake'||(field.key==='mode'&&e.target.value==='regen-brake')))){setIsPlaying(false);setScrubTime(null);}
                    setResetNonce((n) => n + 1);
                  }}
                  className="w-full rounded border px-2 py-1.5"
                  style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </aside>
      </main>
    </div>
  );
};
