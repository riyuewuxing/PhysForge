import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { wireframePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepWireframeRotation,
  type WireframeParams,
  type WireframeState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WireframeParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '切割类型',
    defaultValue: 'wireframe-gravity-fall',
    options: [
      { value: 'wireframe-gravity-fall', label: '闭合线框进出多区域磁场' },
      { value: 'rotating-rod', label: '金属棒绕端点转动切割' },
      { value: 'faraday-disk', label: '法拉第铜盘发电机' }
    ]
  },
  {
    key: 'loopShape',
    kind: 'select',
    label: '线框几何形状',
    defaultValue: 'square',
    options: [
      { value: 'square', label: '正方形线框' },
      { value: 'triangle', label: '正三角形线框' },
      { value: 'circle', label: '圆形线框' }
    ]
  },
  {
    key: 'fieldProfile',
    kind: 'select',
    label: '磁场区域分布',
    defaultValue: 'dual-opposite',
    options: [
      { value: 'single-zone', label: '单一匀强磁场区' },
      { value: 'dual-opposite', label: '反向双区域磁场 (+B / -B)' },
      { value: 'linear-gradient', label: '竖直梯度变化磁场 B(y)' }
    ]
  },
  { key: 'magneticB', kind: 'number', label: '磁感应强度 B₀', unit: 'T', min: 0, max: 3, step: 0.1, defaultValue: 1.5 },
  { key: 'loopSizeL', kind: 'number', label: '线框尺寸/杆长 L', unit: 'm', min: 0.3, max: 1.4, step: 0.1, defaultValue: 0.8 },
  { key: 'zoneHeightH', kind: 'number', label: '单磁场区高度 H', unit: 'm', min: 0.5, max: 2.0, step: 0.1, defaultValue: 1.0 },
  { key: 'massM', kind: 'number', label: '线框质量 m', unit: 'kg', min: 0.1, max: 3, step: 0.1, defaultValue: 0.5 },
  { key: 'resistanceR', kind: 'number', label: '线框总电阻 R', unit: 'Ω', min: 0.2, max: 5, step: 0.2, defaultValue: 1.0 },
  { key: 'initialVy', kind: 'number', label: '初始下落速度 v₀', unit: 'm/s', min: 0, max: 6, step: 0.5, defaultValue: 2.0 },
  { key: 'omegaRadS', kind: 'number', label: '转动角速度 ω', unit: 'rad/s', min: 0, max: 10, step: 0.5, defaultValue: 4.0 },
  { key: 'gravityEnabled', kind: 'boolean', label: '包含重力自由下落', defaultValue: true }
];


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "induced-current",
  "title": "纯电阻闭合线框的感应电流",
  "latex": "I=\\frac{\\mathcal E}{\\htmlClass{pf-live-var}{\\htmlData{param=resistanceR}{R}}}",
  "bindings": [
    {
      "tokenKey": "resistanceR",
      "paramKey": "resistanceR",
      "label": "线框总电阻 R",
      "unit": "Ω",
      "min": 0.2,
      "max": 5,
      "step": 0.2,
      "precision": 2
    }
  ]
}];
export const emWireframeRotationPlugin = Object.assign(defineSimulationPlugin<WireframeParams, WireframeState>({
  meta: {
    id: 'em-wireframe-rotation',
    title: '线框进出多区域磁场与旋转切割 (E05)',
    textbookRef: '人教版 选择性必修二 第二章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: 0.917, offsetRatioX: 0.05 },
  paramSchema,
  presets: wireframePresets,
  engine: {
    createInitialState,
    step: stepWireframeRotation,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'fields', label: '单/双/梯度磁场区域', defaultVisible: true },
    { id: 'conductor', label: '闭合线框或旋转导体', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'fluxWb', label: '磁通量 Φ', unit: 'Wb', color: '#38bdf8' },
    { key: 'emfV', label: '感应电动势 E', unit: 'V', color: '#fbbf24' },
    { key: 'currentA', label: '感应电流 I', unit: 'A', color: '#4ade80' },
    { key: 'ampereForceN', label: '安培力 F安', unit: 'N', color: '#f472b6' }
  ],
  getForceVectors: (state, params) =>
    params.mode === 'wireframe-gravity-fall'
      ? [
          {
            id: 'mg',
            label: 'mg',
            origin: { x: 0, y: state.centerY },
            force: { x: 0, y: params.gravityEnabled ? -params.massM * CLASSROOM_GRAVITY : 0 },
            category: 'gravity',
            color: '#f59e0b'
          },
          {
            id: 'ampere',
            label: 'F安',
            origin: { x: 0, y: state.centerY },
            force: { x: 0, y: state.ampereForceN },
            category: 'magnetic',
            color: '#fb7185'
          }
        ]
      : [],
  getControlHandles: (_s, params) => [
    {
      id: 'loop-size',
      label: `L=${params.loopSizeL.toFixed(1)}m`,
      position: { x: 0.5 * params.loopSizeL, y: 0 },
      handleKind: 'radius',
      color: '#38bdf8',
      onDrag: (wp) => ({ loopSizeL: Number(Math.max(0.3, Math.min(1.4, Math.abs(wp.x) * 2)).toFixed(1)) })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-wireframe-rotation',
      title: '线框进出磁场与旋转切割',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WireframeParams>
  },
  exportDiagramIR: (state, params) => {
    const H = params.zoneHeightH;
    const primitives: DiagramPrimitive[] = [
      { kind: 'rect', x: -1.4, y: -H, width: 2.8, height: H, dashed: true },
      { kind: 'block', cx: 0, cy: state.centerY, width: params.loopSizeL, height: params.loopSizeL, label: 'R' },
      { kind: 'mathLabel', x: 1.6, y: 0.5, text: `\\mathcal{E}=${state.emfV.toFixed(2)}\\text{V}`, align: 'end' }
    ];
    return {
      width: 680,
      height: 440,
      viewBox: { minX: -2.0, minY: -2.4, maxX: 2.0, maxY: 1.2 },
      title: '闭合线框进出磁场配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const fillWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    const strokeWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    ctx.save();
    if (params.mode !== 'wireframe-gravity-fall') {
      const pivot = m.toScreen(0, 0);
      const rWorld = params.loopSizeL * 0.5;
      const rPx = rWorld * m.ppm;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
      ctx.beginPath();
      ctx.arc(pivot.x, pivot.y, rPx * 1.15, 0, Math.PI * 2);
      ctx.fill();

      if (params.mode === 'faraday-disk') {
        ctx.fillStyle = 'rgba(217, 119, 6, 0.45)';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pivot.x, pivot.y, rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      const endpoint = m.toScreen(rWorld * Math.cos(state.angleRad), rWorld * Math.sin(state.angleRad));
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pivot.x, pivot.y);
      ctx.lineTo(endpoint.x, endpoint.y);
      ctx.stroke();
      labels.push({ id: 'rotation-cutting-summary', x: pivot.x, y: pivot.y - m.len(1), text: params.mode === 'faraday-disk' ? `法拉第圆盘 Φ=${state.fluxWb.toFixed(2)} Wb` : `旋转切割 ε=${state.emfV.toFixed(2)} V`, color: '#e2e8f0', font: 'bold 12px sans-serif' });
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    const H = params.zoneHeightH;
    if (activeLayers.has('fields')) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      fillWorldRect(-1.5, -H, 3, H);
      if (params.fieldProfile === 'dual-opposite') {
        ctx.fillStyle = 'rgba(244, 114, 182, 0.12)';
        fillWorldRect(-1.5, -2 * H, 3, H);
      }
      ctx.strokeStyle = '#64748b';
      ctx.setLineDash([5, 4]);
      const zoneTopLeft = m.toScreen(-1.5, 0);
      const zoneTopRight = m.toScreen(1.5, 0);
      const zoneBottomLeft = m.toScreen(-1.5, -H);
      const zoneBottomRight = m.toScreen(1.5, -H);
      ctx.beginPath();
      ctx.moveTo(zoneTopLeft.x, zoneTopLeft.y);
      ctx.lineTo(zoneTopRight.x, zoneTopRight.y);
      ctx.moveTo(zoneBottomLeft.x, zoneBottomLeft.y);
      ctx.lineTo(zoneBottomRight.x, zoneBottomRight.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (activeLayers.has('conductor')) {
      const L = params.loopSizeL;
      const half = 0.5 * L;
      const center = m.toScreen(0, state.centerY);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      if (params.loopShape === 'square') {
        strokeWorldRect(-half, state.centerY - half, L, L);
      } else if (params.loopShape === 'circle') {
        ctx.beginPath();
        ctx.arc(center.x, center.y, half * m.ppm, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const top = m.toScreen(0, state.centerY + half);
        const left = m.toScreen(-half, state.centerY - half);
        const right = m.toScreen(half, state.centerY - half);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.closePath();
        ctx.stroke();
      }
      labels.push({ id: 'wireframe-summary', x: center.x, y: center.y - m.len(half + 0.18), text: `Φ=${state.fluxWb.toFixed(2)} Wb · ε=${state.emfV.toFixed(2)} V`, color: '#e2e8f0', font: '12px sans-serif' });
    }
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state) => [
    {
      id: 'wireframe-emf',
      label: '法拉第定律与四联核心观测量',
      latex: '\\mathcal{E} = -\\frac{\\Delta \\Phi}{\\Delta t}, \\quad I = \\frac{\\mathcal{E}}{R}',
      substitutedLatex: `\\Phi=${state.fluxWb.toFixed(3)}\\text{ Wb},\\; \\mathcal{E}=${state.emfV.toFixed(2)}\\text{ V},\\; I=${state.currentA.toFixed(2)}\\text{ A}`
    }
  ]
}), { liveFormulas });

export default emWireframeRotationPlugin;
