import { defineSimulationPlugin, type ParamFieldSpec } from '@physforge/sim-sdk';
import { ensureRapierLoaded } from './rapierLoader.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepSandbox,
  type SandboxParams,
  type SandboxState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<SandboxParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '沙箱力学积木场景',
    options: [
      { label: '一维刚体弹性/非弹性碰撞', value: 'elastic-collision' },
      { label: '斜面滑块下滑碰撞', value: 'incline-slide' },
      { label: '气垫导轨轻弹簧振子', value: 'spring-oscillator' },
      { label: '牛顿摆多球动量传递', value: 'newtons-cradle' }
    ],
    defaultValue: 'elastic-collision'
  },
  {
    key: 'restitution',
    kind: 'number',
    label: '恢复系数 e',
    unit: '',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 1.0
  },
  {
    key: 'massRatio',
    kind: 'number',
    label: '靶球/靶块质量 m₂',
    unit: 'kg',
    min: 0.5,
    max: 5.0,
    step: 0.5,
    defaultValue: 1.0
  },
  {
    key: 'gravity',
    kind: 'number',
    label: '重力加速度 g',
    unit: 'm/s²',
    min: 0,
    max: 15,
    step: 0.2,
    defaultValue: 9.8
  },
  {
    key: 'friction',
    kind: 'number',
    label: '接触摩擦因数 μ',
    unit: '',
    min: 0,
    max: 0.6,
    step: 0.05,
    defaultValue: 0
  },
  {
    key: 'inclineDeg',
    kind: 'number',
    label: '斜面倾角 θ',
    unit: '°',
    min: 15,
    max: 45,
    step: 5,
    defaultValue: 30
  },
  {
    key: 'springK',
    kind: 'number',
    label: '弹簧劲度系数 k',
    unit: 'N/m',
    min: 5,
    max: 50,
    step: 5,
    defaultValue: 20
  }
];

export const mechFreeSandboxPlugin = defineSimulationPlugin<SandboxParams, SandboxState>({
  meta: {
    id: 'mech-free-sandbox',
    title: '自由力学刚体与碰撞探究沙箱（Rapier2D）',
    textbookRef: '人教版 必修第二册 & 选择性必修一 第一章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '基础新授',
    version: '1.0.0'
  },
  paramSchema,
  presets: [
    {
      id: 'elastic-equal-mass',
      name: '1. 等质量完全弹性碰撞（速度交换）',
      description: '利用 Rapier2D WASM 刚体物理引擎模拟 e=1 等质量小球正碰，碰撞后动量守恒且速度完美交换。',
      params: {
        scenario: 'elastic-collision',
        restitution: 1.0,
        massRatio: 1.0,
        friction: 0
      }
    },
    {
      id: 'inelastic-collision',
      name: '2. 完全非弹性碰撞（动能损失最大）',
      description: '恢复系数 e=0，两球碰撞后粘合共速运动，观察总动量守恒而总动能显著衰减。',
      params: {
        scenario: 'elastic-collision',
        restitution: 0,
        massRatio: 2.0,
        friction: 0
      }
    },
    {
      id: 'incline-slide-impact',
      name: '3. 斜面滑块加速下滑撞击',
      description: '滑块从 30° 斜面释放加速冲下水平桌面与静止靶块发生刚体碰撞。',
      params: {
        scenario: 'incline-slide',
        inclineDeg: 30,
        restitution: 0.9,
        friction: 0.05,
        massRatio: 1.5
      }
    },
    {
      id: 'newtons-cradle-chain',
      name: '4. 多球连锁动量传递（牛顿摆原型）',
      description: '四球弹性链式正碰，清晰演示动量与能量如何依次跨过中间静止球直达末球。',
      params: {
        scenario: 'newtons-cradle',
        restitution: 1.0,
        friction: 0
      }
    }
  ],
  engine: {
    createInitialState: (params) => {
      // 仅在真正创建/运行本沙箱模型时异步按需触发 WASM 加载
      void ensureRapierLoaded();
      return createInitialState(params);
    },
    step: stepSandbox,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'bodies', label: '刚体与约束边界', defaultVisible: true },
    { id: 'velocityLabels', label: '瞬时速度读数标签', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'totalMomentumX', label: '系统水平总动量 Px', unit: 'kg·m/s', color: '#38bdf8' },
    { key: 'kineticEnergy', label: '系统总动能 Ek', unit: 'J', color: '#4ade80' },
    { key: 'primaryVx', label: '主刚体速度 vx', unit: 'm/s', color: '#fbbf24' }
  ],
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    return [
      {
        id: 'sandbox-momentum',
        label: `碰撞动量与能量监测（${state.rapierActive ? 'Rapier2D WASM 已接管' : '正在按需加载 WASM'}）`,
        latex: 'p_x = \\sum m_i v_{ix}, \\quad E_k = \\sum \\frac{1}{2}m_i v_i^2',
        substitutedLatex: `p_x = ${(obs.totalMomentumX ?? 0).toFixed(2)}\\text{ kg}\\cdot\\text{m/s},\\; E_k = ${(obs.kineticEnergy ?? 0).toFixed(2)}\\text{ J}`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const pxPerM = Math.min(viewport.width, viewport.height) * 0.14 * viewport.scale;
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const toScreen = (wx: number, wy: number) => ({
      sx: cx + wx * pxPerM,
      sy: cy - wy * pxPerM
    });

    if (activeLayers.has('bodies')) {
      // 若为弹簧振子先绘制弹簧锯齿线
      if (params.scenario === 'spring-oscillator') {
        const anchor = state.bodies.find((b) => b.id === 'anchor');
        const block = state.bodies.find((b) => b.id === 'mass-block');
        if (anchor && block) {
          const pA = toScreen(anchor.x + anchor.halfW, anchor.y);
          const pB = toScreen(block.x - block.halfW, block.y);
          ctx.save();
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          const coils = 12;
          ctx.moveTo(pA.sx, pA.sy);
          for (let i = 1; i < coils; i++) {
            const frac = i / coils;
            const sx = pA.sx + (pB.sx - pA.sx) * frac;
            const sy = pA.sy + (i % 2 === 0 ? -10 : 10);
            ctx.lineTo(sx, sy);
          }
          ctx.lineTo(pB.sx, pB.sy);
          ctx.stroke();
          ctx.restore();
        }
      }

      for (const b of state.bodies) {
        const p = toScreen(b.x, b.y);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(-b.angle);
        ctx.fillStyle = b.color;
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;

        if (b.shape === 'ball') {
          ctx.beginPath();
          ctx.arc(0, 0, b.halfW * pxPerM, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const w = b.halfW * 2 * pxPerM;
          const h = b.halfH * 2 * pxPerM;
          ctx.fillRect(-0.5 * w, -0.5 * h, w, h);
          if (b.dynamic) ctx.strokeRect(-0.5 * w, -0.5 * h, w, h);
        }
        ctx.restore();

        if (activeLayers.has('velocityLabels') && b.dynamic) {
          ctx.save();
          ctx.fillStyle = b.color;
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.fillText(`${b.label} v=${b.vx.toFixed(2)}`, p.sx - 35, p.sy - b.halfH * pxPerM - 10);
          ctx.restore();
        }
      }
    }

    ctx.save();
    ctx.fillStyle = state.rapierActive ? '#4ade80' : '#fbbf24';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(
      `引擎状态：${state.rapierActive ? 'Rapier2D WASM 刚体内核运行中' : '按需加载 Rapier2D WASM...'}`,
      18,
      26
    );
    ctx.restore();
  }
});

export default mechFreeSandboxPlugin;
