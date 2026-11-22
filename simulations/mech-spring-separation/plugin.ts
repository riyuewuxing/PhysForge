import { degToRad } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { springSepPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepSpringSeparation,
  type SpringSepParams,
  type SpringSepState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<SpringSepParams>[] = [
  { key: 'mass1', kind: 'number', label: '连簧物块 m₁', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'mass2', kind: 'number', label: '接触物块 m₂', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 2 },
  { key: 'springK', kind: 'number', label: '弹簧劲度系数 k', unit: 'N/m', min: 10, max: 80, step: 5, defaultValue: 30 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', min: 0, max: 45, step: 5, defaultValue: 0 },
  { key: 'initialComp', kind: 'number', label: '初始压缩量 x₀', unit: 'm', min: 0.4, max: 1.8, step: 0.1, defaultValue: 1 },
  { key: 'externalForce', kind: 'number', label: '右侧拉 m₂ 恒力 F', unit: 'N', min: 0, max: 30, step: 2, defaultValue: 0 }
];

export const mechSpringSeparationPlugin = defineSimulationPlugin<SpringSepParams, SpringSepState>({
  meta: {
    id: 'mech-spring-separation',
    title: '含弹簧连接体与临界分离模型 (M08)',
    textbookRef: '人教版 必修第一册 第四章 & 必修二',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: springSepPresets,
  engine: {
    createInitialState,
    step: stepSpringSeparation,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'spring', label: '弹簧与两物块结构', defaultVisible: true },
    { id: 'eventPins', label: 'FN=0 临界分离钉点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'normalForceN', label: '两块间弹力 FN', unit: 'N', color: '#fbbf24' },
    { key: 'v1', label: 'm₁ 速度 v₁', unit: 'm/s', color: '#38bdf8' },
    { key: 'v2', label: 'm₂ 速度 v₂', unit: 'm/s', color: '#f472b6' },
    { key: 's1', label: 'm₁ 位移 s₁', unit: 'm', color: '#4ade80' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'initial-compression',
      label: `x₀=${params.initialComp.toFixed(1)}m`,
      position: { x: -params.initialComp, y: 0 },
      handleKind: 'point',
      color: '#38bdf8',
      onDrag: (wp) => ({ initialComp: Number(Math.max(0.4, Math.min(1.8, -wp.x)).toFixed(1)) })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-spring-separation',
      title: '弹簧临界分离',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<SpringSepParams>
  },
  exportDiagramIR: (state, params) => ({
    width: 720,
    height: 380,
    viewBox: { minX: -2.8, minY: -1.2, maxX: 3.2, maxY: 1.6 },
    title: '含弹簧连接体临界分离配图',
    primitives: [
      { kind: 'hatchedGround', x1: -2.5, y1: -0.25, x2: 3.0, y2: -0.25 },
      { kind: 'spring', x1: -2.3, y1: 0, x2: state.s1 - 0.25, y2: 0, coils: 8 },
      { kind: 'block', cx: state.s1, cy: 0, width: 0.48, height: 0.48, label: 'm_1' },
      { kind: 'block', cx: state.s2 + 0.5, cy: 0, width: 0.48, height: 0.48, label: 'm_2' },
      { kind: 'mathLabel', x: 2.8, y: 1.2, text: `k=${params.springK}N/m,\\; F_N=${state.normalForceN.toFixed(1)}N`, align: 'end' }
    ] as DiagramPrimitive[]
  }),
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const th = degToRad(params.inclineDeg);
    const ppm = Math.min(viewport.width, viewport.height) * 0.16 * viewport.scale;
    ctx.save();
    ctx.translate(viewport.width * 0.45 + viewport.offsetX, viewport.height * 0.62 + viewport.offsetY);
    ctx.rotate(-th);

    if (activeLayers.has('spring')) {
      const wallX = -2.2 * ppm;
      const b1X = state.s1 * ppm;
      const b2X = state.s2 * ppm + 42;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(wallX, -50);
      ctx.lineTo(wallX, 2);
      ctx.lineTo(2.8 * ppm, 2);
      ctx.stroke();

      // Spring zigzag
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const sEnd = b1X - 20;
      ctx.moveTo(wallX, -20);
      for (let i = 1; i < 10; i++) {
        const sx = wallX + ((sEnd - wallX) * i) / 10;
        const sy = -20 + (i % 2 === 0 ? -9 : 9);
        ctx.lineTo(sx, sy);
      }
      ctx.lineTo(sEnd, -20);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(b1X - 20, -40, 40, 40);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(b2X - 20, -40, 40, 40);
    }

    if (activeLayers.has('eventPins') && state.separated && state.separationPosS !== null) {
      const sx = state.separationPosS * ppm;
      ctx.strokeStyle = '#4ade80';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx + 20, -70);
      ctx.lineTo(sx + 20, 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
});

export default mechSpringSeparationPlugin;
