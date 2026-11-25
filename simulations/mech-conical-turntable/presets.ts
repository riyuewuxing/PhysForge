import type { PresetSpec } from '@physforge/sim-sdk';
import type { ConicalTurntableParams } from './engine.js';

export const conicalTurntablePresets: readonly PresetSpec<ConicalTurntableParams>[] = [
  {
    id: 'turntable-friction-flip',
    name: '1. 圆盘 A 静摩擦反向（仍共转）',
    description: 'B 在外侧先达到最大静摩擦并拉紧轻绳，随 ω 增大 A 的静摩擦减小至零后反向指外。',
    params: { mode: 'turntable-dual', omega: 1.7, massA: 1, massB: 2, radiusA: 0.6, radiusB: 1.5, mu: 0.3, pendulumLength: 1.5 }
  },
  {
    id: 'turntable-breakout',
    name: '2. 超过极限角速度 ω₃：真实二维滑移',
    description: '当 ω > ω₃ 时不存在共同可行张力；在地面惯性系中沿真实绳长约束滑移，到盘边或松绳边界停止。',
    params: { mode: 'turntable-dual', omega: 3.2, massA: 1, massB: 2, radiusA: 0.6, radiusB: 1.5, mu: 0.3, pendulumLength: 1.5 }
  },
  {
    id: 'conical-pendulum-steady',
    name: '3. 圆锥摆定态张力与周期关系 (ω = √(g / L cosθ))',
    description: '改变转动角速度观察摆线张开半顶角 θ 与拉力变化规律。',
    params: { mode: 'conical-pendulum', omega: 3.6, massA: 1, massB: 1, radiusA: 0.6, radiusB: 1.5, mu: 0.3, pendulumLength: 1.5 }
  },
  {id:'turntable-a-dominant',name:'4. A 质量半径乘积主导（B 反向）',description:'D<0，另一物块 B 的静摩擦反号。两块各自的摩擦边界共同决定可行张力。',params:{mode:'turntable-dual',omega:1.72,massA:5,massB:.5,radiusA:1.2,radiusB:1.5,mu:.3,pendulumLength:1.5}},
  {id:'turntable-balanced',name:'5. mA rA=mB rB：无有限滑移临界',description:'D=0，绳张力可提供共同的向心力需求，不存在有限 ω₃。',params:{mode:'turntable-dual',omega:4,massA:2.5,massB:1,radiusA:.6,radiusB:1.5,mu:.3,pendulumLength:1.5}},
  {id:'conical-pendulum-rest',name:'6. 圆锥摆竖直静止支',description:'Ω≤√(g/L) 无非零半径定态圆锥摆；不显示虚构运动周期。',params:{mode:'conical-pendulum',omega:1,massA:1,massB:1,radiusA:.6,radiusB:1.5,mu:.3,pendulumLength:1.5}}
];
