import { createWorldMapper, defineSimulationPlugin, drawGlowVectorArrow, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeDopplerFrequencies,
  computeObservables,
  computeWaveSpeed,
  createInitialState,
  enumerateMultiSolutionSpeeds,
  evaluateInterferenceAtPoint,
  evaluateStandingWave,
  evaluateTransverseWave,
  stepWaveCoupling,
  type WaveCouplingParams,
  type WaveCouplingState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WaveCouplingParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '波动模型模式',
    options: [
      { label: '一维横波与质点振动联动', value: 'transverse' },
      { label: '两列等幅反向波叠加驻波（波节/波腹）', value: 'standing' },
      { label: '双波源二维水波干涉', value: 'interference' },
      { label: '运动波源多普勒效应（含超音速马赫锥）', value: 'doppler' }
    ],
    defaultValue: 'transverse'
  },
  {
    key: 'amplitude',
    kind: 'number',
    label: '振幅 A',
    unit: 'm',
    min: 0,
    max: 1.2,
    step: 0.05,
    defaultValue: 0.6
  },
  {
    key: 'frequency',
    kind: 'number',
    label: '波源频率 f',
    unit: 'Hz',
    min: 0.2,
    max: 3.0,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'wavelength',
    kind: 'number',
    label: '波长 λ',
    unit: 'm',
    min: 0.5,
    max: 4.0,
    step: 0.1,
    defaultValue: 2.0
  },
  {
    key: 'direction',
    kind: 'select',
    label: '传播方向',
    options: [
      { label: '沿 +x 向右传播', value: 'right' },
      { label: '沿 -x 向左传播', value: 'left' }
    ],
    defaultValue: 'right'
  },
  {
    key: 'causalFront',
    kind: 'boolean',
    label: '启用起振因果波前',
    defaultValue: false
  },
  {
    key: 'probeX',
    kind: 'number',
    label: '探测质点 Px',
    unit: 'm',
    min: -3.5,
    max: 3.5,
    step: 0.1,
    defaultValue: 1.5
  },
  {
    key: 'probeY',
    kind: 'number',
    label: '探测质点 Py（干涉）',
    unit: 'm',
    min: -2.5,
    max: 2.5,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'sourceSeparation',
    kind: 'number',
    label: '双波源间距 d',
    unit: 'm',
    min: 1.0,
    max: 6.0,
    step: 0.2,
    defaultValue: 4.0
  },
  {
    key: 'phaseDiffDeg',
    kind: 'number',
    label: '两波源初相差 Δφ₀',
    unit: '°',
    min: 0,
    max: 180,
    step: 180,
    defaultValue: 0
  },
  {
    key: 'sourceSpeedRatio',
    kind: 'number',
    label: '波源速度比 vs/v',
    unit: '倍',
    min: 0,
    max: 1.2,
    step: 0.05,
    defaultValue: 0.45
  }
];

export const waveVibrationCouplingPlugin = defineSimulationPlugin<
  WaveCouplingParams,
  WaveCouplingState
>({
  meta: {
    id: 'wave-vibration-coupling',
    title: '机械波与质点振动双图联动 · 干涉与多普勒',
    textbookRef: '人教版 选择性必修一 第三章 第1–4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: { scale: 0.72 },
  paramSchema,
  presets: [
    {
      id: 'transverse-slope-rule',
      name: '1. 波形传播与上下坡法判振向',
      description: '观察波动图像向右推进时，“上坡质点向下振、下坡质点向上振”，并与底部 y-t 曲线同步对照。',
      params: {
        mode: 'transverse',
        amplitude: 0.6,
        frequency: 0.8,
        wavelength: 2.4,
        direction: 'right',
        causalFront: false,
        probeX: 1.5
      },
      visibleLayers: ['waveform', 'slopeGhost', 'probeParticle', 'vibrationGraph']
    },
    {
      id: 'causal-wavefront-startup',
      name: '2. 波源起振因果波前传播',
      description: '从 t=0 起波源开始起振，精确观察波前抵达远处质点 P 的时间延迟与起振方向传承。',
      params: {
        mode: 'transverse',
        amplitude: 0.65,
        frequency: 1.0,
        wavelength: 2.0,
        direction: 'right',
        causalFront: true,
        probeX: 2.6
      },
      visibleLayers: ['waveform', 'slopeGhost', 'probeParticle', 'vibrationGraph']
    },
    {
      id: 'interference-in-phase',
      name: '3. 双波源同相水波干涉',
      description: '两个振动步调完全相同的波源产生稳定干涉图样，中垂线及波程差为波长的整数倍处为加强区。',
      params: {
        mode: 'interference',
        amplitude: 0.5,
        frequency: 1.5,
        wavelength: 1.2,
        causalFront: false,
        sourceSeparation: 3.6,
        phaseDiffDeg: 0,
        probeX: 0,
        probeY: 1.4
      },
      visibleLayers: ['interferenceField', 'antinodeCurves', 'probeParticle']
    },
    {
      id: 'interference-anti-phase-misconception',
      name: '4. 反例辨析：反相波源中垂线相消',
      description: '当两波源初相差为 180° 时，到两波源等距的中垂线不再是加强区而是完全静止的减弱区。',
      params: {
        mode: 'interference',
        amplitude: 0.5,
        frequency: 1.5,
        wavelength: 1.2,
        causalFront: false,
        sourceSeparation: 3.6,
        phaseDiffDeg: 180,
        probeX: 0,
        probeY: 1.4
      },
      visibleLayers: ['interferenceField', 'antinodeCurves', 'probeParticle']
    },
    {
      id: 'doppler-moving-source',
      name: '5. 运动波源多普勒效应（波前挤压）',
      description: '波源以 0.55 倍波速向右移动，直观呈现前方波长变短（频率升高）、后方波长变长（频率降低）。',
      params: {
        mode: 'doppler',
        amplitude: 0.45,
        frequency: 1.8,
        wavelength: 1.0,
        sourceSpeedRatio: 0.55,
        probeX: 2.0,
        probeY: 0
      },
      visibleLayers: ['dopplerFronts', 'probeParticle']
    },
    {
      id: 'standing-wave-nodes',
      name: '6. 等幅相向行波叠加形成驻波（固定波节与波腹）',
      description: '在 x = kλ/2 处始终保持严格静止的波节，相邻波节间质点同相振动且振幅包络为 2A|sin(kx)|。',
      params: {
        mode: 'standing',
        amplitude: 0.45,
        frequency: 1.2,
        wavelength: 2.0,
        probeX: 0.5,
        probeY: 0
      },
      visibleLayers: ['waveform', 'probeParticle', 'vibrationGraph']
    },
    {
      id: 'supersonic-mach-cone',
      name: '7. 超音速波源与马赫锥 (vs = 1.15 v波)',
      description: '当波源速率超过波速时，同心球面波前叠加出清晰马赫激波锥，半顶角满足 sin(α)=v/vs。',
      params: {
        mode: 'doppler',
        amplitude: 0.45,
        frequency: 2.0,
        wavelength: 0.9,
        sourceSpeedRatio: 1.15,
        probeX: 2.0,
        probeY: 0
      },
      visibleLayers: ['dopplerFronts', 'probeParticle']
    }
  ],
  engine: {
    createInitialState,
    step: stepWaveCoupling,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'waveform', label: '当前时刻 y-x 波形', defaultVisible: true },
    { id: 'slopeGhost', label: '微平移法下一瞬虚线波形', defaultVisible: true },
    { id: 'probeParticle', label: '探测质点与振动方向矢量', defaultVisible: true },
    { id: 'vibrationGraph', label: '画内实时 y-t 振动缩略联动', defaultVisible: true },
    { id: 'interferenceField', label: '二维干涉波峰波谷强弱场', defaultVisible: true },
    { id: 'antinodeCurves', label: '加强区中垂与节点辅助标线', defaultVisible: true },
    { id: 'dopplerFronts', label: '多普勒同心波前族', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'probeY', label: '探测质点位移 y_P', unit: 'm', color: '#38bdf8' },
    { key: 'probeVy', label: '探测质点振动速度 v_y', unit: 'm/s', color: '#4ade80' },
    { key: 'probeAy', label: '质点加速度 a_y', unit: 'm/s²', color: '#f472b6' },
    { key: 'analyticalAmplitude', label: '合振幅 A_net', unit: 'm', color: '#fbbf24' }
  ],
  getControlHandles: (state, params) => {
    const probeY = params.mode === 'interference'
      ? params.probeY
      : params.mode === 'doppler'
        ? 0
        : (params.mode === 'standing'
          ? evaluateStandingWave(params.probeX, state.t, params).y
          : evaluateTransverseWave(params.probeX, state.t, params).y);
    return [{
      id: 'wave-probe',
      label: `探针 Px=${params.probeX.toFixed(1)}`,
      position: { x: params.probeX, y: probeY },
      handleKind: 'point',
      color: '#4ade80',
      onDrag: (wp) => ({
        probeX: Number(Math.max(-3.5, Math.min(3.5, wp.x)).toFixed(1)),
        probeY: Number(Math.max(-2.5, Math.min(2.5, wp.y)).toFixed(1))
      })
    }];
  },
  referenceFrames: [
    {
      id: 'wavefront',
      label: '波速随动参考系（静止波形）',
      getOrigin: (s, params) => ({
        x: (params.direction === 'right' ? 1 : -1) * computeWaveSpeed(params) * s.t,
        y: 0
      })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'wave-vibration-coupling',
      title: '机械波与驻波/多普勒',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WaveCouplingParams>
  },
  exportDiagramIR: (state, params) => {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const x = -3 + (i / 48) * 6;
      const y =
        params.mode === 'standing'
          ? evaluateStandingWave(x, state.t, params).y
          : evaluateTransverseWave(x, state.t, params).y;
      pts.push({ x, y });
    }
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -3.2, y1: 0, x2: 3.2, y2: 0 },
      { kind: 'polyline', points: pts },
      {
        kind: 'mathLabel',
        x: 3.0,
        y: 1.1,
        text: `\\lambda=${params.wavelength.toFixed(1)}\\text{m},\\; f=${params.frequency.toFixed(1)}\\text{Hz}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -3.4, minY: -1.4, maxX: 3.4, maxY: 1.4 },
      title: '机械波波形配图',
      primitives
    };
  },
  formatFormulas: (state, params) => {
    const vWave = computeWaveSpeed(params);
    if (params.mode === 'doppler') {
      const { frontFreq, backFreq } = computeDopplerFrequencies(params);
      return [
        {
          id: 'doppler-formula',
          label: '多普勒表观频率',
          latex: "f' = f \\frac{v}{v \\mp v_s}",
          substitutedLatex: `f_{\\text{前}}' = ${Number.isFinite(frontFreq) ? frontFreq.toFixed(2) : '\\infty'}\\text{ Hz},\\quad f_{\\text{后}}' = ${backFreq.toFixed(2)}\\text{ Hz}`
        }
      ];
    }
    if (params.mode === 'interference') {
      const res = evaluateInterferenceAtPoint(params.probeX, params.probeY, state.t, params);
      return [
        {
          id: 'interference-delta',
          label: '双波源波程差与合振幅',
          latex: '\\Delta r = |r_2 - r_1|',
          substitutedLatex: `\\Delta r = ${res.pathDiff.toFixed(2)}\\text{ m} = ${(res.pathDiff / Math.max(params.wavelength, 1e-6)).toFixed(2)}\\lambda,\\; A_{\\text{合}} = ${res.analyticalAmplitude.toFixed(2)}\\text{ m}`
        }
      ];
    }
    return [
      {
        id: 'wave-speed',
        label: '波速与多解通式',
        latex: 'v = \\lambda f',
        substitutedLatex: `v = ${vWave.toFixed(2)}\\text{ m/s},\\; \\Delta x_0\\text{ 通解 } v_1=${enumerateMultiSolutionSpeeds(params.wavelength, 0.5, 1, 0)[0]?.speed.toFixed(2) ?? '0'}\\text{ m/s}`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const drawWorldRect = (x: number, y: number, width: number, height: number, fill: boolean) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      if (fill) ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      else ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    if (params.mode === 'transverse' || params.mode === 'standing') {
      const xMin = -4;
      const xMax = 4;
      const showSubGraph = activeLayers.has('vibrationGraph');
      const toScreen = (wx: number, wy: number) => m.toScreen(wx, wy);

      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1.5;
      const axL = toScreen(xMin, 0);
      const axR = toScreen(xMax, 0);
      ctx.beginPath();
      ctx.moveTo(axL.x, axL.y);
      ctx.lineTo(axR.x, axR.y);
      ctx.stroke();

      for (let gx = -4; gx <= 4; gx += 1) {
        const gp = toScreen(gx, 0);
        ctx.beginPath();
        ctx.moveTo(gp.x, gp.y - m.len(0.025));
        ctx.lineTo(gp.x, gp.y + m.len(0.025));
        ctx.stroke();
        labels.push({ id: `wave-axis-${gx}`, x: gp.x, y: gp.y + m.len(0.13), text: `${gx}m`, color: 'rgba(148, 163, 184, 0.85)', font: '11px system-ui, sans-serif' });
      }
      ctx.restore();

      if (activeLayers.has('slopeGhost')) {
        const dtGhost = params.frequency > 0 ? 0.08 / params.frequency : 0.05;
        ctx.save();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        const samples = 240;
        for (let i = 0; i <= samples; i++) {
          const wx = xMin + ((xMax - xMin) * i) / samples;
          const { y } =
            params.mode === 'standing'
              ? evaluateStandingWave(wx, state.t + dtGhost, params)
              : evaluateTransverseWave(wx, state.t + dtGhost, params);
          const p = toScreen(wx, y);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 主波形
      if (activeLayers.has('waveform')) {
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        const samples = 300;
        for (let i = 0; i <= samples; i++) {
          const wx = xMin + ((xMax - xMin) * i) / samples;
          const { y } =
            params.mode === 'standing'
              ? evaluateStandingWave(wx, state.t, params)
              : evaluateTransverseWave(wx, state.t, params);
          const p = toScreen(wx, y);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        // 介质采样点
        ctx.fillStyle = 'rgba(56, 189, 248, 0.65)';
        for (let wx = -3.6; wx <= 3.6; wx += 0.4) {
          const { y } =
            params.mode === 'standing'
              ? evaluateStandingWave(wx, state.t, params)
              : evaluateTransverseWave(wx, state.t, params);
          const p = toScreen(wx, y);
          ctx.beginPath();
          ctx.arc(p.x, p.y, m.len(0.02), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 探测质点 P 与振动方向箭头
      if (activeLayers.has('probeParticle')) {
        const { y, vy } = params.mode === 'standing'
          ? evaluateStandingWave(params.probeX, state.t, params)
          : evaluateTransverseWave(params.probeX, state.t, params);
        const eqP = toScreen(params.probeX, 0);
        const curP = toScreen(params.probeX, y);
        ctx.save();
        ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(eqP.x, eqP.y - m.len(0.55));
        ctx.lineTo(eqP.x, eqP.y + m.len(0.55));
        ctx.stroke();
        ctx.setLineDash([]);

        // 速度方向箭头
        const arrowHeight = Math.max(-0.35, Math.min(0.35, vy * 0.08));
        if (Math.abs(arrowHeight) > 0.03) {
          const endpoint = toScreen(params.probeX, y + arrowHeight);
          drawGlowVectorArrow(ctx, curP.x, curP.y, endpoint.x, endpoint.y, '#4ade80', 3, 10);
        }

        ctx.fillStyle = '#f472b6';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(curP.x, curP.y, m.len(0.05), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        labels.push({ id: 'transverse-probe-label', x: curP.x, y: curP.y - m.len(0.15), text: `质点 P (x=${params.probeX.toFixed(1)}m)`, color: '#f472b6', font: 'bold 13px system-ui, sans-serif' });
        ctx.restore();
      }

      // 下半部分：质点 P 的实时 y-t 振动曲线
      if (showSubGraph) {
        const boxLeft = -3.4;
        const boxWidth = 6.8;
        const boxBottom = -2.25;
        const boxHeight = 0.9;
        const boxTop = boxBottom + boxHeight;
        const midY = boxBottom + boxHeight * 0.5;

        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.2;
        drawWorldRect(boxLeft, boxBottom, boxWidth, boxHeight, true);
        drawWorldRect(boxLeft, boxBottom, boxWidth, boxHeight, false);

        const left = m.toScreen(boxLeft, midY);
        const right = m.toScreen(boxLeft + boxWidth, midY);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();

        const graphTitle = m.toScreen(0, boxTop + 0.15);
        labels.push({ id: 'probe-vibration-history-label', x: graphTitle.x, y: graphTitle.y, text: `质点 P 振动图像 y - t（${params.probeX.toFixed(1)}m）`, color: '#f472b6', font: 'bold 12px system-ui, sans-serif' });

        if (state.probeHistory.length >= 2) {
          const windowSec = 6;
          const tMax = Math.max(windowSec, state.t);
          const tMin = tMax - windowSec;
          ctx.strokeStyle = '#f472b6';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          let started = false;
          for (const pt of state.probeHistory) {
            if (pt.x < tMin) continue;
            const worldX = boxLeft + ((pt.x - tMin) / windowSec) * boxWidth;
            const worldY = midY + Math.max(-0.34, Math.min(0.34, pt.y / Math.max(params.amplitude, 0.4) * 0.34));
            const point = m.toScreen(worldX, worldY);
            if (!started) {
              ctx.moveTo(point.x, point.y);
              started = true;
            } else {
              ctx.lineTo(point.x, point.y);
            }
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      return;
    }

    const toScreen2D = m.toScreen;

    if (params.mode === 'interference') {
      if (activeLayers.has('interferenceField')) {
        const cols = 96;
        const rows = 58;
        const xMin = -3.5;
        const xMax = 3.5;
        const yMin = -2.5;
        const yMax = 2.5;
        const cellWorldW = (xMax - xMin) / cols;
        const cellWorldH = (yMax - yMin) / rows;
        const maxAmp = Math.max(2 * params.amplitude, 0.1);

        for (let r = 0; r < rows; r++) {
          const wy = yMax - ((r + 0.5) / rows) * (yMax - yMin);
          for (let c = 0; c < cols; c++) {
            const wx = xMin + ((c + 0.5) / cols) * (xMax - xMin);
            const res = evaluateInterferenceAtPoint(wx, wy, state.t, params);
            const norm = Math.max(-1, Math.min(1, res.displacement / maxAmp));
            const alpha = Math.abs(norm) * 0.72;
            ctx.fillStyle =
              norm >= 0
                ? `rgba(56, 189, 248, ${alpha.toFixed(2)})`
                : `rgba(244, 114, 182, ${alpha.toFixed(2)})`;
            const topLeft = m.toScreen(wx - cellWorldW * 0.5, wy + cellWorldH * 0.5);
            ctx.fillRect(topLeft.x, topLeft.y, m.len(cellWorldW), m.len(cellWorldH));
          }
        }
      }

      if (activeLayers.has('antinodeCurves')) {
        // 中垂线辅助线
        const pTop = toScreen2D(0, 3.5);
        const pBot = toScreen2D(0, -3.5);
        ctx.save();
        ctx.strokeStyle =
          Math.abs(params.phaseDiffDeg) < 90
            ? 'rgba(74, 222, 128, 0.75)'
            : 'rgba(248, 113, 113, 0.75)';
        ctx.setLineDash([7, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pTop.x, pTop.y);
        ctx.lineTo(pBot.x, pBot.y);
        ctx.stroke();
        ctx.restore();
      }

      // 两波源标记
      const halfD = 0.5 * params.sourceSeparation;
      for (const [idx, sxPos] of [-halfD, halfD].entries()) {
        const sp = toScreen2D(sxPos, 0);
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, m.len(0.045), 0, Math.PI * 2);
        ctx.fill();
        labels.push({ id: `interference-source-${idx}`, x: sp.x, y: sp.y - m.len(0.12), text: `S${idx + 1}`, color: '#fbbf24', font: 'bold 13px system-ui, sans-serif' });
        ctx.restore();
      }

      if (activeLayers.has('probeParticle')) {
        const pp = toScreen2D(params.probeX, params.probeY);
        const res = evaluateInterferenceAtPoint(params.probeX, params.probeY, state.t, params);
        ctx.save();
        ctx.fillStyle = '#4ade80';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, m.len(0.05 + Math.abs(res.displacement) * 0.04), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        labels.push({ id: 'interference-probe-label', x: pp.x, y: pp.y - m.len(0.15), text: `P (A合=${res.analyticalAmplitude.toFixed(2)}m)`, color: '#e2e8f0', font: 'bold 13px system-ui, sans-serif' });
        ctx.restore();
      }
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      return;
    }

    // Doppler 模式
    const vWave = computeWaveSpeed(params);
    if (activeLayers.has('dopplerFronts')) {
      ctx.save();
      for (const wf of state.wavefronts) {
        const age = state.t - wf.emittedAt;
        if (age < 0) continue;
        const r = vWave * age * m.ppm;
        if (r > m.len(6)) continue;
        const center = toScreen2D(wf.cx, wf.cy);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    const src = toScreen2D(state.sourceX, 0);
    ctx.save();
    if (params.sourceSpeedRatio > 1.0 && state.wavefronts.length > 1) {
      const sinAlpha = 1 / params.sourceSpeedRatio;
      const halfConeAngle = Math.asin(sinAlpha);
      const coneLen = m.len(4.5);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(src.x - coneLen * Math.cos(halfConeAngle), src.y - coneLen * Math.sin(halfConeAngle));
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(src.x - coneLen * Math.cos(halfConeAngle), src.y + coneLen * Math.sin(halfConeAngle));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(src.x, src.y, m.len(0.05), 0, Math.PI * 2);
    ctx.fill();
    labels.push({ id: 'doppler-source-label', x: src.x, y: src.y - m.len(0.16), text: `波源 vs=${(params.sourceSpeedRatio * vWave).toFixed(2)}m/s`, color: '#fbbf24', font: 'bold 13px system-ui, sans-serif' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  }
});

export default waveVibrationCouplingPlugin;
