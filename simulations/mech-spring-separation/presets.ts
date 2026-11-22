import type { PresetSpec } from '@physforge/sim-sdk';
import type { SpringSepParams } from './engine.js';

export const springSepPresets: readonly PresetSpec<SpringSepParams>[] = [
  {
    id: 'horizontal-natural-length-sep',
    name: '1. 水平弹簧双物块无外力分离（原长处 F_N = 0）',
    description: '压缩轻弹簧释放，两物块共同加速至弹簧原长 s=0 处相互作用弹力降为零精准分离。',
    params: { mass1: 1.0, mass2: 2.0, springK: 30, inclineDeg: 0, initialComp: 1.0, externalForce: 0 }
  },
  {
    id: 'incline-spring-sep',
    name: '2. 30° 光滑斜面上叠放双物块释放分离',
    description: '斜面上两物块自由释放时仍在原长 s=0 处分离，对比斜面与水平面加速度曲线变化。',
    params: { mass1: 1.0, mass2: 2.0, springK: 40, inclineDeg: 30, initialComp: 1.2, externalForce: 0 }
  },
  {
    id: 'external-pull-early-sep',
    name: '3. 施加恒定拉力提前分离（压缩区尚未回原长即脱开）',
    description: '对 m2 施加向右恒力 F=12 N，两物块在弹簧仍处于压缩状态时提前满足 F_N = 0 分离。',
    params: { mass1: 1.0, mass2: 2.0, springK: 30, inclineDeg: 0, initialComp: 1.0, externalForce: 12 }
  }
];
