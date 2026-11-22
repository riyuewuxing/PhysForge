import { wavelengthToRgb } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { photoelectricComptonPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  computePhotocurrentMa,
  createInitialState,
  solvePhotoelectric,
  stepPhotoelectricCompton,
  type PhotoelectricComptonParams,
  type PhotoelectricComptonState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<PhotoelectricComptonParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验模式',
    defaultValue: 'photoelectric',
    options: [
      { label: '光电效应（I-U 曲线 + E_km-ν）', value: 'photoelectric' },
      { label: '康普顿散射（相对论矢量三角形）', value: 'compton' }
    ]
  },
  {
    key: 'cathodeMetal',
    kind: 'select',
    label: '阴极金属材料',
    defaultValue: 'Na',
    options: [
      { label: '铯 Cs (W₀ = 2.14 eV)', value: 'Cs' },
      { label: '钠 Na (W₀ = 2.36 eV)', value: 'Na' },
      { label: '锌 Zn (W₀ = 4.31 eV)', value: 'Zn' },
      { label: '铂 Pt (W₀ = 5.65 eV)', value: 'Pt' },
      { label: '自定义逸出功', value: 'custom' }
    ]
  },
  { key: 'customWorkFunctionEv', kind: 'number', label: '自定义逸出功 W₀', unit: 'eV', defaultValue: 2.36, min: 1.0, max: 6.5, step: 0.05 },
  { key: 'wavelengthNm', kind: 'number', label: '入射光波长 λ', unit: 'nm', defaultValue: 405, min: 200, max: 750, step: 5 },
  { key: 'intensityRel', kind: 'number', label: '相对光强 P', defaultValue: 1.4, min: 0.2, max: 3.0, step: 0.1 },
  { key: 'anodeVoltageV', kind: 'number', label: '光电管电压 U_AK', unit: 'V', defaultValue: 0, min: -5.0, max: 6.0, step: 0.1 },
  { key: 'freezeRefEnabled', kind: 'boolean', label: '叠加对比参考曲线', defaultValue: true },
  { key: 'refWavelengthNm', kind: 'number', label: '参考波长 λ_ref', unit: 'nm', defaultValue: 450, min: 200, max: 750, step: 5 },
  { key: 'refIntensityRel', kind: 'number', label: '参考光强 P_ref', defaultValue: 0.8, min: 0.2, max: 3.0, step: 0.1 },
  { key: 'xrayWavelengthNm', kind: 'number', label: '入射 X 射线波长 λ', unit: 'nm', defaultValue: 0.071, min: 0.01, max: 0.2, step: 0.002 },
  { key: 'scatterAngleDeg', kind: 'number', label: '光子散射角 θ', unit: '°', defaultValue: 90, min: 10, max: 180, step: 5 }
];

export const modernPhotoelectricComptonPlugin = defineSimulationPlugin<
  PhotoelectricComptonParams,
  PhotoelectricComptonState
>({
  meta: {
    id: 'modern-photoelectric-compton',
    title: '光电效应与康普顿散射 (N01)',
    textbookRef: '人教版 选择性必修三 第四章第 2 节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: photoelectricComptonPresets,
  engine: {
    createInitialState,
    step: stepPhotoelectricCompton,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'apparatus', label: '光电管 / 康普顿矢量示意', defaultVisible: true },
    { id: 'characteristic', label: '伏安特性 I-U 与参考曲线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'photonEnergyEv', label: '光子能量 hν', unit: 'eV', color: '#a855f7' },
    { key: 'stoppingVoltageV', label: '遏止电压 U_c', unit: 'V', color: '#38bdf8' },
    { key: 'currentMa', label: '光电流 I', unit: 'mA', color: '#4ade80' },
    { key: 'deltaLambdaPm', label: '康普顿频移 Δλ', unit: 'pm', color: '#f59e0b' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'modern-photoelectric-compton',
      title: '光电效应与康普顿散射',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<PhotoelectricComptonParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'arrow', x1: -2.0, y1: -1.2, x2: 2.0, y2: -1.2, label: 'U(V)' },
      { kind: 'arrow', x1: 0, y1: -1.4, x2: 0, y2: 1.4, label: 'I(mA)' }
    ];
    if (params.mode === 'photoelectric') {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= 40; i++) {
        const u = -4 + (i / 40) * 8;
        const curr = computePhotocurrentMa(u, state.photoelectric, params.intensityRel);
        pts.push({ x: u * 0.45, y: -1.2 + curr * 0.35 });
      }
      primitives.push({ kind: 'polyline', points: pts });
    } else {
      const th = (params.scatterAngleDeg * Math.PI) / 180;
      const ph = (state.compton.recoilAngleDeg * Math.PI) / 180;
      primitives.push(
        { kind: 'arrow', x1: -2, y1: 0, x2: 0, y2: 0, label: 'p_γ' },
        { kind: 'arrow', x1: 0, y1: 0, x2: 1.4 * Math.cos(th), y2: 1.4 * Math.sin(th), label: "p'_γ" },
        { kind: 'arrow', x1: 0, y1: 0, x2: 1.2 * Math.cos(ph), y2: 1.2 * Math.sin(ph), dashed: true, label: 'p_e' }
      );
    }
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.4, minY: -1.6, maxX: 2.4, maxY: 1.6 },
      title: params.mode === 'photoelectric' ? '光电效应伏安特性配图' : '康普顿散射动量闭合示意图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const width = viewport.width;
    const height = viewport.height;
    ctx.save();

    if (params.mode === 'compton') {
      const cx = width * 0.38;
      const cy = height * 0.52;
      const scale = Math.min(width, height) * 0.25;
      const th = (params.scatterAngleDeg * Math.PI) / 180;
      const ph = (state.compton.recoilAngleDeg * Math.PI) / 180;

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - scale * 1.1, cy);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      ctx.strokeStyle = '#a855f7';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + scale * (state.compton.pScattered / state.compton.pIncident) * Math.cos(th), cy - scale * (state.compton.pScattered / state.compton.pIncident) * Math.sin(th));
      ctx.stroke();

      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + scale * (state.compton.pElectron / state.compton.pIncident) * Math.cos(ph), cy - scale * (state.compton.pElectron / state.compton.pIncident) * Math.sin(ph));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px ui-sans-serif, system-ui';
      ctx.fillText(`Δλ = ${(state.compton.deltaLambdaNm * 1000).toFixed(3)} pm  |  λ' = ${state.compton.scatteredWavelengthNm.toFixed(5)} nm`, 20, 32);
      ctx.fillText(`反冲电子角 φ = ${state.compton.recoilAngleDeg.toFixed(2)}°  |  E_ke = ${state.compton.electronKineticKev.toFixed(3)} keV`, 20, 56);
      ctx.restore();
      return;
    }

    if (activeLayers.has('apparatus')) {
      const tubeCx = width * 0.24;
      const tubeCy = height * 0.5;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tubeCx, tubeCy, Math.min(width * 0.16, height * 0.26), 0, 2 * Math.PI);
      ctx.stroke();

      const beamColor = wavelengthToRgb(Math.max(380, Math.min(780, params.wavelengthNm))).hex;
      ctx.strokeStyle = params.wavelengthNm < 380 ? '#c084fc' : beamColor;
      ctx.lineWidth = 3;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(tubeCx - 110, tubeCy - 70 + k * 14);
        ctx.lineTo(tubeCx - 35, tubeCy + k * 14);
        ctx.stroke();
      }

      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(tubeCx - 35, tubeCy - 38);
      ctx.lineTo(tubeCx - 35, tubeCy + 38);
      ctx.stroke();
      ctx.strokeStyle = '#f87171';
      ctx.beginPath();
      ctx.moveTo(tubeCx + 42, tubeCy - 28);
      ctx.lineTo(tubeCx + 42, tubeCy + 28);
      ctx.stroke();

      if (state.photoelectric.thresholdPassed) {
        ctx.fillStyle = '#38bdf8';
        const travel = state.photoelectric.currentMa > 0 ? 70 : 28;
        for (let eIdx = 0; eIdx < 5; eIdx++) {
          const frac = (state.phaseWave / (2 * Math.PI) + eIdx * 0.2) % 1;
          ctx.beginPath();
          ctx.arc(tubeCx - 32 + frac * travel, tubeCy - 20 + eIdx * 10, 3.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    if (activeLayers.has('characteristic')) {
      const gx0 = width * 0.48;
      const gy0 = height * 0.78;
      const gw = width * 0.46;
      const gh = height * 0.56;
      const uMin = -5;
      const uMax = 6;
      const iMax = 7.5;
      const toPx = (u: number) => gx0 + ((u - uMin) / (uMax - uMin)) * gw;
      const toPy = (curr: number) => gy0 - (curr / iMax) * gh;

      ctx.strokeStyle = 'rgba(148,163,184,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx0, gy0);
      ctx.lineTo(gx0 + gw, gy0);
      ctx.moveTo(toPx(0), gy0 - gh);
      ctx.lineTo(toPx(0), gy0 + 15);
      ctx.stroke();

      if (params.freezeRefEnabled) {
        const refSol = solvePhotoelectric({
          ...params,
          wavelengthNm: params.refWavelengthNm,
          intensityRel: params.refIntensityRel
        });
        ctx.strokeStyle = 'rgba(148,163,184,0.65)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (let k = 0; k <= 80; k++) {
          const u = uMin + (k / 80) * (uMax - uMin);
          const px = toPx(u);
          const py = toPy(computePhotocurrentMa(u, refSol, params.refIntensityRel));
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      for (let k = 0; k <= 100; k++) {
        const u = uMin + (k / 100) * (uMax - uMin);
        const px = toPx(u);
        const py = toPy(computePhotocurrentMa(u, state.photoelectric, params.intensityRel));
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(toPx(params.anodeVoltageV), toPy(state.photoelectric.currentMa), 5, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px ui-sans-serif, system-ui';
    ctx.fillText(
      `hν = ${state.photoelectric.photonEnergyEv.toFixed(3)} eV | W₀ = ${state.photoelectric.workFunctionEv.toFixed(2)} eV | U_c = ${state.photoelectric.stoppingVoltageV.toFixed(3)} V`,
      20,
      30
    );
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'einstein-compton',
      label: params.mode === 'photoelectric' ? '爱因斯坦光电效应方程' : '康普顿波长偏移与能量守恒',
      latex: params.mode === 'photoelectric' ? 'h\\nu - W_0 = eU_c' : '\\Delta\\lambda = \\frac{h}{m_e c}(1 - \\cos\\theta)',
      substitutedLatex:
        params.mode === 'photoelectric'
          ? `h\\nu=${state.photoelectric.photonEnergyEv.toFixed(3)}\\text{ eV},\\; W_0=${state.photoelectric.workFunctionEv.toFixed(2)}\\text{ eV},\\; U_c=${state.photoelectric.stoppingVoltageV.toFixed(3)}\\text{ V}`
          : `\\Delta\\lambda=${(state.compton.deltaLambdaNm * 1000).toFixed(3)}\\text{ pm},\\; \\varphi=${state.compton.recoilAngleDeg.toFixed(2)}^\\circ`
    }
  ]
});

export default modernPhotoelectricComptonPlugin;
