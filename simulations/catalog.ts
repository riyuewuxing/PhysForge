import type { ParamRecord, SimulationMeta, SimulationPlugin } from '@physforge/sim-sdk';

export type AnySimulationPlugin = SimulationPlugin<ParamRecord, unknown>;

export interface SimulationCatalogEntry {
  readonly meta: SimulationMeta;
}

function erasePluginType<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): AnySimulationPlugin {
  return plugin as unknown as AnySimulationPlugin;
}

/**
 * V1.0 旧模型 ID 到 V2.0 自由建模器规范 ID 的兼容别名映射表
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

export const simulationCatalog: readonly SimulationCatalogEntry[] = [
  {
    meta: {
      id: 'builder-composite-em-field',
      title: '自由复合场与动态圆建模器 (B1)',
      textbookRef: '人教版 选择性必修二 第一章 第2–3节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'wave-vibration-coupling',
      title: '机械波与质点振动双图联动 · 干涉与多普勒',
      textbookRef: '人教版 选择性必修一 第三章 第1–4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-induction-double-rod',
      title: '电磁感应单杆与双杆切割综合模型',
      textbookRef: '人教版 选择性必修二 第二章 第2–4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-block-conveyor',
      title: '动力学板块模型与传送带摩擦力突变',
      textbookRef: '人教版 必修第一册 第四章 第5–6节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '1.0.0'
    }
  },
  {
    meta: {
      id: 'builder-optics-ray',
      title: '自由几何光学与波动光学建模器 (B3)',
      textbookRef: '人教版 选择性必修一 第四章 第1–4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'builder-mechanics-lab',
      title: '自由力学约束与多刚体建模器 (B4)',
      textbookRef: '人教版 必修第二册 & 选择性必修一 第一章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '基础新授',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'builder-circuit-mna',
      title: '自由拓扑线性与非线性电路建模器 (B2)',
      textbookRef: '人教版 必修第三册 第十二章 第1–3节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'builder-custom-ode-lab',
      title: '通用微分方程与拉格朗日实验室 (B5)',
      textbookRef: '强基竞赛 & 高阶数值探究拓展',
      curriculumTags: ['科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-kinematics-chase',
      title: '运动学追及相遇与多过程图像 (M01)',
      textbookRef: '人教版 必修第一册 第二章 第4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-dynamic-equilibrium',
      title: '动态平衡几何图解（活结/死结/矢量三角形）(M02)',
      textbookRef: '人教版 必修第一册 第三章 第4节',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '高三一轮',
      version: '2.1.0'
    }
  },
  {
    meta: {
      id: 'mech-constrained-velocity',
      title: '关联速度（绳拉船 / 靠墙杆 / 接触面分解）(M03)',
      textbookRef: '人教版 必修第二册 第五章 第1–2节',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-projectile-coupling',
      title: '抛体运动与斜面/曲面耦合（安全包络与阻力）(M04)',
      textbookRef: '人教版 必修第二册 第五章 第3节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-vertical-circular',
      title: '竖直面圆周运动与单边脱轨模态切换 (M06)',
      textbookRef: '人教版 必修第二册 第六章 第4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-conical-turntable',
      title: '圆锥摆、水平圆盘双物块临界滑移 (M07)',
      textbookRef: '人教版 必修第二册 第六章 第2–3节',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-spring-separation',
      title: '含弹簧连接体与临界分离模型 (M08)',
      textbookRef: '人教版 必修第一册 第四章 & 必修二',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-collision-recoil',
      title: '碰撞、斜碰与反冲动量模型 (M09)',
      textbookRef: '人教版 选择性必修一 第一章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'astro-orbital-mechanics',
      title: '万有引力、霍曼转移与拉格朗日点 (M10)',
      textbookRef: '人教版 必修第二册 第七章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'mech-shm-resonance',
      title: '简谐振动、非线性单摆与受迫共振 (M11)',
      textbookRef: '人教版 选择性必修一 第二章',
      curriculumTags: ['物理观念', '科学探究', '科学思维'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-electrostatic-field',
      title: '多点电荷静电场、等势面与粒子偏转 (E01)',
      textbookRef: '人教版 必修第三册 第九、十章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-capacitor-millikan',
      title: '平行板电容器动态分析与密立根油滴 (E02)',
      textbookRef: '人教版 必修第三册 第十章 第4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-ac-field-oscilloscope',
      title: '交变电场、示波管与等效重力场 (E03)',
      textbookRef: '人教版 必修第三册 第十章 第5节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-wireframe-rotation',
      title: '线框进出多区域磁场与旋转切割 (E05)',
      textbookRef: '人教版 选择性必修二 第二章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-eddy-vortex-field',
      title: '感生涡旋电场与电磁阻尼对比 (E06)',
      textbookRef: '人教版 选择性必修二 第二章 第4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-ac-generator-rms',
      title: '交流电产生与有效值削峰填谷推导 (E07)',
      textbookRef: '人教版 选择性必修二 第三章 第1–2节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-transformer-grid',
      title: '理想变压器动态分析与高压输电网 (E08)',
      textbookRef: '人教版 选择性必修二 第三章 第3–4节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-lc-rlc-oscillation',
      title: 'LC 电磁振荡与 RLC 交流谐振 (E09)',
      textbookRef: '人教版 选择性必修二 第四章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'em-3d-magnetic-fields',
      title: '3D 电磁空间场与左手/右手定则 (E10)',
      textbookRef: '人教版 选择性必修二 第一章 & 必修三 第十三章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'wave-2d-ripple-fdtd',
      title: '2D FDTD 波动池衍射、折射与干涉 (W02)',
      textbookRef: '人教版 选择性必修一 第三、四章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'optics-wave-interference',
      title: '光的波动性进阶：劈尖、牛顿环与光栅缺级 (O01)',
      textbookRef: '人教版 选择性必修一 第四章 第4–6节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'thermo-piston-gas-laws',
      title: '汽缸活塞卡口、水银柱与变质量充放气 (T01)',
      textbookRef: '人教版 选择性必修三 第二章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'thermo-cycles-kinetic-md',
      title: '热力学循环与硬球分子动理论微观盒 (T02)',
      textbookRef: '人教版 选择性必修三 第一、三章',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'modern-photoelectric-compton',
      title: '光电效应与康普顿散射 (N01)',
      textbookRef: '人教版 选择性必修三 第四章第 2 节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'modern-rutherford-bohr',
      title: '卢瑟福散射与玻尔氢原子能级 (N02)',
      textbookRef: '人教版 选择性必修三 第四章第 3–4 节',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'modern-nuclear-recoil-decay',
      title: '核衰变反冲径迹与半衰期蒙特卡洛 (N03)',
      textbookRef: '人教版 选择性必修三 第五章第 2–4 节',
      curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'stse-tokamak-magnetic-mirror',
      title: '托卡马克环形磁场与磁镜/磁瓶 (S01)',
      textbookRef: '人教版 选择性必修二 第一章 · 现代核聚变磁约束 STSE',
      curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'stse-em-devices-suite',
      title: '现代电磁科技器件集成台 (S02)',
      textbookRef: '人教版 选择性必修二 第一章 · 电磁六大科技器件集成',
      curriculumTags: ['物理观念', '科学思维', '科学探究'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'stse-em-launch-regen-brake',
      title: '电磁弹射与新能源再生制动 (S03)',
      textbookRef: '人教版 选择性必修二 第二章 & 必修二 · 电磁能流 STSE',
      curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'stse-gravity-assist-rendezvous',
      title: '深空引力弹弓与空间站交会对接 (S04)',
      textbookRef: '人教版 必修第二册 第七章 · 天体变轨与深空探测 STSE',
      curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'exp-mechanics-error-lab',
      title: '力学实验真误差与纸带逐差仿真台 (X01)',
      textbookRef: '人教版 必修第一册 第四章 · 探究 a-F 异常图线溯源',
      curriculumTags: ['科学探究', '科学思维', '物理观念'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'exp-electrical-error-lab',
      title: '电学核心实验真误差与精密读数台 (X02)',
      textbookRef: '人教版 必修第三册 第十一、十二章 · 非理想电表误差与读数',
      curriculumTags: ['科学探究', '科学思维', '物理观念'],
      difficulty: '高三一轮',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'comp-rigid-rolling-slip',
      title: '刚体定轴转动与滑滚转换 (C01)',
      textbookRef: '人教版 选择性必修一 & 强基竞赛 · 刚体转动与滑滚',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'comp-chaos-normal-coriolis',
      title: '混沌双摆、简正模与科里奥利力 (C02)',
      textbookRef: '人教版 选择性必修一 & 强基竞赛 · 分析力学与非惯性系',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  },
  {
    meta: {
      id: 'comp-relativity-quantum-tunneling',
      title: '狭义相对论时空图与一维量子隧穿 (C03)',
      textbookRef: '人教版 选择性必修三 & 强基竞赛 · 相对论几何与 TDSE 隧穿',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '压轴专题',
      version: '2.0.0'
    }
  }
];

const MODEL_LOADERS: Readonly<Record<string, () => Promise<AnySimulationPlugin>>> = {
  'builder-composite-em-field': async () =>
    erasePluginType((await import('./em-bounded-magnetic-field/plugin.js')).emBoundedMagneticFieldPlugin),
  'wave-vibration-coupling': async () =>
    erasePluginType((await import('./wave-vibration-coupling/plugin.js')).waveVibrationCouplingPlugin),
  'em-induction-double-rod': async () =>
    erasePluginType((await import('./em-induction-double-rod/plugin.js')).emInductionDoubleRodPlugin),
  'mech-block-conveyor': async () =>
    erasePluginType((await import('./mech-block-conveyor/plugin.js')).mechBlockConveyorPlugin),
  'builder-optics-ray': async () =>
    erasePluginType((await import('./optics-ray-studio/plugin.js')).opticsRayStudioPlugin),
  'builder-mechanics-lab': async () =>
    erasePluginType((await import('./mech-free-sandbox/plugin.js')).mechFreeSandboxPlugin),
  'builder-circuit-mna': async () =>
    erasePluginType((await import('./circuit-dc-capacitor-mna/plugin.js')).circuitDcCapacitorMnaPlugin),
  'builder-custom-ode-lab': async () =>
    erasePluginType((await import('./builder-custom-ode-lab/plugin.js')).builderCustomOdeLabPlugin),
  'mech-kinematics-chase': async () =>
    erasePluginType((await import('./mech-kinematics-chase/plugin.js')).mechKinematicsChasePlugin),
  'mech-dynamic-equilibrium': async () =>
    erasePluginType((await import('./mech-dynamic-equilibrium/plugin.js')).mechDynamicEquilibriumPlugin),
  'mech-constrained-velocity': async () =>
    erasePluginType((await import('./mech-constrained-velocity/plugin.js')).mechConstrainedVelocityPlugin),
  'mech-projectile-coupling': async () =>
    erasePluginType((await import('./mech-projectile-coupling/plugin.js')).mechProjectileCouplingPlugin),
  'mech-vertical-circular': async () =>
    erasePluginType((await import('./mech-vertical-circular/plugin.js')).mechVerticalCircularPlugin),
  'mech-conical-turntable': async () =>
    erasePluginType((await import('./mech-conical-turntable/plugin.js')).mechConicalTurntablePlugin),
  'mech-spring-separation': async () =>
    erasePluginType((await import('./mech-spring-separation/plugin.js')).mechSpringSeparationPlugin),
  'mech-collision-recoil': async () =>
    erasePluginType((await import('./mech-collision-recoil/plugin.js')).mechCollisionRecoilPlugin),
  'astro-orbital-mechanics': async () =>
    erasePluginType((await import('./astro-orbital-mechanics/plugin.js')).astroOrbitalMechanicsPlugin),
  'mech-shm-resonance': async () =>
    erasePluginType((await import('./mech-shm-resonance/plugin.js')).mechShmResonancePlugin),
  'em-electrostatic-field': async () =>
    erasePluginType((await import('./em-electrostatic-field/plugin.js')).emElectrostaticFieldPlugin),
  'em-capacitor-millikan': async () =>
    erasePluginType((await import('./em-capacitor-millikan/plugin.js')).emCapacitorMillikanPlugin),
  'em-ac-field-oscilloscope': async () =>
    erasePluginType((await import('./em-ac-field-oscilloscope/plugin.js')).emAcFieldOscilloscopePlugin),
  'em-wireframe-rotation': async () =>
    erasePluginType((await import('./em-wireframe-rotation/plugin.js')).emWireframeRotationPlugin),
  'em-eddy-vortex-field': async () =>
    erasePluginType((await import('./em-eddy-vortex-field/plugin.js')).emEddyVortexFieldPlugin),
  'em-ac-generator-rms': async () =>
    erasePluginType((await import('./em-ac-generator-rms/plugin.js')).emAcGeneratorRmsPlugin),
  'em-transformer-grid': async () =>
    erasePluginType((await import('./em-transformer-grid/plugin.js')).emTransformerGridPlugin),
  'em-lc-rlc-oscillation': async () =>
    erasePluginType((await import('./em-lc-rlc-oscillation/plugin.js')).emLcRlcOscillationPlugin),
  'em-3d-magnetic-fields': async () =>
    erasePluginType((await import('./em-3d-magnetic-fields/plugin.js')).em3dMagneticFieldsPlugin),
  'wave-2d-ripple-fdtd': async () =>
    erasePluginType((await import('./wave-2d-ripple-fdtd/plugin.js')).wave2dRippleFdtdPlugin),
  'optics-wave-interference': async () =>
    erasePluginType((await import('./optics-wave-interference/plugin.js')).opticsWaveInterferencePlugin),
  'thermo-piston-gas-laws': async () =>
    erasePluginType((await import('./thermo-piston-gas-laws/plugin.js')).thermoPistonGasLawsPlugin),
  'thermo-cycles-kinetic-md': async () =>
    erasePluginType((await import('./thermo-cycles-kinetic-md/plugin.js')).thermoCyclesKineticMdPlugin),
  'modern-photoelectric-compton': async () =>
    erasePluginType((await import('./modern-photoelectric-compton/plugin.js')).modernPhotoelectricComptonPlugin),
  'modern-rutherford-bohr': async () =>
    erasePluginType((await import('./modern-rutherford-bohr/plugin.js')).modernRutherfordBohrPlugin),
  'modern-nuclear-recoil-decay': async () =>
    erasePluginType((await import('./modern-nuclear-recoil-decay/plugin.js')).modernNuclearRecoilDecayPlugin),
  'stse-tokamak-magnetic-mirror': async () =>
    erasePluginType((await import('./stse-tokamak-magnetic-mirror/plugin.js')).stseTokamakMagneticMirrorPlugin),
  'stse-em-devices-suite': async () =>
    erasePluginType((await import('./stse-em-devices-suite/plugin.js')).stseEmDevicesSuitePlugin),
  'stse-em-launch-regen-brake': async () =>
    erasePluginType((await import('./stse-em-launch-regen-brake/plugin.js')).stseEmLaunchRegenBrakePlugin),
  'stse-gravity-assist-rendezvous': async () =>
    erasePluginType((await import('./stse-gravity-assist-rendezvous/plugin.js')).stseGravityAssistRendezvousPlugin),
  'exp-mechanics-error-lab': async () =>
    erasePluginType((await import('./exp-mechanics-error-lab/plugin.js')).expMechanicsErrorLabPlugin),
  'exp-electrical-error-lab': async () =>
    erasePluginType((await import('./exp-electrical-error-lab/plugin.js')).expElectricalErrorLabPlugin),
  'comp-rigid-rolling-slip': async () =>
    erasePluginType((await import('./comp-rigid-rolling-slip/plugin.js')).compRigidRollingSlipPlugin),
  'comp-chaos-normal-coriolis': async () =>
    erasePluginType((await import('./comp-chaos-normal-coriolis/plugin.js')).compChaosNormalCoriolisPlugin),
  'comp-relativity-quantum-tunneling': async () =>
    erasePluginType((await import('./comp-relativity-quantum-tunneling/plugin.js')).compRelativityQuantumTunnelingPlugin)
};

export async function loadSimulationById(id: string): Promise<AnySimulationPlugin | undefined> {
  const canonical = resolveCanonicalModelId(id);
  const loader = MODEL_LOADERS[canonical];
  if (!loader) return undefined;
  return loader();
}
