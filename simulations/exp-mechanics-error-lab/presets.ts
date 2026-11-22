import type { PresetSpec } from '@physforge/sim-sdk';
import type { MechanicsErrorParams } from './engine.js';

export const mechanicsErrorPresets: readonly PresetSpec<MechanicsErrorParams>[] = [
  {
    id: 'af-under-compensated-f-intercept',
    name: '未平衡摩擦力（横轴正截距 F₀ = f - Mgsinθ）',
    description: '水平轨道（θ=0）存在阻力 f=0.06N，外力须先克服静阻力才产生加速度，a-F 图线右移交正 F 轴',
    curriculumNotes: '必修第一册 第四章第 2 节 · 探究 a 与 F、m 关系的高考误差诊断',
    params: {
      scenario: 'under-compensated',
      cartMassKg: 0.4,
      hangerMassKg: 0.04,
      trackTiltDeg: 0,
      frictionForceN: 0.06,
      readingNoiseMm: 0,
      seed: 20261122,
      phyphoxOverlayCsv: '0.1;0.08\n0.2;0.31\n0.4;0.79'
    }
  },
  {
    id: 'af-over-compensated-a-intercept',
    name: '倾角过大过度平衡（纵轴正截距 a₀ = g sinθ - f/M）',
    description: '木板垫得过高导致未挂钩码时小车已加速下滑，a-F 图像在纵轴留下明确正截距',
    curriculumNotes: '必修第一册 第四章 · 过度平衡摩擦力系统误差溯源',
    params: {
      scenario: 'over-compensated',
      cartMassKg: 0.4,
      hangerMassKg: 0.04,
      trackTiltDeg: 4.0,
      frictionForceN: 0.05,
      readingNoiseMm: 0.15,
      seed: 20261122,
      phyphoxOverlayCsv: ''
    }
  },
  {
    id: 'af-heavy-hanger-bend',
    name: '未满足 m ≪ M 导致 a-F 图像末端明显向下弯曲',
    description: '随着悬挂质量增大，拉力不再近似 mg，a(F) 严格贴合 F/(M + F/g) 的次线性弯曲规律',
    curriculumNotes: '必修第一册 第四章 · 牛顿第二定律实验的系统误差边界条件',
    params: {
      scenario: 'heavy-hanger-bend',
      cartMassKg: 0.4,
      hangerMassKg: 0.2,
      trackTiltDeg: 0,
      frictionForceN: 0,
      readingNoiseMm: 0,
      seed: 20261122,
      phyphoxOverlayCsv: ''
    }
  }
];
