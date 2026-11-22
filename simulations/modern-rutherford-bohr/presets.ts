import type { PresetSpec } from '@physforge/sim-sdk';
import type { RutherfordBohrParams } from './engine.js';

export const rutherfordBohrPresets: readonly PresetSpec<RutherfordBohrParams>[] = [
  {
    id: 'rutherford-gold-foil-scatter',
    name: '卢瑟福 α 粒子金箔核式散射（Z=79, K=5 MeV, ScaleContext）',
    description: '基于 fm 核尺度无量纲求解库仑排斥 ODE，实测偏转角 θ 与卢瑟福解析公式误差 < 1e-4',
    curriculumNotes: '选择性必修三 第四章第 3 节 · 原子的核式结构模型',
    params: {
      mode: 'rutherford',
      alphaEnergyMev: 5.0,
      targetZ: 79,
      impactParamFm: 25,
      excitedLevelN: 4,
      populationMode: 'ensemble',
      probeKind: 'photon',
      probeEnergyEv: 12.75
    }
  },
  {
    id: 'bohr-balmer-ensemble-vs-single',
    name: '玻尔氢原子 n=6 能级跃迁：巴耳末四条可见光谱线与单/多原子对比',
    description: '计算 n≤6 全部 C_6^2=15 条跃迁谱线，并按物理波长真彩色高亮巴耳末 Hα/Hβ/Hγ/Hδ',
    curriculumNotes: '选择性必修三 第四章第 4 节 · 玻尔的原子模型与氢原子光谱',
    params: {
      mode: 'bohr',
      alphaEnergyMev: 5.0,
      targetZ: 79,
      impactParamFm: 25,
      excitedLevelN: 6,
      populationMode: 'ensemble',
      probeKind: 'photon',
      probeEnergyEv: 12.09
    }
  },
  {
    id: 'bohr-photon-vs-electron-excitation',
    name: '实物电子 vs 光子激发对照（12.5 eV 探针入射基态氢原子）',
    description: '12.5 eV 光子因不等于任何能级差被直接透射，而 12.5 eV 电子可把原子激发至 n=3 并带走 0.41 eV 剩余动能',
    curriculumNotes: '选择性必修三 第四章第 4 节 · 弗兰克-赫兹碰撞激发与光子共振吸收差异',
    params: {
      mode: 'bohr',
      alphaEnergyMev: 5.0,
      targetZ: 79,
      impactParamFm: 25,
      excitedLevelN: 4,
      populationMode: 'single-atom',
      probeKind: 'electron',
      probeEnergyEv: 12.5
    }
  }
];
