import type { PresetSpec } from '@physforge/sim-sdk';
import type { EddyVortexParams } from './engine.js';

export const eddyVortexPresets: readonly PresetSpec<EddyVortexParams>[] = [
  {
    id: 'betatron-vortex-acceleration',
    name: '柱对称涡旋电场与带正电试探粒子',
    description: '圆柱区域内磁感应强度线性增强，激发环形闭合感生电场，验证 ∮E·dl = -dΦ/dt',
    curriculumNotes: '选择性必修二 第二章 · 感生电场与感生电场与试探粒子',
    params: {
      mode: 'betatron-vortex',
      cylinderRadiusR: 1.2,
      bDotRate: 1.5,
      bField0: 1.0,
      particleChargeRatio: 1.6,
      particleInitRadius: 0.9,
      pendulumLengthL: 1.0,
      solidDampingGamma: 2.2,
      slottedDampingGamma: 0.08,
      initialAngleDeg: 35
    }
  },
  {
    id: 'eddy-solid-vs-slotted-pendulum',
    name: '电磁阻尼双摆对照（整块铜板 vs 开槽铜板）',
    description: '同期释放，相同初态和摆长，整块板与开槽板采用不同等效阻尼率，分别记录机械能和耗散热',
    curriculumNotes: '选择性必修二 第二章 · 涡流与电磁阻尼演示',
    params: {
      mode: 'eddy-damping-compare',
      cylinderRadiusR: 1.0,
      bDotRate: 0,
      bField0: 1.5,
      particleChargeRatio: 1.0,
      particleInitRadius: 0.8,
      pendulumLengthL: 1.0,
      solidDampingGamma: 2.4,
      slottedDampingGamma: 0.06,
      initialAngleDeg: 35
    }
  },
  {
    id: 'outer-region-1overr-decay',
    name: '柱外 r > R 区域涡旋电场 1/r 衰减检验',
    description: '将试探轨道拖出磁场区 r > R，场区外 B=0 仍有环向感生电场驱动偏转',
    curriculumNotes: '选择性必修二 · 磁场边界外感生电场',
    params: {
      mode: 'betatron-vortex',
      cylinderRadiusR: 0.8,
      bDotRate: 2.0,
      bField0: 0.5,
      particleChargeRatio: 1.2,
      particleInitRadius: 1.25,
      pendulumLengthL: 1.0,
      solidDampingGamma: 2.2,
      slottedDampingGamma: 0.08,
      initialAngleDeg: 35
    }
  },
  {id:'vortex-negative-charge',name:'负荷质比 · 感生功与运动方向',description:'有向荷质比为负的示教试探粒子，不等同真实电子荷质比。',curriculumNotes:'选择性必修二 · 电磁力方向',
    params:{mode:'betatron-vortex',cylinderRadiusR:1.2,bDotRate:1.5,bField0:1,particleChargeRatio:-1.6,particleInitRadius:.9}},
  {id:'vortex-neutral-crossing',name:'中性粒子 · 精确磁区几何出界',description:'η=0，粒子匀速，精确记录首次穿越柱边界。',curriculumNotes:'选择性必修二 · 临界事件',
    params:{mode:'betatron-vortex',cylinderRadiusR:1.2,bDotRate:0,bField0:1,particleChargeRatio:0,particleInitRadius:.6}},
  {id:'vortex-zero-ramp',name:'B 不变 · 只有磁力的回旋',description:'dB/dt=0，感生场为零，纯磁力不做功。',curriculumNotes:'选择性必修二 · 洛伦兹力',
    params:{mode:'betatron-vortex',cylinderRadiusR:1.8,bDotRate:0,bField0:2,particleChargeRatio:1,particleInitRadius:.3}},
  {id:'eddy-zero-damping',name:'零阻尼 · 两摆完全重合的能量对照',description:'两摆无阻尼，单位质量机械能守恒，无耗散热。',curriculumNotes:'选择性必修二 · 对照实验',
    params:{mode:'eddy-damping-compare',pendulumLengthL:1,solidDampingGamma:0,slottedDampingGamma:0,initialAngleDeg:35}}
];
