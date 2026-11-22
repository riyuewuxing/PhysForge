import type { PresetSpec } from '@physforge/sim-sdk';
import type { WireframeParams } from './engine.js';

export const wireframePresets: readonly PresetSpec<WireframeParams>[] = [
  {
    id: 'dual-opposite-field-2x-emf',
    name: '反向双区域磁场穿越（交界电动势严格 2.000 倍）',
    description: '线框下边跨入 -B 区而上边尚在 +B 区时双边同向叠加切割，感应电动势翻倍、安培力陡增 4 倍',
    curriculumNotes: '选择性必修二 第二章 · 多区域磁场线框切割',
    params: {
      mode: 'wireframe-gravity-fall',
      loopShape: 'square',
      fieldProfile: 'dual-opposite',
      magneticB: 1.5,
      loopSizeL: 0.8,
      zoneHeightH: 1.0,
      massM: 0.5,
      resistanceR: 1.0,
      initialVy: 2.0,
      omegaRadS: 4,
      gravityEnabled: true
    }
  },
  {
    id: 'triangle-loop-linear-emf',
    name: '正三角形线框自由落入匀强磁场',
    description: '有效切割宽度随落入深度线性变化，观察 Φ-t 与 E-t 四联示波变化规律',
    curriculumNotes: '选择性必修二 · 异形闭合线框',
    params: {
      mode: 'wireframe-gravity-fall',
      loopShape: 'triangle',
      fieldProfile: 'single-zone',
      magneticB: 1.8,
      loopSizeL: 0.9,
      zoneHeightH: 1.4,
      massM: 0.5,
      resistanceR: 0.8,
      initialVy: 1.0,
      omegaRadS: 4,
      gravityEnabled: true
    }
  },
  {
    id: 'rotating-rod-cutting',
    name: '金属杆绕端点 OA 匀速转动切割磁感线',
    description: '实时演示 E = 1/2·BωL² 与法拉第旋转圆盘等效模型',
    curriculumNotes: '选择性必修二 · 转动切割电动势',
    params: {
      mode: 'rotating-rod',
      loopShape: 'square',
      fieldProfile: 'single-zone',
      magneticB: 1.5,
      loopSizeL: 1.0,
      zoneHeightH: 1.2,
      massM: 1.0,
      resistanceR: 0.5,
      initialVy: 0,
      omegaRadS: 4.0,
      gravityEnabled: false
    }
  },
  {
    id: 'faraday-copper-disk',
    name: '法拉第铜盘发电机（径向恒定电动势）',
    description: '匀强磁场中绕中心轴恒定角速度转动的实心铜盘在边缘与中心产生稳恒电动势 1/2·BωR²',
    curriculumNotes: '选择性必修二 · 法拉第圆盘拓展',
    params: {
      mode: 'faraday-disk',
      loopShape: 'circle',
      fieldProfile: 'single-zone',
      magneticB: 1.2,
      loopSizeL: 1.0,
      zoneHeightH: 1.2,
      massM: 1.0,
      resistanceR: 0.4,
      initialVy: 0,
      omegaRadS: 5.0,
      gravityEnabled: false
    }
  }
];
