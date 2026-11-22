import type { PresetSpec } from '@physforge/sim-sdk';
import type { EddyVortexParams } from './engine.js';

export const eddyVortexPresets: readonly PresetSpec<EddyVortexParams>[] = [
  {
    id: 'betatron-vortex-acceleration',
    name: '电子感应加速器与柱对称涡旋电场（dB/dt > 0）',
    description: '圆柱区域内磁感应强度线性增强，激发环形闭合感生电场，验证 ∮E·dl = -dΦ/dt',
    curriculumNotes: '选择性必修二 第二章 · 感生电场与电子感应加速器',
    params: {
      mode: 'betatron-vortex',
      cylinderRadiusR: 1.2,
      bDotRate: 1.5,
      bField0: 1.0,
      particleChargeRatio: 1.6,
      particleInitRadius: 0.9,
      pendulumLengthL: 1.0,
      solidDampingGamma: 2.2,
      slottedDampingGamma: 0.08,
      initialAngleDeg: 35
    }
  },
  {
    id: 'eddy-solid-vs-slotted-pendulum',
    name: '电磁阻尼双摆对照（整块铜板 vs 开槽铜板）',
    description: '同期释放，整块铜摆经过磁极缝隙迅速衰减停稳，开槽铜摆切断涡流回路持续摆动',
    curriculumNotes: '选择性必修二 第二章 · 涡流与电磁阻尼演示',
    params: {
      mode: 'eddy-damping-compare',
      cylinderRadiusR: 1.0,
      bDotRate: 0,
      bField0: 1.5,
      particleChargeRatio: 1.0,
      particleInitRadius: 0.8,
      pendulumLengthL: 1.0,
      solidDampingGamma: 2.4,
      slottedDampingGamma: 0.06,
      initialAngleDeg: 35
    }
  },
  {
    id: 'outer-region-1overr-decay',
    name: '柱外 r > R 区域涡旋电场 1/r 衰减检验',
    description: '将试探轨道拖出磁场区 r > R，场区外 B=0 仍有环向感生电场驱动偏转',
    curriculumNotes: '选择性必修二 · 磁场边界外感生电场',
    params: {
      mode: 'betatron-vortex',
      cylinderRadiusR: 0.8,
      bDotRate: 2.0,
      bField0: 0.5,
      particleChargeRatio: 1.2,
      particleInitRadius: 1.25,
      pendulumLengthL: 1.0,
      solidDampingGamma: 2.2,
      slottedDampingGamma: 0.08,
      initialAngleDeg: 35
    }
  }
];
