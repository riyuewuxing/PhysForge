import type { PresetSpec } from '@physforge/sim-sdk';
import type { ConicalTurntableParams } from './engine.js';

export const conicalTurntablePresets: readonly PresetSpec<ConicalTurntableParams>[] = [
  {
    id: 'turntable-friction-flip',
    name: '1. 水平圆盘双物块连线：A 静摩擦反向临界 (ω₁ < ω < ω₃)',
    description: 'B 在外侧先达到最大静摩擦并拉紧轻绳，随 ω 增大 A 的静摩擦减小至零后反向指外。',
    params: { mode: 'turntable-dual', omega: 2.2, massA: 1, massB: 2, radiusA: 0.6, radiusB: 1.5, mu: 0.3, pendulumLength: 1.5 }
  },
  {
    id: 'turntable-breakout',
    name: '2. 超过极限角速度 ω₃ 整体离心滑出',
    description: '当 ω > ω₃ 时，A 与 B 最大静摩擦之和不足以提供向心力，两物块同步向外径向滑动。',
    params: { mode: 'turntable-dual', omega: 3.2, massA: 1, massB: 2, radiusA: 0.6, radiusB: 1.5, mu: 0.3, pendulumLength: 1.5 }
  },
  {
    id: 'conical-pendulum-steady',
    name: '3. 圆锥摆定态张力与周期关系 (ω = √(g / L cosθ))',
    description: '改变转动角速度观察摆线张开半顶角 θ 与拉力变化规律。',
    params: { mode: 'conical-pendulum', omega: 3.6, massA: 1, massB: 1, radiusA: 0.6, radiusB: 1.5, mu: 0.3, pendulumLength: 1.5 }
  }
];
