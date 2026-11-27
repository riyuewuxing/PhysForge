import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { ensureRapierLoaded } from './rapierLoader.js';
import { layoutCradleLabels, type CradleLabel } from './cradleLabelLayout.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  disposeSandbox,
  stepSandbox,
  usesAnalyticSolver,
  SPRING_EQUILIBRIUM_X,
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
      { label: '牛顿摆多球动量传递', value: 'newtons-cradle' },
      { label: '阿特伍德机解析约束 (Udwadia-Kalaba)', value: 'atwood-constrained' }
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
    id: 'builder-mechanics-lab',
    title: '自由力学约束与多刚体建模器 (B4)',
    textbookRef: '人教版 必修第二册 & 选择性必修一 第一章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '基础新授',
    version: '2.0.0'
  },
  defaultView: {
    scale:(params,{width,height})=>params.scenario==='atwood-constrained'?Math.max(.1,Math.min(1.1,(width-(width>=900?300:0)-40)/(3.6*Math.min(width,height)*.24),(height-180)/(3.5*Math.min(width,height)*.24))):.58,
    offsetRatioX:(params,{width})=>params.scenario==='atwood-constrained'?(width-(width>=900?280:0))/(2*width)-.45:.05,
    offsetRatioY:params=>params.scenario==='atwood-constrained'?-.06:0
  },
  getControlHandles: (state, params) => {
    const id=params.scenario==='elastic-collision'?'b2':params.scenario==='incline-slide'?'target':params.scenario==='atwood-constrained'?'atwood-right':undefined;
    const dyn=state.bodies.find(b=>b.id===id);
    if (!dyn) return [];
    const position={x:dyn.x,y:dyn.y+dyn.halfH+.5};
    return [
      {
        id: 'mass-ratio',
        label: `m₂=${params.massRatio.toFixed(1)}kg`,
        position,
        handleKind: 'point',
        color: '#f472b6',
        onDrag: (wp) => ({
          massRatio: Math.max(.5,Math.min(5,Math.round((params.massRatio+2*(wp.y-position.y))*2)/2))
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    const vectors = [];
    for (const b of state.bodies) {
      if (!b.dynamic) continue;
      vectors.push({
        id: `weight-${b.id}`,
        label: `${b.label}g`,
        origin: { x: b.x, y: b.y },
        force: { x: 0, y: -b.mass * params.gravity },
        color: '#fbbf24',
        category: 'gravity' as const,
        unit: 'N'
      });
      if (params.scenario === 'atwood-constrained' && state.constraintTensionN !== undefined) {
        vectors.push({
          id: `tension-${b.id}`,
          label: 'T',
          origin: { x: b.x, y: b.y },
          force: { x: 0, y: state.constraintTensionN },
          color: '#38bdf8',
          category: 'tension' as const,
          unit: 'N'
        });
      }
      if (params.scenario === 'spring-oscillator' && b.id === 'mass-block') {
        vectors.push({
          id:'normal-mass-block',label:'N',origin:{x:b.x,y:b.y},
          force:{x:0,y:b.mass*params.gravity},color:'#38bdf8',category:'normal' as const,unit:'N'
        });
        vectors.push({
          id: 'spring-force',
          label: 'F_k',
          origin: { x: b.x, y: b.y },
          force: { x: -params.springK * (b.x - SPRING_EQUILIBRIUM_X), y: 0 },
          color: '#4ade80',
          category: 'tension' as const,
          unit: 'N'
        });
      }
    }
    return vectors;
  },
  referenceFrames: [
    {
      id: 'center-of-mass',
      label: '系统质心参考系',
      getOrigin: (state) => {
        let totalM = 0;
        let mx = 0;
        let my = 0;
        for (const b of state.bodies) {
          if (!b.dynamic) continue;
          totalM += b.mass;
          mx += b.mass * b.x;
          my += b.mass * b.y;
        }
        return totalM > 0 ? { x: mx / totalM, y: my / totalM } : { x: 0, y: 0 };
      }
    }
  ],
  sceneSerializer: {
    exportScene: (_state, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-mechanics-lab',
      title: '自由力学约束实验场景',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<SandboxParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [];
    for (const b of state.bodies) {
      if(b.id==='floor'){
        primitives.push({kind:'hatchedGround',x1:b.x-b.halfW,y1:b.y+b.halfH,x2:b.x+b.halfW,y2:b.y+b.halfH});
        continue;
      }
      if(b.id==='pulley')continue;
      if (b.shape === 'ball') {
        primitives.push({ kind: 'circle', cx: b.x, cy: b.y, r: b.halfW });
      } else {
        primitives.push({
          kind: 'block',
          cx: b.x,
          cy: b.y,
          width: b.halfW * 2,
          height: b.halfH * 2,
          angleDeg:b.angle*180/Math.PI,
          label: b.label
        });
      }
    }
    if (params.scenario === 'spring-oscillator') {
      const anchor = state.bodies.find((b) => b.id === 'anchor');
      const block = state.bodies.find((b) => b.id === 'mass-block');
      if (anchor && block) {
        primitives.push({ kind: 'spring', x1: anchor.x + anchor.halfW, y1: anchor.y, x2: block.x - block.halfW, y2: block.y, coils: 8 });
      }
    } else if (params.scenario === 'atwood-constrained') {
      const left = state.bodies.find((b) => b.id === 'atwood-left');
      const right = state.bodies.find((b) => b.id === 'atwood-right');
      primitives.push({ kind: 'circle', cx: 0, cy: 1.4, r: 0.28 });
      primitives.push({kind:'arc',cx:0,cy:1.4,r:.28,startAngle:0,endAngle:Math.PI});
      if (left && right) {
        primitives.push({ kind: 'line', x1: -0.28, y1: 1.4, x2: left.x, y2: left.y + left.halfH });
        primitives.push({ kind: 'line', x1: 0.28, y1: 1.4, x2: right.x, y2: right.y + right.halfH });
      }
    }
    return {
      width: 720,
      height: 440,
      viewBox: { minX: params.scenario==='atwood-constrained'?-1.6:-5.2, minY: -1.8, maxX: params.scenario==='atwood-constrained'?1.6:5.2, maxY: 2.2 },
      title: '自由力学刚体与解析约束试卷配图',
      primitives
    };
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
      description: '恢复系数 e=0，理想正碰瞬间两球法向速度相同；未添加永久粘接约束。观察碰撞动量及动能变化。',
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
    },
    {
      id: 'atwood-udwadia-analytical',
      name: '5. 阿特伍德机精确约束与张力求解 (Udwadia-Kalaba)',
      description: '采用 Gauss 最小拘束原理直接输出轻绳张力 T = 2m₁m₂g/(m₁+m₂) 与恒加速度轨迹，适用于重物碰到滑轮前。',
      params: {
        scenario: 'atwood-constrained',
        massRatio: 2.0,
        gravity: 9.8
      }
    },
    {
      id:'ideal-spring-oscillator',
      name:'6. 理想气垫导轨弹簧振子',
      description:'无摩擦水平约束，精确简谐运动；调节劲度系数，检验动能和弹性势能转换。',
      params:{scenario:'spring-oscillator',springK:20,gravity:9.8,friction:0}
    }
  ],
  engine: {
    createInitialState: (params) => {
      // 仅在真正创建/运行本沙箱模型时异步按需触发 WASM 加载
      if(!usesAnalyticSolver(params.scenario))void ensureRapierLoaded().catch(()=>{/* surfaced as a terminal engine event on step */});
      return createInitialState(params);
    },
    step: stepSandbox,
    disposeState:disposeSandbox,
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
    { key: 'primaryVx', label: '主刚体速度 vx', unit: 'm/s', color: '#fbbf24' },
    { key: 'springPotentialEnergy', label: '弹性势能', unit: 'J', color: '#fbbf24' },
    { key: 'primaryVy', label: '左重物速度', unit: 'm/s', color: '#38bdf8' },
    { key: 'secondaryVy', label: '右重物速度', unit: 'm/s', color: '#f472b6' },
    { key: 'constraintTensionN', label: '轻绳张力', unit: 'N', color: '#4ade80' }
  ],
  formatFormulas: (state, params) => {
    if(params.scenario==='spring-oscillator'){
      const b=state.bodies.find(b=>b.id==='mass-block')!;
      const omega=Math.sqrt(params.springK/b.mass),q=b.x-SPRING_EQUILIBRIUM_X;
      return [
        {id:'spring-omega',label:'理想简谐振子（无摩擦）',latex:'\\omega=\\sqrt{k/m}',substitutedLatex:'\\omega='+omega.toFixed(3)+'\\ \\mathrm{rad/s}'},
        {id:'spring-energy',label:'动能与弹性势能',latex:'E=\\frac12mv_x^2+\\frac12k(x-x_0)^2',substitutedLatex:'E='+(.5*b.mass*b.vx*b.vx+.5*params.springK*q*q).toFixed(3)+'\\ \\mathrm J'}
      ];
    }
    if(params.scenario==='atwood-constrained'){
      const l=state.bodies.find(b=>b.id==='atwood-left')!,r=state.bodies.find(b=>b.id==='atwood-right')!;
      const a=(r.mass-l.mass)*params.gravity/(l.mass+r.mass);
      return [
        {id:'atwood-a',label:state.terminal==='pulley-contact'?'首次接触滑轮（碰撞前一瞬）':'理想轻绳约束（上为正）',latex:'a_1=-a_2=\\frac{(m_2-m_1)g}{m_1+m_2}',substitutedLatex:'a_1='+a.toFixed(3)+'\\ \\mathrm{m/s^2}'},
        {id:'atwood-tension',label:state.terminal==='pulley-contact'?'碰撞前张力':'轻绳张力',latex:'T=\\frac{2m_1m_2g}{m_1+m_2}',substitutedLatex:'T='+(state.constraintTensionN??0).toFixed(3)+'\\ \\mathrm N'}
      ];
    }
    const obs = computeObservables(state, params);
    return [
      {
        id: 'sandbox-momentum',
        label: `碰撞动量与能量监测（${state.terminal==='engine-unavailable'?'加载失败，请复位重试':state.rapierActive ? 'Rapier2D WASM 已接管' : '正在按需加载 WASM，物理时间暂停'}）`,
        latex: 'p_x = \\sum m_i v_{ix}, \\quad E_k = \\sum (\\frac{1}{2}m_i v_i^2+\\frac{1}{2}I_i\\omega_i^2)',
        substitutedLatex: `p_x = ${(obs.totalMomentumX ?? 0).toFixed(2)}\\text{ kg}\\cdot\\text{m/s},\\; E_k = ${(obs.kineticEnergy ?? 0).toFixed(2)}\\text{ J}`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const pxPerM = m.ppm;
    const paper=viewport.theme==='projector';
    const toScreen = (wx: number, wy: number) => {
      const point = m.toScreen(wx, wy);
      return { sx: point.x, sy: point.y };
    };

    const cradleLabels:CradleLabel[]=[];
    if (activeLayers.has('bodies')) {
      if (params.scenario === 'atwood-constrained') {
        const pulley = state.bodies.find((b) => b.id === 'pulley');
        const left = state.bodies.find((b) => b.id === 'atwood-left');
        const right = state.bodies.find((b) => b.id === 'atwood-right');
        if (pulley && left && right) {
          const pP = toScreen(pulley.x, pulley.y);
          const pL = toScreen(left.x, left.y + left.halfH);
          const pR = toScreen(right.x, right.y + right.halfH);
          const rPx = pulley.halfW * pxPerM;
          ctx.save();
          ctx.strokeStyle = paper?'#475569':'#cbd5e1';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(pL.sx, pL.sy);
          ctx.lineTo(pP.sx - rPx, pP.sy);
          ctx.moveTo(pR.sx, pR.sy);
          ctx.lineTo(pP.sx + rPx, pP.sy);
          ctx.moveTo(pP.sx-rPx,pP.sy);
          ctx.arc(pP.sx,pP.sy,rPx,Math.PI,2*Math.PI);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 若为弹簧振子先绘制弹簧锯齿线
      if (params.scenario === 'spring-oscillator') {
        const anchor = state.bodies.find((b) => b.id === 'anchor');
        const block = state.bodies.find((b) => b.id === 'mass-block');
        if (anchor && block) {
          const pA = toScreen(anchor.x + anchor.halfW, anchor.y);
          const pB = toScreen(block.x - block.halfW, block.y);
          ctx.save();
          ctx.strokeStyle = paper?'#92400e':'#fbbf24';
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
        const paperColors:Record<string,string>={'#38bdf8':'#bae6fd','#f472b6':'#fbcfe8','#fbbf24':'#fde68a','#4ade80':'#bbf7d0','#475569':'#cbd5e1','#64748b':'#94a3b8','#94a3b8':'#cbd5e1'};
        ctx.fillStyle = paper?paperColors[b.color]??b.color:b.color;
        ctx.strokeStyle = paper?'#334155':'#e2e8f0';
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
          const paper=viewport.theme==='projector',atwood=params.scenario==='atwood-constrained';
          ctx.fillStyle = paper?'#334155':b.color;
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.textAlign=atwood?(b.x<0?'right':'left'):'center';
          const x=atwood?p.sx+Math.sign(b.x)*(b.halfW*pxPerM+9):p.sx;
          const y=atwood?p.sy+5:p.sy-b.halfH*pxPerM-10;
          const text=b.label+(atwood?' vᵧ='+b.vy.toFixed(2):' vₓ='+b.vx.toFixed(2))+' m/s';
          if(params.scenario==='newtons-cradle'){
            const top=p.sy-b.halfH*pxPerM,bottom=p.sy+b.halfH*pxPerM;
            if(p.sx>=0&&p.sx<=viewport.width&&bottom>=0&&top<=viewport.height){
              cradleLabels.push({id:b.id,text,color:paper?'#334155':b.color,x:p.sx,top,bottom,width:ctx.measureText(text).width});
            }
          }else ctx.fillText(text,x,y);
          ctx.restore();
        }
      }
    }

    if(cradleLabels.length){
      ctx.save();
      ctx.font='bold 13px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      for(const label of layoutCradleLabels(cradleLabels,viewport.width,viewport.height)){
        ctx.fillStyle=label.color;ctx.fillText(label.text,label.x,label.y);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = paper?(usesAnalyticSolver(params.scenario)||state.rapierActive?'#166534':'#92400e'):(usesAnalyticSolver(params.scenario)||state.rapierActive ? '#4ade80' : '#fbbf24');
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(
      `引擎状态：${params.scenario==='spring-oscillator'?'理想简谐运动解析流':params.scenario==='atwood-constrained'?(state.terminal==='pulley-contact'?'首次接触滑轮 · 碰撞前一瞬':'Udwadia-Kalaba 轻绳约束'):state.terminal==='engine-unavailable'?'刚体引擎加载失败 · 请复位重试':state.rapierActive?'Rapier2D WASM 刚体内核运行中':'等待 Rapier2D WASM · 物理时间暂停'}`,
      18,
      26
    );
    ctx.restore();
  }
});

export default mechFreeSandboxPlugin;
