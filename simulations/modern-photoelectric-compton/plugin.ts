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
  type ComptonSolution,
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

// Diagram coordinates are illustrative; physical axis values are explicit.
const plot = { x: 0.05, y: -0.9, width: 2.05, height: 1.8, uMin: -5, uMax: 6, iMax: 7.5 };
function graphX(u: number): number { return plot.x + (u - plot.uMin) / (plot.uMax - plot.uMin) * plot.width; }
function graphY(i: number): number { return plot.y + i / plot.iMax * plot.height; }

export function comptonMomentumVectors(solution: ComptonSolution, scatterAngleDeg: number, length = 0.95) {
  const theta = scatterAngleDeg * Math.PI / 180;
  const phi = solution.recoilAngleDeg * Math.PI / 180;
  return {
    incident: { x: length, y: 0 },
    scattered: { x: length * solution.pScattered / solution.pIncident * Math.cos(theta),
      y: length * solution.pScattered / solution.pIncident * Math.sin(theta) },
    recoil: { x: length * solution.pElectron / solution.pIncident * Math.cos(phi),
      y: length * solution.pElectron / solution.pIncident * Math.sin(phi) }
  };
}

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
    { key: 'deltaLambdaPm', label: '康普顿波长差 Δλ', unit: 'pm', color: '#f59e0b' },
    { key: 'electronKineticKev', label: '反冲电子动能', unit: 'keV', color: '#4ade80' }
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
    const primitives: DiagramPrimitive[] = [];
    if (params.mode === 'photoelectric') {
      // Use the same normalized graph geometry and response as the canvas.
      primitives.push(
        { kind: 'arrow', x1: graphX(plot.uMin), y1: plot.y, x2: graphX(plot.uMax)+0.12, y2: plot.y, label: 'U_AK (V)' },
        { kind: 'arrow', x1: graphX(0), y1: plot.y, x2: graphX(0), y2: graphY(plot.iMax)+0.12, label: 'I (mA)' },
        { kind: 'text', x: graphX(0), y: plot.y-0.12, text: '0', align: 'middle' }
      );
      const curve = (solution: typeof state.photoelectric, intensity: number) =>
        Array.from({length: 101}, (_, i) => {
          const u = plot.uMin + i / 100 * (plot.uMax - plot.uMin);
          return { x: graphX(u), y: graphY(computePhotocurrentMa(u, solution, intensity)) };
        });
      if (params.freezeRefEnabled) {
        const reference = solvePhotoelectric({ ...params, wavelengthNm: params.refWavelengthNm, intensityRel: params.refIntensityRel });
        primitives.push({ kind: 'polyline', points: curve(reference, params.refIntensityRel), dashed: true });
      }
      primitives.push({ kind: 'polyline', points: curve(state.photoelectric, params.intensityRel) });
      if (state.photoelectric.thresholdPassed && -state.photoelectric.stoppingVoltageV >= plot.uMin) {
        const stopX = graphX(-state.photoelectric.stoppingVoltageV);
        primitives.push({kind:'circle',cx:stopX,cy:plot.y,r:0.025},
          {kind:'text',x:stopX,y:plot.y-0.27,text:'−Uc',align:'middle'});
      }
      primitives.push({kind:'circle',cx:graphX(params.anodeVoltageV),cy:graphY(state.photoelectric.currentMa),r:0.024,fill:true});
      return { width: 680, height: 400, viewBox: {minX: -0.28, minY: -1.38, maxX: 2.65, maxY: 1.28},
        title: '光电效应伏安特性配图', primitives };
    }
    const v = comptonMomentumVectors(state.compton, params.scatterAngleDeg, 1.3);
    primitives.push(
      { kind:'arrow', x1:-v.incident.x, y1:0, x2:0, y2:0, label:'pγ' },
      { kind:'arrow', x1:0, y1:0, x2:v.scattered.x, y2:v.scattered.y, label:'p′γ' },
      { kind:'arrow', x1:0, y1:0, x2:v.recoil.x, y2:v.recoil.y, label:'pe' },
      { kind:'line', x1:v.scattered.x, y1:v.scattered.y, x2:v.incident.x, y2:0, dashed:true },
      { kind:'line', x1:v.recoil.x, y1:v.recoil.y, x2:v.incident.x, y2:0, dashed:true }
    );
    return {width:680,height:400,viewBox:{minX:-1.65,minY:-1.6,maxX:3.05,maxY:1.6},
      title:'康普顿散射动量闭合示意图',primitives};
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    ctx.save();
    const labels: CanvasLabel[] = [];

    if (params.mode === 'compton') {
      const origin = m.toScreen(-0.8, 0);
      const vectors = comptonMomentumVectors(state.compton, params.scatterAngleDeg);
      const incoming = m.toScreen(-0.8 - vectors.incident.x, 0);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = m.len(0.015);
      drawGlowVectorArrow(ctx, incoming.x, incoming.y, origin.x, origin.y, '#38bdf8', m.len(0.015), m.len(0.06));

      const scattered = m.toScreen(-0.8 + vectors.scattered.x, vectors.scattered.y);
      drawGlowVectorArrow(ctx, origin.x, origin.y, scattered.x, scattered.y, '#a855f7', m.len(0.015), m.len(0.06));

      const recoil = m.toScreen(-0.8 + vectors.recoil.x, vectors.recoil.y);
      drawGlowVectorArrow(ctx, origin.x, origin.y, recoil.x, recoil.y, '#f59e0b', m.len(0.015), m.len(0.06));
      const resultant = m.toScreen(-0.8 + vectors.incident.x, 0);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.6)'; ctx.lineWidth = 1.4; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(scattered.x,scattered.y); ctx.lineTo(resultant.x,resultant.y);
      ctx.moveTo(recoil.x,recoil.y); ctx.lineTo(resultant.x,resultant.y); ctx.stroke(); ctx.restore();
      labels.push(
        { id: 'compton-incident-label', ...m.toScreen(-1.4, 0.1), text: 'pγ', color: '#38bdf8' },
        { id: 'compton-scattered-label', ...m.toScreen(-0.8 + vectors.scattered.x * 0.65, vectors.scattered.y * 0.65 + 0.14), text: "p′γ", color: '#a855f7' },
        { id: 'compton-recoil-label', ...m.toScreen(-0.8 + vectors.recoil.x * 0.65, vectors.recoil.y * 0.65 - 0.14), text: 'pe', color: '#f59e0b' },
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
      const { x: gx0, y: gy0, width: gw, height: gh, uMin, uMax } = plot;
      const toPx = (u: number) => m.toX(graphX(u));
      const toPy = (curr: number) => m.toY(graphY(curr));

      ctx.strokeStyle = 'rgba(148,163,184,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.toX(gx0), m.toY(gy0));
      ctx.lineTo(m.toX(gx0 + gw), m.toY(gy0));
      ctx.moveTo(toPx(0), m.toY(gy0));
      ctx.lineTo(toPx(0), m.toY(gy0 + gh));
      ctx.stroke();

      const axisColor = '#94a3b8';
      ctx.strokeStyle = axisColor; ctx.lineWidth = 1;
      for (const tick of [-5,-3,0,3,6]) {
        ctx.beginPath(); ctx.moveTo(toPx(tick),toPy(0)); ctx.lineTo(toPx(tick),toPy(0)+5); ctx.stroke();
        labels.push({id:'voltage-tick-'+tick,x:toPx(tick),y:toPy(0)+15,text:String(tick),color:axisColor});
      }
      for (const tick of [2,4,6]) {
        ctx.beginPath(); ctx.moveTo(toPx(0)-5,toPy(tick)); ctx.lineTo(toPx(0),toPy(tick)); ctx.stroke();
        labels.push({id:'current-tick-'+tick,x:toPx(0)-15,y:toPy(tick),text:String(tick),color:axisColor});
      }
      labels.push({id:'voltage-axis',x:toPx(uMax),y:toPy(0)+32,text:'U_AK (V)',color:axisColor},
        {id:'current-axis',x:toPx(0),y:toPy(plot.iMax)-15,text:'I (mA)',color:axisColor});
      if (state.photoelectric.thresholdPassed && -state.photoelectric.stoppingVoltageV >= uMin) {
        const x = toPx(-state.photoelectric.stoppingVoltageV);
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.arc(x,toPy(0),4,0,Math.PI*2); ctx.stroke();
        labels.push({id:'stopping-point',x,y:toPy(0)+32,text:'−Uc='+(-state.photoelectric.stoppingVoltageV).toFixed(3)+' V',color:'#67e8f9'});
      }
      if (params.freezeRefEnabled) {
        labels.push({id:'reference-curve-legend',...m.toScreen(1.36,-1.2),
          text:'虚线：参考光 λ='+params.refWavelengthNm.toFixed(0)+' nm',color:axisColor});
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
      labels.push({ id: 'photoelectric-summary', ...m.toScreen(0.9, 1.12), text: `hν = ${state.photoelectric.photonEnergyEv.toFixed(3)} eV | W₀ = ${state.photoelectric.workFunctionEv.toFixed(2)} eV | ${state.photoelectric.thresholdPassed ? 'Uc = '+state.photoelectric.stoppingVoltageV.toFixed(3)+' V' : '未超过阈频 · 无光电流'}`, color: '#e2e8f0', font: 'bold 14px ui-sans-serif, system-ui' });
    }
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    if (params.mode === 'compton') {
      const { scattered } = comptonMomentumVectors(state.compton, params.scatterAngleDeg);
      return [
        {
          id: 'compton-scatter-angle',
          label: `θ=${params.scatterAngleDeg.toFixed(0)}°`,
          position: { x: -0.8 + scattered.x, y: scattered.y },
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

    const voltageX = graphX(params.anodeVoltageV);
    const currentY = graphY(state.photoelectric.currentMa);
    return [
      {
        id: 'anode-voltage-point',
        label: `U_AK=${params.anodeVoltageV.toFixed(1)} V`,
        position: { x: voltageX, y: currentY },
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (world) => ({
          anodeVoltageV: Number(Math.max(-5, Math.min(6, Math.round((plot.uMin + ((world.x - plot.x) / plot.width) * (plot.uMax - plot.uMin)) * 10) / 10)).toFixed(1))
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
      latex: params.mode === 'photoelectric' ? (state.photoelectric.thresholdPassed ? 'h\\nu - W_0 = eU_c' : 'h\\nu \\le W_0,\\quad I=0') : '\\Delta\\lambda = \\frac{h}{m_e c}(1 - \\cos\\theta)',
      substitutedLatex:
        params.mode === 'photoelectric'
          ? (state.photoelectric.thresholdPassed
            ? `\\begin{aligned}U_c&=${state.photoelectric.stoppingVoltageV.toFixed(3)}\\text{ V}\\\\U_{AK}&=${params.anodeVoltageV.toFixed(1)}\\text{ V}\\\\ I&=${state.photoelectric.currentMa.toFixed(2)}\\text{ mA}\\end{aligned}`
            : `\\begin{aligned}h\\nu&=${state.photoelectric.photonEnergyEv.toFixed(3)}\\text{ eV}\\\\W_0&=${state.photoelectric.workFunctionEv.toFixed(2)}\\text{ eV}\\\\I&=0\\text{ mA}\\end{aligned}`)
          : `\\Delta\\lambda=${(state.compton.deltaLambdaNm * 1000).toFixed(3)}\\text{ pm},\\; \\varphi=${state.compton.recoilAngleDeg.toFixed(2)}^\\circ`
    }
  ]
});

export default modernPhotoelectricComptonPlugin;
