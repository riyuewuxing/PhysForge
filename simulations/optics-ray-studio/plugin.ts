import { degToRad, radToDeg } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepOptics,
  type OpticsParams,
  type OpticsState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<OpticsParams>[] = [
  {
    key: 'sceneMode',
    kind: 'select',
    label: '光学实验模式',
    options: [
      { label: '全反射与临界角实验', value: 'tir-interface' },
      { label: '平行玻璃砖侧移测折射率', value: 'parallel-slab' },
      { label: '三棱镜折射与色散光谱', value: 'prism-dispersion' },
      { label: '光导纤维全反射导光', value: 'optical-fiber' },
      { label: '双缝干涉条纹测定', value: 'double-slit' },
      { label: '理想薄凸透镜成像规律 (1/u+1/v=1/f)', value: 'thin-lens-imaging' }
    ],
    defaultValue: 'tir-interface'
  },
  {
    key: 'incidentAngleDeg',
    kind: 'number',
    label: '入射角 θ₁',
    unit: '°',
    min: 0,
    max: 85,
    step: 1,
    defaultValue: 35
  },
  {
    key: 'n1',
    kind: 'number',
    label: '介质 1 / 玻璃折射率 n₁',
    unit: '',
    min: 1.0,
    max: 2.2,
    step: 0.05,
    defaultValue: 1.5
  },
  {
    key: 'n2',
    kind: 'number',
    label: '介质 2 / 包层折射率 n₂',
    unit: '',
    min: 1.0,
    max: 2.0,
    step: 0.05,
    defaultValue: 1.0
  },
  {
    key: 'slabThickness',
    kind: 'number',
    label: '玻璃砖厚度 d',
    unit: 'm',
    min: 0.3,
    max: 1.8,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'prismApexDeg',
    kind: 'number',
    label: '三棱镜顶角 A',
    unit: '°',
    min: 30,
    max: 75,
    step: 5,
    defaultValue: 60
  },
  {
    key: 'fiberHalfWidth',
    kind: 'number',
    label: '光纤纤芯半宽',
    unit: 'm',
    min: 0.15,
    max: 0.6,
    step: 0.05,
    defaultValue: 0.3
  },
  {
    key: 'wavelengthNm',
    kind: 'number',
    label: '单色光波长 λ（双缝）',
    unit: 'nm',
    min: 400,
    max: 720,
    step: 10,
    defaultValue: 600
  },
  {
    key: 'slitSeparationMm',
    kind: 'number',
    label: '双缝间距 d（双缝）',
    unit: 'mm',
    min: 0.2,
    max: 1.5,
    step: 0.05,
    defaultValue: 0.5
  },
  {
    key: 'screenDistanceM',
    kind: 'number',
    label: '屏缝距离 L（双缝）',
    unit: 'm',
    min: 0.5,
    max: 3.0,
    step: 0.1,
    defaultValue: 1.5
  },
  {
    key: 'animateSweep',
    kind: 'boolean',
    label: '连续扫描入射角（运行模式）',
    defaultValue: true
  },
  {
    key: 'focalLengthM',
    kind: 'number',
    label: '薄透镜焦距 f',
    unit: 'm',
    min: 0.3,
    max: 1.5,
    step: 0.05,
    defaultValue: 0.65
  },
  {
    key: 'objectDistanceM',
    kind: 'number',
    label: '物距 u（薄透镜）',
    unit: 'm',
    min: 0.25,
    max: 2.5,
    step: 0.05,
    defaultValue: 1.2
  }
];

export const opticsRayStudioPlugin = defineSimulationPlugin<OpticsParams, OpticsState>({
  meta: {
    id: 'builder-optics-ray',
    title: '自由几何光学与波动光学建模器 (B3)',
    textbookRef: '人教版 选择性必修一 第四章 第1–4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  getControlHandles: (state, params) => {
    if (params.sceneMode === 'thin-lens-imaging') {
      const u = params.objectDistanceM ?? 1.2;
      return [
        {
          id: 'object-distance',
          label: `物距 u=${u.toFixed(2)}m`,
          position: { x: -u, y: 0.55 },
          handleKind: 'point',
          color: '#fbbf24',
          onDrag: (wp) => ({
            objectDistanceM: Number(Math.max(0.25, Math.min(2.5, -wp.x)).toFixed(2))
          })
        }
      ];
    }
    const rad = degToRad(state.activeAngleDeg);
    return [
      {
        id: 'incident-angle',
        label: `θ₁=${state.activeAngleDeg.toFixed(0)}°`,
        position: { x: -1.4 * Math.sin(rad), y: 1.4 * Math.cos(rad) },
        origin: { x: 0, y: 0 },
        handleKind: 'angle',
        color: '#fbbf24',
        onDrag: (wp) => {
          const ang = Math.max(0, Math.min(85, Math.round((Math.atan2(-wp.x, Math.max(0.05, wp.y)) * 180) / Math.PI)));
          return { incidentAngleDeg: ang, animateSweep: false };
        }
      }
    ];
  },
  sceneSerializer: {
    exportScene: (_state, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-optics-ray',
      title: '几何光学画板场景',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<OpticsParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.6, y1: 0, x2: 2.6, y2: 0, dashed: params.sceneMode === 'thin-lens-imaging' }
    ];
    if (params.sceneMode === 'tir-interface') {
      primitives.push({ kind: 'line', x1: 0, y1: -1.8, x2: 0, y2: 1.8, dashed: true });
      primitives.push({
        kind: 'arcAngle',
        cx: 0,
        cy: 0,
        r: 0.55,
        startAngle: Math.PI / 2,
        endAngle: Math.PI / 2 + degToRad(state.activeAngleDeg),
        label: `θ_1=${state.activeAngleDeg.toFixed(0)}°`
      });
    } else if (params.sceneMode === 'thin-lens-imaging') {
      primitives.push({ kind: 'line', x1: 0, y1: -1.2, x2: 0, y2: 1.2, strokeWidth: 2 });
      const u = params.objectDistanceM ?? 1.2;
      primitives.push({ kind: 'arrow', x1: -u, y1: 0, x2: -u, y2: 0.55, label: '物' });
    }
    for (const r of state.rays) {
      primitives.push({ kind: 'arrow', x1: r.from.x, y1: r.from.y, x2: r.to.x, y2: r.to.y, dashed: r.dashed, label: r.label });
    }
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -2.8, minY: -1.9, maxX: 2.8, maxY: 1.9 },
      title: '几何光学与折射全反射光路图',
      primitives
    };
  },
  paramSchema,
  presets: [
    {
      id: 'tir-water-air',
      name: '1. 全反射与临界角扫描（光密→光疏）',
      description: '光线由折射率 1.5 玻璃射向空气，运行即自动扫描入射角至突破临界角 C = 41.8° 触发 100% 全反射。',
      params: {
        sceneMode: 'tir-interface',
        incidentAngleDeg: 35,
        n1: 1.5,
        n2: 1.0,
        animateSweep: true
      }
    },
    {
      id: 'parallel-glass-slab',
      name: '2. 平行玻璃砖侧移测折射率',
      description: '验证经过两平行折射面后出射光与入射光严格平行，并量化侧移距离 Δx。',
      params: {
        sceneMode: 'parallel-slab',
        incidentAngleDeg: 50,
        n1: 1.5,
        slabThickness: 1.0,
        animateSweep: false
      }
    },
    {
      id: 'prism-dispersion',
      name: '3. 三棱镜对复色光的色散',
      description: '白光经过等腰三棱镜两次折射后，紫光折射率最大偏折角最大、红光偏折最小，形成彩色光谱。',
      params: {
        sceneMode: 'prism-dispersion',
        incidentAngleDeg: 45,
        n1: 1.52,
        prismApexDeg: 60,
        animateSweep: false
      }
    },
    {
      id: 'optical-fiber',
      name: '4. 光导纤维内部全反射传导',
      description: '高折射率纤芯（n₁=1.6）包裹低折射率包层（n₂=1.4），演示小角度入射光在纤维内连续全反射向前传输。',
      params: {
        sceneMode: 'optical-fiber',
        incidentAngleDeg: 22,
        n1: 1.6,
        n2: 1.4,
        fiberHalfWidth: 0.3,
        animateSweep: false
      }
    },
    {
      id: 'double-slit-interference',
      name: '5. 双缝干涉条纹与波长测量',
      description: '改变单色光波长 λ、缝距 d 与屏距 L，实时观测明暗相间等距条纹及中心光强分布曲线。',
      params: {
        sceneMode: 'double-slit',
        wavelengthNm: 600,
        slitSeparationMm: 0.5,
        screenDistanceM: 1.5,
        animateSweep: false
      }
    },
    {
      id: 'thin-lens-real-image',
      name: '6. 薄凸透镜成倒立实像 (u > 2f)',
      description: '验证高斯成像公式 1/u + 1/v = 1/f，拖动左侧物矢即可连续观察实像/虚像转换。',
      params: {
        sceneMode: 'thin-lens-imaging',
        focalLengthM: 0.65,
        objectDistanceM: 1.5,
        animateSweep: false
      }
    }
  ],
  engine: {
    createInitialState,
    step: stepOptics,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'medium', label: '光学介质与几何轮廓', defaultVisible: true },
    { id: 'normalLine', label: '界面法线与角度标识', defaultVisible: true },
    { id: 'rays', label: '光路射线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'incidentAngleDeg', label: '入射角 θ₁', unit: '°', color: '#fbbf24' },
    { key: 'refractedAngleDeg', label: '折射角 θ₂', unit: '°', color: '#38bdf8' },
    { key: 'lateralShift', label: '玻璃砖侧移 Δx', unit: 'm', color: '#4ade80' },
    { key: 'fringeSpacingMm', label: '条纹间距 Δx', unit: 'mm', color: '#f472b6' }
  ],
  formatFormulas: (state, params) => {
    if (params.sceneMode === 'double-slit') {
      return [
        {
          id: 'double-slit-eq',
          label: '双缝干涉条纹间距公式',
          latex: '\\Delta x = \\frac{L}{d}\\lambda',
          substitutedLatex: `\\Delta x = \\frac{${params.screenDistanceM.toFixed(2)}}{${params.slitSeparationMm.toFixed(2)}\\text{ mm}} \\times ${params.wavelengthNm}\\text{ nm} = ${state.fringeSpacingMm.toFixed(2)}\\text{ mm}`
        }
      ];
    }
    if (params.sceneMode === 'parallel-slab') {
      return [
        {
          id: 'slab-eq',
          label: '平行玻璃砖侧移公式',
          latex: '\\Delta x = d\\frac{\\sin(\\theta_1 - \\theta_2)}{\\cos\\theta_2}',
          substitutedLatex: `\\theta_1 = ${state.activeAngleDeg.toFixed(1)}^\\circ,\\; \\theta_2 = ${(state.refractedAngleDeg ?? 0).toFixed(1)}^\\circ,\\; \\Delta x = ${state.lateralShift.toFixed(3)}\\text{ m}`
        }
      ];
    }
    const critStr =
      state.criticalAngleDeg !== null ? `${state.criticalAngleDeg.toFixed(1)}^\\circ` : '\\text{无}';
    return [
      {
        id: 'snell-eq',
        label: '斯涅尔折射定律与全反射临界角',
        latex: 'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2, \\quad \\sin C = \\frac{n_2}{n_1}',
        substitutedLatex: `\\theta_1 = ${state.activeAngleDeg.toFixed(1)}^\\circ,\\; C = ${critStr},\\; ${
          state.isTotalInternalReflection ? '\\text{已全反射}' : `\\theta_2 = ${(state.refractedAngleDeg ?? 0).toFixed(1)}^\\circ`
        }`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const pxPerM = Math.min(viewport.width, viewport.height) * 0.22 * viewport.scale;
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const toScreen = (wx: number, wy: number) => ({
      sx: cx + wx * pxPerM,
      sy: cy - wy * pxPerM
    });

    if (params.sceneMode === 'double-slit') {
      // 双缝干涉专属屏面渲染
      const barrierX = viewport.width * 0.22;
      const screenX = viewport.width * 0.72;
      const midY = viewport.height * 0.5;
      const slitGapPx = Math.max(14, params.slitSeparationMm * 28);

      ctx.save();
      // 挡板与双缝
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(barrierX, 30);
      ctx.lineTo(barrierX, midY - slitGapPx - 5);
      ctx.moveTo(barrierX, midY - slitGapPx + 5);
      ctx.lineTo(barrierX, midY + slitGapPx - 5);
      ctx.moveTo(barrierX, midY + slitGapPx + 5);
      ctx.lineTo(barrierX, viewport.height - 30);
      ctx.stroke();

      // 光屏干涉明暗条纹与右侧光强分布曲线
      const screenH = viewport.height - 80;
      const topY = 40;
      const wavelengthColor =
        params.wavelengthNm < 490
          ? '#60a5fa'
          : params.wavelengthNm < 570
            ? '#4ade80'
            : params.wavelengthNm < 605
              ? '#fbbf24'
              : '#f87171';

      const pxPerMm = 22;
      const spacingPx = Math.max(8, state.fringeSpacingMm * pxPerMm);

      for (let py = topY; py <= topY + screenH; py += 2) {
        const dy = py - midY;
        const intensity = Math.pow(Math.cos((Math.PI * dy) / spacingPx), 2);
        ctx.fillStyle = wavelengthColor;
        ctx.globalAlpha = 0.08 + 0.92 * intensity;
        ctx.fillRect(screenX - 10, py, 20, 2.5);
      }
      ctx.globalAlpha = 1;

      // 光强曲线 I(y)
      ctx.strokeStyle = wavelengthColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let py = topY; py <= topY + screenH; py += 2) {
        const dy = py - midY;
        const intensity = Math.pow(Math.cos((Math.PI * dy) / spacingPx), 2);
        const ix = screenX + 24 + intensity * 120;
        if (py === topY) ctx.moveTo(ix, py);
        else ctx.lineTo(ix, py);
      }
      ctx.stroke();

      // 示例相干路径线
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      for (const syOff of [-slitGapPx, slitGapPx]) {
        ctx.beginPath();
        ctx.moveTo(barrierX, midY + syOff);
        ctx.lineTo(screenX, midY);
        ctx.moveTo(barrierX, midY + syOff);
        ctx.lineTo(screenX, midY - spacingPx);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`条纹间距 Δx = ${state.fringeSpacingMm.toFixed(2)} mm`, screenX - 10, 26);
      ctx.restore();
      return;
    }

    // 1. 绘制介质边界
    if (activeLayers.has('medium')) {
      ctx.save();
      if (params.sceneMode === 'tir-interface') {
        const p0 = toScreen(0, 0);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(0, 0, viewport.width, p0.sy);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, p0.sy);
        ctx.lineTo(viewport.width, p0.sy);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText(`介质 1 (n₁ = ${params.n1.toFixed(2)})`, 20, p0.sy - 14);
        ctx.fillText(`介质 2 (n₂ = ${params.n2.toFixed(2)})`, 20, p0.sy + 26);
      } else if (params.sceneMode === 'parallel-slab') {
        const d = params.slabThickness;
        const tl = toScreen(-2.2, 0.5 * d);
        const br = toScreen(2.2, -0.5 * d);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      } else if (params.sceneMode === 'prism-dispersion') {
        const halfA = 0.5 * degToRad(params.prismApexDeg);
        const h = 1.6;
        const halfBase = h * Math.tan(halfA);
        const pTop = toScreen(0, 0.6 * h);
        const pL = toScreen(-halfBase, -0.4 * h);
        const pR = toScreen(halfBase, -0.4 * h);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pTop.sx, pTop.sy);
        ctx.lineTo(pL.sx, pL.sy);
        ctx.lineTo(pR.sx, pR.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (params.sceneMode === 'optical-fiber') {
        const hw = params.fiberHalfWidth;
        const tl = toScreen(-2.4, hw);
        const br = toScreen(2.4, -hw);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.fillRect(tl.sx, tl.sy - 16, br.sx - tl.sx, br.sy - tl.sy + 32);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      } else if (params.sceneMode === 'thin-lens-imaging') {
        const axisL = toScreen(-2.8, 0);
        const axisR = toScreen(2.8, 0);
        const lensTop = toScreen(0, 1.3);
        const lensBot = toScreen(0, -1.3);
        ctx.strokeStyle = '#94a3b8';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(axisL.sx, axisL.sy);
        ctx.lineTo(axisR.sx, axisR.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lensTop.sx, lensTop.sy);
        ctx.lineTo(lensBot.sx, lensBot.sy);
        ctx.stroke();
        const f = params.focalLengthM ?? 0.65;
        const u = params.objectDistanceM ?? 1.2;
        const fL = toScreen(-f, 0);
        const fR = toScreen(f, 0);
        ctx.fillStyle = '#38bdf8';
        for (const fp of [fL, fR]) {
          ctx.beginPath();
          ctx.arc(fp.sx, fp.sy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        const oB = toScreen(-u, 0);
        const oT = toScreen(-u, 0.55);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(oB.sx, oB.sy);
        ctx.lineTo(oT.sx, oT.sy);
        ctx.stroke();
        if (state.imageDistanceM !== undefined && state.magnification !== undefined) {
          const iB = toScreen(state.imageDistanceM, 0);
          const iT = toScreen(state.imageDistanceM, 0.55 * state.magnification);
          ctx.strokeStyle = state.imageDistanceM > 0 ? '#4ade80' : '#f472b6';
          ctx.setLineDash(state.imageDistanceM > 0 ? [] : [5, 4]);
          ctx.beginPath();
          ctx.moveTo(iB.sx, iB.sy);
          ctx.lineTo(iT.sx, iT.sy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }

    // 2. 法线
    if (activeLayers.has('normalLine') && params.sceneMode === 'tir-interface') {
      const top = toScreen(0, 1.8);
      const bot = toScreen(0, -1.8);
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.65)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(top.sx, top.sy);
      ctx.lineTo(bot.sx, bot.sy);
      ctx.stroke();
      ctx.restore();
    }

    // 3. 光路射线
    if (activeLayers.has('rays')) {
      for (const ray of state.rays) {
        const p1 = toScreen(ray.from.x, ray.from.y);
        const p2 = toScreen(ray.to.x, ray.to.y);
        ctx.save();
        ctx.strokeStyle = ray.color;
        ctx.globalAlpha = ray.intensity;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.stroke();

        // 线段中点箭头
        const mx = 0.5 * (p1.sx + p2.sx);
        const my = 0.5 * (p1.sy + p2.sy);
        const ang = Math.atan2(p2.sy - p1.sy, p2.sx - p1.sx);
        ctx.fillStyle = ray.color;
        ctx.beginPath();
        ctx.moveTo(mx + 6 * Math.cos(ang), my + 6 * Math.sin(ang));
        ctx.lineTo(mx - 6 * Math.cos(ang - 0.5), my - 6 * Math.sin(ang - 0.5));
        ctx.lineTo(mx - 6 * Math.cos(ang + 0.5), my - 6 * Math.sin(ang + 0.5));
        ctx.closePath();
        ctx.fill();

        if (ray.label) {
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.fillText(ray.label, p2.sx - 20, p2.sy - 10);
        }
        ctx.restore();
      }
    }

    // 角度信息 HUD
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 14px system-ui, sans-serif';
    const critInfo =
      state.criticalAngleDeg !== null ? `  |  临界角 C = ${state.criticalAngleDeg.toFixed(1)}°` : '';
    ctx.fillText(
      `θ₁ = ${radToDeg(degToRad(state.activeAngleDeg)).toFixed(1)}°${critInfo}`,
      20,
      30
    );
    ctx.restore();
  }
});

export default opticsRayStudioPlugin;
