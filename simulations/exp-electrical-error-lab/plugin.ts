import { createWorldMapper, defineSimulationPlugin, type ParamFieldSpec, type DiagramPrimitive } from '@physforge/sim-sdk';
import { electricalDiagram, electricalItems, caliperX, microX, CALIPER_ZERO_X, CALIPER_MM_WORLD, CALIPER_RULER_Y, MICRO_ZERO_X, MICRO_MM_WORLD, MICRO_RULER_Y, type Role } from './geometry.js';
import { electricalErrorPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepElectricalErrorLab,
  type ElectricalErrorParams,
  type ElectricalErrorState
} from './engine.js';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const paramSchema: readonly ParamFieldSpec<ElectricalErrorParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '电学实验模块',
    defaultValue: 'emf-inner-outer',
    options: [
      { value: 'emf-inner-outer', label: '测电源 E,r 内外接系统误差 (MNA)' },
      { value: 'bulb-iv-curve', label: '小灯泡非线性 I-U（分压/限流）' },
      { value: 'half-bias-rg', label: '半偏法测电流表内阻 R_g' },
      { value: 'caliper-micrometer', label: '游标卡尺与螺旋测微器读数' }
    ]
  },
  {
    key: 'emfWiring',
    kind: 'select',
    label: '测 E,r 电表接法',
    defaultValue: 'voltmeter-across-source',
    options: [
      { value: 'voltmeter-across-source', label: '电压表并接电源（E_测<E, r_测<r）' },
      { value: 'ammeter-in-series', label: '电流表串接电源（E_测=E, r_测=r+R_A）' }
    ]
  },
  { key: 'emfVolts', kind: 'number', label: '电源真电动势 E', unit: 'V', defaultValue: 3.0, min: 1.5, max: 9.0, step: 0.5 },
  { key: 'rInternalOhm', kind: 'number', label: '电源真内阻 r', unit: 'Ω', defaultValue: 1.5, min: 0.2, max: 4.0, step: 0.2 },
  { key: 'rAmmeterOhm', kind: 'number', label: '电流表内阻 R_A', unit: 'Ω', defaultValue: 0.4, min: 0.05, max: 2.0, step: 0.1 },
  { key: 'rVoltmeterOhm', kind: 'number', label: '电压表内阻 R_V', unit: 'Ω', defaultValue: 150, min: 20, max: 3000, step: 50 },
  {
    key: 'bulbWiring',
    kind: 'select',
    label: '滑动变阻器接法',
    defaultValue: 'voltage-divider',
    options: [
      { value: 'voltage-divider', label: '分压式（电压从 0 起连续可调）' },
      { value: 'current-limit', label: '限流式（存在最小底压）' }
    ]
  },
  { key: 'rheostatMaxOhm', kind: 'number', label: '变阻器总阻值 R_p', unit: 'Ω', defaultValue: 20, min: 5, max: 100, step: 5 },
  { key: 'rheostatTapFrac', kind: 'number', label: '滑片比例', defaultValue: 0.5, min: 0, max: 1.0, step: 0.05 },
  { key: 'rgTrueOhm', kind: 'number', label: '表头真内阻 R_g', unit: 'Ω', defaultValue: 100, min: 20, max: 300, step: 10 },
  { key: 'halfBiasSupplyV', kind: 'number', label: '半偏法电源 E', unit: 'V', defaultValue: 6.0, min: 1.5, max: 12.0, step: 1.5 },
  { key: 'targetVernierMm', kind: 'number', label: '卡尺待测长度（真值）', unit: 'mm', defaultValue: 23.46, min: 0, max: 50, step: 0.001 },
  {
    key: 'vernierDivisions',
    kind: 'select',
    label: '游标分度',
    defaultValue: '50',
    options: [
      { value: '10', label: '10 分度 (0.1 mm)' },
      { value: '20', label: '20 分度 (0.05 mm)' },
      { value: '50', label: '50 分度 (0.02 mm)' }
    ]
  },
  { key: 'targetMicrometerMm', kind: 'number', label: '测微器待测长度（真值）', unit: 'mm', defaultValue: 5.73, min: 0, max: 20, step: 0.001 }
];

export const expElectricalErrorLabPlugin = defineSimulationPlugin<ElectricalErrorParams, ElectricalErrorState>({
  meta: {
    id: 'exp-electrical-error-lab',
    title: '电学核心实验真误差与精密读数台 (X02)',
    textbookRef: '人教版 必修第三册 第十一、十二章 · 非理想电表误差与读数',
    curriculumTags: ['科学探究', '科学思维', '物理观念'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: electricalErrorPresets,
  engine: {
    createInitialState,
    step: stepElectricalErrorLab,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: 'MNA 误差曲线 / 刻度尺视图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'eFittedV', label: '拟合电动势 E_测', unit: 'V', color: '#38bdf8' },
    { key: 'rFittedOhm', label: '拟合内阻 r_测', unit: 'Ω', color: '#fbbf24' },
    { key: 'rgMeasuredOhm', label: '半偏法测得 R_g', unit: 'Ω', color: '#4ade80' },
    { key: 'vernierReadoutMm', label: '游标卡尺读数', unit: 'mm', color: '#a855f7' },
    { key: 'microReadoutMm', label: '螺旋测微器读数', unit: 'mm', color: '#f472b6' },
    { key: 'bulbVoltageV', label: '当前灯泡电压', unit: 'V', color: '#38bdf8' },
    { key: 'bulbCurrentA', label: '当前灯泡电流', unit: 'A', color: '#fbbf24' }
  ],
  defaultView: {scale:.83,offsetRatioY:-.035},
  getControlHandles: (state, params) => {
    if (params.mode !== 'caliper-micrometer') return [];
    const divisions = Number(params.vernierDivisions) || 50;
    const vernierStep = 1 / divisions;
    return [
      {
        id: 'vernier-jaw',
        label: `${state.instrument.vernierReadoutMm.toFixed(2)}mm`,
        position: {
          x: caliperX(state.instrument.vernierReadoutMm),
          y: CALIPER_RULER_Y
        },
        handleKind: 'point',
        color: '#a855f7',
        onDrag: (worldPos) => {
          const rawMm = clamp((worldPos.x - CALIPER_ZERO_X) / CALIPER_MM_WORLD, 0, 50);
          const snappedMm = Math.round(rawMm / vernierStep) * vernierStep;
          return { targetVernierMm: Number(snappedMm.toFixed(3)) };
        }
      },
      {
        id: 'micrometer-thimble',
        label: `${state.instrument.microReadoutMm.toFixed(2)}mm`,
        position: {
          x: microX(state.instrument.microReadoutMm),
          y: MICRO_RULER_Y
        },
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (worldPos) => {
          const rawMm = clamp((worldPos.x - MICRO_ZERO_X) / MICRO_MM_WORLD, 0, 20);
          return { targetMicrometerMm: Number((Math.round(rawMm / 0.01) * 0.01).toFixed(2)) };
        }
      }
    ];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'exp-electrical-error-lab',
      title: '电学核心实验真误差仿真台',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ElectricalErrorParams>
  },
  exportDiagramIR: electricalDiagram,
  renderCanvas: (ctx,state,params,viewport,activeLayers) => {
    if (!activeLayers.has('main')) return;
    const m=createWorldMapper(viewport),screen=m.toScreen,paper=viewport.theme==='projector';
    const colors:Record<Role,string>=paper?{ink:'#172033',muted:'#475569',reference:'#64748b',fit:'#0369a1',measured:'#166534',selected:'#b45309'}:{ink:'#e2e8f0',muted:'#94a3b8',reference:'#94a3b8',fit:'#38bdf8',measured:'#4ade80',selected:'#fbbf24'};
    const label=(x:number,y:number,value:string,align:CanvasTextAlign='center',size=11,color=colors.ink)=>{
      const p=screen(x,y);ctx.save();ctx.fillStyle=color;ctx.font=size+'px ui-sans-serif,system-ui';ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(value,p.x,p.y);ctx.restore();
    };
    const trace=(points:readonly {x:number;y:number}[],closed=false)=>{
      if(points.length<2)return;
      ctx.beginPath();points.forEach((p,i)=>{const z=screen(p.x,p.y);if(i)ctx.lineTo(z.x,z.y);else ctx.moveTo(z.x,z.y);});if(closed)ctx.closePath();ctx.stroke();
    };
    const line=(x1:number,y1:number,x2:number,y2:number)=>trace([{x:x1,y:y1},{x:x2,y:y2}]);
    function drawCircuit(p:Extract<DiagramPrimitive,{kind:'circuitElement'}>){
      const dx=p.x2-p.x1,dy=p.y2-p.y1,d=Math.hypot(dx,dy);if(d<1e-12)return;
      const ux=dx/d,uy=dy/d,cx=(p.x1+p.x2)/2,cy=(p.y1+p.y2)/2;
      const local=(x:number,y:number)=>({x:cx+ux*x-uy*y,y:cy+uy*x+ux*y});
      const path=(points:readonly [number,number][],closed=false)=>trace(points.map(([x,y])=>local(x,y)),closed);
      const r=Math.min(.15,d*.31),h=Math.min(.08,d*.17);
      path([[-d/2,0],[-r,0]]);path([[r,0],[d/2,0]]);
      if(p.element==='resistor'){
        path([[-r,-h],[r,-h],[r,h],[-r,h]],true);
      }else if(p.element==='battery'){
        const gap=Math.min(.045,r*.5);
        path([[-r,0],[-gap,0]]);path([[gap,0],[r,0]]);
        path([[-gap,-h*1.7],[-gap,h*1.7]]);path([[gap,-h*.86],[gap,h*.86]]);
      }else{
        const z=screen(cx,cy);ctx.beginPath();ctx.arc(z.x,z.y,m.len(r),0,Math.PI*2);ctx.stroke();
        if(p.element==='lamp'){
          const size=r*.66;path([[-size,-size],[size,size]]);path([[-size,size],[size,-size]]);
        }else label(cx,cy,p.element==='ammeter'?'A':'V','center',Math.max(10,Math.min(15,m.len(r))),colors.ink);
      }
    }
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    const items=electricalItems(state,params);
    const font=Math.max(9,Math.min(12,m.len(.067)));
    for(const {role,primitive:p} of items){
      const color=colors[role];ctx.strokeStyle=color;ctx.fillStyle=color;
      ctx.lineWidth=role==='fit'||role==='selected'?2:1.25;
      ctx.setLineDash('dashed' in p&&p.dashed?[5,4]:[]);
      if(p.kind==='line'||p.kind==='arrow'){
        if(p.kind==='line'&&p.strokeWidth!==undefined)ctx.lineWidth=p.strokeWidth;
        line(p.x1,p.y1,p.x2,p.y2);
        if(p.kind==='arrow'){
          const a=screen(p.x1,p.y1),b=screen(p.x2,p.y2),angle=Math.atan2(b.y-a.y,b.x-a.x);
          ctx.beginPath();ctx.moveTo(b.x-7*Math.cos(angle-.45),b.y-7*Math.sin(angle-.45));ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-7*Math.cos(angle+.45),b.y-7*Math.sin(angle+.45));ctx.stroke();
        }
      }else if(p.kind==='polyline')trace(p.points,p.closed);
      else if(p.kind==='circle'){
        const z=screen(p.cx,p.cy);ctx.beginPath();ctx.arc(z.x,z.y,Math.max(1.7,m.len(p.r)),0,Math.PI*2);if(p.fill)ctx.fill();else ctx.stroke();
      }else if(p.kind==='rect'){
        const z=screen(p.x,p.y+p.height);ctx.strokeRect(z.x,z.y,m.len(p.width),m.len(p.height));
      }else if(p.kind==='text')label(p.x,p.y,p.text,p.align==='start'?'left':p.align==='end'?'right':'center',font,color);
      else if(p.kind==='circuitElement')drawCircuit(p);
    }
    ctx.restore();
    if(ctx.canvas?.dataset)ctx.canvas.dataset.electricalErrorRendered=JSON.stringify({
      t:state.t,mode:params.mode,emfWiring:params.emfWiring,E:params.emfVolts,r:params.rInternalOhm,rA:params.rAmmeterOhm,rV:params.rVoltmeterOhm,
      emf:state.emfSummary,half:state.halfBias,halfSupply:params.halfBiasSupplyV,bulbWiring:params.bulbWiring,R:params.rheostatMaxOhm,
      bulb:state.bulbOperatingPoint,bulbCurve:state.bulbCurve,instrument:state.instrument,N:Number(params.vernierDivisions),
      targetV:params.targetVernierMm,targetM:params.targetMicrometerMm,
      caliperHandle:screen(caliperX(state.instrument.vernierReadoutMm),CALIPER_RULER_Y),
      microHandle:screen(microX(state.instrument.microReadoutMm),MICRO_RULER_Y),
      pxPerCaliperMm:m.len(CALIPER_MM_WORLD),pxPerMicroMm:m.len(MICRO_MM_WORLD)
    });
  },
  formatFormulas: (state,params) => {
    if(params.mode==='emf-inner-outer'){
      const e=state.emfSummary;
      const outer=params.emfWiring==='voltmeter-across-source';
      return [
        {id:'emf-wiring-law',label:outer?'电压表直接并电源：电压表分流':'电流表直接串电源：电流表分压',
          latex:outer?'U=E-r(I+U/R_V)':'U=E-(r+R_A)I'},
        {id:'emf-fit-E',label:'拟合纵截距',
          latex:outer?'E_{\\rm 测}=\\frac{R_V E}{R_V+r}':'E_{\\rm 测}=E',
          substitutedLatex:'E_{\\rm 测}='+e.eFittedV.toFixed(4)+'\\ \\mathrm{V}'},
        {id:'emf-fit-r',label:'拟合斜率绝对值',
          latex:outer?'r_{\\rm 测}=\\frac{rR_V}{r+R_V}':'r_{\\rm 测}=r+R_A',
          substitutedLatex:'r_{\\rm 测}='+e.rFittedOhm.toFixed(4)+'\\ \\Omega'}
      ];
    }
    if(params.mode==='bulb-iv-curve'){
      const p=state.bulbOperatingPoint,f=p.tap,divider=params.bulbWiring==='voltage-divider';
      return [
        {id:'bulb-law',label:'既有非线性灯丝模型（非实测数据）',latex:'I=0.14U(U+10^{-6})^{-0.38}'},
        {id:'bulb-kcl',label:divider?'分压节点电流守恒':'限流串联',
          latex:f===1?'U=E':divider&&f===0?'U=0':divider?'\\frac{E-U}{R_{上}}=\\frac{U}{R_{下}}+I':'E=U+IR_{串}'},
        {id:'bulb-point-U',label:'当前工作点电压',latex:'U_L',substitutedLatex:'U_L='+p.voltageV.toFixed(4)+'\\ \\mathrm{V}'},
        {id:'bulb-point-I',label:'当前工作点电流',latex:'I_L',substitutedLatex:'I_L='+p.currentA.toFixed(4)+'\\ \\mathrm{A}'}
      ];
    }
    if(params.mode==='half-bias-rg'){
      const h=state.halfBias;
      return [
        {id:'half-bias-init',label:'断开 R₂，调初始电流',latex:'I_0=\\frac{E}{R_1+R_g}'},
        {id:'half-bias-exact',label:'闭合并调至半偏的严格关系',latex:'R_2=\\frac{R_1 R_g}{R_1+R_g}',substitutedLatex:'R_2='+h.rgMeasuredOhm.toFixed(3)+'\\ \\Omega'},
        {id:'half-bias-error',label:'相对低估，R₁远大于Rg才近似相等',latex:'\\delta=\\frac{R_g-R_2}{R_g}',substitutedLatex:'\\delta='+(100*h.biasRelativeErr).toFixed(3)+'\\%'}
      ];
    }
    const i=state.instrument;
    return [
      {id:'vernier-read',label:'游标卡尺：主尺 + 对齐格',latex:'L=n+\\frac{j}{N}\\ \\mathrm{mm}',substitutedLatex:'L='+i.vernierReadoutMm.toFixed(2)+'\\ \\mathrm{mm}'},
      {id:'micro-read',label:'测微器：半毫米格 + 可动尺格',latex:'L=(0.5h+0.01j)\\ \\mathrm{mm}',substitutedLatex:'L='+i.microReadoutMm.toFixed(2)+'\\ \\mathrm{mm}'},
      {id:'vernier-quantization',label:'卡尺量化差',latex:'\\delta_V=|L_V-L_{V0}|',substitutedLatex:'\\delta_V='+i.vernierQuantErrorMm.toFixed(5)+'\\ \\mathrm{mm}'},
      {id:'micro-quantization',label:'测微器量化差',latex:'\\delta_M=|L_M-L_{M0}|',substitutedLatex:'\\delta_M='+i.microQuantErrorMm.toFixed(5)+'\\ \\mathrm{mm}'}
    ];
  }
});

export default expElectricalErrorLabPlugin;
