import type { PresetSpec } from '@physforge/sim-sdk';
import type { TokamakMirrorParams } from './engine.js';

export const tokamakMirrorPresets: readonly PresetSpec<TokamakMirrorParams>[] = [
  {
    id: 'mirror-trapped-bounce',
    name: '磁瓶往复反射约束（θ = 52° > 逃逸锥角 38.7°）',
    description: '带电粒子满足 θ > θ_c，在无散磁镜缩颈处顺次减速反转，实现本次轨迹的往复反射且磁矩 μ 近似守恒',
    curriculumNotes: '选择性必修二 第一章 · 受控核聚变磁镜约束原理与 STSE',
    params: {
      mode: 'magnetic-mirror',
      b0Tesla: 2.5,
      mirrorLengthM: 1.2,
      coilHalfSpanM: 1.5,
      pitchAngleDeg: 52,
      speed0: 2.0,
      qOverM: 45,
      majorRadiusM: 1.4,
      safetyFactorQ: 2.4
    }
  },
  {
    id: 'mirror-loss-cone-escape',
    name: '逃逸锥泄漏穿出（θ = 22° < 临界角 θ_c）',
    description: '投射角进入逃逸锥内，纵向动量无法在磁喉前归零，粒子直接穿透磁瓶端面泄漏',
    curriculumNotes: '选择性必修二 · 磁镜逃逸锥角 sinθ_c = 1/√Rm 判据',
    params: {
      mode: 'magnetic-mirror',
      b0Tesla: 2.5,
      mirrorLengthM: 1.2,
      coilHalfSpanM: 1.5,
      pitchAngleDeg: 22,
      speed0: 2.0,
      qOverM: 45,
      majorRadiusM: 1.4,
      safetyFactorQ: 2.4
    }
  },
  {
    id: 'tokamak-helical-confinement',
    name: '托卡马克环向与极向场（单粒子示意）',
    description: '在给定环向与极向外磁场中观察真实粒子轨迹与螺旋磁感线；有限时段未越过示意室壁不代表长期约束或真实聚变装置稳态',
    curriculumNotes: '选择性必修二 / 必修三 · 人造太阳托卡马克螺旋磁位形',
    params: {
      mode: 'tokamak',
      b0Tesla: 3.0,
      mirrorLengthM: 1.2,
      coilHalfSpanM: 1.5,
      pitchAngleDeg: 45,
      speed0: 2.2,
      qOverM: 45,
      majorRadiusM: 1.4,
      safetyFactorQ: 2.5
    }
  }
];
