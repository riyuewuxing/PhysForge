import type { StoryDeck } from '@physforge/sim-sdk';
import type { Magnetic3dParams } from './engine.js';

const uniform = {
  geometryType: 'uniform-helix', currentI: 2, radiusR: 1, solenoidTurns: 10,
  qOverM: 1, vPerp: 1.5, vParallel: 0, uniformBz: 2
} as const satisfies Magnetic3dParams;
const layers = ['conductors', 'fieldLines3d', 'handednessTriad'] as const;
const camera = (morphT: 0 | 1) => ({
  view3D: { azimuthRad: 0.67, polarRad: 1.08, target: [0, 0, 0] as [number, number, number], visibleHeight: 4.8, morphT },
  durationMs: 750
});

export const magnetic3dStoryDecks: readonly StoryDeck[] = [{
  id: 'e10-field-and-helix', modelId: 'em-3d-magnetic-fields', title: '空间磁场：从环形电流到螺旋运动',
  beats: [
    { id: 'e10-coil', title: '环形电流的空间磁场', caption: '磁感线具有方向；空间磁场不能仅凭一个平面判断。',
      speakerNotes: '先用右手安培定则判断环形电流的轴线磁场，再旋转观察线圈。此镜是单匝稳恒电流的毕奥—萨伐尔场，试探粒子不参与场源计算。真实空间场与二维侧投影不是同一对象。',
      paramPatch: { ...uniform, geometryType: 'single-loop', currentI: 2.5 }, paramTweenMs: 0, simAction: 'reset-pause',
      camera: camera(0), layerOverrides: { visibleLayerIds: layers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'biot-savart-current' } },
    { id: 'e10-circle', title: '垂直入射：圆周运动', caption: '洛伦兹力改变速度方向，不改变速率。',
      speakerNotes: '正荷质比为 1 C/kg，B=2 T，垂直初速 1.5 m/s。经典半径为 0.75 m，周期为 π s。按模型时间达到 π s 定格，比较一周附近的速度方向；数值积分离散误差不意味着恰好闭合。',
      paramPatch: uniform, paramTweenMs: 0, simAction: 'reset-play', camera: camera(0),
      autoFreeze: { observableKey: 't', operator: '>=', threshold: Math.PI, badgeText: '经过约一个理论回旋周期' },
      layerOverrides: { visibleLayerIds: layers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'uniform-gyro-frequency' } },
    { id: 'e10-helix', title: '斜射：叠加轴向匀速运动', caption: '沿磁场方向匀速，垂直磁场方向回旋。',
      speakerNotes: '只增加轴向初速度至 1 m/s，理论回旋半径和周期不变，螺距为 π m。先观察立体螺旋，再用侧投影比较横向振荡；定格是轴向位置首次达到 0.8 m，非完整周期事件。',
      paramPatch: { ...uniform, vParallel: 1 }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(0),
      autoFreeze: { observableKey: 'z', operator: '>=', threshold: 0.8, badgeText: '轴向位置达到 0.8 m' },
      layerOverrides: { visibleLayerIds: layers, showFbd: false, referenceFrameId: 'ground', highlightFormulaId: 'uniform-parallel-velocity' } },
    { id: 'e10-project', title: '侧投影与空间轨迹', caption: '侧视只保留 z、y 坐标，深度信息被压平。',
      speakerNotes: '此镜独立重置至同一斜射初始条件并切到侧视。提醒学生不能把投影曲线当作真实空间运动，更不能据投影方向单独判断三维叉乘。',
      paramPatch: { ...uniform, vParallel: 1 }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(1),
      layerOverrides: { visibleLayerIds: layers, showFbd: true, referenceFrameId: 'ground', highlightFormulaId: 'uniform-gyro-frequency' } }
  ]
}];
