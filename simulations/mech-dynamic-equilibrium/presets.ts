import type { PresetSpec } from '@physforge/sim-sdk';
import type { EquilibriumParams } from './engine.js';

export const equilibriumPresets: readonly PresetSpec<EquilibriumParams>[] = [
  {
    id: 'dead-knot-triangle',
    name: '1. 死结旋转拉起：矢量三角形与极小拉力 (F₂⊥F₁)',
    description: '固定左绳与竖直成 α=37°，连续改变右绳仰角 β，直观看到右绳与左绳垂直时拉力最小 F_min = mg sinα。',
    params: {
      mode: 'dead-knot-rotate',
      mass: 2.0,
      baseAngleDeg: 37,
      sweepAngleDeg: 37,
      autoSweep: true
    }
  },
  {
    id: 'active-pulley-symmetry',
    name: '2. 活结轻滑轮等张力律 (T₁ ≡ T₂)',
    description: '光滑轻滑轮在绳上自由滑动，两侧张力始终严格相等且 T = mg / (2 sinθ)。',
    params: {
      mode: 'active-pulley-knot',
      mass: 2.0,
      baseAngleDeg: 30,
      sweepAngleDeg: 45,
      autoSweep: true
    }
  },
  {
    id: 'similar-triangle-support',
    name: '3. 光滑斜面与水平拉力',
    description: '改变法线与竖直的夹角，观察 N=mg/cosθ 与 F=mg tanθ；保留原预设标识。',
    params: {
      mode: 'hemisphere-similar',
      mass: 2.0,
      baseAngleDeg: 30,
      sweepAngleDeg: 30,
      autoSweep: true
    }
  }
  ,{id:'hemisphere-suspended-rope',name:'4. 光滑半球悬绳：相似三角形',description:'固定悬点与球心，改变接触点；支持力不变，绳张力随绳长变化。',params:{mode:'hemisphere-suspension',mass:2,baseAngleDeg:37,sweepAngleDeg:35,radiusM:1,anchorHeightM:.6,autoSweep:true}}
  ,{id:'hinged-rod-compression-tension',name:'5. 动杆：二力杆受压与受拉',description:'两端理想铰接；改变绳方向，观察杆轴力正负和垂直时的最小张力。',params:{mode:'hinged-rod',mass:2,baseAngleDeg:30,sweepAngleDeg:60,rodLengthM:1.2,autoSweep:true}}
  ,{id:'fixed-rod-support-moment',name:'6. 定杆：任意方向支承力与力矩',description:'固定支座同时提供合力和力矩；绳张力为指定量，杆端受力不必沿杆。',params:{mode:'fixed-rod',mass:2,baseAngleDeg:30,sweepAngleDeg:60,rodLengthM:1.2,pullForceN:8,autoSweep:true}}
];
