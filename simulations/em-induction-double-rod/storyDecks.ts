import type { StoryDeck } from '@physforge/sim-sdk';

// Horizontal equal-width, frictionless isolated rods: p = 12 kg m/s, v_inf = 4 m/s, Q_inf = 12 J.
const doubleRod = {
  rodMode: 'double', circuitLoad: 'resistor', magneticB: 1.5, railWidth: 1, railWidth2: 0,
  inclineDeg: 0, mass1: 2, mass2: 1, resistorR: 1.5, rodResistance1: 0.5,
  rodResistance2: 0.5, capacitance: 0.25, batteryEmf: 6, externalForce: 0,
  frictionMu: 0, v1Initial: 6, v2Initial: 0
} as const;

export const inductionStoryDecks: readonly StoryDeck[] = [{
  id: 'e04-double-rod-energy', modelId: 'em-induction-double-rod', title: '双杆切割：从相对运动到共速',
  beats: [
    { id: 'e04-start', title: '先判断电流与安培力', caption: '两杆速度不同，回路磁通量改变。',
      speakerNotes: '左、右两杆处于同一匀强磁场，导轨水平光滑。请判断感应电流方向和两杆所受安培力方向；说明为什么系统水平方向总动量守恒。',
      paramPatch: doubleRod, paramTweenMs: 0, simAction: 'reset-pause', layerOverrides: { showFbd: true } },
    { id: 'e04-common-speed', title: '共速附近自动定格', caption: '速度差衰减，感应电流趋于零。',
      speakerNotes: '总动量为 2×6=12 kg·m/s，极限共速为 4 m/s。严格共速是指数渐近过程；当电流小于等于 0.05 A 时只作课堂近似定格，不宣称已经严格相等。',
      paramPatch: doubleRod, paramTweenMs: 0, simAction: 'reset-play',
      autoFreeze: { observableKey: 'current', operator: '<=', threshold: 0.05, badgeText: '电流 ≤ 0.05 A：接近共速' },
      layerOverrides: { showFbd: true } },
    { id: 'e04-energy', title: '机械能向焦耳热转化', caption: '动量守恒，但机械能转化为焦耳热。',
      speakerNotes: '初始动能 36 J，极限共同速度对应总动能 24 J，极限焦耳热 12 J。请学生说明能量守恒与机械能不守恒并不矛盾。定格条件是累计焦耳热达到 11.9 J。',
      paramPatch: doubleRod, paramTweenMs: 0, simAction: 'reset-play',
      autoFreeze: { observableKey: 'jouleHeat', operator: '>=', threshold: 11.9, badgeText: '累计焦耳热 ≥ 11.9 J' } }
  ]
}];
