import type { PresetSpec } from '@physforge/sim-sdk';
import type { EmLaunchRegenParams } from './engine.js';

export const emLaunchRegenPresets: readonly PresetSpec<EmLaunchRegenParams>[] = [
  {
    id: 'railgun-capacitor-pulse',
    name: '脉冲电容驱动电磁导轨炮（含反电动势 BLv 与风阻）',
    description: '脉冲电容器放电加速弹体，实时结算电容余能、弹体动能、回路焦耳热与气动损失闭环账本',
    curriculumNotes: '选择性必修二 第二章 · 电磁感应动能定理与脉冲能量账本 STSE',
    params: {
      mode: 'railgun',
      driveMode: 'capacitor-pulse',
      massKg: 2.0,
      v0Mps: 0,
      bFieldT: 4.0,
      trackSpanM: 0.4,
      circuitResOhm: 0.25,
      loadResOhm: 0,
      capacitanceF: 0.2,
      capVoltageV: 800,
      driveCurrentA: 400,
      aeroDragCoeff: 0.02,
      mechBrakeN: 0
    }
  },
  {
    id: 'ev-pure-em-regen-brake',
    name: '新能源汽车纯电磁阻尼（渐近位移对照）',
    description: '闭合等效回路，速度渐近趋零；比较初始动能向等效负载及内阻的转移，纯电磁极限位移不是有限停车距离',
    curriculumNotes: '选择性必修二 & 必修二 · 新能源汽车动能回收系统物理模型',
    params: {
      mode: 'regen-brake',
      driveMode: 'capacitor-pulse',
      massKg: 1200,
      v0Mps: 25,
      bFieldT: 6.0,
      trackSpanM: 3.0,
      circuitResOhm: 0.08,
      loadResOhm: 0.42,
      capacitanceF: 1.0,
      capVoltageV: 0,
      driveCurrentA: 0,
      aeroDragCoeff: 0,
      mechBrakeN: 0
    }
  },
  {
    id: 'ev-blended-regen-mech',
    name: '低速混合制动（再生发电 + 机械摩擦片补足制动）',
    description: '机械损耗与电磁阻尼共同减速，分别展示等效负载能量和损耗，不直接套用纯电磁极限公式',
    curriculumNotes: '选择性必修二 · 多能流耦合与汽车工程折中优化',
    params: {
      mode: 'regen-brake',
      driveMode: 'capacitor-pulse',
      massKg: 1200,
      v0Mps: 20,
      bFieldT: 5.0,
      trackSpanM: 2.5,
      circuitResOhm: 0.08,
      loadResOhm: 0.32,
      capacitanceF: 1.0,
      capVoltageV: 0,
      driveCurrentA: 0,
      aeroDragCoeff: 0.35,
      mechBrakeN: 1200
    }
  }
];
