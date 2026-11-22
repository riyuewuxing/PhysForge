import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
    const width = viewport.width;
    const height = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.mode === 'rutherford') {
      const cx = width * 0.52;
      const cy = height * 0.52;
      const scale = Math.min(width, height) / 280;

      for (const guideB of [-65, -40, 40, 65]) {
        ctx.strokeStyle = 'rgba(56,189,248,0.2)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx - 160 * scale, cy - guideB * scale);
        ctx.lineTo(cx, cy - guideB * scale);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 12px ui-sans-serif, system-ui';
      ctx.fillText(`Z=${params.targetZ}`, cx + 12, cy + 4);

      const pts = state.rutherford.trajectoryFm;
      if (pts.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const px = cx + pts[i]!.x * scale;
          const py = cy - pts[i]!.y * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        const idx = Math.min(pts.length - 1, Math.floor(state.animCursor * pts.length));
        const curPt = pts[idx]!;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(cx + curPt.x * scale, cy - curPt.y * scale, 5.5, 0, 2 * Math.PI);
        ctx.fill();
      }

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px ui-sans-serif, system-ui';
      ctx.fillText(
        `RK45 偏转角 θ = ${state.rutherford.simulatedAngleDeg.toFixed(3)}° (解析 ${state.rutherford.analyticalAngleDeg.toFixed(3)}°) | 最近距离 ${state.rutherford.minDistanceFm.toFixed(2)} fm`,
        20,
        30
      );
      ctx.restore();
      return;
    }

    const leftX = width * 0.08;
    const rightX = width * 0.46;
    const topY = height * 0.14;
    const botY = height * 0.88;
    const yOfEv = (e: number) => botY - ((e + 13.6) / 13.6) * (botY - topY);

    ctx.lineWidth = 2;
    ctx.font = 'bold 12px ui-sans-serif, system-ui';
    for (let n = 1; n <= 6; n++) {
      const e = bohrEnergyEv(n);
      const y = yOfEv(e);
      ctx.strokeStyle = n <= params.excitedLevelN ? '#38bdf8' : 'rgba(148,163,184,0.35)';
      ctx.beginPath();
      ctx.moveTo(leftX, y);
      ctx.lineTo(rightX, y);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`n=${n} (${e.toFixed(2)} eV)`, rightX + 8, y + 4);
    }

    const visibleLines = state.bohr.spectralLines.filter((l) => l.lowerN === 2);
    visibleLines.forEach((line, i) => {
      const x = leftX + 45 + i * 42;
      const y1 = yOfEv(bohrEnergyEv(line.upperN));
      const y2 = yOfEv(bohrEnergyEv(line.lowerN));
      ctx.strokeStyle = line.hex;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.stroke();
      ctx.fillStyle = line.hex;
      ctx.fillText(`${line.wavelengthNm.toFixed(1)}nm`, x - 20, (y1 + y2) / 2);
    });

    const specX = width * 0.58;
    const specW = width * 0.36;
    ctx.fillStyle = '#020617';
    ctx.fillRect(specX, height * 0.25, specW, 56);
    visibleLines.forEach((l) => {
      const frac = Math.max(0, Math.min(1, (l.wavelengthNm - 380) / 320));
      ctx.fillStyle = l.hex;
      ctx.fillRect(specX + frac * (specW - 6), height * 0.25, 4, 56);
    });

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px ui-sans-serif, system-ui';
    ctx.fillText(
      `激发态 n=${params.excitedLevelN} (${params.populationMode === 'ensemble' ? `一群原子 C_n^2=${state.bohr.totalCombinationLines} 条` : `单原子至多 ${state.bohr.maxSingleAtomLines} 条`})`,
      20,
      28
    );
    ctx.fillText(
      state.bohr.excitationAccepted
        ? `探针激发成功：跃迁至 ${state.bohr.ionized ? '电离连续态' : `n=${state.bohr.reachedLevel}`}，剩余动能 ${state.bohr.residualElectronEv.toFixed(2)} eV`
        : `光子能量 ${params.probeEnergyEv.toFixed(2)} eV 不匹配任何能级差 ΔE`,
      specX,
      height * 0.56
    );
    ctx.restore();
  },
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
