import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
  defaultView: { offsetRatioX: -0.05 },
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
    const m = createWorldMapper(viewport);
    ctx.save();
    const labels: CanvasLabel[] = [];

    if (params.mode === 'kinetic-md-box') {
      const boxLeft = -1.9;
      const boxBottom = -1;
      const boxSizeWorld = 2;

      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      const speedRailTop = m.toScreen(0.22, 0.5);
      const speedRailBottom = m.toScreen(0.22, -0.9);
      ctx.beginPath();
      ctx.moveTo(speedRailTop.x, speedRailTop.y);
      ctx.lineTo(speedRailBottom.x, speedRailBottom.y);
      ctx.stroke();

      if (activeLayers.has('mainView')) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        const topLeft = m.toScreen(boxLeft, boxBottom + boxSizeWorld);
        ctx.fillRect(topLeft.x, topLeft.y, m.len(boxSizeWorld), m.len(boxSizeWorld));
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = m.len(0.014);
        ctx.strokeRect(topLeft.x, topLeft.y, m.len(boxSizeWorld), m.len(boxSizeWorld));

        for (const p of state.particles) {
          ctx.fillStyle = p.mass > 2 ? '#fbbf24' : '#38bdf8';
          ctx.beginPath();
          const point = m.toScreen(boxLeft + (p.x / state.boxSize) * boxSizeWorld, boxBottom + (p.y / state.boxSize) * boxSizeWorld);
          ctx.arc(point.x, point.y, m.len(Math.max(0.012, (p.radius / state.boxSize) * boxSizeWorld)), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (activeLayers.has('histogramOrTrail')) {
        if (state.brownianTrail.length > 1) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          const first = m.toScreen(boxLeft + (state.brownianTrail[0]!.x / 10) * boxSizeWorld, boxBottom + (state.brownianTrail[0]!.y / 10) * boxSizeWorld);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < state.brownianTrail.length; i++) {
            const point = m.toScreen(boxLeft + (state.brownianTrail[i]!.x / 10) * boxSizeWorld, boxBottom + (state.brownianTrail[i]!.y / 10) * boxSizeWorld);
            ctx.lineTo(point.x, point.y);
          }
          ctx.stroke();
        }

        // Maxwell speed histogram on right
        const histTopLeft = m.toScreen(0.3, 0.2);
        const histBottomRight = m.toScreen(2.1, -1);
        const hx = histTopLeft.x;
        const hy = histBottomRight.y;
        const hw = histBottomRight.x - hx;
        const hh = hy - histTopLeft.y;
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
        ctx.fillStyle = '#4ade80';
        bins.forEach((c, i) => {
          const barTop = m.toScreen(0.3 + i * 0.15, -1 + (c / maxCnt) * 1.0);
          ctx.fillRect(barTop.x, barTop.y, m.len(0.12), m.len((c / maxCnt) * 1.0));
        });
        labels.push({ id: 'maxwell-histogram-title', x: hx + m.len(0.5), y: histTopLeft.y + m.len(0.08), text: `分子速率分布 (${state.particles.length} 粒子)`, color: '#cbd5e1', font: '12px sans-serif' });
      }

      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    // Thermodynamic cycle P-V closed loop diagram
    const allPts = state.cycle.segments.flatMap((s) => s.points);
    const maxV = Math.max(10, ...allPts.map((p) => p.vL));
    const maxP = Math.max(200, ...allPts.map((p) => p.pKPa));
    const gx = -1.8;
    const gy = -0.9;
    const gw = 3.6;
    const gh = 1.8;
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    const temperatureRailTop = m.toScreen(1.75, 0.9);
    const temperatureRailBottom = m.toScreen(1.75, -0.9);
    ctx.beginPath();
    ctx.moveTo(temperatureRailTop.x, temperatureRailTop.y);
    ctx.lineTo(temperatureRailBottom.x, temperatureRailBottom.y);
    ctx.stroke();
    const toPx = (vL: number) => m.toX(gx + (vL / (maxV * 1.1)) * gw);
    const toPy = (pKPa: number) => m.toY(gy + (pKPa / (maxP * 1.15)) * gh);

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.toX(gx), m.toY(gy + gh));
    ctx.lineTo(m.toX(gx), m.toY(gy));
    ctx.lineTo(m.toX(gx + gw), m.toY(gy));
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

    labels.push({ id: 'thermo-cycle-summary', ...m.toScreen(0, 1.08), text: `循环净功 W=${state.cycle.sumWJ.toFixed(1)} J | 热效率 η=${(state.cycle.efficiency * 100).toFixed(2)}% (卡诺上限 ${(state.cycle.carnotEfficiency * 100).toFixed(2)}%)`, color: '#e2e8f0', font: '13px sans-serif' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);

    ctx.restore();
  },
  getControlHandles: (_state, params) => params.mode === 'kinetic-md-box'
    ? [{
        id: 'md-speed-scale',
        label: `速率倍率=${params.mdSpeedScale.toFixed(2)}×`,
        position: { x: 0.22, y: -0.9 + ((params.mdSpeedScale - 0.5) / 1.5) * 1.4 },
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (world) => {
          const scale = Math.max(0.5, Math.min(2, Math.round((0.5 + ((world.y + 0.9) / 1.4) * 1.5) * 4) / 4));
          return { mdSpeedScale: Number(scale.toFixed(2)) };
        }
      }]
    : [{
        id: 'carnot-t-hot',
        label: `T_H=${params.tHotK.toFixed(0)} K`,
        position: { x: 1.75, y: -0.9 + ((params.tHotK - 400) / 500) * 1.8 },
        handleKind: 'point',
        color: '#f43f5e',
        onDrag: (world) => {
          const temperature = Math.max(400, Math.min(900, Math.round((400 + ((world.y + 0.9) / 1.8) * 500) / 50) * 50));
          return { tHotK: temperature };
        }
      }],
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
