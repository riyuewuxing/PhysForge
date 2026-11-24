import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { waveFdtdPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepWaveFdtd,
  type WaveFdtdParams,
  type WaveFdtdState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WaveFdtdParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '波动池实验',
    defaultValue: 'double-slit',
    options: [
      { value: 'double-slit', label: '双缝干涉（时间平均强度屏）' },
      { value: 'single-slit', label: '单缝明显衍射' },
      { value: 'obstacle-diffraction', label: '障碍物绕射' },
      { value: 'refraction-prism', label: '斜界面介质折射 c(x,y)' }
    ]
  },
  { key: 'wavelengthCells', kind: 'number', label: '入射波长 λ (网格)', unit: 'px', min: 6, max: 20, step: 1, defaultValue: 10 },
  { key: 'waveSpeed', kind: 'number', label: '参考波速 c₀', unit: 'm/s', min: 0.5, max: 2.0, step: 0.1, defaultValue: 1.0 },
  { key: 'amplitude', kind: 'number', label: '波源振幅 A', unit: '', min: 0, max: 1.5, step: 0.1, defaultValue: 1.0 },
  { key: 'slitSepCells', kind: 'number', label: '双缝间距 d (网格)', unit: 'px', min: 14, max: 52, step: 2, defaultValue: 30 },
  { key: 'slitWidthCells', kind: 'number', label: '缝宽 / 障碍半宽', unit: 'px', min: 3, max: 20, step: 1, defaultValue: 5 },
  { key: 'refractiveIndexN', kind: 'number', label: '右侧介质折射率 n', unit: '', min: 1, max: 2.5, step: 0.1, defaultValue: 1.6 }
];

export const wave2dRippleFdtdPlugin = defineSimulationPlugin<WaveFdtdParams, WaveFdtdState>({
  meta: {
    id: 'wave-2d-ripple-fdtd',
    title: '2D FDTD 波动池衍射、折射与干涉 (W02)',
    textbookRef: '人教版 选择性必修一 第三、四章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: waveFdtdPresets,
  defaultView: { offsetRatioX: -0.04 },
  engine: {
    createInitialState,
    step: stepWaveFdtd,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'waveField', label: '2D 波面振幅伪彩场 u(x,y)', defaultVisible: true },
    { id: 'screenProfile', label: '右侧接收屏强度 ⟨u²(y)⟩ 曲线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'courantNumber', label: 'CFL 稳定系数', unit: '', color: '#4ade80' },
    { key: 'maxAmplitude', label: '场域峰值振幅', unit: '', color: '#38bdf8' },
    { key: 'centerScreenIntensity', label: '屏中心强度 ⟨u²⟩', unit: '', color: '#fbbf24' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'slit-sep',
      label: `d=${params.slitSepCells}格`,
      position: { x: -0.6, y: params.slitSepCells * 0.025 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({ slitSepCells: Math.round(Math.max(14, Math.min(52, Math.abs(wp.y) / 0.025)) / 2) * 2 })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'wave-2d-ripple-fdtd',
      title: '2D FDTD 波动池',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WaveFdtdParams>
  },
  exportDiagramIR: (_s, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -0.6, y1: -1.4, x2: -0.6, y2: 1.4, strokeWidth: 3 },
      { kind: 'line', x1: 1.8, y1: -1.4, x2: 1.8, y2: 1.4, dashed: true },
      {
        kind: 'mathLabel',
        x: 1.7,
        y: 1.25,
        text: `\\lambda=${params.wavelengthCells}\\text{px},\\; d=${params.slitSepCells}\\text{px}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.6, maxX: 2.2, maxY: 1.6 },
      title: '2D 波动池双缝干涉配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, _params, viewport, activeLayers) => {
    const nx = state.nx;
    const ny = state.ny;
    const m = createWorldMapper(viewport);
    const centerJ = Math.floor(ny / 2);
    const leftI = Math.max(0, state.wallI - 28);
    const topJ = Math.max(0, centerJ - 24);
    const columns = Math.min(68, nx - leftI);
    const rows = Math.min(48, ny - topJ);
    const gridTopLeft = m.toScreen(-2, 1.2);
    const cell = m.len(0.05);

    ctx.save();
    if (activeLayers.has('waveField')) {
      // Show a cropped physical window at the solver's 0.05 m cell pitch.
      const invMax = 1 / Math.max(0.25, state.maxAmplitude * 0.7);

      for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < columns; i += 1) {
          const solverI = leftI + i;
          const solverJ = topJ + j;
          const idx = solverJ * nx + solverI;
          const spd = state.speedSnapshot[idx]!;
          if (spd === 0) {
            ctx.fillStyle = '#94a3b8';
          } else {
            const v = Math.max(-1, Math.min(1, state.fieldSnapshot[idx]! * invMax));
            if (v >= 0) {
              const c = Math.round(v * 230);
              ctx.fillStyle = `rgb(${Math.round(c * 0.2)}, ${Math.round(c * 0.75)}, ${c})`;
            } else {
              const c = Math.round(-v * 230);
              ctx.fillStyle = `rgb(${c}, ${Math.round(c * 0.35)}, ${Math.round(c * 0.55)})`;
            }
          }
          ctx.fillRect(gridTopLeft.x + i * cell, gridTopLeft.y + j * cell, cell + 0.5, cell + 0.5);
        }
      }

      ctx.strokeStyle = 'rgba(148,163,184,0.4)';
      ctx.strokeRect(gridTopLeft.x, gridTopLeft.y, m.len(3.4), m.len(2.4));
      const wallX = m.toScreen(-0.6, 0).x;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = m.len(0.012);
      ctx.beginPath();
      ctx.moveTo(wallX, m.toScreen(0, 1.2).y);
      ctx.lineTo(wallX, m.toScreen(0, -1.2).y);
      ctx.stroke();
    }

    if (activeLayers.has('screenProfile')) {
      const profileTopLeft = m.toScreen(1.55, 1.2);
      const profileBottomRight = m.toScreen(2.15, -1.2);
      const sx0 = profileTopLeft.x;
      const y0 = profileTopLeft.y;
      const sw = profileBottomRight.x - sx0;
      const drawH = profileBottomRight.y - y0;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(sx0, y0, sw, drawH);
      let maxI = 1e-6;
      for (let j = 16; j < ny - 16; j++) {
        if (state.screenIntensity[j]! > maxI) maxI = state.screenIntensity[j]!;
      }

      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let j = 16; j < ny - 16; j++) {
        const px = profileTopLeft.x + (state.screenIntensity[j]! / maxI) * sw;
        const py = m.toScreen(0, 1.2 - ((j - 16) / (ny - 32)) * 2.4).y;
        if (j === 16) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.fillText('探测屏 ⟨u²⟩', sx0 + 4, y0 + 16);
    }

    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'fdtd-cfl',
      label: 'FDTD 稳定性与双缝间距定理',
      latex: 'r=\\frac{c\\Delta t}{\\Delta x} < \\frac{1}{\\sqrt{2}},\\quad \\Delta y \\approx \\frac{L}{d}\\lambda',
      substitutedLatex: `r=${state.courantNumber.toFixed(3)},\\; \\text{step}=${state.stepsRun},\\; \\lambda=${params.wavelengthCells}\\text{px}`
    }
  ]
});

export default wave2dRippleFdtdPlugin;
