import type { PresetSpec } from '@physforge/sim-sdk';
import type { ElectrostaticParams } from './engine.js';

export const electrostaticPresets: readonly PresetSpec<ElectrostaticParams>[] = [
  {
    id: 'dipole-opposite-charges',
    name: '等量异种点电荷电场线与等势面',
    description: '直观展现两极等势面与双向 RK4 电场线严格正交（<1°），试探粒子沿 RK45 轨迹偏转',
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
    description: '验证偏转位移 y = U₂ L²/(4 d U₁) 与类平抛运动末速度反向延长线交点定理',
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
  }
];
