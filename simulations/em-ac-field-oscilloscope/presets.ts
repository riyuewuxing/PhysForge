import type { PresetSpec } from '@physforge/sim-sdk';
import type { AcScopeParams } from './engine.js';

export const acScopePresets: readonly PresetSpec<AcScopeParams>[] = [
  {
    id: 'square-wave-four-phases',
    name: '方波交变电场四相位粒子群对比 (t₀=0, T/8, T/4, 3T/8)',
    description: 't₀=0 单向前进但加速度周期反向，t₀=T/4 往复对称一周期净位移精确回零',
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
    name: '等效重力场刚性杆摆（45° 等效高低点）',
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
  },
  {id:'crt-plate-contact',name:'低加速电压 · 偏转触板断光',description:'初相 Y 板触板，屏幕无实际亮点。',curriculumNotes:'必修三 · 临界事件',
   params:{mode:'oscilloscope-lissajous',periodT:1.6,uAccelV:400,uXMaxV:110,uYMaxV:200,freqRatioYOverX:2,phaseDeltaDeg:90}},
  {id:'crt-screen-miss',name:'两轴均出板 · 超出圆形屏幕',description:'145V 双轴同相，四分之一周期时两轴可出板但超出6cm屏幕。',curriculumNotes:'必修三 · 复合偏转',
   params:{mode:'oscilloscope-lissajous',periodT:1.6,uAccelV:1200,uXMaxV:145,uYMaxV:145,freqRatioYOverX:1,phaseDeltaDeg:0}},
  {id:'crt-no-acceleration',name:'零加速电压 · 无电子束',description:'无加速后的入射束，不给出虚构屏点。',curriculumNotes:'必修三 · 模型边界',
   params:{mode:'oscilloscope-lissajous',periodT:1.6,uAccelV:0,uXMaxV:110,uYMaxV:110,freqRatioYOverX:2,phaseDeltaDeg:90}},
  {id:'equivalent-gravity-zero',name:'电场力抵消重力 · 无等效高低点',description:'qE/m=(0,g)，刚性杆摆从静止保持静止。',curriculumNotes:'必修三 · 复合场',
   params:{mode:'equivalent-gravity',eqFieldAccelX:0,eqFieldAccelY:9.8,pendulumLengthL:1.2,initialAngleDeg:35}},
  {id:'equivalent-rod-compression',name:'等效重力向上 · 刚性杆受压',description:'杆端位于支点正下方，向上的合场加速度使杆必须提供向下压力。',curriculumNotes:'必修三 · 约束力',
   params:{mode:'equivalent-gravity',eqFieldAccelX:0,eqFieldAccelY:12,pendulumLengthL:1.2,initialAngleDeg:0}}
];
