import type { PresetSpec } from '@physforge/sim-sdk';
import type { NuclearRecoilDecayParams } from './engine.js';

export const nuclearRecoilPresets: readonly PresetSpec<NuclearRecoilDecayParams>[] = [
  {
    id: 'cloud-chamber-alpha-external',
    name: 'α 衰变理想二体反冲（模型参数）',
    description: '静止母核理想二体运动，磁场中比较同号粒子外切轨迹；输入为教学模型质量，非核素实测数据',
    curriculumNotes: '选择性必修三 第五章第 2–3 节 · 磁云室衰变径迹识别与质能方程',
    params: {
      mode: 'cloud-chamber-recoil',
      decayKind: 'alpha',
      parentZ: 88,
      parentMassU: 226.0254,
      massDefectU: 0.00522,
      magneticFieldT: 1.2,
      nucleiCountN0: 400,
      halfLifeS: 2.0,
      seed: 20261122,
      kEffectiveRaw: 2.1,
      controlRodAbsorption: 0.52
    }
  },
  {
    id: 'cloud-chamber-beta-internal',
    name: 'β⁻ 端点理想化（模型参数）',
    description: '仅反中微子能量趋零的端点极限，电子和子核动量反向等大；一般三体 β 衰变不满足该半径比',
    curriculumNotes: '选择性必修三 第五章 · α/β 衰变外切/内切圆定量判据',
    params: {
      mode: 'cloud-chamber-recoil',
      decayKind: 'beta-minus',
      parentZ: 90,
      parentMassU: 234.0436,
      massDefectU: 0.00029,
      magneticFieldT: 0.4,
      nucleiCountN0: 400,
      halfLifeS: 2.0,
      seed: 20261122,
      kEffectiveRaw: 2.1,
      controlRodAbsorption: 0.52
    }
  },
  {
    id: 'half-life-mc-ensemble',
    name: '半衰期蒙特卡洛统计规律（N₀=1600 可重复确定性 PRNG）',
    description: '样本阶梯与理论期望分开；固定种子一次抽取各核寿命，改变时间步长不改变实现',
    curriculumNotes: '选择性必修三 第五章第 2 节 · 半衰期的统计本质与确定性实验复现',
    params: {
      mode: 'half-life-mc',
      decayKind: 'alpha',
      parentZ: 88,
      parentMassU: 226.0254,
      massDefectU: 0.00522,
      magneticFieldT: 1.2,
      nucleiCountN0: 1600,
      halfLifeS: 2.0,
      seed: 20261122,
      kEffectiveRaw: 2.1,
      controlRodAbsorption: 0.52
    }
  },
  {
    id: 'chain-fission-control-rod',
    name: '抽象代际期望对比（非时间仿真）',
    description: '仅比较抽象代际期望；不代表反应堆运行、装置安全或实际粒子轨迹',
    curriculumNotes: '选择性必修三 第五章第 4 节 · 代际期望的数学示意',
    params: {
      mode: 'chain-fission',
      decayKind: 'alpha',
      parentZ: 92,
      parentMassU: 235.0439,
      massDefectU: 0.215,
      magneticFieldT: 1.0,
      nucleiCountN0: 400,
      halfLifeS: 2.0,
      seed: 20261122,
      kEffectiveRaw: 2.2,
      controlRodAbsorption: 0.545
    }
  }
];
