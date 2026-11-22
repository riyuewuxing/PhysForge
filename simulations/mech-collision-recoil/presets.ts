import type { PresetSpec } from '@physforge/sim-sdk';
import type { CollisionRecoilParams } from './engine.js';

export const collisionRecoilPresets: readonly PresetSpec<CollisionRecoilParams>[] = [
  {
    id: 'oblique-equal-mass-elastic',
    name: '等质量二维弹性斜碰（垂直分离 90°）',
    description: 'm₁=m₂，e=1 弹性正交验证，拖动绿色瞄准靶点调节瞄准距 b',
    curriculumNotes: '选择性必修一 · 二维弹性斜碰',
    params: {
      mode: 'collision-2d-oblique',
      mass1: 2,
      mass2: 2,
      v10: 4,
      v20: 0,
      restitutionE: 1,
      impactParamB: 0.36,
      radius1: 0.3,
      radius2: 0.3,
      dragForceF: 8,
      blockLength: 2
    }
  },
  {
    id: 'elastic-1d-heavy-hits-light',
    name: '一维大碰小 / 动碰静恢复系数 e',
    description: '可自由调节恢复系数 e∈[0,1]，定量对比动能损失与动量守恒',
    curriculumNotes: '选择性必修一 · 弹性与非弹性碰撞',
    params: {
      mode: 'collision-1d',
      mass1: 4,
      mass2: 1,
      v10: 3,
      v20: 0,
      restitutionE: 1,
      impactParamB: 0,
      radius1: 0.35,
      radius2: 0.25,
      dragForceF: 8,
      blockLength: 2
    }
  },
  {
    id: 'bullet-hits-block',
    name: '子弹打木块（共速与内力生热 Q=f·d）',
    description: '精确捕获入靶与共速突变时刻，验证系统摩擦生热与动能损失相等',
    curriculumNotes: '选择性必修一 · 压轴专题',
    params: {
      mode: 'bullet-block',
      mass1: 0.5,
      mass2: 2,
      v10: 8,
      v20: 0,
      restitutionE: 0,
      impactParamB: 0,
      radius1: 0.14,
      radius2: 0.35,
      dragForceF: 10,
      blockLength: 1.8
    }
  },
  {
    id: 'boat-person-recoil',
    name: '人船反冲（质心位置严格恒定）',
    description: '总动量恒为零，观察人走船退时红色质心轴线与位移反比关系',
    curriculumNotes: '选择性必修一 · 反冲运动',
    params: {
      mode: 'boat-recoil',
      mass1: 1,
      mass2: 3,
      v10: 2,
      v20: 0,
      restitutionE: 0,
      impactParamB: 0,
      radius1: 0.25,
      radius2: 0.35,
      dragForceF: 8,
      blockLength: 3
    }
  }
];
