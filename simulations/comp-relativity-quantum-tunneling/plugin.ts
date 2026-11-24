import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { relativityQuantumPresets } from './presets.js';
import {
  TDSE_DX,
  TDSE_GRID_N,
  TDSE_X_MIN,
  checkInvariants,
  computeObservables,
  createInitialState,
  solveLorentzInterval,
  stepRelativityQuantum,
  type RelativityQuantumParams,
  type RelativityQuantumState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<RelativityQuantumParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '近代物理拓展模块',
    defaultValue: 'tdse-tunneling',
    options: [
      { value: 'tdse-tunneling', label: '一维量子波包势垒隧穿 (512格 TDSE)' },
      { value: 'minkowski-relativity', label: '狭义相对论闵可夫斯基时空图' }
    ]
  },
  {
    key: 'potentialShape',
    kind: 'select',
    label: '量子势场形状 V(x)',
    defaultValue: 'single-barrier',
    options: [
      { value: 'single-barrier', label: '单矩形势垒 (V₀ > E₀)' },
      { value: 'double-barrier', label: '双势垒共振腔' },
      { value: 'potential-well', label: '负方势阱 (-V₀)' }
    ]
  },
  { key: 'barrierHeightV0', kind: 'number', label: '势垒高度 |V₀|', defaultValue: 2.45, min: 0.5, max: 5.0, step: 0.1 },
  { key: 'barrierWidth', kind: 'number', label: '势垒厚度 w', defaultValue: 1.4, min: 0.6, max: 4.0, step: 0.2 },
  { key: 'waveMomentumK0', kind: 'number', label: '波包中心波矢 k₀', defaultValue: 2.0, min: 1.0, max: 3.5, step: 0.1 },
  { key: 'packetSigma', kind: 'number', label: '高斯波包宽度 σ', defaultValue: 3.2, min: 1.5, max: 6.0, step: 0.2 },
  { key: 'lorentzBeta', kind: 'number', label: '参考系速率 β = v/c', defaultValue: 0.6, min: -0.95, max: 0.95, step: 0.05 },
  { key: 'eventX', kind: 'number', label: '时空事件坐标 x', defaultValue: 3.0, min: -6.0, max: 6.0, step: 0.5 },
  { key: 'eventCt', kind: 'number', label: '时空事件时间 ct', defaultValue: 5.0, min: -6.0, max: 8.0, step: 0.5 }
];

export const compRelativityQuantumTunnelingPlugin = defineSimulationPlugin<
  RelativityQuantumParams,
  RelativityQuantumState
>({
  meta: {
    id: 'comp-relativity-quantum-tunneling',
    title: '狭义相对论时空图与一维量子隧穿 (C03)',
    textbookRef: '人教版 选择性必修三 & 强基竞赛 · 相对论几何与 TDSE 隧穿',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: relativityQuantumPresets,
  engine: {
    createInitialState,
    step: stepRelativityQuantum,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '概率密度分布 / 时空光锥图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'reflectionProb', label: '反射率 R(t)', unit: '', color: '#f59e0b' },
    { key: 'transmissionProb', label: '透射率 T(t)', unit: '', color: '#4ade80' },
    { key: 'normDrift', label: '总概率归一化漂移', unit: '', color: '#38bdf8' },
    { key: 'gammaFactor', label: '洛伦兹因子 γ', unit: '', color: '#a855f7' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-relativity-quantum-tunneling',
      title: '狭义相对论与量子波包隧穿',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<RelativityQuantumParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [];
    if (params.mode === 'tdse-tunneling') {
      const pts: { x: number; y: number }[] = [];
      for (let j = 0; j < TDSE_GRID_N; j += 8) {
        const x = TDSE_X_MIN + j * TDSE_DX;
        const dens = state.psiRe[j]! * state.psiRe[j]! + state.psiIm[j]! * state.psiIm[j]!;
        pts.push({ x: x * 0.04, y: -0.9 + dens * 8.0 });
      }
      primitives.push({ kind: 'line', x1: -2.0, y1: -0.9, x2: 2.0, y2: -0.9 });
      primitives.push({ kind: 'polyline', points: pts });
    } else {
      primitives.push(
        { kind: 'line', x1: -1.6, y1: -1.6, x2: 1.6, y2: 1.6, dashed: true },
        { kind: 'line', x1: -1.6, y1: 1.6, x2: 1.6, y2: -1.6, dashed: true },
        { kind: 'arrow', x1: 0, y1: -1.6, x2: 0, y2: 1.6, label: 'ct' },
        { kind: 'arrow', x1: -1.6, y1: 0, x2: 1.6, y2: 0, label: 'x' }
      );
    }
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.7, maxX: 2.2, maxY: 1.7 },
      title: params.mode === 'tdse-tunneling' ? '一维量子势垒隧穿波包配图' : '闵可夫斯基光锥时空图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.mode === 'minkowski-relativity') {
      const sc = 0.22;
      const point = (x: number, ct: number) => m.toScreen(x * sc, ct * sc);
      // Light cone |x| = ct
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const coneA = point(-8, -8);
      const coneB = point(8, 8);
      const coneC = point(-8, 8);
      const coneD = point(8, -8);
      ctx.moveTo(coneA.x, coneA.y);
      ctx.lineTo(coneB.x, coneB.y);
      ctx.moveTo(coneC.x, coneC.y);
      ctx.lineTo(coneD.x, coneD.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Axes x, ct
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const xAxisA = point(-8, 0);
      const xAxisB = point(8, 0);
      const ctAxisA = point(0, -7);
      const ctAxisB = point(0, 8);
      ctx.moveTo(xAxisA.x, xAxisA.y);
      ctx.lineTo(xAxisB.x, xAxisB.y);
      ctx.moveTo(ctAxisA.x, ctAxisA.y);
      ctx.lineTo(ctAxisB.x, ctAxisB.y);
      ctx.stroke();

      // Lorentz sheared axes x', ct'
      const beta = params.lorentzBeta;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const xpA = point(-7, -7 * beta);
      const xpB = point(7, 7 * beta);
      const ctpA = point(-7 * beta, -7);
      const ctpB = point(7 * beta, 7);
      ctx.moveTo(xpA.x, xpA.y);
      ctx.lineTo(xpB.x, xpB.y);
      ctx.moveTo(ctpA.x, ctpA.y);
      ctx.lineTo(ctpB.x, ctpB.y);
      ctx.stroke();

      // Event point & invariant hyperbola
      const lor = solveLorentzInterval(beta, params.eventX, params.eventCt);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      const event = point(params.eventX, params.eventCt);
      ctx.arc(event.x, event.y, m.len(0.028), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(
        `β=${beta.toFixed(2)} | γ=${lor.gamma.toFixed(3)} | (x',ct')=(${lor.xPrime.toFixed(2)}, ${lor.ctPrime.toFixed(2)}) | Δs² 误差=${lor.err.toExponential(1)}`,
        20,
        28
      );
      ctx.fillText(
        `双生子固有时：留守 τ=${state.twinStayProperTime.toFixed(1)} vs 远行 τ'=${state.twinTravelerProperTime.toFixed(2)}`,
        20,
        52
      );
      ctx.restore();
      return;
    }

    // TDSE 512-grid wavefunction |psi(x)|^2 and potential barrier V(x)
    const xMin = -2.3;
    const xMax = 2.3;
    const baseYWorld = -0.9;
    const toX = (j: number) => xMin + (j / (TDSE_GRID_N - 1)) * (xMax - xMin);
    const toScreen = (j: number, y: number) => m.toScreen(toX(j), y);

    // Draw Potential V(x)
    ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
    ctx.beginPath();
    const firstBase = m.toScreen(xMin, baseYWorld);
    ctx.moveTo(firstBase.x, firstBase.y);
    for (let j = 0; j < TDSE_GRID_N; j++) {
      const pt = toScreen(j, baseYWorld + Math.max(-0.6, Math.min(0.6, state.potential[j]! * 0.12)));
      ctx.lineTo(pt.x, pt.y);
    }
    const lastBase = m.toScreen(xMax, baseYWorld);
    ctx.lineTo(lastBase.x, lastBase.y);
    ctx.closePath();
    ctx.fill();

    // Draw |psi|^2 probability density + real part oscillation
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let j = 0; j < TDSE_GRID_N; j++) {
      const dens = state.psiRe[j]! * state.psiRe[j]! + state.psiIm[j]! * state.psiIm[j]!;
      const pt = toScreen(j, baseYWorld + Math.min(1.3, dens * 0.8));
      if (j === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(168, 85, 247, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let j = 0; j < TDSE_GRID_N; j++) {
      const pt = toScreen(j, baseYWorld + 0.38 + state.psiRe[j]! * 0.18);
      if (j === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    ctx.fillText(
      `E₀=${(0.5 * params.waveMomentumK0 * params.waveMomentumK0).toFixed(2)} vs V₀=${params.barrierHeightV0.toFixed(2)} | R=${(state.reflectionProb * 100).toFixed(1)}% | T=${(state.transmissionProb * 100).toFixed(1)}% | ∑|ψ|²Δx=${state.totalNorm.toFixed(8)}`,
      20,
      28
    );
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    if (params.mode === 'minkowski-relativity') {
      return [
        {
          id: 'spacetime-event',
          label: `(x=${params.eventX.toFixed(1)}, ct=${params.eventCt.toFixed(1)})`,
          position: { x: params.eventX * 0.22, y: params.eventCt * 0.22 },
          handleKind: 'point',
          color: '#4ade80',
          onDrag: (world) => ({
            eventX: Number(Math.max(-6, Math.min(6, Math.round((world.x / 0.22) * 2) / 2)).toFixed(1)),
            eventCt: Number(Math.max(-6, Math.min(8, Math.round((world.y / 0.22) * 2) / 2)).toFixed(1))
          })
        }
      ];
    }

    let peakIndex = 0;
    for (let index = 1; index < state.potential.length; index += 1) {
      if (Math.abs(state.potential[index]!) > Math.abs(state.potential[peakIndex]!)) peakIndex = index;
    }
    const x = -2.3 + (peakIndex / (TDSE_GRID_N - 1)) * 4.6;
    const potential = state.potential[peakIndex]!;
    const potentialOffset = Math.max(-0.6, Math.min(0.6, potential * 0.12));
    return [
      {
        id: 'potential-height',
        label: `|V₀|=${params.barrierHeightV0.toFixed(1)}`,
        position: { x, y: -0.9 + potentialOffset },
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (world) => ({
          barrierHeightV0: Number(Math.max(0.5, Math.min(5, Math.round((Math.abs((world.y + 0.9) / 0.12)) * 10) / 10)).toFixed(1))
        })
      }
    ];
  },
  referenceFrames: [
    {
      id: 'lorentz-boost-s-prime',
      label: '高速运动飞船 S′ 系 (v = βc)',
      getOrigin: (state, params) => params.mode === 'minkowski-relativity'
        ? { x: params.lorentzBeta * state.t * 0.22, y: state.t * 0.22 }
        : { x: 0, y: 0 },
      getVelocity: (_state, params) => params.mode === 'minkowski-relativity'
        ? { x: params.lorentzBeta * 0.22, y: 0.22 }
        : { x: 0, y: 0 }
    }
  ],
  formatFormulas: (state, params) => [
    {
      id: 'relativity-tdse',
      label: params.mode === 'tdse-tunneling' ? '含时薛定谔方程 Crank-Nicolson' : '洛伦兹时空不变量 Δs²',
      latex:
        params.mode === 'tdse-tunneling'
          ? 'i\\hbar\\frac{\\partial\\psi}{\\partial t}=\\left(-\\frac{\\hbar^2}{2m}\\frac{\\partial^2}{\\partial x^2}+V(x)\\right)\\psi'
          : '\\Delta s^2=(ct)^2-x^2=(ct\')^2-x\'^2',
      substitutedLatex:
        params.mode === 'tdse-tunneling'
          ? `R=${state.reflectionProb.toFixed(3)},\\; T=${state.transmissionProb.toFixed(3)},\\; |\\|\\psi\\|-1|=${state.normDrift.toExponential(1)}`
          : `\\gamma=${state.gammaFactor.toFixed(3)},\\; |\\Delta s^2-\\Delta s\'^2|=${state.intervalError.toExponential(1)}`
    }
  ]
});

export default compRelativityQuantumTunnelingPlugin;
