import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type ParamFieldSpec } from '@physforge/sim-sdk';
import { thermoCycleMdPresets } from './presets.js';
import {thermalGeometry,THERMAL_BOUNDS} from './sceneGeometry.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepThermoCycleMd,
  type ThermoCycleMdParams,
  type ThermoCycleMdState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ThermoCycleMdParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '热学体系',
    defaultValue: 'kinetic-md-box',
    options: [
      { value: 'kinetic-md-box', label: '空间哈希硬球分子 MD + 布朗运动' },
      { value: 'cycle-carnot', label: '卡诺循环 (等温 + 绝热)' },
      { value: 'cycle-rect-pv', label: 'P-V 矩形热力学循环' }
    ]
  },
  { key: 'molesN', kind: 'number', label: '理想气体摩尔数 n', unit: 'mol', min: 0.5, max: 3, step: 0.5, defaultValue: 1 },
  { key: 'tHotK', kind: 'number', label: '高温热源 T_H', unit: 'K', min: 400, max: 900, step: 50, defaultValue: 600 },
  { key: 'tColdK', kind: 'number', label: '低温 / 最低温 T_C', unit: 'K', min: 200, max: 450, step: 25, defaultValue: 300 },
  { key: 'compressionRatioV2OverV1', kind: 'number', label: '膨胀体积比 V₂/V₁', unit: '', min: 1.4, max: 4.0, step: 0.2, defaultValue: 2.5 },
  { key: 'rectPressureRatio', kind: 'number', label: '矩形循环压强比 P高/P低', unit: '', min: 1.4, max: 3.5, step: 0.2, defaultValue: 2.0 },
  { key: 'particleCountN', kind: 'number', label: '气体圆盘数 N', unit: '个', min: 100, max: 400, step: 50, defaultValue: 300 },
  { key: 'seed', kind: 'number', label: '确定性随机种子 seed', unit: '', min: 1, max: 99999999, step: 1, defaultValue: 20261122 },
  { key: 'brownianPollen', kind: 'boolean', label: '放入大质量布朗花粉微粒', defaultValue: true },
  { key: 'mdSpeedScale', kind: 'number', label: '初始速率倍率（非温度倍率）', unit: 'x', min: 0.5, max: 2.0, step: 0.25, defaultValue: 1.0 }
];

export const thermoCyclesKineticMdPlugin = defineSimulationPlugin<ThermoCycleMdParams, ThermoCycleMdState>({
  meta: {
    id: 'thermo-cycles-kinetic-md',
    title: '热力学循环与硬球分子动理论微观盒 (T02)',
    textbookRef: '人教版 选择性必修三 第一、三章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets:thermoCycleMdPresets,
  defaultView:{scale:1.02,offsetRatioX:-.03,offsetRatioY:-.04},
  getParamFields:p=>{
    const keys=p.mode==='kinetic-md-box'?['mode','brownianPollen','particleCountN','mdSpeedScale','seed']:p.mode==='cycle-carnot'?['mode','tHotK','tColdK','compressionRatioV2OverV1','molesN']:['mode','tColdK','compressionRatioV2OverV1','rectPressureRatio','molesN'];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key));
  },
  engine:{createInitialState,step:stepThermoCycleMd,computeObservables,checkInvariants},
  layers:[
    {id:'mainView',label:'真实分子盒 / 循环路径',defaultVisible:true},
    {id:'histogramOrTrail',label:'统计 / 逐段热功账本',defaultVisible:true}
  ],
  telemetryChannels:[
    {key:'kineticEnergy',label:'总动能 E*',unit:'约化能量',color:'#4ade80'},
    {key:'wallPressure',label:'累计平均壁压 P*',unit:'约化二维压强',color:'#38bdf8'},
    {key:'rmsSpeed',label:'气体方均根速率',unit:'约化速率',color:'#fbbf24'},
    {key:'temperatureProxy',label:'气体温度代理 kBT*',unit:'约化能量',color:'#f472b6'}
  ],
  getTelemetryChannels:p=>p.mode==='kinetic-md-box'?
    [{key:'kineticEnergy',label:'总动能 E*',unit:'约化能量',color:'#4ade80'},{key:'wallPressure',label:'累计平均壁压 P*',unit:'约化二维压强',color:'#38bdf8'},{key:'rmsSpeed',label:'气体方均根速率',unit:'约化速率',color:'#fbbf24'},{key:'temperatureProxy',label:'气体温度代理 kBT*',unit:'约化能量',color:'#f472b6'}]:[],
  sceneSerializer:{
    exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'thermo-cycles-kinetic-md',title:'热力学循环与 MD 气体盒',params}),
    importScene:dsl=>dsl.params as Partial<ThermoCycleMdParams>
  },
  exportDiagramIR:(s,p)=>({width:1060,height:680,viewBox:THERMAL_BOUNDS,title:p.mode==='kinetic-md-box'?'真实分子快照与拟合统计':'解析热力学循环与热功账本',primitives:thermalGeometry(s,p).marks.map(m=>m.primitive)}),
  renderCanvas:(ctx,s,p,viewport,layers)=>{
    const mapper=createWorldMapper(viewport),paper=viewport.theme==='projector';
    const palette=paper?{ink:'#0f172a',grid:'#94a3b8',gas:'#075985',pollen:'#a16207',heat:'#b91c1c',work:'#92400e',cool:'#0369a1',adiabat:'#166534',sample:'#0284c7',theory:'#9a3412',alert:'#be123c'}:
      {ink:'#e2e8f0',grid:'#475569',gas:'#67e8f9',pollen:'#fbbf24',heat:'#fb7185',work:'#fbbf24',cool:'#38bdf8',adiabat:'#4ade80',sample:'#38bdf8',theory:'#fbbf24',alert:'#fb7185'};
    const labels:CanvasLabel[]=[];
    const line=(x1:number,y1:number,x2:number,y2:number,width:number)=>{
      ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(mapper.toX(x1),mapper.toY(y1));ctx.lineTo(mapper.toX(x2),mapper.toY(y2));ctx.stroke();
    };
    ctx.save();
    const g=thermalGeometry(s,p);
    g.marks.forEach(({primitive:v,tone},i)=>{
      const side=v.kind==='rect'?v.x+v.width/2:v.kind==='circle'?v.cx:v.kind==='text'?v.x:v.kind==='line'||v.kind==='arrow'?(v.x1+v.x2)/2:v.kind==='trajectory'||v.kind==='polyline'?(v.points[0]?.x??0):0;
      if(s.cycle.valid||p.mode==='kinetic-md-box'){
        if(side<.2&&!layers.has('mainView')&&v.kind!=='trajectory')return;
        if((side>=.2||v.kind==='trajectory')&&!layers.has('histogramOrTrail'))return;
      }
      const color=palette[tone];ctx.strokeStyle=color;ctx.fillStyle=color;
      if(v.kind==='text'){
        const q=mapper.toScreen(v.x,v.y);ctx.font='12px sans-serif';
        const w=ctx.measureText(v.text).width;
        labels.push({id:'thermal-'+i,x:q.x+(v.align==='end'?-w/2:v.align==='start'?w/2:0),y:q.y,text:v.text,color,font:'12px sans-serif'});
      }else if(v.kind==='line'){
        ctx.setLineDash(v.dashed?[4,4]:[]);line(v.x1,v.y1,v.x2,v.y2,tone==='theory'?2:1.2);ctx.setLineDash([]);
      }else if(v.kind==='arrow'){
        line(v.x1,v.y1,v.x2,v.y2,2);
        const a=mapper.toScreen(v.x1,v.y1),b=mapper.toScreen(v.x2,v.y2),theta=Math.atan2(b.y-a.y,b.x-a.x);
        ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-7*Math.cos(theta-.5),b.y-7*Math.sin(theta-.5));ctx.lineTo(b.x-7*Math.cos(theta+.5),b.y-7*Math.sin(theta+.5));ctx.closePath();ctx.fill();
      }else if(v.kind==='rect'){
        const a=mapper.toScreen(v.x,v.y+v.height),w=mapper.len(v.width),h=mapper.len(v.height);
        ctx.globalAlpha=tone==='sample'?.65:.14;ctx.fillRect(a.x,a.y,w,h);ctx.globalAlpha=1;ctx.lineWidth=1.2;ctx.strokeRect(a.x,a.y,w,h);
      }else if(v.kind==='circle'){
        const q=mapper.toScreen(v.cx,v.cy);ctx.beginPath();ctx.arc(q.x,q.y,mapper.len(v.r),0,Math.PI*2);ctx.fill();
      }else if(v.kind==='trajectory'||v.kind==='polyline'){
        ctx.setLineDash(v.dashed?[4,4]:[]);ctx.lineWidth=v.kind==='trajectory'?1.4:2.5;ctx.beginPath();
        v.points.forEach((q,j)=>{const a=mapper.toScreen(q.x,q.y);if(j===0)ctx.moveTo(a.x,a.y);else ctx.lineTo(a.x,a.y);});
        if(v.kind==='polyline'&&v.closed)ctx.closePath();ctx.stroke();ctx.setLineDash([]);
      }
    });
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  getControlHandles:(_s,p)=>p.mode==='kinetic-md-box'?[{
    id:'md-speed-scale',label:'初速 '+p.mdSpeedScale.toFixed(2)+'×',position:{x:.09,y:-.83+(p.mdSpeedScale-.5)/1.5*1.55},handleKind:'point',color:'#fbbf24',
    onDrag:wp=>({mdSpeedScale:Math.max(.5,Math.min(2,Math.round((.5+(wp.y+.83)/1.55*1.5)*4)/4))})
  }]:p.mode==='cycle-carnot'?[{
    id:'carnot-t-hot',label:'T_H='+p.tHotK.toFixed(0)+' K',position:{x:.26,y:-.82+(p.tHotK-400)/500*1.55},handleKind:'point',color:'#fb7185',
    onDrag:wp=>({tHotK:Math.max(400,Math.min(900,Math.round((400+(wp.y+.82)/1.55*500)/50)*50))})
  }]:[],
  formatFormulas:(s,p)=>{
    if(p.mode==='kinetic-md-box'){
      const o=computeObservables(s,p);
      return [{id:'thermo-first-law',label:'二维硬盘 · 约化单位 · 无热浴',latex:'E^*=\\sum_i m_i^* v_i^{*2}/2,\\quad P^*=I_{\\rm wall}^*/(4L^*t^*)',substitutedLatex:'N='+o.gasCount+',\\quad E^*='+s.kineticEnergy.toFixed(3)+(s.t>0?',\\quad P^*='+s.wallPressure.toFixed(3):'')},
      {id:'speed-statistics',label:'气体样本，不含花粉；拟合 CDF 距离',latex:'F(v)=1-e^{-v^2/\\langle v^2\\rangle},\\quad k_BT^*=\\langle v^{*2}\\rangle/2',substitutedLatex:'v_{\\rm rms}^*='+o.rmsSpeed!.toFixed(3)+',\\quad D='+o.maxwellKs!.toFixed(4)}];
    }
    if(!s.cycle.valid)return [{id:'thermo-first-law',label:'无有效循环：不改写输入温度',latex:'T_H>T_C>0'}];
    const c=s.cycle;
    return [{id:'thermo-first-law',label:'单原子理想气体 · 静态解析循环',latex:'\\Delta U=Q-W,\\quad \\eta=W_{\\rm net}/Q_{\\rm in}',substitutedLatex:'W_{\\rm net}='+c.sumWJ.toFixed(2)+'\\,\\mathrm J,\\quad \\eta='+ (100*c.efficiency).toFixed(2)+'\\%'},
      {id:'cycle-limit',label:p.mode==='cycle-carnot'?'理想卡诺两热源':'矩形循环实际温区上限比较',latex:'\\eta_C=1-T_{\\min}/T_{\\max}',substitutedLatex:'T_{\\min}='+c.minTemperatureK.toFixed(1)+'\\,\\mathrm K,\\quad T_{\\max}='+c.maxTemperatureK.toFixed(1)+'\\,\\mathrm K'}];
  }
});
export default thermoCyclesKineticMdPlugin;
