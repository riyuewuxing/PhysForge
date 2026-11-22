import type { PresetSpec } from '@physforge/sim-sdk';
import type { EmDevicesParams } from './engine.js';

export const emDevicesPresets: readonly PresetSpec<EmDevicesParams>[] = [
  {
    id: 'cyclotron-classic-vs-rel',
    name: '医用回旋加速器（经典动能 E_km 精确解析 vs 相对论质速失谐）',
    description: '演示质子在 D 形盒间的等周期回旋加速，校验出射最大动能公式并可开启相对论质速失谐对照',
    curriculumNotes: '选择性必修二 第一章第 4 节 · 质谱仪与回旋加速器 STSE',
    params: {
      device: 'cyclotron',
      eFieldVPerM: 2e5,
      bFieldT: 1.5,
      bDeflectT: 0.5,
      particleSpeedMps: 2e5,
      chargeC: 1.602176634e-19,
      massKg: 1.67262192369e-27,
      cyclotronRadiusM: 0.45,
      cyclotronVoltageV: 25000,
      relativisticDetune: false,
      hallCurrentA: 2.0,
      hallDensityPerM3: 1e24,
      hallThicknessM: 0.001,
      carrierType: 'electron',
      mhdDuctWidthM: 0.4,
      mhdDuctAreaM2: 0.1,
      mhdPlasmaResOhmM: 0.2,
      mhdLoadOhm: 0.8,
      flowDiameterM: 0.2
    }
  },
  {
    id: 'hall-electron-vs-hole',
    name: '霍尔元件载流子极性翻转（N 型电子 vs P 型空穴）',
    description: '一键切换电子与空穴载流子，定量计算微伏/毫伏级霍尔电势差与前/后表面电势高低',
    curriculumNotes: '选择性必修二 第一章 · 霍尔效应及其半导体检测应用',
    params: {
      device: 'hall-sensor',
      eFieldVPerM: 2e5,
      bFieldT: 0.8,
      bDeflectT: 0.5,
      particleSpeedMps: 1e5,
      chargeC: 1.602176634e-19,
      massKg: 1.67262192369e-27,
      cyclotronRadiusM: 0.45,
      cyclotronVoltageV: 25000,
      relativisticDetune: false,
      hallCurrentA: 3.0,
      hallDensityPerM3: 2e24,
      hallThicknessM: 0.0005,
      carrierType: 'electron',
      mhdDuctWidthM: 0.4,
      mhdDuctAreaM2: 0.1,
      mhdPlasmaResOhmM: 0.2,
      mhdLoadOhm: 0.8,
      flowDiameterM: 0.2
    }
  },
  {
    id: 'mhd-peak-power',
    name: '磁流体发电与阻抗匹配（R = r 最大输出功率）',
    description: '高温等离子体高速穿过平行金属板形成等效电源，验证负载等于内阻时输出功率达峰值',
    curriculumNotes: '选择性必修二 / 必修三 · 磁流体发电机与等效闭合电路',
    params: {
      device: 'mhd-generator',
      eFieldVPerM: 1e4,
      bFieldT: 2.0,
      bDeflectT: 0.5,
      particleSpeedMps: 1200,
      chargeC: 1.602176634e-19,
      massKg: 1.67262192369e-27,
      cyclotronRadiusM: 0.45,
      cyclotronVoltageV: 25000,
      relativisticDetune: false,
      hallCurrentA: 2.0,
      hallDensityPerM3: 1e24,
      hallThicknessM: 0.001,
      carrierType: 'hole',
      mhdDuctWidthM: 0.4,
      mhdDuctAreaM2: 0.1,
      mhdPlasmaResOhmM: 0.2,
      mhdLoadOhm: 0.8,
      flowDiameterM: 0.2
    }
  },
  {
    id: 'velocity-selector-spectrometer',
    name: '速度选择器与同位素质谱仪联动',
    description: '调节交叉场 E/B 筛选目标粒子速率，并在右侧匀强磁场区观察不同荷质比粒子的轨道分离',
    curriculumNotes: '选择性必修二 第一章 · 速度选择器与阿斯顿质谱仪',
    params: {
      device: 'velocity-selector',
      eFieldVPerM: 2e5,
      bFieldT: 1.0,
      bDeflectT: 0.5,
      particleSpeedMps: 2e5,
      chargeC: 1.602176634e-19,
      massKg: 3.34e-27,
      cyclotronRadiusM: 0.45,
      cyclotronVoltageV: 25000,
      relativisticDetune: false,
      hallCurrentA: 2.0,
      hallDensityPerM3: 1e24,
      hallThicknessM: 0.001,
      carrierType: 'electron',
      mhdDuctWidthM: 0.4,
      mhdDuctAreaM2: 0.1,
      mhdPlasmaResOhmM: 0.2,
      mhdLoadOhm: 0.8,
      flowDiameterM: 0.2
    }
  }
];
