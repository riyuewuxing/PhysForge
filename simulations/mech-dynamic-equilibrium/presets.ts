import type { PresetSpec } from '@physforge/sim-sdk';
import type { EquilibriumParams } from './engine.js';

export const equilibriumPresets: readonly PresetSpec<EquilibriumParams>[] = [
  {
    id: 'dead-knot-triangle',
    name: '1. 死结旋转拉起：矢量三角形与极小拉力 (F₂⊥F₁)',
    description: '固定左绳与竖直成 α=37°，连续改变右绳仰角 β，直观看到右绳与左绳垂直时拉力最小 F_min = mg sinα。',
    params: {
      mode: 'dead-knot-rotate',
      mass: 2.0,
      baseAngleDeg: 37,
      sweepAngleDeg: 37,
      autoSweep: true
    }
  },
  {
    id: 'active-pulley-symmetry',
    name: '2. 活结轻滑轮等张力律 (T₁ ≡ T₂)',
    description: '光滑轻滑轮在绳上自由滑动，两侧张力始终严格相等且 T = mg / (2 sinθ)。',
    params: {
      mode: 'active-pulley-knot',
      mass: 2.0,
      baseAngleDeg: 30,
      sweepAngleDeg: 45,
      autoSweep: true
    }
  },
  {
    id: 'similar-triangle-support',
    name: '3. 共点力平衡动态变化（辅助几何分析）',
    description: '连续增大推角观察支持力与水平拉力单调协同变化规律。',
    params: {
      mode: 'hemisphere-similar',
      mass: 2.0,
      baseAngleDeg: 30,
      sweepAngleDeg: 30,
      autoSweep: true
    }
  }
];
