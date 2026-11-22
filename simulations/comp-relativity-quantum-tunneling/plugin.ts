import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.mode === 'minkowski-relativity') {
      const cx = w * 0.5;
      const cy = h * 0.54;
      const sc = Math.min(w, h) * 0.042;
      // Light cone |x| = ct
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - 8 * sc, cy + 8 * sc);
      ctx.lineTo(cx + 8 * sc, cy - 8 * sc);
      ctx.moveTo(cx - 8 * sc, cy - 8 * sc);
      ctx.lineTo(cx + 8 * sc, cy + 8 * sc);
      ctx.stroke();
      ctx.setLineDash([]);

      // Axes x, ct
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 8 * sc, cy);
      ctx.lineTo(cx + 8 * sc, cy);
      ctx.moveTo(cx, cy + 7 * sc);
      ctx.lineTo(cx, cy - 8 * sc);
      ctx.stroke();

      // Lorentz sheared axes x', ct'
      const beta = params.lorentzBeta;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 7 * sc, cy + 7 * beta * sc);
      ctx.lineTo(cx + 7 * sc, cy - 7 * beta * sc);
      ctx.moveTo(cx - 7 * beta * sc, cy + 7 * sc);
      ctx.lineTo(cx + 7 * beta * sc, cy - 7 * sc);
      ctx.stroke();

      // Event point & invariant hyperbola
      const lor = solveLorentzInterval(beta, params.eventX, params.eventCt);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(cx + params.eventX * sc, cy - params.eventCt * sc, 6, 0, Math.PI * 2);
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
    const baseY = h * 0.78;
    const gx0 = w * 0.06;
    const gw = w * 0.88;
    const toX = (j: number) => gx0 + (j / (TDSE_GRID_N - 1)) * gw;

    // Draw Potential V(x)
    ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
    ctx.beginPath();
    ctx.moveTo(toX(0), baseY);
    for (let j = 0; j < TDSE_GRID_N; j++) {
      ctx.lineTo(toX(j), baseY - state.potential[j]! * 48);
    }
    ctx.lineTo(toX(TDSE_GRID_N - 1), baseY);
    ctx.closePath();
    ctx.fill();

    // Draw |psi|^2 probability density + real part oscillation
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let j = 0; j < TDSE_GRID_N; j++) {
      const dens = state.psiRe[j]! * state.psiRe[j]! + state.psiIm[j]! * state.psiIm[j]!;
      const py = baseY - dens * h * 2.2;
      if (j === 0) ctx.moveTo(toX(j), py);
      else ctx.lineTo(toX(j), py);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(168, 85, 247, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let j = 0; j < TDSE_GRID_N; j++) {
      const py = baseY - 60 - state.psiRe[j]! * 120;
      if (j === 0) ctx.moveTo(toX(j), py);
      else ctx.lineTo(toX(j), py);
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
