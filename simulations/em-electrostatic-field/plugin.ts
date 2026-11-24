import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { electrostaticPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalPointChargePotentialAndField,
  extractElectrostaticIsolines,
  solveThreePointUniformField,
  stepElectrostatic,
  traceFieldLines,
  type ElectrostaticParams,
  type ElectrostaticState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ElectrostaticParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '静电场模型',
    defaultValue: 'dipole-point-charges',
    options: [
      { value: 'dipole-point-charges', label: '双点电荷叠加静电场' },
      { value: 'uniform-three-point', label: '匀强场三点等分求 E' },
      { value: 'deflection-tube', label: '先加速后偏转极板' }
    ]
  },
  { key: 'q1MicroC', kind: 'number', label: '源电荷 q₁', unit: 'μC', min: -5, max: 5, step: 0.5, defaultValue: 3 },
  { key: 'q2MicroC', kind: 'number', label: '源电荷 q₂', unit: 'μC', min: -5, max: 5, step: 0.5, defaultValue: -3 },
  { key: 'x1', kind: 'number', label: 'q₁ 位置 x₁', unit: 'm', min: -2.2, max: -0.3, step: 0.1, defaultValue: -1.2 },
  { key: 'x2', kind: 'number', label: 'q₂ 位置 x₂', unit: 'm', min: 0.3, max: 2.2, step: 0.1, defaultValue: 1.2 },
  { key: 'testChargeRatio', kind: 'number', label: '试探荷质比 q/m', unit: '', min: -2, max: 2, step: 0.2, defaultValue: 0.4 },
  { key: 'v0x', kind: 'number', label: '试探初速 vx₀', unit: 'm/s', min: -4, max: 5, step: 0.2, defaultValue: 2.2 },
  { key: 'v0y', kind: 'number', label: '试探初速 vy₀', unit: 'm/s', min: -3, max: 3, step: 0.2, defaultValue: 0.2 },
  { key: 'startY', kind: 'number', label: '试探入射高度 y₀', unit: 'm', min: -1.6, max: 1.6, step: 0.1, defaultValue: 0.9 },
  { key: 'uAccelV', kind: 'number', label: '加速电压 U₁', unit: 'V', min: 4, max: 32, step: 2, defaultValue: 16 },
  { key: 'uDeflectV', kind: 'number', label: '偏转电压 U₂', unit: 'V', min: -16, max: 16, step: 1, defaultValue: 8 },
  { key: 'phiA', kind: 'number', label: 'A点电势 φA', unit: 'V', min: -10, max: 10, step: 1, defaultValue: 0 },
  { key: 'phiB', kind: 'number', label: 'B点电势 φB', unit: 'V', min: -10, max: 12, step: 1, defaultValue: 4 },
  { key: 'phiC', kind: 'number', label: 'C点电势 φC', unit: 'V', min: -10, max: 20, step: 1, defaultValue: 12 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "two-charge-potential",
  "title": "两点电荷电势叠加（零势能参考在无穷远）",
  "latex": "\\varphi=k\\left(\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=q1MicroC}{q_1}}}{r_1}+\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=q2MicroC}{q_2}}}{r_2}\\right)",
  "bindings": [
    {
      "tokenKey": "q1MicroC",
      "paramKey": "q1MicroC",
      "label": "源电荷 q₁",
      "unit": "μC",
      "min": -5,
      "max": 5,
      "step": 0.5,
      "precision": 2
    },
    {
      "tokenKey": "q2MicroC",
      "paramKey": "q2MicroC",
      "label": "源电荷 q₂",
      "unit": "μC",
      "min": -5,
      "max": 5,
      "step": 0.5,
      "precision": 2
    }
  ]
}];
export const emElectrostaticFieldPlugin = Object.assign(defineSimulationPlugin<ElectrostaticParams, ElectrostaticState>({
  meta: {
    id: 'em-electrostatic-field',
    title: '多点电荷静电场、等势面与粒子偏转 (E01)',
    textbookRef: '人教版 必修第三册 第九、十章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: 0.85, offsetRatioX: 0.05 },
  paramSchema,
  presets: electrostaticPresets,
  engine: {
    createInitialState,
    step: stepElectrostatic,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'equipotentials', label: 'Marching Squares 等势线', defaultVisible: true },
    { id: 'fieldLines', label: 'RK4 双向电场线', defaultVisible: true },
    { id: 'particle', label: 'RK45 试探电荷与轨迹', defaultVisible: true },
    { id: 'profileCurve', label: '连线 E(x) 与 φ(x) 曲线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'phi', label: '所在处电势 φ', unit: 'V', color: '#fbbf24' },
    { key: 'eMag', label: '场强大小 |E|', unit: 'V/m', color: '#38bdf8' },
    { key: 'ek', label: '粒子动能 Ek', unit: 'J', color: '#4ade80' },
    { key: 'totalEnergy', label: '总能量 Ek+qφ', unit: 'J', color: '#f472b6' }
  ],
  getForceVectors: (state, params) => {
    const obs = computeObservables(state, params);
    const fx = params.testChargeRatio * (obs.Ex ?? 0);
    const fy = params.testChargeRatio * (obs.Ey ?? 0);
    return [
      {
        id: 'electric-force',
        label: 'qE',
        origin: { x: state.px, y: state.py },
        force: { x: fx, y: fy },
        category: 'electric',
        color: '#38bdf8'
      }
    ];
  },
  getControlHandles: (_s, params) =>
    params.mode === 'dipole-point-charges'
      ? [
          {
            id: 'q1-pos',
            label: `q₁=${params.q1MicroC}μC`,
            position: { x: params.x1, y: 0 },
            handleKind: 'point',
            color: params.q1MicroC >= 0 ? '#f43f5e' : '#38bdf8',
            onDrag: (wp) => ({ x1: Number(Math.max(-2.2, Math.min(-0.3, wp.x)).toFixed(1)) })
          },
          {
            id: 'q2-pos',
            label: `q₂=${params.q2MicroC}μC`,
            position: { x: params.x2, y: 0 },
            handleKind: 'point',
            color: params.q2MicroC >= 0 ? '#f43f5e' : '#38bdf8',
            onDrag: (wp) => ({ x2: Number(Math.max(0.3, Math.min(2.2, wp.x)).toFixed(1)) })
          }
        ]
      : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-electrostatic-field',
      title: '静电场与等势面偏转',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ElectrostaticParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: params.x1, cy: 0, r: 0.16, fill: true },
      { kind: 'circle', cx: params.x2, cy: 0, r: 0.16 },
      { kind: 'trajectory', points: state.trail.map((p) => ({ x: p.x, y: p.y })), strokeWidth: 2 },
      { kind: 'circle', cx: state.px, cy: state.py, r: 0.08, fill: true },
      {
        kind: 'mathLabel',
        x: 2.8,
        y: 1.8,
        text: `q_1=${params.q1MicroC},\\; q_2=${params.q2MicroC}`,
        align: 'end'
      }
    ];
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -3.2, minY: -2.2, maxX: 3.2, maxY: 2.2 },
      title: '静电场线与等势面偏转配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    ctx.save();

    if (activeLayers.has('equipotentials') && params.mode !== 'deflection-tube') {
      const contours = extractElectrostaticIsolines(params);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      for (const c of contours) {
        ctx.beginPath();
        for (const seg of c.segments) {
          const a = m.toScreen(seg.a.x, seg.a.y);
          const b = m.toScreen(seg.b.x, seg.b.y);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (activeLayers.has('fieldLines')) {
      if (params.mode === 'dipole-point-charges') {
        const lines = traceFieldLines(params);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        ctx.lineWidth = 1.5;
        for (const pts of lines) {
          if (pts.length < 2) continue;
          ctx.beginPath();
          const first = m.toScreen(pts[0]!.x, pts[0]!.y);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < pts.length; i++) {
            const point = m.toScreen(pts[i]!.x, pts[i]!.y);
            ctx.lineTo(point.x, point.y);
          }
          ctx.stroke();
        }
      } else if (params.mode === 'uniform-three-point') {
        const sol = solveThreePointUniformField(params);
        const pts = [
          { ...sol.A, name: `A(${sol.A.phi}V)` },
          { ...sol.B, name: `B(${sol.B.phi}V)` },
          { ...sol.C, name: `C(${sol.C.phi}V)` }
        ];
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        const a = m.toScreen(sol.A.x, sol.A.y);
        const b = m.toScreen(sol.B.x, sol.B.y);
        const c = m.toScreen(sol.C.x, sol.C.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.stroke();

        // Equal-potential segment B <-> equalPointOnAC
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.2;
        const equal = m.toScreen(sol.equalPointOnAC.x, sol.equalPointOnAC.y);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(equal.x, equal.y);
        ctx.stroke();

        // E vector
        const eMag = Math.hypot(sol.Ex, sol.Ey) || 1;
        const eOrigin = m.toScreen(0, 0);
        const eEnd = m.toScreen((sol.Ex / eMag) * 1.1, (sol.Ey / eMag) * 1.1);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(eOrigin.x, eOrigin.y);
        ctx.lineTo(eEnd.x, eEnd.y);
        ctx.stroke();

        for (const pt of pts) {
          const point = m.toScreen(pt.x, pt.y);
          ctx.beginPath();
          ctx.arc(point.x, point.y, m.len(0.025), 0, Math.PI * 2);
          ctx.fill();
          labels.push({ id: `uniform-point-${pt.name[0]}`, x: point.x, y: point.y - m.len(0.1), text: pt.name, color: '#e2e8f0', font: '12px sans-serif' });
        }
      } else {
        // Parallel plates
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 4;
        const plateLeftTop = m.toScreen(-1.0, 1.0);
        const plateRightTop = m.toScreen(1.0, 1.0);
        const plateLeftBottom = m.toScreen(-1.0, -1.0);
        const plateRightBottom = m.toScreen(1.0, -1.0);
        ctx.beginPath();
        ctx.moveTo(plateLeftTop.x, plateLeftTop.y);
        ctx.lineTo(plateRightTop.x, plateRightTop.y);
        ctx.moveTo(plateLeftBottom.x, plateLeftBottom.y);
        ctx.lineTo(plateRightBottom.x, plateRightBottom.y);
        ctx.stroke();
      }
    }

    if (params.mode === 'dipole-point-charges') {
      const drawCharge = (x: number, q: number, label: string) => {
        ctx.fillStyle = q > 0 ? '#f43f5e' : q < 0 ? '#38bdf8' : '#64748b';
        const point = m.toScreen(x, 0);
        ctx.beginPath();
        ctx.arc(point.x, point.y, m.len(0.075), 0, Math.PI * 2);
        ctx.fill();
        labels.push({ id: `charge-${label}`, x: point.x, y: point.y + m.len(0.15), text: `${label}${q > 0 ? '+' : ''}${q}`, color: '#fff', font: 'bold 12px sans-serif' });
      };
      drawCharge(params.x1, params.q1MicroC, 'q₁=');
      drawCharge(params.x2, params.q2MicroC, 'q₂=');
    }

    if (activeLayers.has('particle')) {
      if (state.trail.length > 1) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        const first = m.toScreen(state.trail[0]!.x, state.trail[0]!.y);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < state.trail.length; i++) {
          const point = m.toScreen(state.trail[i]!.x, state.trail[i]!.y);
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
      const particle = m.toScreen(state.px, state.py);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, m.len(0.04), 0, Math.PI * 2);
      ctx.fill();
    }

    if (activeLayers.has('profileCurve') && params.mode === 'dipole-point-charges') {
      const bx = viewport.width - 205;
      const by = 22;
      const bw = 185;
      const bh = 88;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i <= 50; i++) {
        const x = -2.8 + (i / 50) * 5.6;
        const val = Math.max(-5, Math.min(5, evalPointChargePotentialAndField(x, 0.25, params).phi));
        const px = bx + 10 + (i / 50) * (bw - 20);
        const py = by + bh * 0.55 - val * 6;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      labels.push({ id: 'potential-profile-title', x: bx + 95, y: by + 15, text: '连线邻域 φ(x) 分布', color: '#cbd5e1', font: '11px sans-serif' });
    }

    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    return [
      {
        id: 'electrostatic-state',
        label: '场强、电势与能量守恒',
        latex: 'E_{\\text{tot}} = E_k + q\\varphi',
        substitutedLatex: `\\varphi=${(obs.phi ?? 0).toFixed(3)}\\text{ V},\\; |E|=${(obs.eMag ?? 0).toFixed(3)},\\; E_{\\text{tot}}=${(obs.totalEnergy ?? 0).toFixed(4)}`
      }
    ];
  }
}), { liveFormulas });

export default emElectrostaticFieldPlugin;
