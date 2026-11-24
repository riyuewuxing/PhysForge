import { degToRad, radToDeg } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { shmResonancePresets } from './presets.js';
import {
  checkInvariants,
  computeNaturalOmega,
  computeObservables,
  computeTheoreticalResonanceOmega,
  createInitialState,
  stepShmResonance,
  type ShmResonanceParams,
  type ShmResonanceState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ShmResonanceParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '振动模式',
    defaultValue: 'pendulum-compare',
    options: [
      { value: 'pendulum-compare', label: '非线性摆 vs 简谐幽灵摆' },
      { value: 'damped-free', label: '阻尼自由衰减振动' },
      { value: 'forced-resonance', label: '受迫振动与共振峰' }
    ]
  },
  { key: 'lengthL', kind: 'number', label: '摆长 L', unit: 'm', min: 0.4, max: 3, step: 0.1, defaultValue: 1 },
  { key: 'gravityG', kind: 'number', label: '重力加速度 g', unit: 'm/s²', min: 1.6, max: 20, step: 0.2, defaultValue: 9.8 },
  { key: 'massM', kind: 'number', label: '摆球质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'initialAngleDeg', kind: 'number', label: '初始摆角 θ₀', unit: '°', min: 1, max: 90, step: 1, defaultValue: 20 },
  { key: 'dampingGamma', kind: 'number', label: '阻尼系数 γ', unit: 's⁻¹', min: 0, max: 1.2, step: 0.05, defaultValue: 0.45 },
  { key: 'driveAccelAmp', kind: 'number', label: '受迫驱动幅值 F₀/mL', unit: 's⁻²', min: 0, max: 3, step: 0.1, defaultValue: 0.8 },
  { key: 'driveOmega', kind: 'number', label: '驱动角频率 ωd', unit: 'rad/s', min: 0.5, max: 8, step: 0.05, defaultValue: 3.06 }
];

export const mechShmResonancePlugin = defineSimulationPlugin<ShmResonanceParams, ShmResonanceState>({
  meta: {
    id: 'mech-shm-resonance',
    title: '简谐振动、非线性单摆与受迫共振 (M11)',
    textbookRef: '人教版 选择性必修一 第二章',
    curriculumTags: ['物理观念', '科学探究', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: 1, offsetRatioX: -0.01, offsetRatioY: -0.34 },
  paramSchema,
  presets: shmResonancePresets,
  engine: {
    createInitialState,
    step: stepShmResonance,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'pendulum', label: '非线性摆与等时性幽灵摆', defaultVisible: true },
    { id: 'referenceCircle', label: '参考圆投影联动', defaultVisible: true },
    { id: 'resonanceCurve', label: '幅频共振响应曲线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'thetaRad', label: '摆角 θ (x轴相图)', unit: 'rad', color: '#38bdf8' },
    { key: 'omega', label: '角速度 ω (y轴相图)', unit: 'rad/s', color: '#4ade80' },
    { key: 'thetaLinearRad', label: '简谐幽灵摆 θ_lin', unit: 'rad', color: '#f472b6' },
    { key: 'mechanicalEnergy', label: '机械能 E', unit: 'J', color: '#fbbf24' }
  ],
  getForceVectors: (state, params) => {
    const L = params.lengthL;
    const bx = L * Math.sin(state.theta);
    const by = -L * Math.cos(state.theta);
    const tMag = params.massM * params.gravityG * Math.cos(state.theta) + params.massM * L * state.omega * state.omega;
    return [
      {
        id: 'mg',
        origin: { x: bx, y: by },
        force: { x: 0, y: -params.massM * params.gravityG },
        label: 'mg',
        category: 'gravity',
        color: '#f59e0b'
      },
      {
        id: 'tension',
        origin: { x: bx, y: by },
        force: { x: -tMag * Math.sin(state.theta), y: tMag * Math.cos(state.theta) },
        label: 'T',
        category: 'tension',
        color: '#38bdf8'
      }
    ];
  },
  getControlHandles: (_s, params) => {
    const L = params.lengthL;
    const rad = degToRad(params.initialAngleDeg);
    return [
      {
        id: 'initial-angle',
        label: `θ₀=${params.initialAngleDeg.toFixed(0)}°`,
        position: { x: L * Math.sin(rad), y: -L * Math.cos(rad) },
        handleKind: 'angle',
        color: '#38bdf8',
        onDrag: (wp) => {
          const deg = Math.abs(radToDeg(Math.atan2(wp.x, -wp.y)));
          return { initialAngleDeg: Number(Math.max(1, Math.min(90, deg)).toFixed(0)) };
        }
      }
    ];
  },
  referenceFrames: [
    {
      id: 'shm-bob',
      label: '摆球随动参考系',
      getOrigin: (s, p) => ({ x: p.lengthL * Math.sin(s.theta), y: -p.lengthL * Math.cos(s.theta) }),
      getVelocity: (s, p) => ({ x: p.lengthL * Math.cos(s.theta) * s.omega, y: p.lengthL * Math.sin(s.theta) * s.omega })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-shm-resonance',
      title: '简谐与受迫共振模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ShmResonanceParams>
  },
  exportDiagramIR: (state, params) => {
    const L = params.lengthL;
    const bx = L * Math.sin(state.theta);
    const by = -L * Math.cos(state.theta);
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -0.6, y1: 0, x2: 0.6, y2: 0, strokeWidth: 2 },
      { kind: 'line', x1: 0, y1: 0, x2: 0, y2: -L - 0.2, dashed: true },
      { kind: 'line', x1: 0, y1: 0, x2: bx, y2: by },
      { kind: 'circle', cx: bx, cy: by, r: 0.1 },
      {
        kind: 'arcAngle',
        cx: 0,
        cy: 0,
        r: 0.35,
        startAngle: -90,
        endAngle: -90 + radToDeg(state.theta),
        label: '\\theta'
      },
      {
        kind: 'mathLabel',
        x: 1.5,
        y: -0.3,
        text: `L=${L.toFixed(1)}\\text{m},\\; \\omega_0=${computeNaturalOmega(params).toFixed(2)}`,
        align: 'end'
      }
    ];
    return {
      width: 640,
      height: 440,
      viewBox: { minX: -1.8, minY: -2.2, maxX: 1.8, maxY: 0.4 },
      title: '单摆与受迫振动配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const pivot = m.toScreen(0, 0);
    const pivotX = pivot.x;
    const pivotY = pivot.y;
    const L = params.lengthL;

    ctx.save();

    if (activeLayers.has('pendulum')) {
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(m.toX(-0.324), pivotY);
      ctx.lineTo(m.toX(0.324), pivotY);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(148,163,184,0.3)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      const ghostAnchor = m.toScreen(0, -(L + 0.3));
      ctx.lineTo(ghostAnchor.x, ghostAnchor.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const ghostBob = m.toScreen(L * Math.sin(state.thetaLinear), -L * Math.cos(state.thetaLinear));
      const gx = ghostBob.x;
      const gy = ghostBob.y;
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(244, 114, 182, 0.45)';
      ctx.beginPath();
      ctx.arc(gx, gy, m.len(0.046), 0, Math.PI * 2);
      ctx.fill();

      const bob = m.toScreen(L * Math.sin(state.theta), -L * Math.cos(state.theta));
      const bx = bob.x;
      const by = bob.y;
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(bx, by, m.len(0.06), 0, Math.PI * 2);
      ctx.fill();

      if (activeLayers.has('referenceCircle')) {
        const amp = Math.max(0.08, degToRad(params.initialAngleDeg) * L);
        const rPx = amp * m.ppm;
        const referenceCenter = m.toScreen(0, -(L + 0.55 + amp));
        const cyRef = referenceCenter.y;
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(referenceCenter.x, cyRef, rPx, 0, Math.PI * 2);
        ctx.stroke();

        const xProj = bx;
        const dxWorld = Math.max(-amp, Math.min(amp, L * Math.sin(state.theta)));
        const yCirc = m.toScreen(dxWorld, -(L + 0.55 + amp) - Math.sqrt(Math.max(0, amp * amp - dxWorld * dxWorld))).y;
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(xProj, yCirc);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(xProj, yCirc, m.len(0.023), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (activeLayers.has('resonanceCurve') && params.mode === 'forced-resonance') {
      const boxW = 190;
      const boxH = 110;
      const bx0 = viewport.width - boxW - 22;
      const by0 = 28;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(bx0, by0, boxW, boxH);
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.strokeRect(bx0, by0, boxW, boxH);

      const w0 = computeNaturalOmega(params);
      const wMax = Math.max(6, w0 * 2);
      const g = params.dampingGamma;
      const ampOf = (w: number) => {
        const d1 = w0 * w0 - w * w;
        const d2 = 2 * g * w;
        return params.driveAccelAmp / Math.max(0.08, Math.hypot(d1, d2));
      };
      const peakA = Math.max(0.1, ampOf(computeTheoreticalResonanceOmega(params)));

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const w = 0.2 + (i / 60) * (wMax - 0.2);
        const px = bx0 + 14 + (w / wMax) * (boxW - 26);
        const py = by0 + boxH - 18 - (ampOf(w) / peakA) * (boxH - 38);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      const curPx = bx0 + 14 + (params.driveOmega / wMax) * (boxW - 26);
      const curPy = by0 + boxH - 18 - (ampOf(params.driveOmega) / peakA) * (boxH - 38);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(curPx, curPy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.fillText(`共振曲线 (ω_res=${computeTheoreticalResonanceOmega(params).toFixed(2)})`, bx0 + 10, by0 + 16);
    }

    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const w0 = computeNaturalOmega(params);
    const wRes = computeTheoreticalResonanceOmega(params);
    const obs = computeObservables(state, params);
    return [
      {
        id: 'pendulum-freq',
        label: '固有角频率与周期',
        latex: '\\omega_0 = \\sqrt{\\frac{g}{L}}, \\quad T_0 = 2\\pi\\sqrt{\\frac{L}{g}}',
        substitutedLatex: `\\omega_0=${w0.toFixed(3)}\\text{ rad/s},\\; T_0=${((2 * Math.PI) / w0).toFixed(4)}\\text{ s}`
      },
      {
        id: 'pendulum-state',
        label: params.mode === 'forced-resonance' ? '受迫共振峰对比' : '非线性角与小角对比',
        latex: params.mode === 'forced-resonance' ? '\\omega_{\\text{res}} = \\sqrt{\\omega_0^2 - 2\\gamma^2}' : '\\theta \\text{ vs } \\theta_{\\text{lin}}',
        substitutedLatex:
          params.mode === 'forced-resonance'
            ? `\\omega_{\\text{res}}=${wRes.toFixed(3)}\\text{ rad/s},\\; \\omega_d=${params.driveOmega.toFixed(2)}`
            : `\\theta=${(obs.thetaDeg ?? 0).toFixed(2)}^\\circ,\\; \\theta_{\\text{lin}}=${(obs.thetaLinearDeg ?? 0).toFixed(2)}^\\circ`
      }
    ];
  }
});

export default mechShmResonancePlugin;
