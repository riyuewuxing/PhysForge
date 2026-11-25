import { emDevicesStoryDecks } from './storyDecks.js';
import { flightReadout } from './particleFlight.js';
import { cyclotronReadout, cyclotronHistory, CYCL_DISPLAY_RADIUS } from './cyclotronFlight.js';
import { deviceDiagramPoint, getDeviceSchematic, deeOutline } from './deviceGeometry.js';
import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { emDevicesPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  isSensorDevice,
  sensorReadout,
  createInitialState,
  stepEmDevices,
  type EmDevicesParams,
  type EmDevicesState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EmDevicesParams>[] = [
  {
    key: 'device',
    kind: 'select',
    label: '电磁器件模块',
    defaultValue: 'cyclotron',
    options: [
      { value: 'velocity-selector', label: '速度选择器 (v = E/B)' },
      { value: 'mass-spectrometer', label: '质谱仪 (R = mv/qB)' },
      { value: 'cyclotron', label: '回旋加速器 (E_km)' },
      { value: 'hall-sensor', label: '霍尔元件 (U_H = IB/nqd)' },
      { value: 'mhd-generator', label: '磁流体发电机 (R=r 峰)' },
      { value: 'em-flowmeter', label: '电磁流量计 (Q = πDU/4B)' }
    ]
  },
  { key: 'eFieldVPerM', kind: 'number', label: '电场强度 E', unit: 'V/m', defaultValue: 2e5, min: 1e4, max: 5e5, step: 1e4 },
  { key: 'bFieldT', kind: 'number', label: '主磁场 B', unit: 'T', defaultValue: 1.5, min: 0.2, max: 4.0, step: 0.1 },
  { key: 'bDeflectT', kind: 'number', label: '偏转磁场 B₂', unit: 'T', defaultValue: 0.5, min: 0.2, max: 2.0, step: 0.1 },
  { key: 'particleSpeedMps', kind: 'number', label: '入射/流速 v', unit: 'm/s', defaultValue: 2e5, min: 100, max: 4e5, step: 500 },
  { key: 'chargeC', kind: 'number', label: '粒子电荷 q', unit: 'C', defaultValue: 1.602176634e-19, min: 1e-20, max: 1e-18, step: 1e-20 },
  { key: 'massKg', kind: 'number', label: '粒子质量 m', unit: 'kg', defaultValue: 1.67262192369e-27, min: 1e-28, max: 1e-25, step: 1e-28 },
  { key: 'cyclotronRadiusM', kind: 'number', label: 'D 形盒半径 R_max', unit: 'm', defaultValue: 0.45, min: 0.15, max: 1.2, step: 0.05 },
  { key: 'cyclotronVoltageV', kind: 'number', label: '加速高频电压 U', unit: 'V', defaultValue: 25000, min: 5000, max: 60000, step: 5000 },
  { key: 'relativisticDetune', kind: 'boolean', label: '启用相对论质速失谐', defaultValue: false },
  { key: 'hallCurrentA', kind: 'number', label: '霍尔控制电流 I', unit: 'A', defaultValue: 3.0, min: 0.5, max: 8.0, step: 0.5 },
  { key: 'hallDensityPerM3', kind: 'number', label: '载流子浓度 n', unit: '/m³', defaultValue: 2e24, min: 1e22, max: 1e26, step: 1e23 },
  { key: 'hallThicknessM', kind: 'number', label: '元件厚度 d', unit: 'm', defaultValue: 0.0005, min: 0.0002, max: 0.003, step: 0.0001 },
  {
    key: 'carrierType',
    kind: 'select',
    label: '载流子类型',
    defaultValue: 'electron',
    options: [
      { value: 'electron', label: '电子 (N 型, q=-e)' },
      { value: 'hole', label: '空穴 (P 型, q=+e)' }
    ]
  },
  { key: 'mhdDuctWidthM', kind: 'number', label: 'MHD 通道极间距 d', unit: 'm', defaultValue: 0.4, min: 0.1, max: 1.0, step: 0.05 },
  { key: 'mhdDuctAreaM2', kind: 'number', label: 'MHD 极板面积 S', unit: 'm²', defaultValue: 0.1, min: 0.02, max: 0.5, step: 0.02 },
  { key: 'mhdPlasmaResOhmM', kind: 'number', label: '等离子体电阻率 ρ', unit: 'Ω·m', defaultValue: 0.2, min: 0.05, max: 1.0, step: 0.05 },
  { key: 'mhdLoadOhm', kind: 'number', label: '外电路负载电阻 R', unit: 'Ω', defaultValue: 0.8, min: 0.1, max: 3.0, step: 0.1 },
  { key: 'flowDiameterM', kind: 'number', label: '流量计管径 D', unit: 'm', defaultValue: 0.2, min: 0.05, max: 0.6, step: 0.05 }
];


/** KaTeX-friendly notation for microscopic and macroscopic SI readouts. */
function scientificLatex(value: number): string {
  if (!Number.isFinite(value)) return '\\text{未定义}';
  if (value === 0) return '0';
  const [mantissa, exponent] = value.toExponential(3).split('e');
  if (mantissa === undefined || exponent === undefined) return '\\text{未定义}';
  return Number(exponent) === 0 ? mantissa : `${mantissa}\\times10^{${Number(exponent)}}`;
}

const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "velocity-selector",
    "title": "正交电磁速度选择器（电磁力平衡）",
    "latex": "v_s=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=eFieldVPerM}{E}}}{\\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}}",
    "bindings": [
      {
        "tokenKey": "eFieldVPerM",
        "paramKey": "eFieldVPerM",
        "label": "电场强度 E",
        "unit": "V/m",
        "min": 10000,
        "max": 500000,
        "step": 10000,
        "precision": 0
      },
      {
        "tokenKey": "bFieldT",
        "paramKey": "bFieldT",
        "label": "主磁场 B",
        "unit": "T",
        "min": 0.2,
        "max": 4,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "device": [
        "velocity-selector"
      ]
    }
  },
  {
    "id": "cyclotron-energy",
    "title": "经典回旋加速器极限动能（非相对论）",
    "latex": "E_{\\max}=\\frac{q^2 \\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}^2 \\htmlClass{pf-live-var}{\\htmlData{param=cyclotronRadiusM}{R}}^2}{2m}",
    "bindings": [
      {
        "tokenKey": "bFieldT",
        "paramKey": "bFieldT",
        "label": "主磁场 B",
        "unit": "T",
        "min": 0.2,
        "max": 4,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "cyclotronRadiusM",
        "paramKey": "cyclotronRadiusM",
        "label": "D 形盒半径 R_max",
        "unit": "m",
        "min": 0.15,
        "max": 1.2,
        "step": 0.05,
        "precision": 2
      }
    ],
    "when": {
      "device": [
        "cyclotron"
      ]
    }
  },
  {
    "id": "cyclotron-gap-energy",
    "title": "同步过狭缝的单次能量增量",
    "latex": "\\Delta K=|q|\\htmlClass{pf-live-var}{\\htmlData{param=cyclotronVoltageV}{U}}",
    "bindings": [
      {
        "tokenKey": "cyclotronVoltageV",
        "paramKey": "cyclotronVoltageV",
        "label": "加速高频电压 U",
        "unit": "V",
        "min": 5000,
        "max": 60000,
        "step": 5000,
        "precision": 0
      }
    ],
    "when": {
      "device": [
        "cyclotron"
      ]
    }
  },
  {
    "id": "spectrometer-radius",
    "title": "质谱仪偏转磁场中的经典回旋半径",
    "latex": "r=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=massKg}{m}}\\htmlClass{pf-live-var}{\\htmlData{param=particleSpeedMps}{v}}}{\\htmlClass{pf-live-var}{\\htmlData{param=chargeC}{q}}\\htmlClass{pf-live-var}{\\htmlData{param=bDeflectT}{B_2}}}",
    "bindings": [
      {
        "tokenKey": "massKg",
        "paramKey": "massKg",
        "label": "粒子质量 m",
        "unit": "kg",
        "min": 1e-28,
        "max": 1e-25,
        "step": 1e-28,
        "precision": 3
      },
      {
        "tokenKey": "particleSpeedMps",
        "paramKey": "particleSpeedMps",
        "label": "入射/流速 v",
        "unit": "m/s",
        "min": 100,
        "max": 400000,
        "step": 500,
        "precision": 0
      },
      {
        "tokenKey": "chargeC",
        "paramKey": "chargeC",
        "label": "粒子电荷 q",
        "unit": "C",
        "min": 1e-20,
        "max": 1e-18,
        "step": 1e-20,
        "precision": 3
      },
      {
        "tokenKey": "bDeflectT",
        "paramKey": "bDeflectT",
        "label": "偏转磁场 B₂",
        "unit": "T",
        "min": 0.2,
        "max": 2,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "device": [
        "mass-spectrometer"
      ]
    }
  },
  {
    "id": "hall-voltage",
    "title": "霍尔电压（下−上，q_c=±e）",
    "latex": "U_H=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=hallCurrentA}{I}}\\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}}{\\htmlClass{pf-live-var}{\\htmlData{param=hallDensityPerM3}{n}}q_c\\htmlClass{pf-live-var}{\\htmlData{param=hallThicknessM}{d}}}",
    "bindings": [
      {
        "tokenKey": "hallCurrentA",
        "paramKey": "hallCurrentA",
        "label": "霍尔控制电流 I",
        "unit": "A",
        "min": 0.5,
        "max": 8,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "bFieldT",
        "paramKey": "bFieldT",
        "label": "主磁场 B",
        "unit": "T",
        "min": 0.2,
        "max": 4,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "hallDensityPerM3",
        "paramKey": "hallDensityPerM3",
        "label": "载流子浓度 n",
        "unit": "/m³",
        "min": 1e+22,
        "max": 1e+26,
        "step": 1e+23,
        "precision": 3
      },
      {
        "tokenKey": "hallThicknessM",
        "paramKey": "hallThicknessM",
        "label": "元件厚度 d",
        "unit": "m",
        "min": 0.0002,
        "max": 0.003,
        "step": 0.0001,
        "precision": 4
      }
    ],
    "when": {
      "device": [
        "hall-sensor"
      ]
    }
  },
  {
    "id": "mhd-emf",
    "title": "磁流体发电机开路电动势",
    "latex": "\\mathcal E=\\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}\\htmlClass{pf-live-var}{\\htmlData{param=mhdDuctWidthM}{d}}\\htmlClass{pf-live-var}{\\htmlData{param=particleSpeedMps}{v}}",
    "bindings": [
      {
        "tokenKey": "bFieldT",
        "paramKey": "bFieldT",
        "label": "主磁场 B",
        "unit": "T",
        "min": 0.2,
        "max": 4,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "mhdDuctWidthM",
        "paramKey": "mhdDuctWidthM",
        "label": "MHD 通道极间距 d",
        "unit": "m",
        "min": 0.1,
        "max": 1,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "particleSpeedMps",
        "paramKey": "particleSpeedMps",
        "label": "入射/流速 v",
        "unit": "m/s",
        "min": 100,
        "max": 400000,
        "step": 500,
        "precision": 0
      }
    ],
    "when": {
      "device": [
        "mhd-generator"
      ]
    }
  },
  {
    "id": "mhd-load-power",
    "title": "磁流体发电机外负载功率与内阻",
    "latex": "\\begin{aligned}r&=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=mhdPlasmaResOhmM}{\\rho}}\\htmlClass{pf-live-var}{\\htmlData{param=mhdDuctWidthM}{d}}}{\\htmlClass{pf-live-var}{\\htmlData{param=mhdDuctAreaM2}{S}}}\\\\P_R&=\\frac{\\mathcal E^2\\htmlClass{pf-live-var}{\\htmlData{param=mhdLoadOhm}{R}}}{(R+r)^2}\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "mhdPlasmaResOhmM",
        "paramKey": "mhdPlasmaResOhmM",
        "label": "等离子体电阻率 ρ",
        "unit": "Ω·m",
        "min": 0.05,
        "max": 1,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "mhdDuctWidthM",
        "paramKey": "mhdDuctWidthM",
        "label": "MHD 通道极间距 d",
        "unit": "m",
        "min": 0.1,
        "max": 1,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "mhdDuctAreaM2",
        "paramKey": "mhdDuctAreaM2",
        "label": "MHD 极板面积 S",
        "unit": "m²",
        "min": 0.02,
        "max": 0.5,
        "step": 0.02,
        "precision": 2
      },
      {
        "tokenKey": "mhdLoadOhm",
        "paramKey": "mhdLoadOhm",
        "label": "外电路负载电阻 R",
        "unit": "Ω",
        "min": 0.1,
        "max": 3,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "device": [
        "mhd-generator"
      ]
    }
  },
  {
    "id": "flowmeter-rate",
    "title": "电磁流量计体积流量与开路电压（下−上）",
    "latex": "\\begin{aligned}Q&=\\frac{\\pi \\htmlClass{pf-live-var}{\\htmlData{param=flowDiameterM}{D}}^2 \\htmlClass{pf-live-var}{\\htmlData{param=particleSpeedMps}{v}}}{4}\\\\U&=\\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}Dv\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "flowDiameterM",
        "paramKey": "flowDiameterM",
        "label": "流量计管径 D",
        "unit": "m",
        "min": 0.05,
        "max": 0.6,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "particleSpeedMps",
        "paramKey": "particleSpeedMps",
        "label": "入射/流速 v",
        "unit": "m/s",
        "min": 100,
        "max": 400000,
        "step": 500,
        "precision": 0
      },
      {
        "tokenKey": "bFieldT",
        "paramKey": "bFieldT",
        "label": "主磁场 B",
        "unit": "T",
        "min": 0.2,
        "max": 4,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "device": [
        "em-flowmeter"
      ]
    }
  }
];
export const stseEmDevicesSuitePlugin = Object.assign(defineSimulationPlugin<EmDevicesParams, EmDevicesState>({
  meta: {
    id: 'stse-em-devices-suite',
    title: '现代电磁科技器件集成台 (S02)',
    textbookRef: '人教版 选择性必修二 第一章 · 电磁六大科技器件集成',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  renderMode: 'hybrid',
  paramSchema,
  presets: emDevicesPresets,
  engine: {
    createInitialState,
    step: stepEmDevices,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '电磁器件工作原理动态视图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'selectedSpeed', label: '选择速度 E/B', unit: 'm/s', color: '#38bdf8' },
    { key: 'hallVoltageMv', label: '霍尔电压 U_H', unit: 'mV', color: '#f59e0b' },
    { key: 'mhdOutputWatt', label: 'MHD 输出功率', unit: 'W', color: '#4ade80' },
    { key: 'flowVoltageMv', label: '流量计感生电压', unit: 'mV', color: '#a855f7' },
    { key:'cyclotronEnergyJ', label:'回旋粒子当前动能', unit:'J', color:'#fbbf24' },
    { key:'cyclotronPhaseSlipRad', label:'过缝相位差', unit:'rad', color:'#c084fc' },
    { key:'particleSpeedMps',label:'粒子实际速率',unit:'m/s',color:'#4ade80' },
    { key:'spectrometerRadiusM',label:'质谱偏转半径',unit:'m',color:'#fbbf24' },
    { key:'hallCurrentA',label:'霍尔控制电流',unit:'A',color:'#4ade80' },
    { key:'mhdLoadCurrentA',label:'MHD 负载电流',unit:'A',color:'#fbbf24' },
    { key:'mhdTerminalVoltageV',label:'MHD 端电压',unit:'V',color:'#38bdf8' },
    { key:'flowRateM3ps',label:'体积流量',unit:'m³/s',color:'#4ade80' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-em-devices-suite',
      title: '现代电磁器件集成台',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<EmDevicesParams>
  },
  exportDiagramIR: (state, params) => {
    const diagram = getDeviceSchematic(params.device,params);
    const primitives: DiagramPrimitive[] = [];
    for (const part of diagram.parts) {
      if (part.kind === 'dee') primitives.push({ kind:'polyline', points:deeOutline(part), closed:true });
      else primitives.push({ kind:'rect', x:part.x-part.width/2, y:part.y-part.height/2,
        width:part.width,height:part.height, hatch:part.material==='rail' });
    }
    for (const p of diagram.fields) primitives.push({kind:'fieldMarker',x:p.x,y:p.y,symbol:'dot',radius:0.04});
    for (const cue of diagram.cues) primitives.push({kind:'arrow',x1:cue.x,y1:cue.y,x2:cue.x+cue.dx,y2:cue.y+cue.dy,label:cue.label});
    for (const label of diagram.labels) primitives.push({kind:'text',...label,align:'middle'});
    if(state.cyclotron){
      const history=cyclotronHistory(params,state.cyclotron);
      for(const arc of history)primitives.push({kind:'trajectory',points:arc.points.map(v=>deviceDiagramPoint(v.x,v.y)),strokeWidth:0.6});
      if(history.length)primitives.push({kind:'text',x:-0.25,y:-1.08,text:'细线：抽样历史圆弧；粗线：最近实际轨迹',align:'middle'});
    }
    primitives.push({kind:'trajectory',points:state.trail.slice(-121).map(p=>deviceDiagramPoint(p.x,p.y)),strokeWidth:1.5});
    if(state.cyclotron){
      const sign=Math.sign(state.cyclotron.rfVoltageV);
      if(Math.abs(state.cyclotron.rfVoltageV)>1e-6)primitives.push({kind:'arrow',x1:-0.25-sign*0.13,y1:0.94,x2:-0.25+sign*0.13,y2:0.94,label:'RF'});
    }
    const position=deviceDiagramPoint(state.particlePos.x,state.particlePos.y);
    primitives.push({kind:'circle',cx:position.x,cy:position.y,r:0.035,fill:true});
    primitives.push({kind:'text',x:0,y:-1.38,text:state.flight?flightReadout(state.flight):state.cyclotron?cyclotronReadout(params,state.cyclotron):isSensorDevice(params.device)?sensorReadout(state,params):'归一化原理示意（不按 SI 尺度）',align:'middle'});
    return {
      width: 680, height: 400, viewBox: { minX: -2.2, minY: -1.6, maxX: 2.2, maxY: 1.6 },
      title: '现代电磁器件原理配图', primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    if (!activeLayers.has('main')) return;
    ctx.save();
    const m = createWorldMapper(viewport);
    const diagram = getDeviceSchematic(params.device,params);

    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    const bRailTop = m.toScreen(1.28, 0.6);
    const bRailBottom = m.toScreen(1.28, -0.6);
    const eRailTop = m.toScreen(-1.65, 0.6);
    const eRailBottom = m.toScreen(-1.65, -0.6);
    ctx.beginPath();
    ctx.moveTo(bRailTop.x, bRailTop.y);
    ctx.lineTo(bRailBottom.x, bRailBottom.y);
    if(params.device==='velocity-selector'){ctx.moveTo(eRailTop.x,eRailTop.y);ctx.lineTo(eRailBottom.x,eRailBottom.y);}
    ctx.stroke();

    // All hardware outlines share the same normalized footprint as the spatial stage and exported diagram.
    for (const part of diagram.parts) {
      ctx.strokeStyle = part.material==='copper'?'#d97706':part.material==='glass'?'#64748b':'#94a3b8';
      ctx.fillStyle = part.material==='copper'?'rgba(217,119,6,0.18)':part.material==='glass'?'rgba(56,189,248,0.035)':'rgba(148,163,184,0.12)';
      ctx.lineWidth=2;
      ctx.beginPath();
      if (part.kind==='dee') {
        deeOutline(part).forEach((p,i)=>{const q=m.toScreen(p.x,p.y);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});
        ctx.closePath();
      } else {
        const corner=m.toScreen(part.x-part.width/2,part.y+part.height/2);
        ctx.rect(corner.x,corner.y,m.len(part.width),m.len(part.height));
      }
      ctx.fill();ctx.stroke();
    }
    for (const field of diagram.fields) {
      const point=m.toScreen(field.x,field.y),radius=Math.max(3,m.len(0.045));
      ctx.strokeStyle='#38bdf8';ctx.fillStyle='#38bdf8';ctx.lineWidth=1.25;
      ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.arc(point.x,point.y,1.5,0,Math.PI*2);ctx.fill();
    }
    for (const cue of diagram.cues) {
      const a=m.toScreen(cue.x,cue.y),b=m.toScreen(cue.x+cue.dx,cue.y+cue.dy);
      const angle=Math.atan2(b.y-a.y,b.x-a.x),size=8;
      ctx.strokeStyle=cue.kind==='electric'?'#fbbf24':'#4ade80';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      ctx.moveTo(b.x-size*Math.cos(angle-.45),b.y-size*Math.sin(angle-.45));ctx.lineTo(b.x,b.y);
      ctx.lineTo(b.x-size*Math.cos(angle+.45),b.y-size*Math.sin(angle+.45));ctx.stroke();
      ctx.font='600 12px system-ui, sans-serif';ctx.fillText(cue.label,(a.x+b.x)/2+6,(a.y+b.y)/2-8);
    }
    ctx.fillStyle='#94a3b8';ctx.font='12px system-ui, sans-serif';ctx.textAlign='center';
    for (const label of diagram.labels) { const p=m.toScreen(label.x,label.y);ctx.fillText(label.text,p.x,p.y); }
    ctx.textAlign='left';

    // RF arrow above the actual gap; direction from the current RF voltage.
    if(state.cyclotron){
      const sign=Math.sign(state.cyclotron.rfVoltageV),a=m.toScreen(-0.25-sign*0.14,CYCL_DISPLAY_RADIUS+0.12),b=m.toScreen(-0.25+sign*0.14,CYCL_DISPLAY_RADIUS+0.12);
      if(Math.abs(state.cyclotron.rfVoltageV)>1e-6){
        ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-sign*7,b.y-4);ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-sign*7,b.y+4);ctx.stroke();
      }
    }
    if(state.cyclotron){
      const history=cyclotronHistory(params,state.cyclotron);
      ctx.strokeStyle='rgba(251,191,36,0.46)';ctx.lineWidth=1.2;
      for(const arc of history){
        ctx.beginPath();arc.points.forEach((v,i)=>{const w=deviceDiagramPoint(v.x,v.y),q=m.toScreen(w.x,w.y);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();
      }
      if(history.length){const q=m.toScreen(-0.25,-1.08);ctx.textAlign='center';ctx.fillStyle='#cbd5e1';ctx.font='11px system-ui, sans-serif';ctx.fillText('浅色：抽样历史圆弧 · 亮色：最近实际轨迹',q.x,q.y);ctx.textAlign='left';}
    }
    // Draw particle trail & head
    if (state.trail.length > 1) {
      ctx.strokeStyle = state.cyclotron?'#ffd37a':'#38bdf8';
      ctx.lineWidth = state.cyclotron?2.8:2.4;
      if(state.cyclotron){ctx.shadowColor='#f59e0b';ctx.shadowBlur=5;}
      ctx.beginPath();
      state.trail.forEach((p, idx) => {
        const world = deviceDiagramPoint(p.x,p.y);
        const point = m.toScreen(world.x,world.y);
        const sx = point.x;
        const sy = point.y;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();ctx.shadowBlur=0;
    }
    ctx.fillStyle = state.cyclotron?'#fff1c7':params.device === 'hall-sensor' && params.carrierType === 'hole' ? '#f43f5e' : '#4ade80';
    ctx.beginPath();
    const world = deviceDiagramPoint(state.particlePos.x,state.particlePos.y);
    const particle = m.toScreen(world.x,world.y);
    ctx.arc(particle.x, particle.y, m.len(0.03), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px ui-sans-serif, system-ui';
    const summaryMap: Record<EmDevicesParams['device'], string> = {
      'velocity-selector': `速度选择器 v_sel = E/B = ${state.selectedSpeed.toFixed(0)} m/s`,
      'mass-spectrometer': `质谱仪偏转半径 R = ${state.spectrometerRadiusM.toExponential(3)} m`,
      'cyclotron': `当前 K=${((state.cyclotron?.energyJ??0)/1.602176634e-13).toFixed(3)} MeV · 理想经典上限 ${(state.cyclotronAnalyticalEnergyJ/1.602176634e-13).toFixed(3)} MeV`,
      'hall-sensor': `霍尔电压 U_H = ${(state.hallVoltageV * 1000).toFixed(4)} mV （下−上）`,
      'mhd-generator': `MHD ℰ=${state.mhdEmfV.toFixed(1)} V · P_R=${state.mhdOutputWatt.toFixed(0)} W`,
      'em-flowmeter': `电磁流量计 Q = ${state.flowRateM3ps.toExponential(3)} m³/s | U=${(state.flowVoltageV * 1000).toFixed(2)} mV`
    };
    ctx.textAlign = 'center';
    ctx.fillText(summaryMap[params.device], viewport.width * 0.5, 28);
    ctx.font='11px system-ui, sans-serif';ctx.fillStyle='#94a3b8';
    ctx.fillText(state.flight?flightReadout(state.flight):state.cyclotron?cyclotronReadout(params,state.cyclotron):sensorReadout(state,params)+' · 示意慢放', viewport.width * 0.5, 46);
    ctx.restore();
  },
  getControlHandles: (_state, params) => {
    const controlsDeflectionField = params.device === 'mass-spectrometer';
    const magneticMin = 0.2;
    const magneticMax = controlsDeflectionField ? 2 : 4;
    const magneticField = controlsDeflectionField ? params.bDeflectT : params.bFieldT;
    return [
      {
        id: 'device-b-field',
        label: `B=${magneticField.toFixed(1)} T`,
        position: { x: 1.28, y: -0.6 + ((magneticField - magneticMin) / (magneticMax - magneticMin)) * 1.2 },
        handleKind: 'point' as const,
        color: '#38bdf8',
        onDrag: (world: { x: number; y: number }): Record<string, number> => {
          const value = Number(Math.max(magneticMin, Math.min(magneticMax, Math.round((magneticMin + ((world.y + 0.6) / 1.2) * (magneticMax - magneticMin)) * 10) / 10)).toFixed(1));
          return controlsDeflectionField ? { bDeflectT: value } : { bFieldT: value };
        }
      },
      ...(params.device === 'velocity-selector' ? [{
        id: 'device-e-field',
        label: `E=${(params.eFieldVPerM / 1e5).toFixed(1)}×10⁵ V/m`,
        position: { x: -1.65, y: -0.6 + ((params.eFieldVPerM - 1e4) / 4.9e5) * 1.2 },
        handleKind: 'point' as const,
        color: '#fbbf24',
        onDrag: (world: { x: number; y: number }) => ({
          eFieldVPerM: Math.max(1e4, Math.min(5e5, Math.round((1e4 + ((world.y + 0.6) / 1.2) * 4.9e5) / 1e4) * 1e4))
        })
      }] : [])
    ];
  },
  getForceVectors: (state, params) => {
    if(state.cyclotron){
      if(state.cyclotron.status!=='running')return [];
      const v=state.cyclotron.velocityMps,q=Math.abs(params.chargeC),B=params.bFieldT;
      return [{id:'cyclotron-magnetic-force',label:'F洛=qv×B（盒内）',origin:deviceDiagramPoint(state.particlePos.x,state.particlePos.y),force:{x:q*B*v.y,y:-q*B*v.x},color:'#38bdf8',category:'magnetic',unit:'N'}];
    }
    if (!state.flight || state.flight.status !== 'flying' || state.flight.region==='entry') return [];
    // chargeC is a positive particle charge; carrierType is specific to the Hall sensor.
    const charge = Math.abs(params.chargeC);
    const field = params.device === 'mass-spectrometer' ? params.bDeflectT : params.bFieldT;
    const origin = deviceDiagramPoint(state.particlePos.x,state.particlePos.y);
    const v=state.flight.velocityMps;
    const magneticForce={x:charge*field*v.y,y:-charge*field*v.x};
    if (params.device === 'velocity-selector') {
      return [
        {
          id: 'selector-electric-force',
          label: 'F电=qE',
          origin,
          force: { x: 0, y: charge * params.eFieldVPerM },
          color: '#fbbf24',
          category: 'electric',
          unit: 'N'
        },
        {
          id: 'selector-magnetic-force',
          label: 'F洛=qv×B',
          origin,
          force: magneticForce,
          color: '#38bdf8',
          category: 'magnetic',
          unit: 'N'
        }
      ];
    }
    return [{
      id: 'spectrometer-magnetic-force',
      label: 'F洛=qv×B',
      origin,
      force: magneticForce,
      color: '#38bdf8',
      category: 'magnetic',
      unit: 'N'
    }];
  },
  referenceFrames: [{
    id: 'carrier-particle',
    label: '粒子/载流子随动参考系',
    getOrigin: (state) => ({ x: -0.25 + state.particlePos.x * 0.7, y: state.particlePos.y * 0.7 }),
    getVelocity: (state) => ({ x: state.particleVel.x * 0.7, y: state.particleVel.y * 0.7 })
  }],
  formatFormulas: (state, params) => {
    const id = 'em-devices-law';
    switch (params.device) {
      case 'velocity-selector': return [{ id, label: '正交电磁场速度选择条件',
        latex: 'v_s=E/B',
        substitutedLatex: `v_s=${scientificLatex(state.selectedSpeed)}\\text{ m/s}` }];
      case 'mass-spectrometer': return [{ id, label: '质谱仪偏转磁场回旋半径',
        latex: 'r=\\frac{mv}{|q|B_2}',
        substitutedLatex: `r=${scientificLatex(state.spectrometerRadiusM)}\\text{ m}` }];
      case 'cyclotron': return [{ id, label: '理想经典上限 / 当前动能 / 终止预测（有限装置）',
        latex: 'K_{\\mathrm{lim}}=\\frac{q^2B^2R^2}{2m},\\quad \\Delta K=qU\\cos\\phi',
        substitutedLatex: `\\begin{aligned}K_{\\mathrm{lim}}&=${scientificLatex(state.cyclotronAnalyticalEnergyJ)}\\text{ J},\\\\K_{\\mathrm{now}}&=${scientificLatex(state.cyclotron?.energyJ??0)}\\text{ J},\\\\K_{\\mathrm{end}}&=${scientificLatex(state.cyclotronMaxEnergyJ)}\\text{ J},\\\\\\phi&=${(state.cyclotron?.phaseSlip??0).toFixed(3)}\\text{ rad}\\end{aligned}` }];
      case 'hall-sensor': return [{ id, label: '霍尔电势差 U_H=V下−V上（载流子电荷含符号）',
        latex: 'U_H=\\frac{IB}{nq_cd}',
        substitutedLatex: `U_H=${scientificLatex(state.hallVoltageV * 1000)}\\text{ mV}` }];
      case 'mhd-generator': return [{ id, label: '磁流体发电机输出功率与实际负载端电压',
        latex: 'P_R=\\frac{(Bdv)^2R}{(R+r)^2},\\quad r=\\rho d/S',
        substitutedLatex: `\\begin{aligned}P_R&=${scientificLatex(state.mhdOutputWatt)}\\text{ W},\\\\r&=${state.mhdInternalOhm.toFixed(3)}\\ \\Omega,\\\\U_R&=${scientificLatex(state.mhdTerminalVoltageV)}\\text{ V},\\\\I_R&=${scientificLatex(state.mhdLoadCurrentA)}\\text{ A}\\end{aligned}` }];
      case 'em-flowmeter': return [{ id, label: '电磁流量计体积流量与开路电压 U=V下−V上',
        latex: 'Q=\\frac{\\pi D^2v}{4}=\\frac{\\pi DU}{4B}',
        substitutedLatex: `\\begin{aligned}Q&=${scientificLatex(state.flowRateM3ps)}\\text{ m}^3/\\text{s},\\\\U&=${scientificLatex(state.flowVoltageV)}\\text{ V}\\end{aligned}` }];
    }
  }
}), { storyDecks: emDevicesStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xz' as const, defaultVisibleHeight: 3.4, sceneDepthRadius: 4, default3DAzimuthRad: 0.6, default3DPolarRad: 0.9 } });

export default stseEmDevicesSuitePlugin;
