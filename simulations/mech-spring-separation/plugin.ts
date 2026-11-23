import { degToRad } from '@physforge/physics-core';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
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
  getControlHandles: (state, params) => {
    const theta = degToRad(params.inclineDeg);
    const tangent = { x: Math.cos(theta), y: Math.sin(theta) };
    const normal = { x: -Math.sin(theta), y: Math.cos(theta) };
    const normalOffset = 0.12;
    return [{
      id: 'initial-compression',
      label: `x₀=${params.initialComp.toFixed(1)}m`,
      position: {
        x: state.s1 * tangent.x + normalOffset * normal.x,
        y: state.s1 * tangent.y + normalOffset * normal.y
      },
      handleKind: 'point',
      color: '#38bdf8',
      onDrag: (worldPos) => ({
        initialComp: Number(Math.max(0.4, Math.min(1.8, -(worldPos.x * tangent.x + worldPos.y * tangent.y))).toFixed(1))
      })
    }];
  },
  getForceVectors: (state, params): ForceVectorItem[] => {
    const theta = degToRad(params.inclineDeg);
    const tangent = { x: Math.cos(theta), y: Math.sin(theta) };
    const normal = { x: -Math.sin(theta), y: Math.cos(theta) };
    const blockWidth = 0.34;
    const blockHeight = 0.24;
    const normalOffset = blockHeight / 2;
    const center = (s: number) => ({
      x: s * tangent.x + normalOffset * normal.x,
      y: s * tangent.y + normalOffset * normal.y
    });
    const block1 = center(state.s1);
    const block2 = center(state.s2 + blockWidth);
    const springForce = -params.springK * state.s1;
    const contact = state.separated ? 0 : state.normalForceN;
    const vectors: ForceVectorItem[] = [
      {
        id: 'gravity-1', label: 'm₁g', origin: block1,
        force: { x: 0, y: -params.mass1 * CLASSROOM_GRAVITY },
        color: '#fbbf24', category: 'gravity'
      },
      {
        id: 'normal-1', label: 'N₁', origin: block1,
        force: { x: normal.x * params.mass1 * CLASSROOM_GRAVITY * Math.cos(theta), y: normal.y * params.mass1 * CLASSROOM_GRAVITY * Math.cos(theta) },
        color: '#38bdf8', category: 'normal'
      },
      {
        id: 'gravity-2', label: 'm₂g', origin: block2,
        force: { x: 0, y: -params.mass2 * CLASSROOM_GRAVITY },
        color: '#fbbf24', category: 'gravity'
      },
      {
        id: 'normal-2', label: 'N₂', origin: block2,
        force: { x: normal.x * params.mass2 * CLASSROOM_GRAVITY * Math.cos(theta), y: normal.y * params.mass2 * CLASSROOM_GRAVITY * Math.cos(theta) },
        color: '#38bdf8', category: 'normal'
      }
    ];
    if (Math.abs(springForce) > 1e-5) {
      vectors.push({
        id: 'spring-1', label: 'F_弹', origin: block1,
        force: { x: springForce * tangent.x, y: springForce * tangent.y },
        color: '#fbbf24', category: 'other'
      });
    }
    if (Math.abs(params.externalForce) > 1e-5) {
      vectors.push({
        id: 'external-2', label: 'F_外', origin: block2,
        force: { x: params.externalForce * tangent.x, y: params.externalForce * tangent.y },
        color: '#a78bfa', category: 'other'
      });
    }
    if (contact > 1e-5) {
      vectors.push(
        { id: 'contact-21', label: 'F₂₁', origin: block1, force: { x: -contact * tangent.x, y: -contact * tangent.y }, color: '#f472b6', category: 'normal' },
        { id: 'contact-12', label: 'F₁₂', origin: block2, force: { x: contact * tangent.x, y: contact * tangent.y }, color: '#f472b6', category: 'normal' }
      );
    }
    return vectors;
  },
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
    const ppm = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
    ctx.save();
    ctx.translate(viewport.width * 0.45 + viewport.offsetX, viewport.height * 0.5 + viewport.offsetY);
    ctx.rotate(-th);

    if (activeLayers.has('spring')) {
      const wallX = -2.2 * ppm;
      const b1X = state.s1 * ppm;
      const blockWidth = 0.34;
      const blockHeight = 0.24;
      const b2X = (state.s2 + blockWidth) * ppm;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(wallX, -blockHeight * ppm);
      ctx.lineTo(wallX, 0);
      ctx.lineTo(2.8 * ppm, 0);
      ctx.stroke();

      // Spring zigzag
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const sEnd = b1X - (blockWidth / 2) * ppm;
      ctx.moveTo(wallX, -20);
      for (let i = 1; i < 10; i++) {
        const sx = wallX + ((sEnd - wallX) * i) / 10;
        const sy = -20 + (i % 2 === 0 ? -9 : 9);
        ctx.lineTo(sx, sy);
      }
      ctx.lineTo(sEnd, -20);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(b1X - (blockWidth / 2) * ppm, -blockHeight * ppm, blockWidth * ppm, blockHeight * ppm);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(b2X - (blockWidth / 2) * ppm, -blockHeight * ppm, blockWidth * ppm, blockHeight * ppm);
    }

    if (activeLayers.has('eventPins') && state.separated && state.separationPosS !== null) {
      const sx = state.separationPosS * ppm;
      ctx.strokeStyle = '#4ade80';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx + 0.17 * ppm, -0.5 * ppm);
      ctx.lineTo(sx + 0.17 * ppm, 0.2 * ppm);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
});

export default mechSpringSeparationPlugin;
