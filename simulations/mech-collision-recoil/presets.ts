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
    description: '峰值相对速度给定，sin² 平滑起止；总水平动量恒为零，质心位置固定',
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
  },
  {id:'oblique-miss',name:'未命中：b 大于两球半径和',description:'真实瞄准距 .66m，半径和 .60m；全程无碰撞冲量。',params:{mode:'collision-2d-oblique',mass1:2,mass2:2,v10:4,v20:0,restitutionE:1,impactParamB:.66,radius1:.3,radius2:.3,dragForceF:8,blockLength:2}},
  {id:'oblique-grazing',name:'精确擦边：b 等于两球半径和',description:'接触瞬间法向相对速度为零，不产生碰撞冲量。',params:{mode:'collision-2d-oblique',mass1:2,mass2:2,v10:4,v20:0,restitutionE:1,impactParamB:.6,radius1:.3,radius2:.3,dragForceF:8,blockLength:2}},
  {id:'bullet-exit',name:'理想质点先穿出木块',description:'先穿出而非共速，穿行阶段末阻力撤除，Q=f d。',params:{mode:'bullet-block',mass1:.5,mass2:2,v10:8,v20:0,restitutionE:0,impactParamB:0,radius1:.14,radius2:.35,dragForceF:10,blockLength:1}},
  {id:'boat-zero-speed',name:'人船零速度静止',description:'峰值相对速度为零，初始状态保持，不人为给定最低速度。',params:{mode:'boat-recoil',mass1:1,mass2:3,v10:0,v20:0,restitutionE:0,impactParamB:0,radius1:.25,radius2:.35,dragForceF:8,blockLength:3}}
];
