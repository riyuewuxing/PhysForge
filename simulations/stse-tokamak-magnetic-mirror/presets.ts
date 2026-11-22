import type { PresetSpec } from '@physforge/sim-sdk';
import type { TokamakMirrorParams } from './engine.js';

export const tokamakMirrorPresets: readonly PresetSpec<TokamakMirrorParams>[] = [
  {
    id: 'mirror-trapped-bounce',
    name: '磁瓶往复反射约束（θ = 52° > 逃逸锥角 38.7°）',
    description: '带电粒子满足 θ > θ_c，在无散磁镜缩颈处顺次减速反转，实现磁瓶长期约束且磁矩 μ 绝热守恒',
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
    name: '托卡马克环形 + 极向螺旋磁面约束（EAST/ITER）',
    description: '环形磁场叠加极向角向场形成闭合螺旋磁面，抑制曲率/梯度漂移实现稳态环形约束',
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
