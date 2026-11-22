import type { PresetSpec } from '@physforge/sim-sdk';
import type { PhotoelectricComptonParams } from './engine.js';

export const photoelectricComptonPresets: readonly PresetSpec<PhotoelectricComptonParams>[] = [
  {
    id: 'photoelectric-sodium-violet',
    name: '钠阴极光电效应：405 nm 紫光遏止电压 U_c 与 E_km-ν 直线',
    description: '调节入射光波长 λ 与相对光强，对比冻结参考曲线，直接验证遏止电压仅由频率决定而饱和电流由光强决定',
    curriculumNotes: '选择性必修三 第四章第 2 节 · 光电效应方程与密立根直线斜率 h/e',
    params: {
      mode: 'photoelectric',
      cathodeMetal: 'Na',
      customWorkFunctionEv: 2.36,
      wavelengthNm: 405,
      intensityRel: 1.4,
      anodeVoltageV: 0,
      freezeRefEnabled: true,
      refWavelengthNm: 450,
      refIntensityRel: 0.8,
      xrayWavelengthNm: 0.071,
      scatterAngleDeg: 90
    }
  },
  {
    id: 'photoelectric-red-below-cutoff',
    name: '红光 650 nm 照射锌板：低于截止频率不产生光电流',
    description: '光子能量 hν ≈ 1.91 eV 小于锌的逸出功 W₀ = 4.31 eV，无论如何增大光强均无光电子逸出',
    curriculumNotes: '选择性必修三 第四章第 2 节 · 截止频率的存在对经典波动理论的挑战',
    params: {
      mode: 'photoelectric',
      cathodeMetal: 'Zn',
      customWorkFunctionEv: 4.31,
      wavelengthNm: 650,
      intensityRel: 2.0,
      anodeVoltageV: 2.0,
      freezeRefEnabled: false,
      refWavelengthNm: 254,
      refIntensityRel: 1.0,
      xrayWavelengthNm: 0.071,
      scatterAngleDeg: 90
    }
  },
  {
    id: 'compton-molybdenum-90deg',
    name: '康普顿散射（Mo Kα 0.071 nm @ 90°）：相对论动量闭合三角形',
    description: 'X 光子与静止自由电子弹性碰撞，波长偏移 Δλ = λ_C(1-cosθ)，能量与二维矢量动量严格闭环',
    curriculumNotes: '选择性必修三 第四章第 2 节 · 康普顿散射与光子动量 p = h/λ',
    params: {
      mode: 'compton',
      cathodeMetal: 'Na',
      customWorkFunctionEv: 2.36,
      wavelengthNm: 405,
      intensityRel: 1.0,
      anodeVoltageV: 0,
      freezeRefEnabled: false,
      refWavelengthNm: 450,
      refIntensityRel: 1.0,
      xrayWavelengthNm: 0.071,
      scatterAngleDeg: 90
    }
  }
];
