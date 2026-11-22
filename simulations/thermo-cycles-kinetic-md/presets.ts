import type { PresetSpec } from '@physforge/sim-sdk';
import type { ThermoCycleMdParams } from './engine.js';

export const thermoCycleMdPresets: readonly PresetSpec<ThermoCycleMdParams>[] = [
  {
    id: 'kinetic-md-300-maxwell',
    name: '300 分子二维硬球 MD（麦克斯韦速率分布与器壁压强）',
    description: '基于 SpatialHash2D 精确弹性碰撞与确定性随机种子，实时演化气体统计压强并拟合麦克斯韦速率分布',
    curriculumNotes: '选择性必修三 第一章 · 分子动理论与统计规律',
    params: {
      mode: 'kinetic-md-box',
      molesN: 1,
      tHotK: 600,
      tColdK: 300,
      compressionRatioV2OverV1: 2.5,
      rectPressureRatio: 2.0,
      particleCountN: 300,
      seed: 20261122,
      brownianPollen: true,
      mdSpeedScale: 1.0
    }
  },
  {
    id: 'carnot-ideal-cycle',
    name: '卡诺理想热机循环（η_C = 1 - T_C/T_H）',
    description: '两段等温与两段绝热过程闭合，精确验算循环净功 W、热效率 η 与 ΔU总=0',
    curriculumNotes: '选择性必修三 第三章 · 热力学第二定律与卡诺效率极限',
    params: {
      mode: 'cycle-carnot',
      molesN: 1,
      tHotK: 600,
      tColdK: 300,
      compressionRatioV2OverV1: 2.5,
      rectPressureRatio: 2.0,
      particleCountN: 200,
      seed: 20261122,
      brownianPollen: false,
      mdSpeedScale: 1.0
    }
  },
  {
    id: 'rect-pv-thermo-cycle',
    name: 'P-V 矩形热力学循环（四段功热账本拆解）',
    description: '展示等容升温—定压膨胀—等容降温—定压压缩的 W、Q、ΔU 全账本及效率低于同温区卡诺机',
    curriculumNotes: '选择性必修三 · P-V 图面积计算净功与循环吸放热',
    params: {
      mode: 'cycle-rect-pv',
      molesN: 1,
      tHotK: 600,
      tColdK: 300,
      compressionRatioV2OverV1: 2.2,
      rectPressureRatio: 2.0,
      particleCountN: 200,
      seed: 20261122,
      brownianPollen: false,
      mdSpeedScale: 1.0
    }
  }
];
