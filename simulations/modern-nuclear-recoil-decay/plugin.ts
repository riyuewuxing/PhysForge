import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { nuclearRecoilPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepNuclearRecoilDecay,
  type NuclearRecoilDecayParams,
  type NuclearRecoilDecayState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<NuclearRecoilDecayParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验场景',
    defaultValue: 'cloud-chamber-recoil',
    options: [
      { label: '磁云室反冲径迹与质能亏损', value: 'cloud-chamber-recoil' },
      { label: '半衰期蒙特卡洛统计演化', value: 'half-life-mc' },
      { label: '代际倍增期望（抽象示意）', value: 'chain-fission' }
    ]
  },
  {
    key: 'decayKind',
    kind: 'select',
    label: '衰变类型',
    defaultValue: 'alpha',
    options: [
      { label: 'α 衰变 (外切双圆)', value: 'alpha' },
      { label: 'β⁻ 端点理想化 (内切双圆)', value: 'beta-minus' }
    ]
  },
  { key: 'parentZ', kind: 'number', label: '母核电荷数 Z', defaultValue: 88, min: 6, max: 98, step: 1 },
  { key: 'parentMassU', kind: 'number', label: '母核静质量 M', unit: 'u', defaultValue: 226.0254, min: 10, max: 250, step: 1 },
  { key: 'massDefectU', kind: 'number', label: '质量亏损 Δm', unit: 'u', defaultValue: 0.00522, min: 0.0001, max: 0.02, step: 0.0002 },
  { key: 'magneticFieldT', kind: 'number', label: '磁感应强度 B_z', unit: 'T', defaultValue: 1.2, min: -3.0, max: 3.0, step: 0.1 },
  { key: 'nucleiCountN0', kind: 'number', label: '初始原子核数 N₀', defaultValue: 1600, min: 16, max: 4000, step: 100 },
  { key: 'halfLifeS', kind: 'number', label: '半衰期 T_{1/2}', unit: 's', defaultValue: 2.0, min: 0.5, max: 6.0, step: 0.5 },
  { key: 'seed', kind: 'number', label: 'PRNG 随机种子', defaultValue: 20261122, min: 1, max: 99999999, step: 1 },
  { key: 'kEffectiveRaw', kind: 'number', label: '单次裂变平均倍增系数', defaultValue: 2.2, min: 1.2, max: 2.8, step: 0.1 },
  { key: 'controlRodAbsorption', kind: 'number', label: '控制棒中子吸收比', defaultValue: 0.545, min: 0, max: 0.85, step: 0.02 }
];

function recoilScale(state: NuclearRecoilDecayState): number {
  return 1.2 / Math.max(1, ...state.recoil.emittedTrackCm.map(p => Math.hypot(p.x,p.y)),
    ...state.recoil.daughterTrackCm.map(p => Math.hypot(p.x,p.y)));
}

function halfLifePlot(state: NuclearRecoilDecayState) {
  const maxT = Math.max(4 * state.halfLifeS, state.t);
  const coord = (t: number, fraction: number) => ({x: 0.15 + t / maxT * 1.95, y: -0.9 + fraction * 1.8});
  const sample = state.decayCurve.flatMap((d,i) => i === 0 ? [coord(d.t,d.fraction)] :
    [coord(d.t,state.decayCurve[i-1]!.fraction),coord(d.t,d.fraction)]);
  const expected = Array.from({length: 121}, (_,i) => {
    const t = maxT * i / 120;
    return coord(t, 2 ** (-t / state.halfLifeS));
  });
  return {sample,expected,maxT};
}

export const modernNuclearRecoilDecayPlugin = defineSimulationPlugin<
  NuclearRecoilDecayParams,
  NuclearRecoilDecayState
>({
  meta: {
    id: 'modern-nuclear-recoil-decay',
    title: '核衰变反冲径迹与半衰期蒙特卡洛 (N03)',
    textbookRef: '人教版 选择性必修三 第五章第 2–4 节',
    curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: nuclearRecoilPresets,
  timeSemantics: p => p.mode === 'half-life-mc' ? 'evolving' : 'static-analytic',
  getParamFields: p => paramSchema.filter(f => (
    p.mode === 'cloud-chamber-recoil' ? ['mode','decayKind','parentZ','parentMassU','massDefectU','magneticFieldT'] :
    p.mode === 'half-life-mc' ? ['mode','nucleiCountN0','halfLifeS','seed'] :
    ['mode','kEffectiveRaw','controlRodAbsorption']
  ).includes(f.key)),
  getTelemetryChannels: p => p.mode === 'half-life-mc'
    ? [{ key: 'remainingCount', label: '样本未衰变核数', unit: '个', color: '#38bdf8' },
       { key: 'expectedRemainingCount', label: '理论期望核数', unit: '个', color: '#f59e0b' }]
    : p.mode === 'cloud-chamber-recoil'
    ? [{ key: 'qValueMev', label: '理想释能 Q', unit: 'MeV', color: '#f59e0b' },
       { key: 'emittedKineticMev', label: '出射动能', unit: 'MeV', color: '#38bdf8' },
       { key: 'daughterKineticMev', label: '反冲动能', unit: 'MeV', color: '#4ade80' },
       ...(p.magneticFieldT === 0 ? [] : [{ key: 'radiusRatio', label: '实测半径比', unit: '', color: '#a855f7' }])]
    : [{ key: 'kEff', label: '抽象代际期望系数', unit: '', color: '#a855f7' }],
  engine: {
    createInitialState,
    step: stepNuclearRecoilDecay,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '云室轨迹 / 半衰期网格 / 链式倍增', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'qValueMev', label: '核反应释能 Q', unit: 'MeV', color: '#f59e0b' },
    { key: 'radiusRatio', label: '半径比 R₁/R₂', unit: '', color: '#38bdf8' },
    { key: 'remainingCount', label: '未衰变核数 N(t)', unit: '个', color: '#4ade80' },
    { key: 'kEff', label: '倍增系数 k_eff', unit: '', color: '#a855f7' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'modern-nuclear-recoil-decay',
      title: '核衰变反冲径迹与半衰期',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<NuclearRecoilDecayParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [];
    if (params.mode === 'cloud-chamber-recoil') {
      const k = recoilScale(state);
      const points = (pts: readonly {x:number;y:number}[]) => pts.map(p=>({x:p.x*k,y:p.y*k}));
      primitives.push({kind:'polyline', points:points(state.recoil.emittedTrackCm)},
        {kind:'polyline',points:points(state.recoil.daughterTrackCm),dashed:true},
        {kind:'circle',cx:0,cy:0,r:0.025,fill:true},
        {kind:'text',x:0,y:1.45,text:params.decayKind==='alpha'?'α 二体理想化':'β⁻ 端点理想化（反中微子能量趋零）',align:'middle'},
        {kind:'text',x:0,y:-1.45,text:params.magneticFieldT===0?'B=0：无有限曲率半径':'同一比例的轨迹截段；非同时刻',align:'middle'});
    } else if (params.mode === 'half-life-mc') {
      const plot=halfLifePlot(state);
      primitives.push({kind:'line',x1:.15,y1:-.9,x2:2.1,y2:-.9},
        {kind:'line',x1:.15,y1:-.9,x2:.15,y2:.9},
        {kind:'polyline',points:plot.sample},
        {kind:'polyline',points:plot.expected,dashed:true},
        {kind:'text',x:.15,y:1.05,text:'样本阶梯 / 理论期望（虚线）'},
        {kind:'text',x:2.1,y:-1.15,text:plot.maxT.toFixed(1)+' s',align:'end'});
    } else {
      const maxN=Math.max(10,...state.chainGenerations.map(g=>g.neutrons));
      const barW=3.8/state.chainGenerations.length;
      for(const [i,g] of state.chainGenerations.entries()){
        primitives.push({kind:'rect',x:-1.8+i*barW+.05,y:-.9,width:barW-.1,height:g.neutrons/maxN*1.55});
        primitives.push({kind:'text',x:-1.8+i*barW+.05,y:-1.1,text:'G'+g.generation});
      }
      primitives.push({kind:'text',x:0,y:1.05,text:'抽象代际期望（非时间轨迹）',align:'middle'});
    }
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.4, minY: -1.6, maxX: 2.4, maxY: 1.6 },
      title: '云室衰变径迹与核反应配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    if (!activeLayers.has('main')) return;
    ctx.save();
    const labels: CanvasLabel[] = [];

    if (params.mode === 'cloud-chamber-recoil') {
      const worldScale = recoilScale(state);

      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const magneticTop = m.toScreen(1.65, 0.4);
      const magneticBottom = m.toScreen(1.65, -0.8);
      ctx.moveTo(magneticTop.x, magneticTop.y);
      ctx.lineTo(magneticBottom.x, magneticBottom.y);
      ctx.stroke();

      const drawTrack = (pts: readonly { x: number; y: number }[], color: string, lw: number) => {
        if (pts.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        pts.forEach((p, idx) => {
          const point = m.toScreen(p.x * worldScale, p.y * worldScale);
          const sx = point.x;
          const sy = point.y;
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      };

      drawTrack(state.recoil.emittedTrackCm, '#38bdf8', m.len(0.014));
      drawTrack(state.recoil.daughterTrackCm, '#f59e0b', m.len(0.02));

      const origin = m.toScreen(0, 0);
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, m.len(0.025), 0, 2 * Math.PI);
      ctx.fill();

      labels.push(
        { id: 'cloud-chamber-summary', ...m.toScreen(-0.1, 1.55), text: `${params.decayKind === 'alpha' ? 'α 二体理想化' : 'β⁻ 端点理想化'} | Q = ${state.recoil.qValueMev.toFixed(3)} MeV`, color: '#e2e8f0', font: 'bold 14px ui-sans-serif, system-ui' },
        { id: 'cloud-chamber-radius', ...m.toScreen(-0.1, 1.32), text: state.recoil.radiusRatioMeasured === undefined ? '无有限圆半径／无法拟合' : `实测半径比 R₁/R₂ = ${state.recoil.radiusRatioMeasured.toFixed(6)}（同一比例，轨迹截段）`, color: '#e2e8f0', font: '13px ui-sans-serif, system-ui' }
      );
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    if (params.mode === 'half-life-mc') {
      const n = state.decayedFlags.length;
      const cols = Math.ceil(Math.sqrt(n));
      const cell = 1.6 / cols;
      const gx0 = -1.8;
      const gy0 = 0.9;

      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        ctx.fillStyle = state.decayedFlags[i] ? '#334155' : '#4ade80';
        const point = m.toScreen(gx0 + c * cell, gy0 - r * cell);
        ctx.fillRect(point.x, point.y, m.len(cell * 0.78), m.len(cell * 0.78));
      }

      const graphTopLeft = m.toScreen(0.15, 0.9);
      const graphBottomRight = m.toScreen(2.1, -0.9);
      const px0 = graphTopLeft.x;
      const py0 = graphBottomRight.y;
      const pw = graphBottomRight.x - px0;
      const ph = py0 - graphTopLeft.y;
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px0, py0 - ph);
      ctx.lineTo(px0, py0);
      ctx.lineTo(px0 + pw, py0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const halfLifeRailA = m.toScreen(0.15, -1.02);
      const halfLifeRailB = m.toScreen(2.1, -1.02);
      ctx.moveTo(halfLifeRailA.x, halfLifeRailA.y);
      ctx.lineTo(halfLifeRailB.x, halfLifeRailB.y);
      ctx.stroke();

      const plot=halfLifePlot(state);
      const drawPoly = (points: readonly {x:number;y:number}[], col:string, dash:boolean) => {
        ctx.strokeStyle=col;ctx.lineWidth=2.5;ctx.setLineDash(dash?[5,4]:[]);
        ctx.beginPath();
        points.forEach((d,i)=>{const p=m.toScreen(d.x,d.y);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.stroke();ctx.setLineDash([]);
      };
      drawPoly(plot.expected,'#f59e0b',true);
      drawPoly(plot.sample,'#38bdf8',false);
      labels.push({id:'half-life-legend',...m.toScreen(1.05,-1.35),text:'样本阶梯 / 理论期望（虚线） | '+plot.maxT.toFixed(1)+' s',font:'12px ui-sans-serif, system-ui',color:'#94a3b8'});

      labels.push({ id: 'half-life-summary', ...m.toScreen(1.05, 1.05), text: `N(t) = ${state.remainingCount} / ${n} (${((100 * state.remainingCount) / n).toFixed(1)}%) | t / T₁/₂ = ${(state.t / state.halfLifeS).toFixed(2)}`, color: '#e2e8f0', font: 'bold 14px ui-sans-serif, system-ui' });
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    const bx0 = -1.8;
    const by0 = -0.9;
    const bw = 3.8;
    const bh = 1.55;
    const maxN = Math.max(10, ...state.chainGenerations.map((g) => g.neutrons));
    const barW = bw / state.chainGenerations.length;
    state.chainGenerations.forEach((g, idx) => {
      const h = (g.neutrons / maxN) * bh;
      const barTopLeft = m.toScreen(bx0 + idx * barW + 0.05, by0 + h);
      ctx.fillStyle = state.kEff > 1.02 ? '#ef4444' : state.kEff < 0.98 ? '#38bdf8' : '#4ade80';
      ctx.fillRect(barTopLeft.x, barTopLeft.y, m.len(Math.max(0.04, barW - 0.1)), m.len(h));
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px ui-sans-serif, system-ui';
      const label = m.toScreen(bx0 + idx * barW + 0.05, by0 - 0.04);
      ctx.fillText(`G${g.generation}`, label.x, label.y);
    });
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rodRailTop = m.toScreen(1.85, 0.65);
    const rodRailBottom = m.toScreen(1.85, -0.9);
    ctx.moveTo(rodRailTop.x, rodRailTop.y);
    ctx.lineTo(rodRailBottom.x, rodRailBottom.y);
    ctx.stroke();
    const regime = state.kEff > 1.02 ? '期望增长' : state.kEff < 0.98 ? '期望下降' : '期望近似不变';
    labels.push({ id: 'chain-reaction-summary', ...m.toScreen(0, 1.05), text: `抽象代际期望（非时间仿真） → ${regime}`, color: '#e2e8f0', font: 'bold 14px ui-sans-serif, system-ui' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    if (params.mode === 'cloud-chamber-recoil') {
      return [
        {
          id: 'cloud-magnetic-field',
          label: `B=${params.magneticFieldT.toFixed(1)} T`,
          position: { x: 1.65, y: -0.8 + ((params.magneticFieldT + 3) / 6) * 1.2 },
          handleKind: 'point',
          color: '#38bdf8',
          onDrag: (world) => ({
            magneticFieldT: Number(Math.max(-3, Math.min(3, Math.round((-3 + ((world.y + 0.8) / 1.2) * 6) * 10) / 10)).toFixed(1))
          })
        }
      ];
    }
    if (params.mode === 'half-life-mc') {
      return [
        {
          id: 'half-life-slider',
          label: `T₁/₂=${params.halfLifeS.toFixed(1)} s`,
          position: { x: 0.15 + (params.halfLifeS / 6) * 1.95, y: -1.02 },
          handleKind: 'point',
          color: '#fbbf24',
          onDrag: (world) => ({
            halfLifeS: Number(Math.max(0.5, Math.min(6, Math.round((((world.x - 0.15) / 1.95) * 6) * 2) / 2)).toFixed(1))
          })
        }
      ];
    }
    return [
      {
        id: 'control-rod-absorption',
        label: `吸收率=${(params.controlRodAbsorption * 100).toFixed(0)}%`,
        position: { x: 1.85, y: -0.9 + (params.controlRodAbsorption / 0.85) * 1.55 },
        handleKind: 'point',
        color: '#4ade80',
        onDrag: (world) => ({
          controlRodAbsorption: Number(Math.max(0, Math.min(0.85, Math.round((((world.y + 0.9) / 1.55) * 0.85) * 50) / 50)).toFixed(2))
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    if (params.mode !== 'cloud-chamber-recoil' || params.magneticFieldT === 0) return [];
    const points = state.recoil.emittedTrackCm;
    if (points.length < 2) return [];
    const index = Math.min(points.length - 1, Math.max(1, Math.floor(points.length * 0.25)));
    const point = points[index]!;
    const previous = points[index - 1]!;
    const tangentX = point.x - previous.x;
    const tangentY = point.y - previous.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 1e-12) return [];

    const chargeNumber = params.decayKind === 'alpha' ? 2 : -1;
    const massKg = params.decayKind === 'alpha' ? 6.6446573357e-27 : 9.1093837139e-31;
    const momentum = state.recoil.momentumSi;
    const gamma = Math.sqrt(1 + (momentum / (massKg * 299792458)) ** 2);
    const speed = momentum / (gamma * massKg);
    const charge = chargeNumber * 1.602176634e-19;
    const forceMagnitude = Math.abs(charge) * speed * Math.abs(params.magneticFieldT);
    const worldScale = recoilScale(state);
    const tangentXUnit = tangentX / tangentLength;
    const tangentYUnit = tangentY / tangentLength;
    return [
      {
        id: 'emitted-lorentz-force',
        label: 'F洛 = qv×B',
        origin: { x: point.x * worldScale, y: point.y * worldScale },
        force: {
          x: charge * speed * params.magneticFieldT * tangentYUnit,
          y: -charge * speed * params.magneticFieldT * tangentXUnit
        },
        color: '#38bdf8',
        category: 'magnetic' as const,
        unit: 'N'
      }
    ].map((vector) => ({
      ...vector,
      force: {
        x: vector.force.x * (forceMagnitude / Math.max(1e-300, Math.hypot(vector.force.x, vector.force.y))),
        y: vector.force.y * (forceMagnitude / Math.max(1e-300, Math.hypot(vector.force.x, vector.force.y)))
      }
    }));
  },
  formatFormulas: (state, params) => {
    if(params.mode==='half-life-mc')return [{id:'half-life',label:'样本与理论期望',latex:'\\mathbb{E}[N(t)]=N_0\\,2^{-t/T_{1/2}}',substitutedLatex:'N_{\\rm sample}='+state.remainingCount+',\\quad \\mathbb{E}[N]='+ (state.decayedFlags.length*2**(-state.t/state.halfLifeS)).toFixed(2)}];
    if(params.mode==='chain-fission')return [{id:'generation-expectation',label:'抽象代际期望；非时间轨迹',latex:'\\mathbb{E}[N_g]'}];
    const r=state.recoil;
    return [{id:'nuclear-einstein',label:params.decayKind==='alpha'?'α 二体理想化':'β⁻ 端点理想化',latex:'Q=\\Delta m c^2=K_1+K_2',substitutedLatex:'Q='+r.qValueMev.toFixed(4)+'\\,\\mathrm{MeV},\\quad K_1+K_2='+(r.emittedKineticMev+r.daughterKineticMev).toFixed(4)+'\\,\\mathrm{MeV}'},
      ...(r.radiusRatioMeasured===undefined?[]:[{id:'recoil-ratio',label:'同动量大小的理想磁轨迹',latex:'R_1/R_2=|q_2/q_1|',substitutedLatex:'R_1/R_2='+r.radiusRatioMeasured.toFixed(6)}])];
  }
});

export default modernNuclearRecoilDecayPlugin;
