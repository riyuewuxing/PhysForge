import type { PresetSpec } from '@physforge/sim-sdk';
import type { CustomOdeParams } from './engine.js';

export const customOdePresets: readonly PresetSpec<CustomOdeParams>[] = [
  {
    id: 'harmonic-undamped',
    name: '1. 无阻尼简谐振子 (RK4 守恒验证)',
    description: 'k = 16 N/m, m = 1 kg 的标准简谐振子，对比相空间闭合圆与机械能守恒。',
    params: {
      template: 'harmonic-custom',
      mass: 1.0,
      stiffness: 16,
      damping: 0,
      driveAmp: 0,
      initialPos: 1.5,
      initialVel: 0
    }
  },
  {
    id: 'nonlinear-duffing-expr',
    name: '2. 自定义 Duffing 非线性恢复力方程 (Safe AST)',
    description: '使用白名单 AST 安全沙箱直接求解 a = -(k*x + 2*x^3)/m + A*cos(w*t)。',
    params: {
      template: 'custom-expr',
      exprText: '-(k * x + 2 * x^3) / m - gamma * v + A * cos(w * t)',
      mass: 1.0,
      stiffness: 8,
      damping: 0.12,
      driveAmp: 2.2,
      driveOmega: 2.8,
      initialPos: 1.0,
      initialVel: 0
    }
  },
  {
    id: 'kepler-elliptical-orbit',
    name: '3. 开普勒二维中心引力椭圆轨道 (VelocityVerlet)',
    description: '辛积分演化 r² 平方反比引力场，保持机械能与开普勒第二定律角动量高度守恒。',
    params: {
      template: 'kepler-2d',
      stiffness: 6.0,
      initialPos: 1.4,
      initialVel: 1.7
    }
  },
  {
    id: 'lagrangian-driven-pendulum',
    name: '4. 拉格朗日受驱非线性单摆',
    description: '大角受迫阻尼摆方程 θ̈ = -(g/L)sinθ - γθ̇ + A cos(ωt)。',
    params: {
      template: 'lagrangian-pendulum',
      stiffness: 10,
      damping: 0.15,
      driveAmp: 1.2,
      driveOmega: 2.5,
      initialPos: 1.1,
      initialVel: 0
    }
  }
];
