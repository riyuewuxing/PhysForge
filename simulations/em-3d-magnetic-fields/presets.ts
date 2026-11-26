import type { PresetSpec } from '@physforge/sim-sdk';
import type { Magnetic3dParams } from './engine.js';

export const magnetic3dPresets: readonly PresetSpec<Magnetic3dParams>[] = [
  {
    id: 'helmholtz-uniform-core-3d',
    name: '亥姆霍兹双线圈 3D 磁感线与匀强中心区',
    description: '等距双线圈叠加生成中心匀强磁场，3D Boris 粒子呈螺旋聚焦轨迹并展示左手定则三轴',
    curriculumNotes: '选择性必修二 第一章 · 亥姆霍兹线圈与 3D 磁场',
    params: {
      geometryType: 'helmholtz-coil',
      currentI: 2.0,
      radiusR: 1.0,
      solenoidTurns: 10,
      qOverM: 1.5,
      vPerp: 1.2,
      vParallel: 0.7,
      uniformBz: 2.0
    }
  },
  {
    id: 'single-loop-biot-savart',
    name: '单匝环形电流安培定则（右手螺旋 3D 磁感线）',
    description: '环形电流周围磁感线呈闭合环穿出，轴线磁感应强度严格符合 μ₀IR²/[2(R²+z²)^(3/2)]',
    curriculumNotes: '必修三 第十三章 · 安培定则与毕奥-萨伐尔定律',
    params: {
      geometryType: 'single-loop',
      currentI: 2.5,
      radiusR: 1.0,
      solenoidTurns: 10,
      qOverM: 1.2,
      vPerp: 1.0,
      vParallel: 0.8,
      uniformBz: 2.0
    }
  },
  {
    id: 'finite-solenoid-3d',
    name: '有限长通电螺线管空间 3D 磁感应线',
    description: '内部近似匀强、两端发散弯曲，对比展示螺线管极性与边缘磁感应强度衰减',
    curriculumNotes: '必修三 · 通电螺线管磁场',
    params: {
      geometryType: 'finite-solenoid',
      currentI: 2.0,
      radiusR: 0.7,
      solenoidTurns: 10,
      qOverM: 1.5,
      vPerp: 0.8,
      vParallel: 0.9,
      uniformBz: 2.0
    }
  },
  {
    id: 'uniform-3d-helical-pitch',
    name: '3D 匀强磁场斜射等距螺旋线（螺距 p=v∥·T）',
    description: '粒子斜射入匀强磁场做等螺距圆柱螺旋运动，Boris 辛旋转能量严格无漂移',
    curriculumNotes: '选择性必修二 第一章 · 洛伦兹力空间螺旋运动',
    params: {
      geometryType: 'uniform-helix',
      currentI: 2.0,
      radiusR: 1.0,
      solenoidTurns: 10,
      qOverM: 1.0,
      vPerp: 1.5,
      vParallel: 1.0,
      uniformBz: 2.0
    }
  },
  {id:'uniform-negative-charge',name:'负电荷 · 反向回旋',description:'Bz=4 T，q/m=-4 C/kg，观察反向回旋及轴向速度。',curriculumNotes:'有向洛伦兹力',params:{geometryType:'uniform-helix',uniformBz:4,qOverM:-4,vPerp:2.4,vParallel:-.7}},
  {id:'uniform-negative-field',name:'反向磁场 · 正电荷',description:'Bz=-4 T，正电荷与负电荷正磁场旋向相同。',curriculumNotes:'有向磁场',params:{geometryType:'uniform-helix',uniformBz:-4,qOverM:4,vPerp:2.4,vParallel:-.7}},
  {id:'uniform-zero-field',name:'零磁场 · 匀速直线',description:'Bz=0，不存在实际磁回旋。',curriculumNotes:'磁场边界',params:{geometryType:'uniform-helix',uniformBz:0,qOverM:1,vPerp:1.5,vParallel:1}},
  {id:'uniform-parallel-only',name:'沿轴向入射 · 无洛伦兹力',description:'v⊥=0，沿轴向匀速。',curriculumNotes:'洛伦兹力方向',params:{geometryType:'uniform-helix',uniformBz:2,qOverM:1,vPerp:0,vParallel:1}},
  {id:'finite-wire-reverse',name:'有限直导线 · 反向电流',description:'有向电流为负，磁感线旋向反转。',curriculumNotes:'安培定则',params:{geometryType:'straight-wire',currentI:-2.5,radiusR:1,qOverM:1.2,vPerp:1,vParallel:.5}}
];
