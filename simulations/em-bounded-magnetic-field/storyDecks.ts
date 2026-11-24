import type { StoryDeck } from '@physforge/sim-sdk';

const common = { mode: 'circular', mass: 1, charge: 1, magneticFieldZ: 2, electricFieldY: 3,
  fieldScale: 1.2, launchAngleDeg: 0, beamCount: 5 } as const;

export const magneticStoryDecks: readonly StoryDeck[] = [{
  id: 'b1-circle-focusing-scaling', modelId: 'builder-composite-em-field', title: '有界圆形磁场：磁聚焦与放缩圆',
  beats: [
    { id: 'b1-radius', title: '单粒子半径', caption: '洛伦兹力垂直速度：改变方向，不改变速率。',
      speakerNotes: '纯磁场内 qvB=mv²/r，r=mv/|qB|。当前 m=1 kg，q=1 C，B=2 T，v=2.4 m/s，回旋半径 1.2 m；电荷正负决定偏转方向。',
      paramPatch: { ...common, family: 'single', initialSpeed: 2.4 }, paramTweenMs: 0, simAction: 'reset-play',
      camera: { view3D: { azimuthRad: 0.65, polarRad: 1.15, target: [0, 0, 0], visibleHeight: 5.8, morphT: 0 }, durationMs: 750 },
      layerOverrides: { showFbd: true, highlightFormulaId: 'larmor-initial' } },
    { id: 'b1-focus', title: '等半径磁聚焦', caption: '平行入射粒子满足 r=R 时观察磁聚焦。',
      speakerNotes: '把回旋圆与磁场边界圆作几何比较。在当前模型的相同速率、质量和电荷条件下，回旋半径等于磁场半径；请观察不同入射位置的轨迹及其出界点。',
      paramPatch: { ...common, family: 'focusing', initialSpeed: 2.4 }, paramTweenMs: 0, simAction: 'reset-play',
      camera: { view3D: { azimuthRad: 0.65, polarRad: 1.15, target: [0, 0, 0], visibleHeight: 5.8, morphT: 1 }, durationMs: 750 },
      layerOverrides: { showFbd: false, highlightFormulaId: 'larmor-initial' } },
    { id: 'b1-scale', title: '不同速率的放缩圆', caption: '同一磁场、不同速率，回旋半径随速率成比例变化。',
      speakerNotes: '保持 m、q、B 和入射方向不变，模型生成不同初速的粒子束。逐条比较圆心、半径、出界位置与轨迹包络，不把同速磁聚焦条件误用于不同速率。',
      paramPatch: { ...common, family: 'scaling', initialSpeed: 2 }, paramTweenMs: 0, simAction: 'reset-play',
      layerOverrides: { highlightFormulaId: 'larmor-initial' } }
  ]
}];
