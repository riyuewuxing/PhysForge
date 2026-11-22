import type { PresetSpec } from '@physforge/sim-sdk';
import type { WaveOpticsParams } from './engine.js';

export const waveOpticsPresets: readonly PresetSpec<WaveOpticsParams>[] = [
  {
    id: 'air-wedge-flat-fringes',
    name: '空气劈尖等厚干涉条纹（Δx = λ/(2n tanα)）',
    description: '调节单色光波长与劈尖夹角，观察波长越长条纹间距越宽的等间距平行明暗条纹',
    curriculumNotes: '选择性必修一 第四章 · 薄膜干涉测量平直度',
    params: {
      mode: 'thin-film-wedge',
      wavelengthNm: 589,
      refractiveIndexN2: 1.0,
      wedgeAngleDeg: 0.012,
      defectMode: 'flat',
      lensRadiusR: 2.0,
      slitWidthMicron: 4,
      gratingPitchMicron: 12,
      slitCountN: 6,
      halfWaveLoss: true
    }
  },
  {
    id: 'air-wedge-concave-defect',
    name: '工件表面凹坑缺陷检测（条纹向厚端弯曲）',
    description: '下表面出现局部凹陷时等厚点提前落入厚端，揭示“凸向棱边弯、凹向厚端弯”的判别定则',
    curriculumNotes: '选择性必修一 · 干涉法检定光学平面瑕疵',
    params: {
      mode: 'thin-film-wedge',
      wavelengthNm: 532,
      refractiveIndexN2: 1.0,
      wedgeAngleDeg: 0.012,
      defectMode: 'pit',
      lensRadiusR: 2.0,
      slitWidthMicron: 4,
      gratingPitchMicron: 12,
      slitCountN: 6,
      halfWaveLoss: true
    }
  },
  {
    id: 'newtons-rings-standard',
    name: '牛顿环（中心暗斑 + 内疏外密 r_k = √(kRλ)）',
    description: '由于下界面存在半波损失，中心接触处呈零级暗斑，外围同心圆环间距按平方根逐步收窄',
    curriculumNotes: '选择性必修一 · 牛顿环等厚干涉',
    params: {
      mode: 'newtons-rings',
      wavelengthNm: 589,
      refractiveIndexN2: 1.0,
      wedgeAngleDeg: 0.012,
      defectMode: 'flat',
      lensRadiusR: 2.0,
      slitWidthMicron: 4,
      gratingPitchMicron: 12,
      slitCountN: 6,
      halfWaveLoss: true
    }
  },
  {
    id: 'grating-missing-order-3',
    name: '夫琅禾费光栅缺级现象（d/a = 3 → 第 3、6 级严格消光）',
    description: '光栅主极大与单缝衍射极小重合，第 3 级理论主极大强光被单缝衍射包络精准熄灭',
    curriculumNotes: '选择性必修一 · 光栅衍射与缺级规律',
    params: {
      mode: 'single-slit-grating',
      wavelengthNm: 633,
      refractiveIndexN2: 1.0,
      wedgeAngleDeg: 0.012,
      defectMode: 'flat',
      lensRadiusR: 2.0,
      slitWidthMicron: 4,
      gratingPitchMicron: 12,
      slitCountN: 6,
      halfWaveLoss: true
    }
  }
];
