import type { PresetSpec } from '@physforge/sim-sdk';
import type { ElectrostaticParams } from './engine.js';

export const electrostaticPresets: readonly PresetSpec<ElectrostaticParams>[] = [
  {
    id: 'dipole-opposite-charges',
    name: '等量异种点电荷电场线与等势面',
    description: '观察电势与电场线方向；软化场模型，等势线数值近似，试探粒子沿 RK45 轨迹偏转',
    curriculumNotes: '必修三 第九、十章 · 点电荷叠加场',
    params: {
      mode: 'dipole-point-charges',
      q1MicroC: 3,
      q2MicroC: -3,
      x1: -1.2,
      x2: 1.2,
      testChargeRatio: 0.4,
      v0x: 2.2,
      v0y: 0.2,
      startY: 0.9,
      uAccelV: 10,
      uDeflectV: 6,
      phiA: 0,
      phiB: 4,
      phiC: 12
    }
  },
  {
    id: 'equal-same-sign-charges',
    name: '等量同种正电荷（中心对称零场强点）',
    description: '观察两正电荷连线中点 E=0 鞍点及中垂线电势分布曲线',
    curriculumNotes: '必修三 · 等量同种点电荷场特征',
    params: {
      mode: 'dipole-point-charges',
      q1MicroC: 3,
      q2MicroC: 3,
      x1: -1.2,
      x2: 1.2,
      testChargeRatio: -0.4,
      v0x: 2.0,
      v0y: -0.3,
      startY: 1.0,
      uAccelV: 10,
      uDeflectV: 6,
      phiA: 0,
      phiB: 4,
      phiC: 12
    }
  },
  {
    id: 'uniform-three-point-trisection',
    name: '匀强电场“三点等分法”电势定方向',
    description: '给定 A、B、C 三点电势（如 0V, 4V, 12V），几何等分找等势线并作垂线得 E',
    curriculumNotes: '必修三 · 高考高频三点等分法',
    params: {
      mode: 'uniform-three-point',
      q1MicroC: 2,
      q2MicroC: -2,
      x1: -1.2,
      x2: 1.2,
      testChargeRatio: 0.3,
      v0x: 1.0,
      v0y: 0,
      startY: 0.5,
      uAccelV: 10,
      uDeflectV: 6,
      phiA: 0,
      phiB: 4,
      phiC: 12
    }
  },
  {
    id: 'deflection-capacitor-tube',
    name: '带电粒子先经 U₁ 加速后在 U₂ 偏转极板偏转',
    description: '未触板时验证有向偏转公式；加速区已完成，忽略边缘场，出入板与触板精确定位',
    curriculumNotes: '必修三 · 带电粒子在匀强电场中的偏转',
    params: {
      mode: 'deflection-tube',
      q1MicroC: 0,
      q2MicroC: 0,
      x1: -1.2,
      x2: 1.2,
      testChargeRatio: 1.0,
      v0x: 4,
      v0y: 0,
      startY: 0,
      uAccelV: 16,
      uDeflectV: 8,
      phiA: 0,
      phiB: 4,
      phiC: 12
    }
  },
  {id:'uniform-reordered-potential',name:'三点电势换序 · 中值点不再是 B',description:'A=4V, B=12V, C=0V；按电势顺序构造真实等势线。',curriculumNotes:'必修三 · 等势线',
   params:{mode:'uniform-three-point',phiA:4,phiB:12,phiC:0,testChargeRatio:.3,v0x:1,v0y:0,startY:.5}},
  {id:'uniform-equal-potential',name:'三点等势 · E=0',description:'全平面等势，不构造唯一等势线。',curriculumNotes:'必修三 · 电势与电场',
   params:{mode:'uniform-three-point',phiA:4,phiB:4,phiC:4,testChargeRatio:.3,v0x:1,v0y:0,startY:.5}},
  {id:'deflection-plate-contact',name:'偏转过大 · 首次触板停止',description:'低加速电压、大偏转电压；精确触板，不再给出不存在的出射位移。',curriculumNotes:'必修三 · 临界运动',
   params:{mode:'deflection-tube',testChargeRatio:2,uAccelV:4,uDeflectV:16}},
  {id:'deflection-negative-charge',name:'负电荷 · 反向偏转',description:'在相同极板电压下负电荷向反方向运动。',curriculumNotes:'必修三 · 电场力方向',
   params:{mode:'deflection-tube',testChargeRatio:-1,uAccelV:16,uDeflectV:8}},
  {id:'deflection-neutral',name:'零荷质比 · 不产生加速初速',description:'中性粒子在加速区从静止出发时仍静止。',curriculumNotes:'必修三 · 模型边界',
   params:{mode:'deflection-tube',testChargeRatio:0,uAccelV:16,uDeflectV:8}}
];
