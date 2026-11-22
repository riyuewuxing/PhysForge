import type { PresetSpec } from '@physforge/sim-sdk';
import type { AcScopeParams } from './engine.js';

export const acScopePresets: readonly PresetSpec<AcScopeParams>[] = [
  {
    id: 'square-wave-four-phases',
    name: '方波交变电场四相位粒子群对比 (t₀=0, T/8, T/4, 3T/8)',
    description: 't₀=0 单向一直加速，t₀=T/4 往复对称一周期净位移精确回零',
    curriculumNotes: '必修三 第十章 · 交变电场带电粒子运动',
    params: {
      mode: 'ac-square-wave',
      periodT: 2.0,
      accelA0: 4.0,
      uAccelV: 1200,
      uXMaxV: 120,
      uYMaxV: 120,
      freqRatioYOverX: 2,
      phaseDeltaDeg: 90,
      eqFieldAccelX: 9.8,
      eqFieldAccelY: 0,
      pendulumLengthL: 1.0,
      initialAngleDeg: 10
    }
  },
  {
    id: 'oscilloscope-lissajous-2to1',
    name: '示波管余辉扫描与 2:1 李萨如图形',
    description: '调节频率比 fy/fx 与初相角 δ，观察荧光屏电子束余辉轨迹与偏转原理',
    curriculumNotes: '必修三 · 示波管拓展应用',
    params: {
      mode: 'oscilloscope-lissajous',
      periodT: 1.6,
      accelA0: 4.0,
      uAccelV: 1200,
      uXMaxV: 110,
      uYMaxV: 110,
      freqRatioYOverX: 2,
      phaseDeltaDeg: 90,
      eqFieldAccelX: 9.8,
      eqFieldAccelY: 0,
      pendulumLengthL: 1.0,
      initialAngleDeg: 10
    }
  },
  {
    id: 'equivalent-gravity-tilted',
    name: '等效重力场单摆（45° 等效最低点与最高点）',
    description: '水平电场力 qE=mg 使等效重力偏转 45°，展示等效平衡轴及 Auto-FBD 受力分解',
    curriculumNotes: '必修三 · 复合场等效重力模型',
    params: {
      mode: 'equivalent-gravity',
      periodT: 2.0,
      accelA0: 4.0,
      uAccelV: 1200,
      uXMaxV: 110,
      uYMaxV: 110,
      freqRatioYOverX: 1,
      phaseDeltaDeg: 90,
      eqFieldAccelX: 9.8,
      eqFieldAccelY: 0,
      pendulumLengthL: 1.2,
      initialAngleDeg: -10
    }
  },
  {
    id: 'sine-wave-acceleration',
    name: '正弦交变电场同步对比',
    description: '对比平滑正弦交变电场中不同入场相位粒子的加速度连续演化',
    curriculumNotes: '必修三 · 正弦交变电场分析',
    params: {
      mode: 'ac-sine-wave',
      periodT: 2.0,
      accelA0: 5.0,
      uAccelV: 1200,
      uXMaxV: 110,
      uYMaxV: 110,
      freqRatioYOverX: 1.5,
      phaseDeltaDeg: 45,
      eqFieldAccelX: 9.8,
      eqFieldAccelY: 0,
      pendulumLengthL: 1.0,
      initialAngleDeg: 10
    }
  }
];
