import { defineSimulationPlugin, type ParamFieldSpec } from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeLarmorCircleForTrack,
  computeObservables,
  createInitialState,
  fieldSignedDistance,
  stepBoundedMagnetic,
  type BoundedMagneticParams,
  type BoundedMagneticState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<BoundedMagneticParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '场域几何类型',
    options: [
      { label: '直线半空间边界 (x≥0)', value: 'half-space' },
      { label: '圆形有界匀强磁场', value: 'circular' },
      { label: '矩形有界匀强磁场', value: 'rectangular' },
      { label: '正交电磁复合场 (E×B)', value: 'crossed-eb' }
    ],
    defaultValue: 'circular'
  },
  {
    key: 'family',
    kind: 'select',
    label: '动态圆族模式',
    options: [
      { label: '单粒子精细观测', value: 'single' },
      { label: '放缩圆（不同速率）', value: 'scaling' },
      { label: '旋转圆（不同入射角）', value: 'rotating' },
      { label: '平移圆（不同入射位置）', value: 'translating' },
      { label: '磁聚焦（圆形场平行汇聚）', value: 'focusing' }
    ],
    defaultValue: 'focusing'
  },
  {
    key: 'mass',
    kind: 'number',
    label: '粒子质量 m',
    unit: 'kg',
    min: 0.2,
    max: 5,
    step: 0.1,
    defaultValue: 1
  },
  {
    key: 'charge',
    kind: 'number',
    label: '粒子电荷量 q',
    unit: 'C',
    min: -3,
    max: 3,
    step: 0.5,
    defaultValue: 1
  },
  {
    key: 'magneticFieldZ',
    kind: 'number',
    label: '磁感应强度 Bz',
    unit: 'T',
    min: -4,
    max: 4,
    step: 0.2,
    defaultValue: 2
  },
  {
    key: 'electricFieldY',
    kind: 'number',
    label: '电场强度 Ey（复合场）',
    unit: 'V/m',
    min: -6,
    max: 6,
    step: 0.5,
    defaultValue: 3
  },
  {
    key: 'initialSpeed',
    kind: 'number',
    label: '入射初速率 v₀',
    unit: 'm/s',
    min: 0,
    max: 6,
    step: 0.2,
    defaultValue: 2.4
  },
  {
    key: 'launchAngleDeg',
    kind: 'number',
    label: '入射偏转角 θ',
    unit: '°',
    min: -60,
    max: 60,
    step: 5,
    defaultValue: 0
  },
  {
    key: 'fieldScale',
    kind: 'number',
    label: '磁场尺度 R / W',
    unit: 'm',
    min: 0.5,
    max: 2.5,
    step: 0.1,
    defaultValue: 1.2
  },
  {
    key: 'beamCount',
    kind: 'number',
    label: '粒子束数量',
    unit: '束',
    min: 1,
    max: 7,
    step: 1,
    defaultValue: 5
  }
];

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  label?: string
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.min(11, len * 0.35);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(label, x2 + 6, y2 - 6);
  }
  ctx.restore();
}

export const emBoundedMagneticFieldPlugin = defineSimulationPlugin<
  BoundedMagneticParams,
  BoundedMagneticState
>({
  meta: {
    id: 'em-bounded-magnetic-field',
    title: '有界磁场与动态圆 · 复合场配速法',
    textbookRef: '人教版 选择性必修二 第一章 第2–3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '1.0.0'
  },
  paramSchema,
  presets: [
    {
      id: 'circle-magnetic-focusing',
      name: '1. 圆形磁场磁聚焦 (R_c = R_field)',
      description: '五束平行同种电荷射入满足回旋半径等于磁场半径的圆形磁场，精确汇聚于同一边界点。',
      params: {
        mode: 'circular',
        family: 'focusing',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.4,
        fieldScale: 1.2,
        launchAngleDeg: 0,
        beamCount: 5
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'larmorCircle', 'velocityVector', 'eventPins']
    },
    {
      id: 'halfspace-rotating-circles',
      name: '2. 直线边界旋转圆与临界相切',
      description: '同速率粒子从同一点按不同入射角进入半空间磁场，动态观察旋转圆弦长与运动时间规律。',
      params: {
        mode: 'half-space',
        family: 'rotating',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.2,
        fieldScale: 1.2,
        launchAngleDeg: 0,
        beamCount: 5
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'larmorCircle', 'eventPins']
    },
    {
      id: 'circle-scaling-circles',
      name: '3. 圆形磁场放缩圆包络',
      description: '同方向不同速率粒子射入圆形有界磁场，动态呈现圆心共线且半径放缩的轨道族。',
      params: {
        mode: 'circular',
        family: 'scaling',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.0,
        fieldScale: 1.2,
        launchAngleDeg: 0,
        beamCount: 5
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'larmorCircle', 'eventPins']
    },
    {
      id: 'crossed-eb-cycloid',
      name: '4. 正交电磁复合场配速法摆线',
      description: '初速度为零的粒子在正交 E×B 复合场中做摆线运动，实时分解为匀速漂移 v_d 与圆周分速度 v_rot。',
      params: {
        mode: 'crossed-eb',
        family: 'single',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        electricFieldY: 3,
        initialSpeed: 0,
        launchAngleDeg: 0,
        fieldScale: 1.2,
        beamCount: 1
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'velocityVector', 'speedDecomposition']
    },
    {
      id: 'misconception-lorentz-work',
      name: '5. 易错反例：洛伦兹力永不做功',
      description: '纯磁场中速度方向剧烈偏转，对比观测底部示波器动能曲线始终为水平直线。',
      params: {
        mode: 'rectangular',
        family: 'single',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2.4,
        initialSpeed: 2.0,
        launchAngleDeg: 15,
        fieldScale: 1.5,
        beamCount: 1
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'velocityVector', 'eventPins']
    }
  ],
  engine: {
    createInitialState,
    step: stepBoundedMagnetic,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'fieldRegion', label: '磁场边界与磁感线符号', defaultVisible: true },
    { id: 'trajectory', label: '粒子连续轨迹', defaultVisible: true },
    { id: 'larmorCircle', label: '动态圆心与完整辅助圆', defaultVisible: true },
    { id: 'velocityVector', label: '速度与洛伦兹力矢量', defaultVisible: true },
    { id: 'speedDecomposition', label: '复合场配速法分解', defaultVisible: true },
    { id: 'eventPins', label: '出入界精确事件钉点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'speed', label: '速率 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'kineticEnergy', label: '动能 Ek', unit: 'J', color: '#4ade80' },
    { key: 'x', label: '横坐标 x', unit: 'm', color: '#fbbf24' },
    { key: 'y', label: '纵坐标 y', unit: 'm', color: '#f472b6' },
    { key: 'larmorRadius', label: '瞬时回旋半径 R', unit: 'm', color: '#a78bfa' }
  ],
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    const qB = Math.abs(params.charge * params.magneticFieldZ);
    const radiusStr = qB > 0 ? (obs.larmorRadius ?? 0).toFixed(3) : '\\infty';
    const items = [
      {
        id: 'larmor-r',
        label: '洛伦兹力回旋半径公式',
        latex: 'R = \\frac{mv}{|qB|}',
        substitutedLatex: `R = \\frac{${params.mass.toFixed(1)} \\times ${(obs.speed ?? 0).toFixed(2)}}{|${params.charge.toFixed(1)} \\times ${params.magneticFieldZ.toFixed(1)}|} = ${radiusStr}\\text{ m}`
      }
    ];
    if (params.mode === 'crossed-eb' && Math.abs(params.magneticFieldZ) > 0) {
      items.push({
        id: 'drift-v',
        label: '正交复合场配速漂移速度',
        latex: 'v_d = \\frac{E_y}{B_z}',
        substitutedLatex: `v_d = \\frac{${params.electricFieldY.toFixed(1)}}{${params.magneticFieldZ.toFixed(1)}} = ${(obs.vDriftX ?? 0).toFixed(2)}\\text{ m/s}`
      });
    }
    return items;
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const pxPerMeter = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
    const originX = viewport.width * 0.45 + viewport.offsetX;
    const originY = viewport.height * 0.5 + viewport.offsetY;
    const toScreen = (wx: number, wy: number) => ({
      sx: originX + wx * pxPerMeter,
      sy: originY - wy * pxPerMeter
    });

    // 坐标系微弱网格
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    const gridMeters = 0.5;
    const maxM = 6;
    for (let m = -maxM; m <= maxM; m += gridMeters) {
      const p = toScreen(m, m);
      ctx.beginPath();
      ctx.moveTo(p.sx, 0);
      ctx.lineTo(p.sx, viewport.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p.sy);
      ctx.lineTo(viewport.width, p.sy);
      ctx.stroke();
    }
    ctx.restore();

    // 1. 磁场区域与 ⊗ / ⊙ 符号
    if (activeLayers.has('fieldRegion')) {
      const R = Math.max(params.fieldScale, 0.1);
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;

      if (params.mode === 'half-space') {
        const p0 = toScreen(0, 0);
        ctx.fillRect(p0.sx, 0, viewport.width - p0.sx, viewport.height);
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(p0.sx, 0);
        ctx.lineTo(p0.sx, viewport.height);
        ctx.stroke();
      } else if (params.mode === 'circular') {
        const c = toScreen(0, 0);
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, R * pxPerMeter, 0, Math.PI * 2);
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.stroke();
      } else if (params.mode === 'rectangular') {
        const h = R * 1.6;
        const tl = toScreen(0, 0.5 * h);
        ctx.fillRect(tl.sx, tl.sy, R * pxPerMeter, h * pxPerMeter);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(tl.sx, tl.sy, R * pxPerMeter, h * pxPerMeter);
      } else {
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      }

      // 绘制 B 方向标志（B_z > 0 向外 ⊙；B_z < 0 向里 ⊗）
      if (Math.abs(params.magneticFieldZ) > 1e-6) {
        const outOfPage = params.magneticFieldZ > 0;
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
        ctx.fillStyle = 'rgba(125, 211, 252, 0.65)';
        ctx.lineWidth = 1.4;
        for (let wx = -2.5; wx <= 3.0; wx += 0.55) {
          for (let wy = -2.0; wy <= 2.0; wy += 0.55) {
            if (fieldSignedDistance({ x: wx, y: wy, z: 0 }, params.mode, params.fieldScale) <= -0.05) {
              const p = toScreen(wx, wy);
              ctx.beginPath();
              ctx.arc(p.sx, p.sy, 6, 0, Math.PI * 2);
              ctx.stroke();
              if (outOfPage) {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, 2, 0, Math.PI * 2);
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.moveTo(p.sx - 4, p.sy - 4);
                ctx.lineTo(p.sx + 4, p.sy + 4);
                ctx.moveTo(p.sx + 4, p.sy - 4);
                ctx.lineTo(p.sx - 4, p.sy + 4);
                ctx.stroke();
              }
            }
          }
        }
      }

      // 复合场绘制向上的电场线箭头
      if (params.mode === 'crossed-eb' && Math.abs(params.electricFieldY) > 1e-6) {
        const sgn = params.electricFieldY > 0 ? 1 : -1;
        for (let wx = -1.6; wx <= 2.4; wx += 1.0) {
          const base = toScreen(wx, -1.2 * sgn);
          const tip = toScreen(wx, -0.5 * sgn);
          drawArrow(ctx, base.sx, base.sy, tip.sx, tip.sy, 'rgba(251, 191, 36, 0.55)', 'E');
        }
      }
      ctx.restore();
    }

    // 2. 动态圆辅助圆与圆心
    if (activeLayers.has('larmorCircle')) {
      for (const track of state.particles) {
        if (!track.inField && params.mode !== 'crossed-eb') continue;
        const circle = computeLarmorCircleForTrack(track, params);
        if (!circle) continue;
        const centerScreen = toScreen(circle.center.x, circle.center.y);
        const posScreen = toScreen(track.state.position.x, track.state.position.y);

        ctx.save();
        ctx.strokeStyle = track.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(centerScreen.sx, centerScreen.sy, circle.radius * pxPerMeter, 0, Math.PI * 2);
        ctx.stroke();

        // 半径连线
        ctx.beginPath();
        ctx.moveTo(centerScreen.sx, centerScreen.sy);
        ctx.lineTo(posScreen.sx, posScreen.sy);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = track.color;
        ctx.beginPath();
        ctx.arc(centerScreen.sx, centerScreen.sy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 3. 粒子轨迹
    if (activeLayers.has('trajectory')) {
      for (const track of state.particles) {
        if (track.trail.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = track.color;
        ctx.lineWidth = track.id === 0 ? 3 : 2;
        ctx.beginPath();
        track.trail.forEach((pt, idx) => {
          const s = toScreen(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(s.sx, s.sy);
          else ctx.lineTo(s.sx, s.sy);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // 4. 粒子主体、速度矢量与配速法分解
    for (const track of state.particles) {
      const p = toScreen(track.state.position.x, track.state.position.y);
      ctx.save();
      ctx.fillStyle = track.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, track.id === 0 ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      if (activeLayers.has('velocityVector') && (track.id === 0 || state.particles.length <= 3)) {
        const vScale = 22;
        drawArrow(
          ctx,
          p.sx,
          p.sy,
          p.sx + track.state.velocity.x * vScale,
          p.sy - track.state.velocity.y * vScale,
          '#4ade80',
          track.id === 0 ? 'v' : undefined
        );
      }

      if (
        activeLayers.has('speedDecomposition') &&
        track.id === 0 &&
        params.mode === 'crossed-eb' &&
        Math.abs(params.magneticFieldZ) > 1e-6
      ) {
        const vScale = 22;
        const vd = params.electricFieldY / params.magneticFieldZ;
        const vxRot = track.state.velocity.x - vd;
        const vyRot = track.state.velocity.y;
        drawArrow(ctx, p.sx, p.sy, p.sx + vd * vScale, p.sy, '#fbbf24', 'v_d');
        drawArrow(
          ctx,
          p.sx,
          p.sy,
          p.sx + vxRot * vScale,
          p.sy - vyRot * vScale,
          '#f472b6',
          'v_rot'
        );
      }
    }

    // 5. 临界出入界钉点
    if (activeLayers.has('eventPins')) {
      for (const ev of state.events) {
        if (!ev.position) continue;
        const s = toScreen(ev.position.x, ev.position.y);
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText(ev.label, s.sx + 9, s.sy - 8);
        ctx.restore();
      }
    }
  }
});

export default emBoundedMagneticFieldPlugin;
