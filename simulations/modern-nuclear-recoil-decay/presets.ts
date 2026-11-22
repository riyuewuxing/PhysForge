import type { PresetSpec } from '@physforge/sim-sdk';
import type { NuclearRecoilDecayParams } from './engine.js';

export const nuclearRecoilPresets: readonly PresetSpec<NuclearRecoilDecayParams>[] = [
  {
    id: 'cloud-chamber-alpha-external',
    name: 'Ra-226 α 衰变磁云室反冲径迹（外切圆 R₁/R₂ = q₂/q₁）',
    description: '静止母核 α 衰变发生质能亏损并释放反冲动量，两同号粒子在磁场中作外切反向回旋圆周',
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
    name: 'Th-234 β⁻ 衰变磁云室径迹（内切圆 + 相对论速度校正）',
    description: '出射负电子与正电反冲子核电性相反，洛伦兹力同向，轨迹呈典型内切圆弧，半径比严格等于 Z_子',
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
    description: '展示半衰期是对大量原子核衰变的统计规律：N(t) = N₀(1/2)^(t/T)，少量核起伏大而大样本逼近指数',
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
    name: '重核裂变链式反应与镉控制棒临界调节（k_eff = 1）',
    description: '调节控制棒中子吸收比例使有效倍增系数 k_eff 穿过 1.0，直观对比次临界衰减与超临界雪崩',
    curriculumNotes: '选择性必修三 第五章第 4 节 · 核裂变、临界体积与反应堆安全控制',
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
