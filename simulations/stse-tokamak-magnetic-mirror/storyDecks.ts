import type { StoryDeck } from '@physforge/sim-sdk';
import type { TokamakMirrorParams } from './engine.js';

const mirror = {
  mode: 'magnetic-mirror', b0Tesla: 2.5, mirrorLengthM: 1.2, coilHalfSpanM: 1.5,
  pitchAngleDeg: 52, speed0: 2, qOverM: 45, majorRadiusM: 1.4, safetyFactorQ: 2.4
} as const satisfies TokamakMirrorParams;
const layers = ['conductors', 'fieldLines3d'] as const;
const camera = (morphT: 0 | 1) => ({
  view3D: { azimuthRad: 0.5, polarRad: 1.05, target: [0, 0, 0] as [number, number, number], visibleHeight: 6.5, morphT },
  durationMs: 750
});

export const fusionStoryDecks: readonly StoryDeck[] = [{
  id: 's01-mirror-loss-cone', modelId: 'stse-tokamak-magnetic-mirror', title: '磁约束：反射、逃逸与环形磁场',
  beats: [
    { id: 's01-trap', title: '磁镜反射', caption: '在缓变磁场中，粒子的垂直与平行速度可以相互转化。',
      speakerNotes: '当前轴线磁镜比为 1+(1.5/1.2)²=2.5625，绝热近似下逃逸锥半角约 38.7°。52° 位于锥外。总动能守恒，磁矩近似守恒；观察引擎实际记录的首次轴向速度反号。磁镜没有实体反弹壁。',
      paramPatch: mirror, paramTweenMs: 0, simAction: 'reset-play', camera: camera(0),
      autoFreeze: { observableKey: 'reflectionCount', operator: '>=', threshold: 1, badgeText: '引擎记录首次磁镜反射' },
      layerOverrides: { visibleLayerIds: layers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'mirror-ratio' } },
    { id: 's01-loss', title: '进入逃逸锥', caption: '投射角过小，粒子可能穿过磁喉而逃逸。',
      speakerNotes: '保持场形和速率不变，只把投射角改为 22°。按绝热近似，此角位于逃逸锥内。实际定格依据引擎轴向位置到达正向磁喉 1.5 m；不把近似判据说成任意强非均匀磁场中的精确定理。',
      paramPatch: { ...mirror, pitchAngleDeg: 22 }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(1),
      autoFreeze: { observableKey: 'z', operator: '>=', threshold: 1.5, badgeText: '到达正向磁喉 z=1.5 m 附近' },
      layerOverrides: { visibleLayerIds: layers, showFbd: true, referenceFrameId: 'ground', highlightFormulaId: 'mirror-pitch' } },
    { id: 's01-torus', title: '环向与极向磁场', caption: '环形磁场叠加极向分量，形成螺旋磁位形。',
      speakerNotes: '切换到托卡马克示意模型，比较环向场与极向场。当前模型环向分量与柱坐标半径成反比。此演示不含真实等离子体集体效应、输运与不稳定性，不据一条粒子轨迹推断装置达到稳态聚变。',
      paramPatch: { ...mirror, mode: 'tokamak', b0Tesla: 3, pitchAngleDeg: 45, speed0: 2.2, safetyFactorQ: 2.5 },
      paramTweenMs: 0, simAction: 'reset-play', camera: camera(0),
      layerOverrides: { visibleLayerIds: layers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'tokamak-toroidal-field' } }
  ]
}];
