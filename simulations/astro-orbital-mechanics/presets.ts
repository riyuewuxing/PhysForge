import type { PresetSpec } from '@physforge/sim-sdk';
import type { AstroOrbitalParams } from './engine.js';

export const astroOrbitalPresets: readonly PresetSpec<AstroOrbitalParams>[] = [
  {
    id: 'kepler-ellipse-second-law',
    name: '开普勒椭圆轨道与等面积扫过扇区',
    description: '近地高轨 e≈0.44，基于 ScaleContext 归一化与四阶辛积分，实时渲染等时间扫过面积',
    curriculumNotes: '必修二 · 开普勒第一/二/三定律',
    params: {
      mode: 'kepler-ellipse',
      scaleRegime: 'earth-orbit',
      r1Ratio: 1,
      r2OverR1: 2,
      v0Ratio: 1.2,
      massRatioQ: 0.08,
      simSpeed: 1
    }
  },
  {
    id: 'hohmann-geo-transfer',
    name: '地球同步轨道霍曼双脉冲转移 (Δv₁ + Δv₂)',
    description: '近地点点火进入大椭圆，bisectEvent 捕获远地点自动二次圆化变轨',
    curriculumNotes: '必修二 · 卫星变轨与宇宙航行',
    params: {
      mode: 'hohmann-transfer',
      scaleRegime: 'earth-orbit',
      r1Ratio: 1,
      r2OverR1: 2.4,
      v0Ratio: 1,
      massRatioQ: 0.08,
      simSpeed: 1
    }
  },
  {
    id: 'solar-escape-velocity',
    name: '第二宇宙速度逃逸对比 (v₀=√2 v₁)',
    description: '日地天文单位 AU 尺度下检验抛物线逃逸临界速度比 √2≈1.4142',
    curriculumNotes: '必修二 · 宇宙速度',
    params: {
      mode: 'kepler-ellipse',
      scaleRegime: 'solar-au',
      r1Ratio: 1,
      r2OverR1: 2,
      v0Ratio: 1.414,
      massRatioQ: 0.08,
      simSpeed: 1
    }
  },
  {
    id: 'binary-lagrange-roche',
    name: '限制性三体洛希等势面与 L₁–L₅ 拉格朗日点',
    description: '展示 L1-L5 平衡点分布、marchingSquares 等势线及 L4 附近稳定天平动轨道',
    curriculumNotes: '必修二 · 拓展天体专题',
    params: {
      mode: 'binary-lagrange',
      scaleRegime: 'solar-au',
      r1Ratio: 1,
      r2OverR1: 2,
      v0Ratio: 1,
      massRatioQ: 0.03,
      simSpeed: 1
    }
  }
];
