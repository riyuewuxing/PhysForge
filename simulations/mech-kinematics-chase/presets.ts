import type { PresetSpec } from '@physforge/sim-sdk';
import type { KinematicsChaseParams } from './engine.js';

export const kinematicsChasePresets: readonly PresetSpec<KinematicsChaseParams>[] = [
  {
    id: 'brake-safe-margin',
    name: '1. 匀加速追及前方匀速车（共速不撞临界）',
    description: 'B 车在前匀速，A 车从静止出发经反应后匀加速或减速，观察共速时刻最小间距。',
    params: {
      scenario: 'brake-collision-avoid',
      vA0: 20,
      aA: -4,
      reactionTime: 0.4,
      xB0: 42,
      vB0: 6,
      aB: 0
    }
  },
  {
    id: 'catchup-acceleration',
    name: '2. 静止加速追及匀速目标 (Δx极大值与相遇)',
    description: 'A 车初速度 0、a=2 m/s² 追赶前方 16 m 处匀速 8 m/s 的 B 车，精确捕获共速 t=4s 与相遇 t=8s。',
    params: {
      scenario: 'accelerate-chase',
      vA0: 0,
      aA: 2,
      reactionTime: 0,
      xB0: 16,
      vB0: 8,
      aB: 0
    }
  },
  {
    id: 'both-braking-lock',
    name: '3. 同向双车紧急刹车（单向零速锁止）',
    description: '两车均全力刹车，先停稳的车锁止为 v=0 不倒车，对比停止前后的 x-t 与 v-t 图像。',
    params: {
      scenario: 'two-stage-overtake',
      vA0: 24,
      aA: -6,
      reactionTime: 0.5,
      xB0: 35,
      vB0: 14,
      aB: -4
    }
  }
];
