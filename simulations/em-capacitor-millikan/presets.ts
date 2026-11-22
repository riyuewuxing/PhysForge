import type { PresetSpec } from '@physforge/sim-sdk';
import type { CapacitorMillikanParams } from './engine.js';

export const capacitorMillikanPresets: readonly PresetSpec<CapacitorMillikanParams>[] = [
  {
    id: 'open-switch-distance-invariant',
    name: '断开开关改变极板间距 d（场强 E 严格不变）',
    description: '开关断开保持电荷 Q 恒定，拖动 d 观察电压与静电计指针变化及内部场强 ΔE≡0',
    curriculumNotes: '必修三 第十章 · 电容器动态分析经典结论',
    params: {
      switchMode: 'open-const-q',
      groundMode: 'bottom',
      sourceVoltageU0: 200,
      distanceMm: 28,
      refDistanceMm: 20,
      areaRatioS: 1.0,
      refAreaRatioS: 1.0,
      dielectricEr: 1,
      refDielectricEr: 1,
      probeFracP: 0.4,
      oilDropEnabled: false,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 4
    }
  },
  {
    id: 'closed-switch-const-u',
    name: '闭合开关接恒压电源（调 d、S、εr）',
    description: '开关闭合保持电压 U 恒定，增大介电常数 εr 或减小 d 将显著增加电容与带电量',
    curriculumNotes: '必修三 第十章 · 恒压动态分析',
    params: {
      switchMode: 'closed-const-u',
      groundMode: 'bottom',
      sourceVoltageU0: 200,
      distanceMm: 16,
      refDistanceMm: 20,
      areaRatioS: 0.85,
      refAreaRatioS: 1.0,
      dielectricEr: 2.5,
      refDielectricEr: 1,
      probeFracP: 0.5,
      oilDropEnabled: false,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 4
    }
  },
  {
    id: 'millikan-oil-drop-balance',
    name: '密立根油滴静悬平衡态 (qE = mg)',
    description: '闭合高压微调电压 U₀，实现带电油滴悬浮静止及上下受迫阻尼运动',
    curriculumNotes: '必修三 · 密立根油滴测量元电荷',
    params: {
      switchMode: 'closed-const-u',
      groundMode: 'bottom',
      sourceVoltageU0: 200,
      distanceMm: 20,
      refDistanceMm: 20,
      areaRatioS: 1.0,
      refAreaRatioS: 1.0,
      dielectricEr: 1,
      refDielectricEr: 1,
      probeFracP: 0.5,
      oilDropEnabled: true,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 6
    }
  },
  {
    id: 'top-plate-grounded-potential',
    name: '上极板接地与探针点 P 电势反转分析',
    description: '切换上/下板接地，定量读出探针 P 点电势 φP 随极板间距变化的单调规律',
    curriculumNotes: '必修三 · 电容器内部某点电势判断',
    params: {
      switchMode: 'open-const-q',
      groundMode: 'top',
      sourceVoltageU0: 200,
      distanceMm: 24,
      refDistanceMm: 20,
      areaRatioS: 1.0,
      refAreaRatioS: 1.0,
      dielectricEr: 1,
      refDielectricEr: 1,
      probeFracP: 0.3,
      oilDropEnabled: false,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 4
    }
  }
];
