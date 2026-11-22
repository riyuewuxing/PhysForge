import type { PresetSpec } from '@physforge/sim-sdk';
import type { VerticalCircularParams } from './engine.js';

export const verticalCircularPresets: readonly PresetSpec<VerticalCircularParams>[] = [
  {
    id: 'smooth-dome-derail',
    name: '1. 光滑半球面微扰下滑脱轨 (cosθ_d = 2/3)',
    description: '质点从半球顶点附近静止微扰下滑，精准在 θ_d = arccos(2/3) ≈ 48.19° 处支持力归零脱轨做平抛。',
    params: { trackMode: 'outer-dome', mass: 1.0, radius: 1.6, vLaunch: 0.01, startAngleDeg: 0.5 }
  },
  {
    id: 'inner-loop-subcritical',
    name: '2. 竖直内圆轨道中途脱轨 (v₀ < √5gR)',
    description: '底部初速不足以过最高点，质点上升过圆心等高线后在压力 FN = 0 处脱离转为斜抛运动。',
    params: { trackMode: 'inner-loop', mass: 1.0, radius: 1.4, vLaunch: 6.8, startAngleDeg: 0 }
  },
  {
    id: 'light-rod-full-loop',
    name: '3. 轻杆双边约束零速过最高点 (T 可压可拉)',
    description: '切换为轻杆模型后约束力可双向变号，最低点初速只需 ≥ √(4gR) 即可完成完整圆周。',
    params: { trackMode: 'light-rod', mass: 1.0, radius: 1.4, vLaunch: 7.6, startAngleDeg: 0 }
  }
];
