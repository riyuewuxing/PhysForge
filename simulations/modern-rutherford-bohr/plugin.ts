import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { rutherfordBohrPresets } from './presets.js';
import {
  bohrEnergyEv,
  checkInvariants,
  computeObservables,
  createInitialState,
  stepRutherfordBohr,
  type RutherfordBohrParams,
  type RutherfordBohrState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<RutherfordBohrParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验模块',
    defaultValue: 'rutherford',
    options: [
      { label: '卢瑟福 α 散射（库仑核尺度 ODE）', value: 'rutherford' },
      { label: '玻尔氢原子能级与真彩光谱', value: 'bohr' }
    ]
  },
  { key: 'alphaEnergyMev', kind: 'number', label: 'α 粒子初动能 K_α', unit: 'MeV', defaultValue: 5.0, min: 1.0, max: 12.0, step: 0.5 },
  { key: 'targetZ', kind: 'number', label: '靶核质子数 Z₂（Au=79）', defaultValue: 79, min: 13, max: 92, step: 1 },
  { key: 'impactParamFm', kind: 'number', label: '瞄准距离 b', unit: 'fm', defaultValue: 25, min: -80, max: 80, step: 5 },
  { key: 'excitedLevelN', kind: 'number', label: '最高激发态主量子数 n', defaultValue: 6, min: 2, max: 7, step: 1 },
  {
    key: 'populationMode',
    kind: 'select',
    label: '发光粒子群体',
    defaultValue: 'ensemble',
    options: [
      { label: '一群氢原子 (C_n^2 条)', value: 'ensemble' },
      { label: '单个氢原子 (最多 n-1 条)', value: 'single-atom' }
    ]
  },
  {
    key: 'probeKind',
    kind: 'select',
    label: '基态激发探针类型',
    defaultValue: 'photon',
    options: [
      { label: '单色光子 (须严格共振 ΔE)', value: 'photon' },
      { label: '入射电子 (E ≥ ΔE 即可激发)', value: 'electron' }
    ]
  },
  { key: 'probeEnergyEv', kind: 'number', label: '探针入射能量 E_probe', unit: 'eV', defaultValue: 12.09, min: 5.0, max: 15.0, step: 0.05 }
];

export const modernRutherfordBohrPlugin = defineSimulationPlugin<RutherfordBohrParams, RutherfordBohrState>({
  meta: {
    id: 'modern-rutherford-bohr',
    title: '卢瑟福散射与玻尔氢原子能级 (N02)',
    textbookRef: '人教版 选择性必修三 第四章第 3–4 节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: rutherfordBohrPresets,
  engine: {
    createInitialState,
    step: stepRutherfordBohr,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '核式散射双曲线 / 玻尔能级光谱', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'rutherfordAngleDeg', label: '散射偏转角 θ', unit: '°', color: '#38bdf8' },
    { key: 'minDistanceFm', label: '最近核距 r_min', unit: 'fm', color: '#f59e0b' },
    { key: 'hAlphaNm', label: '巴耳末 Hα 波长', unit: 'nm', color: '#ef4444' },
    { key: 'residualElectronEv', label: '探针剩余动能', unit: 'eV', color: '#4ade80' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'modern-rutherford-bohr',
      title: '卢瑟福 α 散射与玻尔氢原子',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<RutherfordBohrParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [];
    if (params.mode === 'rutherford') {
      primitives.push({ kind: 'fieldMarker', x: 0, y: 0, symbol: 'plus', radius: 6 });
      const pts = state.rutherford.trajectoryFm
        .filter((_, idx) => idx % 3 === 0)
        .map((p) => ({ x: p.x / 60, y: p.y / 60 }));
      if (pts.length > 1) primitives.push({ kind: 'trajectory', points: pts, strokeWidth: 2 });
    } else {
      for (let n = 1; n <= Math.min(6, params.excitedLevelN); n++) {
        const y = -1.2 + (1 + bohrEnergyEv(n) / 13.6) * 2.2;
        primitives.push(
          { kind: 'line', x1: -1.6, y1: y, x2: 1.6, y2: y, strokeWidth: 1.4 },
          { kind: 'text', x: 1.75, y, text: `n=${n}`, align: 'start' }
        );
      }
    }
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -3.2, minY: -2.0, maxX: 3.2, maxY: 2.0 },
      title: params.mode === 'rutherford' ? 'α 粒子散射双曲线轨迹配图' : '氢原子能级跃迁配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    if (!activeLayers.has('main')) return;
    ctx.save();
    const labels: CanvasLabel[] = [];

    if (params.mode === 'rutherford') {
      for (const guideB of [-65, -40, 40, 65]) {
        ctx.strokeStyle = 'rgba(56,189,248,0.2)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        const start = m.toScreen(-160 / 65, guideB / 65);
        const end = m.toScreen(0, guideB / 65);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      const target = m.toScreen(0, 0);
      ctx.arc(target.x, target.y, m.len(0.045), 0, 2 * Math.PI);
      ctx.fill();
      const targetLabel = m.toScreen(0.07, -0.02);
      labels.push({ id: 'rutherford-target-label', ...targetLabel, text: `Z=${params.targetZ}`, color: '#e2e8f0', font: 'bold 12px ui-sans-serif, system-ui' });

      const pts = state.rutherford.trajectoryFm;
      if (pts.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const point = m.toScreen(pts[i]!.x / 65, pts[i]!.y / 65);
          const px = point.x;
          const py = point.y;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        const idx = Math.min(pts.length - 1, Math.floor(state.animCursor * pts.length));
        const curPt = pts[idx]!;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        const point = m.toScreen(curPt.x / 65, curPt.y / 65);
        ctx.arc(point.x, point.y, m.len(0.028), 0, 2 * Math.PI);
        ctx.fill();
      }

      labels.push({ id: 'rutherford-summary', ...m.toScreen(0.3, 1.55), text: `RK45 偏转角 θ = ${state.rutherford.simulatedAngleDeg.toFixed(3)}° (解析 ${state.rutherford.analyticalAngleDeg.toFixed(3)}°) | 最近距离 ${state.rutherford.minDistanceFm.toFixed(2)} fm`, color: '#e2e8f0', font: 'bold 14px ui-sans-serif, system-ui' });
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    const leftX = -1.8;
    const rightX = -0.1;
    const topY = 1.15;
    const botY = -1.15;
    const yOfEv = (e: number) => botY + ((e + 13.6) / 13.6) * (topY - botY);

    ctx.lineWidth = 2;
    ctx.font = 'bold 12px ui-sans-serif, system-ui';
    for (let n = 1; n <= 6; n++) {
      const e = bohrEnergyEv(n);
      const y = m.toY(yOfEv(e));
      ctx.strokeStyle = n <= params.excitedLevelN ? '#38bdf8' : 'rgba(148,163,184,0.35)';
      ctx.beginPath();
      ctx.moveTo(m.toX(leftX), y);
      ctx.lineTo(m.toX(rightX), y);
      ctx.stroke();
      labels.push({ id: `bohr-level-${n}`, x: m.toX(rightX + 0.05), y: y + 4, text: `n=${n} (${e.toFixed(2)} eV)`, color: '#e2e8f0', font: 'bold 12px ui-sans-serif, system-ui' });
    }

    const visibleLines = state.bohr.spectralLines.filter((l) => l.lowerN === 2);
    visibleLines.forEach((line, i) => {
      const x = leftX + 0.22 + i * 0.2;
      const y1 = yOfEv(bohrEnergyEv(line.upperN));
      const y2 = yOfEv(bohrEnergyEv(line.lowerN));
      ctx.strokeStyle = line.hex;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(m.toX(x), m.toY(yOfEv(bohrEnergyEv(line.upperN))));
      ctx.lineTo(m.toX(x), m.toY(yOfEv(bohrEnergyEv(line.lowerN))));
      ctx.stroke();
      labels.push({ id: `bohr-wavelength-${i}`, x: m.toX(x - 0.12), y: m.toY((yOfEv(bohrEnergyEv(line.upperN)) + yOfEv(bohrEnergyEv(line.lowerN))) / 2), text: `${line.wavelengthNm.toFixed(1)}nm`, color: line.hex, font: '11px ui-sans-serif, system-ui' });
    });

    const specX = 0.35;
    const specW = 1.7;
    const specTop = m.toScreen(specX, 0.95);
    const specBottom = m.toScreen(specX + specW, 0.5);
    ctx.fillStyle = '#020617';
    ctx.fillRect(specTop.x, specTop.y, specBottom.x - specTop.x, specBottom.y - specTop.y);
    visibleLines.forEach((l) => {
      const frac = Math.max(0, Math.min(1, (l.wavelengthNm - 380) / 320));
      ctx.fillStyle = l.hex;
      const x = m.toX(specX + frac * specW);
      ctx.fillRect(x, specTop.y, m.len(0.018), specBottom.y - specTop.y);
    });

    labels.push({ id: 'bohr-excitation-summary', ...m.toScreen(1.15, 0.28), text:
      `激发态 n=${params.excitedLevelN} (${params.populationMode === 'ensemble' ? `一群原子 C_n^2=${state.bohr.totalCombinationLines} 条` : `单原子至多 ${state.bohr.maxSingleAtomLines} 条`}) · ${state.bohr.excitationAccepted
        ? `探针激发成功：跃迁至 ${state.bohr.ionized ? '电离连续态' : `n=${state.bohr.reachedLevel}`}，剩余动能 ${state.bohr.residualElectronEv.toFixed(2)} eV`
        : `光子能量 ${params.probeEnergyEv.toFixed(2)} eV 不匹配任何能级差 ΔE`}`,
      color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  getControlHandles: (_state, params) => {
    if (params.mode === 'rutherford') {
      return [{
        id: 'impact-param-b',
        label: `b=${params.impactParamFm.toFixed(0)} fm`,
        position: { x: -160 / 65, y: params.impactParamFm / 65 },
        origin: { x: -160 / 65, y: 0 },
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (world) => ({ impactParamFm: Math.max(-80, Math.min(80, Math.round((world.y * 65) / 5) * 5)) })
      }];
    }
    return [{
      id: 'probe-energy',
      label: `E=${params.probeEnergyEv.toFixed(2)} eV`,
      position: { x: 0.35 + ((params.probeEnergyEv - 5) / 10) * 1.7, y: 0.72 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (world) => ({ probeEnergyEv: Number(Math.max(5, Math.min(15, Math.round((5 + ((world.x - 0.35) / 1.7) * 10) * 20) / 20)).toFixed(2)) })
    }];
  },
  getForceVectors: (state, params) => {
    if (params.mode !== 'rutherford') return [];
    const points = state.rutherford.trajectoryFm;
    const index = Math.min(points.length - 1, Math.floor(state.animCursor * points.length));
    const point = points[index] ?? points[Math.floor(points.length / 2)] ?? { x: -40, y: params.impactParamFm };
    const radius = Math.hypot(point.x, point.y);
    if (radius < 1e-6) return [];
    const magnitude = Math.min(40, (params.targetZ * 2) / Math.max(25, radius * radius));
    return [{
      id: 'coulomb-repulsion',
      label: 'F库仑',
      origin: { x: point.x / 65, y: point.y / 65 },
      force: { x: (point.x / radius) * magnitude, y: (point.y / radius) * magnitude },
      color: '#fb7185',
      category: 'electric',
      unit: '相对量 (∝1/r²)'
    }];
  },
  referenceFrames: [{
    id: 'alpha-particle',
    label: 'α 入射粒子随动参考系',
    getOrigin: (state, params) => {
      if (params.mode !== 'rutherford') return { x: 0, y: 0 };
      const points = state.rutherford.trajectoryFm;
      const index = Math.min(points.length - 1, Math.floor(state.animCursor * points.length));
      const point = points[index];
      return point ? { x: point.x / 65, y: point.y / 65 } : { x: 0, y: 0 };
    }
  }],
  formatFormulas: (state, params) => [
    {
      id: 'rutherford-bohr',
      label: params.mode === 'rutherford' ? '卢瑟福散射角与库仑偏转' : '玻尔能级与跃迁波长',
      latex: params.mode === 'rutherford' ? '\\tan\\frac{\\theta}{2}=\\frac{k Z_1 Z_2 e^2}{2 K_\\alpha b}' : 'E_n=-\\frac{13.6}{n^2}\\text{ eV}',
      substitutedLatex:
        params.mode === 'rutherford'
          ? `\\theta=${state.rutherford.simulatedAngleDeg.toFixed(3)}^\\circ,\\; r_{\\min}=${state.rutherford.minDistanceFm.toFixed(2)}\\text{ fm}`
          : `n=${params.excitedLevelN},\\; C_n^2=${state.bohr.totalCombinationLines}`
    }
  ]
});

export default modernRutherfordBohrPlugin;
