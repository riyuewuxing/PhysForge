import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { thermoCycleMdPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepThermoCycleMd,
  type ThermoCycleMdParams,
  type ThermoCycleMdState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ThermoCycleMdParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '热学体系',
    defaultValue: 'kinetic-md-box',
    options: [
      { value: 'kinetic-md-box', label: '空间哈希硬球分子 MD + 布朗运动' },
      { value: 'cycle-carnot', label: '卡诺循环 (等温 + 绝热)' },
      { value: 'cycle-rect-pv', label: 'P-V 矩形热力学循环' }
    ]
  },
  { key: 'molesN', kind: 'number', label: '理想气体摩尔数 n', unit: 'mol', min: 0.5, max: 3, step: 0.5, defaultValue: 1 },
  { key: 'tHotK', kind: 'number', label: '高温热源 T_H', unit: 'K', min: 400, max: 900, step: 50, defaultValue: 600 },
  { key: 'tColdK', kind: 'number', label: '低温热源 T_C', unit: 'K', min: 200, max: 450, step: 25, defaultValue: 300 },
  { key: 'compressionRatioV2OverV1', kind: 'number', label: '等温膨胀体积比 V₂/V₁', unit: '', min: 1.4, max: 4.0, step: 0.2, defaultValue: 2.5 },
  { key: 'rectPressureRatio', kind: 'number', label: '矩形循环压强比 P高/P低', unit: '', min: 1.4, max: 3.5, step: 0.2, defaultValue: 2.0 },
  { key: 'particleCountN', kind: 'number', label: 'MD 分子数 N', unit: '个', min: 100, max: 400, step: 50, defaultValue: 300 },
  { key: 'seed', kind: 'number', label: '确定性随机种子 seed', unit: '', min: 1, max: 99999999, step: 1, defaultValue: 20261122 },
  { key: 'brownianPollen', kind: 'boolean', label: '放入大质量布朗花粉微粒', defaultValue: true },
  { key: 'mdSpeedScale', kind: 'number', label: '温度/均方根速率倍率', unit: 'x', min: 0.5, max: 2.0, step: 0.25, defaultValue: 1.0 }
];

export const thermoCyclesKineticMdPlugin = defineSimulationPlugin<ThermoCycleMdParams, ThermoCycleMdState>({
  meta: {
    id: 'thermo-cycles-kinetic-md',
    title: '热力学循环与硬球分子动理论微观盒 (T02)',
    textbookRef: '人教版 选择性必修三 第一、三章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: thermoCycleMdPresets,
  engine: {
    createInitialState,
    step: stepThermoCycleMd,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'mainView', label: 'MD 微观分子盒 / P-V 闭环区', defaultVisible: true },
    { id: 'histogramOrTrail', label: '麦克斯韦速率直方图 / 布朗轨迹', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'kineticEnergy', label: '系统总动能 Ek (绝热守恒)', unit: 'J', color: '#4ade80' },
    { key: 'wallPressure', label: '分子碰撞器壁压强', unit: '', color: '#38bdf8' },
    { key: 'efficiencyPct', label: '热机循环效率 η', unit: '%', color: '#fbbf24' },
    { key: 'maxwellKs', label: '麦克斯韦 KS 偏差 D', unit: '', color: '#f472b6' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'thermo-cycles-kinetic-md',
      title: '热力学循环与 MD 气体盒',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ThermoCycleMdParams>
  },
  exportDiagramIR: (state, params) => {
    const pts = state.cycle.segments.flatMap((seg) =>
      seg.points.map((p) => ({ x: -2 + p.vL * 0.08, y: -1 + p.pKPa * 0.002 }))
    );
    const primitives: DiagramPrimitive[] =
      params.mode === 'kinetic-md-box'
        ? [
            { kind: 'rect', x: -1.5, y: -1.5, width: 3.0, height: 3.0 },
            { kind: 'trajectory', points: state.brownianTrail.map((p) => ({ x: (p.x / 10 - 0.5) * 3, y: (p.y / 10 - 0.5) * 3 })) }
          ]
        : [
            { kind: 'polyline', points: pts, closed: true },
            { kind: 'mathLabel', x: 1.8, y: 1.2, text: `\\eta=${(state.cycle.efficiency * 100).toFixed(1)}\\%`, align: 'end' }
          ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.8, maxX: 2.2, maxY: 1.8 },
      title: '热力学循环与布朗运动配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    ctx.save();

    if (params.mode === 'kinetic-md-box') {
      const boxPx = Math.min(w * 0.52, h * 0.82);
      const bx0 = w * 0.06;
      const by0 = 0.5 * (h - boxPx);
      const scale = boxPx / state.boxSize;

      if (activeLayers.has('mainView')) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.fillRect(bx0, by0, boxPx, boxPx);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.strokeRect(bx0, by0, boxPx, boxPx);

        for (const p of state.particles) {
          ctx.fillStyle = p.mass > 2 ? '#fbbf24' : '#38bdf8';
          ctx.beginPath();
          ctx.arc(bx0 + p.x * scale, by0 + boxPx - p.y * scale, Math.max(2, p.radius * scale), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (activeLayers.has('histogramOrTrail')) {
        if (state.brownianTrail.length > 1) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(bx0 + state.brownianTrail[0]!.x * scale, by0 + boxPx - state.brownianTrail[0]!.y * scale);
          for (let i = 1; i < state.brownianTrail.length; i++) {
            ctx.lineTo(bx0 + state.brownianTrail[i]!.x * scale, by0 + boxPx - state.brownianTrail[i]!.y * scale);
          }
          ctx.stroke();
        }

        // Maxwell speed histogram on right
        const hx = bx0 + boxPx + 24;
        const hw = w - hx - 20;
        const hy = by0 + boxPx;
        const hh = boxPx * 0.65;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(hx, hy - hh, hw, hh);
        const bins = new Array<number>(12).fill(0);
        const vMaxBin = 9 * Math.max(0.5, params.mdSpeedScale);
        for (const p of state.particles) {
          if (p.mass > 2) continue;
          const sp = Math.hypot(p.vx, p.vy);
          const idx = Math.min(11, Math.floor((sp / vMaxBin) * 12));
          bins[idx]!++;
        }
        const maxCnt = Math.max(1, ...bins);
        const bw = (hw - 16) / 12;
        ctx.fillStyle = '#4ade80';
        bins.forEach((c, i) => {
          const barH = (c / maxCnt) * (hh - 28);
          ctx.fillRect(hx + 8 + i * bw, hy - 8 - barH, bw - 3, barH);
        });
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '12px sans-serif';
        ctx.fillText(`分子速率分布 (${state.particles.length} 粒子)`, hx + 8, hy - hh + 18);
      }

      ctx.restore();
      return;
    }

    // Thermodynamic cycle P-V closed loop diagram
    const allPts = state.cycle.segments.flatMap((s) => s.points);
    const maxV = Math.max(10, ...allPts.map((p) => p.vL));
    const maxP = Math.max(200, ...allPts.map((p) => p.pKPa));
    const gx = w * 0.14;
    const gy = h * 0.8;
    const gw = w * 0.72;
    const gh = h * 0.62;
    const toPx = (vL: number) => gx + (vL / (maxV * 1.1)) * gw;
    const toPy = (pKPa: number) => gy - (pKPa / (maxP * 1.15)) * gh;

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, gy - gh);
    ctx.lineTo(gx, gy);
    ctx.lineTo(gx + gw, gy);
    ctx.stroke();

    const cols = ['#f43f5e', '#fbbf24', '#38bdf8', '#4ade80'];
    state.cycle.segments.forEach((seg, idx) => {
      if (seg.points.length < 2) return;
      ctx.strokeStyle = cols[idx % 4]!;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(toPx(seg.points[0]!.vL), toPy(seg.points[0]!.pKPa));
      for (let i = 1; i < seg.points.length; i++) {
        ctx.lineTo(toPx(seg.points[i]!.vL), toPy(seg.points[i]!.pKPa));
      }
      ctx.stroke();
    });

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '13px sans-serif';
    ctx.fillText(
      `循环净功 W=${state.cycle.sumWJ.toFixed(1)} J | 热效率 η=${(state.cycle.efficiency * 100).toFixed(2)}% (卡诺上限 ${(state.cycle.carnotEfficiency * 100).toFixed(2)}%)`,
      gx,
      gy - gh - 14
    );

    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'thermo-first-law',
      label: params.mode === 'kinetic-md-box' ? '微观分子热运动动能统计' : '热力学第一定律与循环效率',
      latex:
        params.mode === 'kinetic-md-box'
          ? 'E_k = \\sum \\frac{1}{2}m_i v_i^2'
          : '\\Delta U = Q - W,\\quad \\eta = \\frac{W_{\\text{净}}}{Q_{\\text{吸}}}',
      substitutedLatex:
        params.mode === 'kinetic-md-box'
          ? `N=${state.particles.length},\\; E_k=${state.kineticEnergy.toFixed(2)}\\text{ J},\\; P_{\\text{壁}}=${state.wallPressure.toFixed(2)}`
          : `W_{\\text{净}}=${state.cycle.sumWJ.toFixed(1)}\\text{ J},\\; \\eta=${(state.cycle.efficiency * 100).toFixed(2)}\\%`
    }
  ]
});

export default thermoCyclesKineticMdPlugin;
