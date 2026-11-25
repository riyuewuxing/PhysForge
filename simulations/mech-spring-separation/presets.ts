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
    name: '2. 30° 光滑斜面上并排接触双块',
    description: '此参数下在原长 s=0 处真正分离，随后重力可使两块再次相遇；碰撞前停止。',
    params: { mass1: 1.0, mass2: 2.0, springK: 40, inclineDeg: 30, initialComp: 1.2, externalForce: 0 }
  },
  {
    id: 'external-pull-early-sep',
    name: '3. 施加恒定拉力提前分离（压缩区尚未回原长即脱开）',
    description: '对 m2 施加向右恒力 F=12 N，两物块在弹簧仍处于压缩状态时提前满足 F_N = 0 分离。',
    params: { mass1: 1.0, mass2: 2.0, springK: 30, inclineDeg: 0, initialComp: 1.0, externalForce: 12 }
  },
  {id:'spring-recontact',name:'4. 斜面分离后首次再接触',description:'先在原长处分离，随后 m₂ 回落追上 m₁，碰撞前精确冻结。',params:{mass1:1,mass2:2,springK:30,inclineDeg:30,initialComp:1.2,externalForce:0}},
  {id:'spring-zero-tangent',name:'5. 原长处零力转折（不分离）',description:'初始压缩 0.98m，恰好到原长时速度与接触力均为零，随后共同折返。',params:{mass1:1,mass2:2,springK:30,inclineDeg:30,initialComp:.98,externalForce:0}},
  {id:'spring-initial-release',name:'6. 初始接触不可行（立即分离）',description:'所需接触力为负；不产生虚假吸引力，t=0 记录事件。',params:{mass1:1,mass2:2,springK:30,inclineDeg:30,initialComp:.4,externalForce:30}}
];
