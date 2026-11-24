import type { StoryDeck } from '@physforge/sim-sdk';
import type { AstroOrbitalParams } from './engine.js';

const orbit = {
  mode: 'kepler-ellipse', scaleRegime: 'earth-orbit', r1Ratio: 1, r2OverR1: 2.4,
  v0Ratio: 1.2, massRatioQ: 0.03, simSpeed: 1
} as const satisfies AstroOrbitalParams;
const camera = (morphT: 0 | 1) => ({
  view3D: { azimuthRad: 0.5, polarRad: 0.92, target: [0, 0, 0] as [number, number, number], visibleHeight: 8.5, morphT },
  durationMs: 750
});
const keplerLayers = ['orbit', 'keplerSectors'] as const;
const binaryLayers = ['orbit', 'rocheIsolines', 'corotatingView'] as const;

export const orbitalStoryDecks: readonly StoryDeck[] = [{
  id: 'm10-orbits-and-transfer', modelId: 'astro-orbital-mechanics', title: '万有引力：圆轨道、等面积与变轨',
  beats: [
    { id: 'm10-circular', title: '圆轨道的初始速度', caption: '引力提供向心力，圆轨道速度由中心天体和半径决定。',
      speakerNotes: '设 r₁ 为归一化长度单位，初始速度等于圆轨道速度。由 GMm/r²=mv²/r 得 v=√(GM/r)。卫星质量在此理想二体问题中约去。天体尺寸为示意，不按真实比例。',
      paramPatch: { ...orbit, v0Ratio: 1 }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(0),
      layerOverrides: { visibleLayerIds: keplerLayers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'circular-speed' } },
    { id: 'm10-areas', title: '椭圆轨道与等面积', caption: '相等时间扫过相等面积；近心点运动更快。',
      speakerNotes: '初始速度增至圆轨道速度的 1.2 倍，仍小于逃逸速度。观察已有积分器每 0.55 个归一化时间生成的扇区。定格后比较面积及位置；等面积来自角动量守恒，不是要求等弧长。离散扇区面积仅为数值近似。',
      paramPatch: orbit, paramTweenMs: 0, simAction: 'reset-play', camera: camera(1),
      autoFreeze: { observableKey: 'tNorm', operator: '>=', threshold: 3.3, badgeText: '已演化约六个等时区间' },
      layerOverrides: { visibleLayerIds: keplerLayers, showFbd: true, referenceFrameId: 'ground', highlightFormulaId: 'circular-speed' } },
    { id: 'm10-transfer', title: '霍曼转移与二次点火', caption: '先加速进入转移椭圆，再在远地点加速圆化。',
      speakerNotes: '目标圆轨道半径为初始半径的 2.4 倍，不称作实际地球同步轨道。引擎初态已施加第一次脉冲；当远地点二次点火事件产生非零 Δv₂ 时定格，比较轨道半径与两次速度增量。模型的事件定位与课堂定格是不同精度层级。',
      paramPatch: { ...orbit, mode: 'hohmann-transfer', v0Ratio: 1, simSpeed: 2 }, paramTweenMs: 0,
      simAction: 'reset-play', camera: camera(1),
      autoFreeze: { observableKey: 'deltaV2SI', operator: '>=', threshold: 1, badgeText: '引擎已记录第二次点火' },
      layerOverrides: { visibleLayerIds: ['orbit'], showFbd: true, referenceFrameId: 'ground', highlightFormulaId: 'hohmann-first-burn' } },
    { id: 'm10-binary', title: '双星系统共转系', caption: '换到共转系，两颗主星保持固定方位。',
      speakerNotes: '切换限制性三体模型，质量分数 q=0.03。解释双星质心与 L₁—L₅ 的几何位置，强调平衡点是共转系中引力和惯性项共同作用的结果，不是两颗星的引力必然互相抵消。展示的等势线不是粒子的轨道。',
      paramPatch: { ...orbit, mode: 'binary-lagrange', scaleRegime: 'solar-au', v0Ratio: 1 },
      paramTweenMs: 0, simAction: 'reset-play', camera: camera(0),
      layerOverrides: { visibleLayerIds: binaryLayers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'binary-barycenter' } }
  ]
}];
