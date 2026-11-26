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
    name: '工件表面凹坑缺陷检测（条纹向薄端弯曲）',
    description: '下表面局部凹陷使空气隙增大；同一等厚点向薄端移动。以 x 从薄端指向厚端为约定。',
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
    name: '牛顿环（中心暗斑 + 内疏外密 r_k ≈ √(kRλ)）',
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
  },
  {id:'wedge-zero-angle',name:'零夹角 · 无周期条纹',description:'接触平行面，反射相位决定均匀亮暗',curriculumNotes:'定义域边界',params:{mode:'thin-film-wedge',wedgeAngleDeg:0,defectMode:'flat',halfWaveLoss:true}},
  {id:'wedge-convex-defect',name:'微凸起 · 等厚点向厚端移动',description:'比较横向二维形貌扰动',curriculumNotes:'等厚条件',params:{mode:'thin-film-wedge',defectMode:'bump',halfWaveLoss:true}},
  {id:'newton-bright-center',name:'牛顿环 · 无相对半波损失',description:'中心亮，第一正暗环半径改变',curriculumNotes:'反射相位对照',params:{mode:'newtons-rings',halfWaveLoss:false}},
  {id:'grating-rational-missing',name:'光栅 d/a=2.5 · 缺级 5、10',description:'非整数比也可能缺级',curriculumNotes:'整数阶次重合条件',params:{mode:'single-slit-grating',wavelengthNm:500,slitWidthMicron:2,gratingPitchMicron:5,slitCountN:6}},
  {id:'grating-single-slit',name:'单缝衍射 · 无光栅级次',description:'N=1 退化为单缝包络',curriculumNotes:'单缝极限',params:{mode:'single-slit-grating',slitCountN:1}},
  {id:'grating-overlap-invalid',name:'重叠狭缝 · 无效几何',description:'d<a 时不隐式修改输入',curriculumNotes:'模型适用域',params:{mode:'single-slit-grating',slitWidthMicron:8,gratingPitchMicron:4,slitCountN:6}},
  {id:'newton-dense-outer-rings',name:'牛顿环 · 外圈密集的分辨率边界',description:'短波长、小曲率半径、高折射率；显示像素积分而非混叠伪条纹',curriculumNotes:'光学图样与有限显示分辨率',params:{mode:'newtons-rings',wavelengthNm:400,refractiveIndexN2:1.8,lensRadiusR:.5,halfWaveLoss:true}}
];
