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
  }
];
