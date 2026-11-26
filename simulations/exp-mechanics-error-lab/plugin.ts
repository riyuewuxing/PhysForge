import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type ParamFieldSpec } from '@physforge/sim-sdk';
import { mechanicsErrorPresets } from './presets.js';
import { afGeometry, graphItems, tapeGeometry, tapeY, type GraphRole } from './geometry.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepMechanicsErrorLab,
  type MechanicsErrorParams,
  type MechanicsErrorState
} from './engine.js';


const paramSchema: readonly ParamFieldSpec<MechanicsErrorParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '扫测范围与预设类型',
    defaultValue: 'under-compensated',
    options: [
      { value: 'ideal-compensated', label: '恰当平衡阻力（小质量近似过原点）' },
      { value: 'under-compensated', label: '平衡不足/水平阻力 (正 F 截距)' },
      { value: 'over-compensated', label: '过度平衡倾角过大 (正 a 截距)' },
      { value: 'heavy-hanger-bend', label: '钩码质量过大 m≈M (末端弯曲)' }
    ]
  },
  { key: 'cartMassKg', kind: 'number', label: '小车质量 M', unit: 'kg', defaultValue: 0.4, min: 0.1, max: 1.5, step: 0.05 },
  { key: 'hangerMassKg', kind: 'number', label: '当前悬挂钩码 m', unit: 'kg', defaultValue: 0.04, min: 0.01, max: 0.5, step: 0.01 },
  { key: 'trackTiltDeg', kind: 'number', label: '木板倾角 θ', unit: '°', defaultValue: 0, min: 0, max: 10, step: 0.5 },
  { key: 'frictionForceN', kind: 'number', label: '轨道阻力 f', unit: 'N', defaultValue: 0.06, min: 0, max: 0.3, step: 0.01 },
  { key: 'readingNoiseMm', kind: 'number', label: '刻度读数高斯噪声 σ', unit: 'mm', defaultValue: 0, min: 0, max: 0.8, step: 0.05 },
  { key: 'seed', kind: 'number', label: 'PRNG 随机种子', defaultValue: 20261122, min: 1, max: 99999999, step: 1 },
  { key: 'rulerOffsetCm', kind: 'number', label: '纸带刻度尺零点偏移', unit: 'cm', defaultValue: 0, min: -5, max: 20, step: 0.1 },
  {
    key: 'phyphoxOverlayCsv',
    kind: 'select',
    label: 'CSV 对照（内置示例）',
    defaultValue: '',
    options: [
      { value: '', label: '不叠加对照散点' },
      { value: '0.1;0.08\n0.2;0.31\n0.4;0.79', label: '分号 CSV 教学示例（非已核实实测）' }
    ]
  }
];

export const expMechanicsErrorLabPlugin = defineSimulationPlugin<MechanicsErrorParams, MechanicsErrorState>({
  meta: {
    id: 'exp-mechanics-error-lab',
    title: '力学实验真误差与纸带逐差仿真台 (X01)',
    textbookRef: '人教版 必修第一册 第四章 · 探究 a-F 异常图线溯源',
    curriculumTags: ['科学探究', '科学思维', '物理观念'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: mechanicsErrorPresets,
  engine: {
    createInitialState,
    step: stepMechanicsErrorLab,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'tape', label: '50Hz 打点纸带缩放刻度', defaultVisible: true },
    { id: 'afCurve', label: 'a-F 拟合曲线与 CSV 实验叠加', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'aTrueMps2', label: '真实加速度 a_true', unit: 'm/s²', color: '#4ade80' },
    { key: 'aDiffMeasuredMps2', label: '逐差法测得加速度', unit: 'm/s²', color: '#38bdf8' },
    { key: 'interceptFitA', label: '拟合 a 轴截距', unit: 'm/s²', color: '#f59e0b' },
    { key: 'rSquared', label: '线性拟合决定系数 R²', unit: '', color: '#a855f7' }
  ],
  defaultView: { scale: .78, offsetRatioY: -.045 },
  getControlHandles: (state, params) => {
    const g=tapeGeometry(state,params);
    return [{
      id: 'tape-ruler-origin',
      label: `零点 ${g.offset.toFixed(1)}cm`,
      position: {x:g.zeroX,y:tapeY},
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: worldPos => ({rulerOffsetCm:Number(g.offsetAtX(worldPos.x).toFixed(1))})
    }];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'exp-mechanics-error-lab',
      title: '力学核心实验真误差仿真台',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<MechanicsErrorParams>
  },
  exportDiagramIR: (state,params) => ({
    width: 760, height: 460,
    viewBox: {minX:-2.3,minY:-1.55,maxX:2.2,maxY:.92},
    title:'a-F 实验：精确理论、拟合与测点',
    primitives:graphItems(state,params).map(i=>i.primitive)
  }),
  renderCanvas: (ctx,state,params,viewport,activeLayers) => {
    const m=createWorldMapper(viewport), toScreen=m.toScreen;
    const projector=viewport.theme==='projector';
    const ink=projector?'#172033':'#e2e8f0';
    const labels:CanvasLabel[]=[];
    const put=(id:string,x:number,y:number,text:string,color=ink,font='11px ui-sans-serif, system-ui')=>{
      const q=toScreen(x,y);labels.push({id,x:q.x,y:q.y,text,color,font});
    };
    const line=(x1:number,y1:number,x2:number,y2:number)=>{
      const a=toScreen(x1,y1),b=toScreen(x2,y2);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    };
    ctx.save();
    if(activeLayers.has('tape')){
      const g=tapeGeometry(state,params), a=toScreen(g.x(g.min),tapeY+.14),b=toScreen(g.x(g.max),tapeY-.32);
      ctx.fillStyle='#e2e8f0';ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);
      ctx.strokeStyle='#334155';ctx.lineWidth=1;
      for(const t of g.ticks){
        line(t.x,tapeY+.12,t.x,tapeY+(t.major?-.015:.045));
        if(t.major)put('tick-'+t.reading,t.x,tapeY+.19,Number(t.reading.toPrecision(5)).toString()+' cm',ink,'10px ui-sans-serif, system-ui');
      }
      for(const d of g.dots){
        const q=toScreen(d.x,tapeY-.19);
        ctx.fillStyle='#0f172a';ctx.beginPath();ctx.arc(q.x,q.y,3,0,Math.PI*2);ctx.fill();
        put('dot-'+d.index,d.x,tapeY-.39,'x'+d.index+'='+d.reading.toFixed(2),ink,'10px ui-sans-serif, system-ui');
      }
      ctx.strokeStyle='#d97706';ctx.lineWidth=2;line(g.zeroX,tapeY+.14,g.zeroX,tapeY-.32);
      put('tape-note',0,1.57,'50 Hz · 每5点取一个计数点 · T=0.10 s');
    }
    if(activeLayers.has('afCurve')){
      const colors:Record<GraphRole,string>={axis:ink,tick:ink,theory:projector?'#075985':'#38bdf8',fit:projector?'#6d28d9':'#c4b5fd',measured:projector?'#92400e':'#fbbf24',overlay:projector?'#be123c':'#f43f5e',legend:ink};
      graphItems(state,params).forEach(({role,primitive:p},idx)=>{
        const color=colors[role];ctx.strokeStyle=color;ctx.fillStyle=color;
        ctx.lineWidth=role==='theory'?2.3:1.25;ctx.setLineDash('dashed' in p&&p.dashed?[5,4]:[]);
        if(p.kind==='line'||p.kind==='arrow'){
          line(p.x1,p.y1,p.x2,p.y2);
          if(p.kind==='arrow'){
            const a=toScreen(p.x1,p.y1),b=toScreen(p.x2,p.y2),angle=Math.atan2(b.y-a.y,b.x-a.x);
            ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-7*Math.cos(angle-.45),b.y-7*Math.sin(angle-.45));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-7*Math.cos(angle+.45),b.y-7*Math.sin(angle+.45));ctx.stroke();
            if(p.label)put('axis-'+idx,p.x2,p.y2+.055,p.label,color);
          }
        }else if(p.kind==='polyline'){
          ctx.beginPath();p.points.forEach((v,i)=>{const q=toScreen(v.x,v.y);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.stroke();
        }else if(p.kind==='circle'){
          const q=toScreen(p.cx,p.cy);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(2,m.len(p.r)),0,Math.PI*2);ctx.fill();
        }else if(p.kind==='rect'){
          const a=toScreen(p.x,p.y+p.height);ctx.strokeRect(a.x,a.y,m.len(p.width),m.len(p.height));
        }else if(p.kind==='text')put('graph-'+idx,p.x,p.y,p.text,color);
      });
      ctx.setLineDash([]);
    }
    labels.push({id:'mechanics-error-summary',x:viewport.width*.45,y:26,text:'a 真='+state.aTrueMps2.toFixed(4)+' | a 逐差='+state.aDiffMeasuredMps2.toFixed(4)+' m/s² | 拟合 F 截距='+state.interceptFitF.toFixed(4)+' N',color:ink,font:'bold 13px ui-sans-serif, system-ui'});
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
    const tape=tapeGeometry(state,params),graph=afGeometry(state,params);
    if(ctx.canvas?.dataset)ctx.canvas.dataset.mechanicsErrorRendered=JSON.stringify({t:state.t,scenario:params.scenario,M:params.cartMassKg,m:params.hangerMassKg,theta:params.trackTiltDeg,f:params.frictionForceN,noise:params.readingNoiseMm,aTrue:state.aTrueMps2,aDiff:state.aDiffMeasuredMps2,fitA:state.interceptFitA,fitF:state.interceptFitF,rSquared:state.rSquared,analyticA:state.analyticInterceptA,analyticF:state.analyticInterceptF,offset:tape.offset,zeroX:tape.zeroX,scale:tape.scale,dots:tape.dots,rawDots:state.tapeDots,curve:state.afCurve,graphZero:graph.map(0,0),graphBounds:graph.bounds,graphRange:{fMax:graph.fMax,aMin:graph.aMin,aMax:graph.aMax},measured:graph.data.measured.map(q=>graph.map(q.f,q.a)),screenBounds:[toScreen(-1.75,1.34),toScreen(1.75,-1.10)],layers:[...activeLayers]});
  },
  formatFormulas: (state) => [
    {
      id: 'mechanics-error-diff',
      label: '预先向正方向运动：恒阻力加速度与逐差',
      latex: 'a_{\\text{真}}=\\frac{mg+Mg\\sin\\theta-f}{M+m},\\quad a=\\frac{(s_4+s_5+s_6)-(s_1+s_2+s_3)}{9T^2}',
      substitutedLatex: `a_{\\text{真}}=${state.aTrueMps2.toFixed(4)}\\text{ m/s}^2,\\; a_{\\text{逐}}=${state.aDiffMeasuredMps2.toFixed(4)}\\text{ m/s}^2,\\; R^2=${state.rSquared.toFixed(5)}`
    }
  ]
});

export default expMechanicsErrorLabPlugin;
