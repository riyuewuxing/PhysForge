import type { PresetSpec } from '@physforge/sim-sdk';
import type { WaveFdtdParams } from './engine.js';

export const waveFdtdPresets: readonly PresetSpec<WaveFdtdParams>[] = [
  {
    id: 'fdtd-double-slit-interference',
    name: '2D FDTD 双缝干涉（惠更斯-菲涅耳极大 Δy=Lλ/d）',
    description: '平面波穿经双缝并向右侧探测屏传播，右屏实时统计时间平均波强 ⟨u²(y)⟩ 明暗干涉条纹',
    curriculumNotes: '选择性必修一 第三、四章 · 双缝干涉物理波动检验',
    params: {
      mode: 'double-slit',
      wavelengthCells: 10,
      waveSpeed: 1.0,
      amplitude: 1.0,
      slitSepCells: 30,
      slitWidthCells: 5,
      refractiveIndexN: 1.6
    }
  },
  {
    id: 'fdtd-single-slit-diffraction',
    name: '单缝显性衍射（狭缝宽度 a ≈ λ）',
    description: '当缝宽接近波长时水波呈明显球面波向外扩散衍射；可增大缝宽对比几何直线传播极限',
    curriculumNotes: '选择性必修一 · 明显衍射发生条件',
    params: {
      mode: 'single-slit',
      wavelengthCells: 12,
      waveSpeed: 1.0,
      amplitude: 1.0,
      slitSepCells: 28,
      slitWidthCells: 8,
      refractiveIndexN: 1.6
    }
  },
  {
    id: 'fdtd-obstacle-shadow-bend',
    name: '小障碍物绕射与波后填补对比',
    description: '波动遇到尺度接近波长的障碍物时绕过边缘在阴影区重新融合',
    curriculumNotes: '选择性必修一 · 障碍物绕射',
    params: {
      mode: 'obstacle-diffraction',
      wavelengthCells: 12,
      waveSpeed: 1.0,
      amplitude: 1.0,
      slitSepCells: 28,
      slitWidthCells: 5,
      refractiveIndexN: 1.6
    }
  },
  {
    id: 'fdtd-refraction-snell',
    name: '波速梯度斜界面折射（c₂ = c₁ / n，波长缩短偏折）',
    description: '波束斜射入高折射率（低波速）介质区，直观展现波前转折与波长压缩现象',
    curriculumNotes: '选择性必修一 · 惠更斯原理解释波的折射',
    params: {
      mode: 'refraction-prism',
      wavelengthCells: 11,
      waveSpeed: 1.0,
      amplitude: 1.0,
      slitSepCells: 28,
      slitWidthCells: 6,
      refractiveIndexN: 1.75
    }
  },
  {id:'fdtd-double-slit-fast',name:'高速双缝 · 实测屏面',description:'c₀=2 m/s，完整求解到达后的接收屏均方位移；可用较短课堂时间比较有限缝峰谷。',curriculumNotes:'物理时间与屏幕实测',params:{mode:'double-slit',wavelengthCells:10,waveSpeed:2,amplitude:1,slitSepCells:30,slitWidthCells:5,refractiveIndexN:1.6}},
  {id:'fdtd-overlap-invalid',name:'反例 · 重叠双缝请求',description:'请求缝宽20格、中心间距14格，不能形成独立双缝；拒绝启动，不伪造有效几何。',curriculumNotes:'独立开口定义域',params:{mode:'double-slit',wavelengthCells:10,waveSpeed:1,amplitude:1,slitSepCells:14,slitWidthCells:20,refractiveIndexN:1.6}}
];
