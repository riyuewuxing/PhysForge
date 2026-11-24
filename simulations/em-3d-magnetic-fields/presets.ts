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
    description: '粒子斜射入匀强磁场做等螺距圆锥/圆柱螺旋运动，Boris 辛旋转能量严格无漂移',
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
  }
];
