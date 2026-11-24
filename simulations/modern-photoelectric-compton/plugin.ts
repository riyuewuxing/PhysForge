import { wavelengthToRgb } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, drawGlowVectorArrow, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
  defaultView: { offsetRatioX: -0.05 },
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
    const m = createWorldMapper(viewport);
    ctx.save();
    const labels: CanvasLabel[] = [];

    if (params.mode === 'compton') {
      const origin = m.toScreen(-0.8, 0);
      const incoming = m.toScreen(-1.85, 0);
      const th = (params.scatterAngleDeg * Math.PI) / 180;
      const ph = (state.compton.recoilAngleDeg * Math.PI) / 180;

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = m.len(0.015);
      drawGlowVectorArrow(ctx, incoming.x, incoming.y, origin.x, origin.y, '#38bdf8', m.len(0.015), m.len(0.06));

      const scattered = m.toScreen(-0.8 + 0.95 * (state.compton.pScattered / state.compton.pIncident) * Math.cos(th), 0.95 * (state.compton.pScattered / state.compton.pIncident) * Math.sin(th));
      drawGlowVectorArrow(ctx, origin.x, origin.y, scattered.x, scattered.y, '#a855f7', m.len(0.015), m.len(0.06));

      const recoil = m.toScreen(-0.8 + 0.95 * (state.compton.pElectron / state.compton.pIncident) * Math.cos(ph), -0.95 * (state.compton.pElectron / state.compton.pIncident) * Math.sin(ph));
      drawGlowVectorArrow(ctx, origin.x, origin.y, recoil.x, recoil.y, '#f59e0b', m.len(0.015), m.len(0.06));
      labels.push(
        { id: 'compton-incident-label', ...m.toScreen(-1.4, 0.1), text: 'pγ', color: '#38bdf8' },
        { id: 'compton-scattered-label', ...m.toScreen(-0.3, 0.45), text: "p′γ", color: '#a855f7' },
        { id: 'compton-recoil-label', ...m.toScreen(-0.3, -0.42), text: 'pe', color: '#f59e0b' },
        { id: 'compton-shift-summary', ...m.toScreen(0.65, 1.38), text: `Δλ = ${(state.compton.deltaLambdaNm * 1000).toFixed(3)} pm | λ′ = ${state.compton.scatteredWavelengthNm.toFixed(5)} nm`, color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' },
        { id: 'compton-recoil-summary', ...m.toScreen(0.65, 1.16), text: `反冲电子角 φ = ${state.compton.recoilAngleDeg.toFixed(2)}° | Eke = ${state.compton.electronKineticKev.toFixed(3)} keV`, color: '#e2e8f0', font: '13px ui-sans-serif, system-ui' }
      );

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, m.len(0.035), 0, 2 * Math.PI);
      ctx.fill();

      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    if (activeLayers.has('apparatus')) {
      const tube = m.toScreen(-1.2, 0);
      const tubeCx = tube.x;
      const tubeCy = tube.y;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = m.len(0.012);
      ctx.beginPath();
      ctx.arc(tubeCx, tubeCy, m.len(0.68), 0, 2 * Math.PI);
      ctx.stroke();

      const beamColor = wavelengthToRgb(Math.max(380, Math.min(780, params.wavelengthNm))).hex;
      ctx.strokeStyle = params.wavelengthNm < 380 ? '#c084fc' : beamColor;
      ctx.lineWidth = m.len(0.015);
      for (let k = -1; k <= 1; k++) {
        const beamStart = m.toScreen(-1.95, 0.25 + k * 0.065);
        const beamEnd = m.toScreen(-1.48, k * 0.065);
        ctx.beginPath();
        ctx.moveTo(beamStart.x, beamStart.y);
        ctx.lineTo(beamEnd.x, beamEnd.y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(148,163,184,0.4)';
      ctx.lineWidth = 1;
      const wavelengthRailTop = m.toScreen(-2.02, -0.2);
      const wavelengthRailBottom = m.toScreen(-2.02, -0.72);
      ctx.beginPath();
      ctx.moveTo(wavelengthRailTop.x, wavelengthRailTop.y);
      ctx.lineTo(wavelengthRailBottom.x, wavelengthRailBottom.y);
      ctx.stroke();

      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = m.len(0.025);
      const cathodeTop = m.toScreen(-1.48, 0.19);
      const cathodeBottom = m.toScreen(-1.48, -0.19);
      ctx.beginPath();
      ctx.moveTo(cathodeTop.x, cathodeTop.y);
      ctx.lineTo(cathodeBottom.x, cathodeBottom.y);
      ctx.stroke();
      ctx.strokeStyle = '#f87171';
      const anodeTop = m.toScreen(-0.73, 0.14);
      const anodeBottom = m.toScreen(-0.73, -0.14);
      ctx.beginPath();
      ctx.moveTo(anodeTop.x, anodeTop.y);
      ctx.lineTo(anodeBottom.x, anodeBottom.y);
      ctx.stroke();

      if (state.photoelectric.thresholdPassed) {
        ctx.fillStyle = '#38bdf8';
        const travel = state.photoelectric.currentMa > 0 ? 0.44 : 0.18;
        for (let eIdx = 0; eIdx < 5; eIdx++) {
          const frac = (state.phaseWave / (2 * Math.PI) + eIdx * 0.2) % 1;
          const electron = m.toScreen(-1.47 + frac * travel, 0.12 - eIdx * 0.075);
          ctx.beginPath();
          ctx.arc(electron.x, electron.y, m.len(0.018), 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    if (activeLayers.has('characteristic')) {
      const gx0 = 0.05;
      const gy0 = -0.9;
      const gw = 2.05;
      const gh = 1.8;
      const uMin = -5;
      const uMax = 6;
      const iMax = 7.5;
      const toPx = (u: number) => m.toX(gx0 + ((u - uMin) / (uMax - uMin)) * gw);
      const toPy = (curr: number) => m.toY(gy0 + (curr / iMax) * gh);

      ctx.strokeStyle = 'rgba(148,163,184,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.toX(gx0), m.toY(gy0));
      ctx.lineTo(m.toX(gx0 + gw), m.toY(gy0));
      ctx.moveTo(toPx(0), m.toY(gy0));
      ctx.lineTo(toPx(0), m.toY(gy0 + gh));
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

    if (params.mode === 'photoelectric') {
      labels.push({ id: 'photoelectric-summary', ...m.toScreen(0.9, 1.12), text: `hν = ${state.photoelectric.photonEnergyEv.toFixed(3)} eV | W₀ = ${state.photoelectric.workFunctionEv.toFixed(2)} eV | Uc = ${state.photoelectric.stoppingVoltageV.toFixed(3)} V`, color: '#e2e8f0', font: 'bold 14px ui-sans-serif, system-ui' });
    }
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    if (params.mode === 'compton') {
      const theta = (params.scatterAngleDeg * Math.PI) / 180;
      const length = 0.95 * (state.compton.pScattered / Math.max(1e-9, state.compton.pIncident));
      return [
        {
          id: 'compton-scatter-angle',
          label: `θ=${params.scatterAngleDeg.toFixed(0)}°`,
          position: { x: -0.8 + length * Math.cos(theta), y: length * Math.sin(theta) },
          origin: { x: -0.8, y: 0 },
          handleKind: 'angle',
          color: '#a855f7',
          onDrag: (world) => {
            const degrees = (Math.atan2(world.y, world.x + 0.8) * 180) / Math.PI;
            return { scatterAngleDeg: Math.max(10, Math.min(180, Math.round(degrees / 5) * 5)) };
          }
        }
      ];
    }

    const voltageX = 0.05 + ((params.anodeVoltageV + 5) / 11) * 2.05;
    const currentY = -0.9 + (state.photoelectric.currentMa / 7.5) * 1.8;
    return [
      {
        id: 'anode-voltage-point',
        label: `U=${params.anodeVoltageV.toFixed(1)} V`,
        position: { x: voltageX, y: currentY },
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (world) => ({
          anodeVoltageV: Number(Math.max(-5, Math.min(6, Math.round((-5 + ((world.x - 0.05) / 2.05) * 11) * 10) / 10)).toFixed(1))
        })
      },
      {
        id: 'incident-wavelength',
        label: `λ=${params.wavelengthNm.toFixed(0)} nm`,
        position: { x: -2.02, y: -0.72 + ((750 - params.wavelengthNm) / 550) * 0.52 },
        handleKind: 'point',
        color: state.beamHex,
        onDrag: (world) => ({
          wavelengthNm: Math.max(200, Math.min(750, Math.round((750 - ((world.y + 0.72) / 0.52) * 550) / 5) * 5))
        })
      }
    ];
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
