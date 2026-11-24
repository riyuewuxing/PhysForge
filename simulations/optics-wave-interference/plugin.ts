import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { waveOpticsPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalFraunhoferGratingIntensity,
  evalNewtonRingIntensity,
  evalThinFilmIntensity,
  stepWaveOptics,
  type WaveOpticsParams,
  type WaveOpticsState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WaveOpticsParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '波动光学实验',
    defaultValue: 'thin-film-wedge',
    options: [
      { value: 'thin-film-wedge', label: '薄膜 / 空气劈尖等厚干涉' },
      { value: 'newtons-rings', label: '牛顿环同心等厚条纹' },
      { value: 'single-slit-grating', label: '夫琅禾费单缝/光栅衍射与缺级' }
    ]
  },
  { key: 'wavelengthNm', kind: 'number', label: '入射单色光波长 λ', unit: 'nm', min: 400, max: 700, step: 5, defaultValue: 589 },
  { key: 'refractiveIndexN2', kind: 'number', label: '薄膜折射率 n₂', unit: '', min: 1.0, max: 1.8, step: 0.05, defaultValue: 1.0 },
  { key: 'wedgeAngleDeg', kind: 'number', label: '劈尖夹角 α', unit: '°', min: 0.006, max: 0.03, step: 0.002, defaultValue: 0.012 },
  {
    key: 'defectMode',
    kind: 'select',
    label: '待测面微形貌缺陷',
    defaultValue: 'flat',
    options: [
      { value: 'flat', label: '理想光学平面' },
      { value: 'bump', label: '局部微凸起（条纹向棱边弯）' },
      { value: 'pit', label: '局部微凹陷（条纹向厚端弯）' }
    ]
  },
  { key: 'lensRadiusR', kind: 'number', label: '牛顿环透镜曲率半径 R', unit: 'm', min: 0.5, max: 5, step: 0.25, defaultValue: 2.0 },
  { key: 'slitWidthMicron', kind: 'number', label: '单缝宽度 a', unit: 'μm', min: 1, max: 12, step: 0.5, defaultValue: 4 },
  { key: 'gratingPitchMicron', kind: 'number', label: '光栅常数 d', unit: 'μm', min: 4, max: 30, step: 1, defaultValue: 12 },
  { key: 'slitCountN', kind: 'number', label: '相干狭缝数 N', unit: '条', min: 1, max: 12, step: 1, defaultValue: 6 },
  { key: 'halfWaveLoss', kind: 'boolean', label: '计入界面反射半波损失', defaultValue: true }
];


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "wedge-fringe",
  "title": "劈尖等厚干涉（近法线入射）",
  "latex": "\\Delta x=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=wavelengthNm}{\\lambda}}}{2\\htmlClass{pf-live-var}{\\htmlData{param=refractiveIndexN2}{n}}\\tan \\htmlClass{pf-live-var}{\\htmlData{param=wedgeAngleDeg}{\\alpha}}}",
  "bindings": [
    {
      "tokenKey": "wavelengthNm",
      "paramKey": "wavelengthNm",
      "label": "入射单色光波长 λ",
      "unit": "nm",
      "min": 400,
      "max": 700,
      "step": 5,
      "precision": 1
    },
    {
      "tokenKey": "refractiveIndexN2",
      "paramKey": "refractiveIndexN2",
      "label": "薄膜折射率 n₂",
      "unit": "",
      "min": 1,
      "max": 1.8,
      "step": 0.05,
      "precision": 3
    },
    {
      "tokenKey": "wedgeAngleDeg",
      "paramKey": "wedgeAngleDeg",
      "label": "劈尖夹角 α",
      "unit": "°",
      "min": 0.006,
      "max": 0.03,
      "step": 0.002,
      "precision": 4
    }
  ]
}];
export const opticsWaveInterferencePlugin = Object.assign(defineSimulationPlugin<WaveOpticsParams, WaveOpticsState>({
  meta: {
    id: 'optics-wave-interference',
    title: '光的波动性进阶：劈尖、牛顿环与光栅缺级 (O01)',
    textbookRef: '人教版 选择性必修一 第四章 第4–6节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: waveOpticsPresets,
  engine: {
    createInitialState,
    step: stepWaveOptics,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'fringes', label: '真实波长 RGB 干涉/衍射图样', defaultVisible: true },
    { id: 'intensityCurve', label: '归一化相对光强 I/I₀ 包络线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'wedgeFringeSpacingMm', label: '劈尖条纹间距 Δx', unit: 'mm', color: '#38bdf8' },
    { key: 'newtonFirstDarkMm', label: '牛顿环第1暗环 r₁', unit: 'mm', color: '#fbbf24' },
    { key: 'missingOrderRatio', label: '光栅缺级比 d/a', unit: '', color: '#f472b6' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'wavelength-tune',
      label: `λ=${params.wavelengthNm}nm`,
      position: { x: ((params.wavelengthNm - 550) / 150) * 1.6, y: -0.9 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({
        wavelengthNm: Math.round(Math.max(400, Math.min(700, 550 + (wp.x / 1.6) * 150)) / 5) * 5
      })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'optics-wave-interference',
      title: '波动光学干涉与衍射',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WaveOpticsParams>
  },
  exportDiagramIR: (state, params) => {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = -2.2 + (i / 60) * 4.4;
      const intensity =
        params.mode === 'single-slit-grating'
          ? evalFraunhoferGratingIntensity((x / 2.2) * 0.25, params)
          : evalThinFilmIntensity((i / 60) * 20, params);
      pts.push({ x, y: -0.6 + intensity * 1.4 });
    }
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.4, y1: -0.6, x2: 2.4, y2: -0.6 },
      { kind: 'polyline', points: pts },
      {
        kind: 'mathLabel',
        x: 2.2,
        y: 1.2,
        text: `\\lambda=${params.wavelengthNm}\\text{nm},\\; d/a=${state.missingOrderRatio.toFixed(1)}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.6, minY: -1.0, maxX: 2.6, maxY: 1.5 },
      title: '光学干涉与衍射光强分布图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const rgbHex = state.rgbHex;
    const labels: CanvasLabel[] = [];
    const fillWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    ctx.save();

    if (params.mode === 'newtons-rings') {
      const center = m.toScreen(0, 0);
      const maxPx = m.len(1.5);
      const maxRMm = 5.0;

      if (activeLayers.has('fringes')) {
        const rings = 90;
        for (let k = rings; k >= 1; k--) {
          const rMm = (k / rings) * maxRMm;
          const intensity = evalNewtonRingIntensity(rMm, params);
          ctx.fillStyle = rgbHex;
          ctx.globalAlpha = 0.08 + 0.88 * intensity;
          ctx.beginPath();
          ctx.arc(center.x, center.y, (k / rings) * maxPx, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (activeLayers.has('intensityCurve')) {
        const graphLeft = -1.8;
        const graphRight = 1.8;
        const graphBase = -0.55;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 140; i++) {
          const rMm = ((i / 140) * 2 - 1) * maxRMm;
          const val = evalNewtonRingIntensity(rMm, params);
          const point = m.toScreen(graphLeft + (i / 140) * (graphRight - graphLeft), graphBase + val * 0.65);
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        const summary = m.toScreen(0, -0.72);
        labels.push({ id: 'newton-ring-summary', x: summary.x, y: summary.y, text: `牛顿环 · R=${params.lensRadiusR.toFixed(2)}m · r₁=${state.newtonFirstDarkMm.toFixed(3)}mm`, color: '#fbbf24', font: '12px sans-serif' });
      }
    } else {
      const bandLeft = -2;
      const bandWidth = 4;
      const bandBottom = 0.05;
      const bandHeight = 1.4;
      const cols = 160;

      if (activeLayers.has('fringes')) {
        for (let i = 0; i < cols; i++) {
          const frac = i / cols;
          const intensity = params.mode === 'thin-film-wedge'
            ? evalThinFilmIntensity(frac * 20, params)
            : evalFraunhoferGratingIntensity((frac - 0.5) * 0.42, params);
          ctx.fillStyle = rgbHex;
          ctx.globalAlpha = 0.05 + 0.92 * intensity;
          fillWorldRect(bandLeft + frac * bandWidth, bandBottom, bandWidth / cols + 0.005, bandHeight);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(148,163,184,0.4)';
        const a = m.toScreen(bandLeft, bandBottom + bandHeight);
        const b = m.toScreen(bandLeft + bandWidth, bandBottom);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }

      if (activeLayers.has('intensityCurve')) {
        const graphLeft = -1.8;
        const graphWidth = 3.6;
        const graphBase = -0.55;
        ctx.strokeStyle = rgbHex;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let i = 0; i <= cols; i++) {
          const frac = i / cols;
          const intensity = params.mode === 'thin-film-wedge'
            ? evalThinFilmIntensity(frac * 20, params)
            : evalFraunhoferGratingIntensity((frac - 0.5) * 0.42, params);
          const point = m.toScreen(graphLeft + frac * graphWidth, graphBase + intensity * 0.75);
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        const summary = m.toScreen(0, -0.82);
        labels.push({
          id: 'wave-optics-summary',
          x: summary.x,
          y: summary.y,
          text: params.mode === 'thin-film-wedge'
            ? `劈尖条纹间距 Δx = ${state.wedgeFringeSpacingMm.toFixed(3)} mm`
            : `光栅 d/a = ${state.missingOrderRatio.toFixed(2)}（整数倍发生缺级）`,
          color: '#cbd5e1',
          font: '12px sans-serif'
        });
      }
    }

    const railLeft = m.toScreen(-1.6, -0.9);
    const railRight = m.toScreen(1.6, -0.9);
    ctx.strokeStyle = 'rgba(251,191,36,0.35)';
    ctx.lineWidth = m.len(0.08);
    ctx.beginPath();
    ctx.moveTo(railLeft.x, railLeft.y);
    ctx.lineTo(railRight.x, railRight.y);
    ctx.stroke();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railLeft.x, railLeft.y);
    ctx.lineTo(railRight.x, railRight.y);
    ctx.stroke();
    const wavelengthLabel = m.toScreen(0, -1.12);
    labels.push({ id: 'wavelength-control-rail', x: wavelengthLabel.x, y: wavelengthLabel.y, text: `波长 λ=${params.wavelengthNm} nm`, color: '#fbbf24', font: 'bold 12px sans-serif' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'wave-optics-eq',
      label: '薄膜等厚与光栅衍射定律',
      latex: '\\Delta x = \\frac{\\lambda}{2n\\tan\\alpha},\\quad I(\\theta)=I_0\\left(\\frac{\\sin\\beta}{\\beta}\\right)^2\\left(\\frac{\\sin N\\gamma}{N\\sin\\gamma}\\right)^2',
      substitutedLatex: `\\lambda=${params.wavelengthNm}\\text{ nm},\\; \\Delta x=${state.wedgeFringeSpacingMm.toFixed(3)}\\text{ mm},\\; r_1=${state.newtonFirstDarkMm.toFixed(3)}\\text{ mm}`
    }
  ]
}), { liveFormulas });

export default opticsWaveInterferencePlugin;
