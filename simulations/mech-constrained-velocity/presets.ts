import type { PresetSpec } from '@physforge/sim-sdk';
import type { ConstrainedVelocityParams } from './engine.js';

export const constrainedVelocityPresets: readonly PresetSpec<ConstrainedVelocityParams>[] = [
  {
    id: 'boat-dock-winch',
    name: '1. 河岸定滑轮收绳拉船（变加速靠岸）',
    description: '岸边以恒定速率收绳 v_rope，船沿水平面实际速度 v_boat = v_rope / cosθ 不断增大。',
    params: { mode: 'rope-pull-boat', driveSpeed: 1.5, heightOrLength: 1.8, initialAngleDeg: 25 }
  },
  {
    id: 'ladder-sliding-wall',
    name: '2. 靠墙直杆两端关联下滑',
    description: '杆上端匀速下滑 v_A 时，下端沿地面滑动速率满足 v_B = v_A tanθ。',
    params: { mode: 'ladder-wall', driveSpeed: 1.0, heightOrLength: 3.0, initialAngleDeg: 55 }
  },
  {
    id: 'wedge-vertical-rod',
    name: '3. 倾斜劈面推竖直轻杆（法向速度相等）',
    description: '斜面以 v_1 右推，两接触点垂直斜面的法向速度分矢量严格相等，得到 v_2 = v_1 tanα。',
    params: { mode: 'wedge-rod', driveSpeed: 2.0, heightOrLength: 2.0, initialAngleDeg: 37 }
  }
];
