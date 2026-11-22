import type { PresetSpec } from '@physforge/sim-sdk';
import type { ChaosNormalCoriolisParams } from './engine.js';

export const chaosNormalCoriolisPresets: readonly PresetSpec<ChaosNormalCoriolisParams>[] = [
  {
    id: 'chaos-double-pendulum',
    name: '混沌双摆双初值分离（δθ₀ = 1e-4 rad 蝴蝶效应 + RK45）',
    description: '同时积分几乎重叠的两组双摆初值，高能甩动呈现显著混沌分叉，30s 机械能漂移 < 1e-6',
    curriculumNotes: '强基/大学物理 · 哈密顿混沌系统与初值敏感性',
    params: {
      mode: 'double-pendulum',
      m1Kg: 1.0,
      m2Kg: 1.0,
      l1M: 1.0,
      l2M: 1.0,
      theta1Deg: 135,
      theta2Deg: 135,
      springKw: 20,
      springKc: 8,
      normalExcite: 'symmetric',
      diskOmegaRadps: 1.2,
      puckSpeedMps: 0.9
    }
  },
  {
    id: 'coupled-normal-modes-beat',
    name: '耦合双振子简正模与单振子激振拍频迁移',
    description: '切换对称同相/反相简正模（特征值精度 < 1e-5）或单振子激振观察周期性拍频能量交换',
    curriculumNotes: '强基/物理竞赛 · 多自由度简正坐标与本征频率',
    params: {
      mode: 'normal-modes',
      m1Kg: 1.0,
      m2Kg: 1.0,
      l1M: 1.0,
      l2M: 1.0,
      theta1Deg: 90,
      theta2Deg: 90,
      springKw: 25,
      springKc: 10,
      normalExcite: 'single-beat',
      diskOmegaRadps: 1.2,
      puckSpeedMps: 0.9
    }
  },
  {
    id: 'coriolis-rotating-disk',
    name: '旋转圆盘非惯性科里奥利力双视口实证对照',
    description: '左视口地面惯性系匀直滑行，右视口旋转系受惯性离心力+科里奥利力偏向曲线，双系重合误差 < 1e-6',
    curriculumNotes: '强基/大学先修 · 科里奥利力 -2Ω×v 与非惯性系动力学',
    params: {
      mode: 'coriolis-disk',
      m1Kg: 1.0,
      m2Kg: 1.0,
      l1M: 1.0,
      l2M: 1.0,
      theta1Deg: 90,
      theta2Deg: 90,
      springKw: 25,
      springKc: 10,
      normalExcite: 'symmetric',
      diskOmegaRadps: 1.2,
      puckSpeedMps: 0.9
    }
  }
];
