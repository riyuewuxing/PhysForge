import type { PresetSpec } from '@physforge/sim-sdk';
import type { PhotoelectricComptonParams } from './engine.js';

export const photoelectricComptonPresets: readonly PresetSpec<PhotoelectricComptonParams>[] = [
  {
    id: 'photoelectric-sodium-violet',
    name: '钠阴极光电效应：405 nm 紫光遏止电压 U_c 与 E_km-ν 直线',
    description: '调节入射光波长 λ 与相对光强，对比同材料参考曲线，直接验证遏止电压仅由频率决定而同一频率下饱和电流随光强成比例',
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
  },
  {id:'photoelectric-shutter-closed',name:'钠阴极 · 405 nm 关光',description:'频率满足能量条件但光源关闭，无实际光电子或光电流，不显示遏止电压测量',params:{mode:'photoelectric',cathodeMetal:'Na',wavelengthNm:405,intensityRel:0,anodeVoltageV:2,freezeRefEnabled:true,refWavelengthNm:405,refIntensityRel:1}},
  {id:'photoelectric-same-frequency-bright',name:'钠阴极 · 同频率强光与弱光',description:'相同波长与材料，当前强度3倍于参考；遏止点相同',params:{mode:'photoelectric',cathodeMetal:'Na',wavelengthNm:405,intensityRel:3,anodeVoltageV:2,freezeRefEnabled:true,refWavelengthNm:405,refIntensityRel:1}},
  {id:'photoelectric-high-energy-stopped',name:'低逸出功阴极 · 强紫外完全遏止',description:'200 nm 与1 eV逸出功的理论最大动能超过5 eV；扩展反向电压到−7 V',params:{mode:'photoelectric',cathodeMetal:'custom',customWorkFunctionEv:1,wavelengthNm:200,intensityRel:2,anodeVoltageV:-7,freezeRefEnabled:false}},
  {id:'compton-forward-zero',name:'康普顿正向散射 · θ=0°',description:'不转移能量与动量；零反冲方向未定义',params:{mode:'compton',xrayWavelengthNm:.071,scatterAngleDeg:0}},
  {id:'compton-backscatter',name:'康普顿反向散射 · θ=180°',description:'该入射波长的最大波长偏移；反冲电子沿+x',params:{mode:'compton',xrayWavelengthNm:.071,scatterAngleDeg:180}},
  {id:'compton-short-xray',name:'短波长 X 射线 · 相对论能量分配',description:'0.01 nm、135°，相对论电子动能和独立动量分量',params:{mode:'compton',xrayWavelengthNm:.01,scatterAngleDeg:135}}
];
