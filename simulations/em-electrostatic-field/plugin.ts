import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec, type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { electrostaticPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalPointChargePotentialAndField,
  extractElectrostaticIsolines,
  solveThreePointUniformField,
  stepElectrostatic,
  traceFieldLines,
  type ElectrostaticParams,
  type ElectrostaticState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ElectrostaticParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '静电场模型',
    defaultValue: 'dipole-point-charges',
    options: [
      { value: 'dipole-point-charges', label: '双点电荷叠加静电场' },
      { value: 'uniform-three-point', label: '匀强场三点等分求 E' },
      { value: 'deflection-tube', label: '先加速后偏转极板' }
    ]
  },
  { key: 'q1MicroC', kind: 'number', label: '源电荷 q₁', unit: 'μC', min: -5, max: 5, step: 0.5, defaultValue: 3 },
  { key: 'q2MicroC', kind: 'number', label: '源电荷 q₂', unit: 'μC', min: -5, max: 5, step: 0.5, defaultValue: -3 },
  { key: 'x1', kind: 'number', label: 'q₁ 位置 x₁', unit: 'm', min: -2.2, max: -0.3, step: 0.1, defaultValue: -1.2 },
  { key: 'x2', kind: 'number', label: 'q₂ 位置 x₂', unit: 'm', min: 0.3, max: 2.2, step: 0.1, defaultValue: 1.2 },
  { key: 'testChargeRatio', kind: 'number', label: '试探荷质比 q/m', unit: '', min: -2, max: 2, step: 0.2, defaultValue: 0.4 },
  { key: 'v0x', kind: 'number', label: '试探初速 vx₀', unit: 'm/s', min: -4, max: 5, step: 0.2, defaultValue: 2.2 },
  { key: 'v0y', kind: 'number', label: '试探初速 vy₀', unit: 'm/s', min: -3, max: 3, step: 0.2, defaultValue: 0.2 },
  { key: 'startY', kind: 'number', label: '试探入射高度 y₀', unit: 'm', min: -1.6, max: 1.6, step: 0.1, defaultValue: 0.9 },
  { key: 'uAccelV', kind: 'number', label: '加速电压 U₁', unit: 'V', min: 4, max: 32, step: 2, defaultValue: 16 },
  { key: 'uDeflectV', kind: 'number', label: '偏转电压 U₂', unit: 'V', min: -16, max: 16, step: 1, defaultValue: 8 },
  { key: 'phiA', kind: 'number', label: 'A点电势 φA', unit: 'V', min: -10, max: 10, step: 1, defaultValue: 0 },
  { key: 'phiB', kind: 'number', label: 'B点电势 φB', unit: 'V', min: -10, max: 12, step: 1, defaultValue: 4 },
  { key: 'phiC', kind: 'number', label: 'C点电势 φC', unit: 'V', min: -10, max: 20, step: 1, defaultValue: 12 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "two-charge-potential",
    "title": "软化点电荷归一化电势（无穷远零势）",
    "latex": "\\varphi^*=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=q1MicroC}{q_1^*}}}{\\sqrt{r_1^2+\\delta^2}}+\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=q2MicroC}{q_2^*}}}{\\sqrt{r_2^2+\\delta^2}}",
    "bindings": [
      {
        "tokenKey": "q1MicroC",
        "paramKey": "q1MicroC",
        "label": "源电荷 q₁",
        "unit": "μC",
        "min": -5,
        "max": 5,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "q2MicroC",
        "paramKey": "q2MicroC",
        "label": "源电荷 q₂",
        "unit": "μC",
        "min": -5,
        "max": 5,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "dipole-point-charges"
      ]
    }
  },
  {
    "id": "three-point-field",
    "title": "匀强电场三点电势差的两个线性约束",
    "latex": "\\begin{aligned}\\mathbf E\\cdot\\overrightarrow{AB}&=\\htmlClass{pf-live-var}{\\htmlData{param=phiA}{\\varphi_A}}-\\htmlClass{pf-live-var}{\\htmlData{param=phiB}{\\varphi_B}}\\\\\\mathbf E\\cdot\\overrightarrow{AC}&=\\varphi_A-\\htmlClass{pf-live-var}{\\htmlData{param=phiC}{\\varphi_C}}\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "phiA",
        "paramKey": "phiA",
        "label": "A点电势 φA",
        "unit": "V",
        "min": -10,
        "max": 10,
        "step": 1,
        "precision": 1
      },
      {
        "tokenKey": "phiB",
        "paramKey": "phiB",
        "label": "B点电势 φB",
        "unit": "V",
        "min": -10,
        "max": 12,
        "step": 1,
        "precision": 1
      },
      {
        "tokenKey": "phiC",
        "paramKey": "phiC",
        "label": "C点电势 φC",
        "unit": "V",
        "min": -10,
        "max": 20,
        "step": 1,
        "precision": 1
      }
    ],
    "when": {
      "mode": [
        "uniform-three-point"
      ]
    }
  },
  {
    "id": "deflection-acceleration",
    "title": "偏转极板内的横向加速度",
    "latex": "a_y=\\htmlClass{pf-live-var}{\\htmlData{param=testChargeRatio}{\\frac qm}}\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=uDeflectV}{U_2}}}{d}",
    "bindings": [
      {
        "tokenKey": "testChargeRatio",
        "paramKey": "testChargeRatio",
        "label": "试探荷质比 q/m",
        "unit": "",
        "min": -2,
        "max": 2,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "uDeflectV",
        "paramKey": "uDeflectV",
        "label": "偏转电压 U₂",
        "unit": "V",
        "min": -16,
        "max": 16,
        "step": 1,
        "precision": 1
      }
    ],
    "when": {
      "mode": [
        "deflection-tube"
      ]
    }
  }
];
// Static geometry is independent of simulation time and particle initial conditions.
let contourCache:{key:string;value:ReturnType<typeof extractElectrostaticIsolines>}|null=null;
let lineCache:{key:string;value:ReturnType<typeof traceFieldLines>}|null=null;
function fieldKey(p:ElectrostaticParams){
  return JSON.stringify(p.mode==='uniform-three-point'?[p.mode,p.phiA,p.phiB,p.phiC]:
    [p.mode,p.q1MicroC,p.q2MicroC,p.x1,p.x2]);
}
function contoursFor(p:ElectrostaticParams){
  const key=fieldKey(p);
  if(contourCache?.key!==key)contourCache={key,value:extractElectrostaticIsolines(p)};
  return contourCache.value;
}
function linesFor(p:ElectrostaticParams){
  const key=fieldKey(p);
  if(lineCache?.key!==key)lineCache={key,value:traceFieldLines(p)};
  return lineCache.value;
}
const allChannels:readonly TelemetryChannelSpec[]=[
  {key:'phi',label:'所在处电势 φ',unit:'V',color:'#fbbf24'},
  {key:'eMag',label:'场强大小 |E|',unit:'V/m',color:'#38bdf8'},
  {key:'ek',label:'动能（单位质量模型）',unit:'J',color:'#4ade80'},
  {key:'totalEnergy',label:'总能量 K+qφ',unit:'J',color:'#f472b6'},
  {key:'py',label:'有向偏转 y',unit:'m',color:'#38bdf8'},
  {key:'vy',label:'横向速度 vy',unit:'m/s',color:'#f472b6'},
  {key:'tubeWork',label:'板内电场功 W',unit:'J',color:'#fbbf24'}
];
export const emElectrostaticFieldPlugin = Object.assign(defineSimulationPlugin<ElectrostaticParams, ElectrostaticState>({
  meta: {
    id: 'em-electrostatic-field',
    title: '多点电荷静电场、等势面与粒子偏转 (E01)',
    textbookRef: '人教版 必修第三册 第九、十章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: p=>p.mode==='deflection-tube'?0.82:0.85, offsetRatioX: -0.04,offsetRatioY:-0.10 },
  paramSchema,
  getParamFields:p=>{
    const keys=p.mode==='dipole-point-charges'?['mode','q1MicroC','q2MicroC','testChargeRatio','x1','x2','v0x','v0y','startY']:
      p.mode==='uniform-three-point'?['mode','phiA','phiB','phiC','testChargeRatio','v0x','v0y','startY']:
      ['mode','uAccelV','uDeflectV','testChargeRatio'];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key).map(f=>f.key==='testChargeRatio'?
      {...f,label:p.mode==='dipole-point-charges'?'归一化荷质比 η':'荷质比 q/m',unit:p.mode==='dipole-point-charges'?'':'C/kg'}:f));
  },
  presets: electrostaticPresets,
  engine: {
    createInitialState,
    step: stepElectrostatic,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'equipotentials', label: '等势线（虚线）', defaultVisible: true },
    { id: 'fieldLines', label: '电场线及电场方向', defaultVisible: true },
    { id: 'particle', label: '试探粒子及轨迹', defaultVisible: true },
    { id: 'profileCurve', label: 'y=0.25 m 电势剖面', defaultVisible: true }
  ],
  telemetryChannels:allChannels,
  getTelemetryChannels:p=>{
    const keys=p.mode==='deflection-tube'?['py','vy','ek','tubeWork']:['phi','eMag','ek','totalEnergy'];
    return keys.flatMap(key=>allChannels.filter(c=>c.key===key).map(c=>p.mode==='dipole-point-charges'&&key==='phi'?{...c,label:'归一化电势 φ*',unit:'Φ₀'}:
      p.mode==='dipole-point-charges'&&key==='eMag'?{...c,label:'归一化场强 |E*|',unit:'E₀'}:c));
  },
  getForceVectors: (state, params) => {
    const obs = computeObservables(state, params);
    const fx = params.testChargeRatio * (obs.Ex ?? 0);
    const fy = params.testChargeRatio * (obs.Ey ?? 0);
    return [
      {
        id: 'electric-force',
        label: 'qE (m=1kg)',
        unit:'N',
        origin: { x: state.px, y: state.py },
        force: { x: fx, y: fy },
        category: 'electric',
        color: '#38bdf8'
      }
    ];
  },
  getControlHandles: (_s, params) =>
    params.mode === 'dipole-point-charges'
      ? [
          {
            id: 'q1-pos',
            label: `q₁=${params.q1MicroC}μC`,
            position: { x: params.x1, y: 0 },
            handleKind: 'point',
            color: params.q1MicroC >= 0 ? '#f43f5e' : '#38bdf8',
            onDrag: (wp) => ({ x1: Number(Math.max(-2.2, Math.min(-0.3, wp.x)).toFixed(1)) })
          },
          {
            id: 'q2-pos',
            label: `q₂=${params.q2MicroC}μC`,
            position: { x: params.x2, y: 0 },
            handleKind: 'point',
            color: params.q2MicroC >= 0 ? '#f43f5e' : '#38bdf8',
            onDrag: (wp) => ({ x2: Number(Math.max(0.3, Math.min(2.2, wp.x)).toFixed(1)) })
          }
        ]
      : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-electrostatic-field',
      title: '静电场与等势面偏转',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ElectrostaticParams>
  },
  exportDiagramIR:(state,params)=>{
    const primitives:DiagramPrimitive[]=[];
    if(params.mode==='dipole-point-charges'){
      for(const [x,q] of [[params.x1,params.q1MicroC],[params.x2,params.q2MicroC]] as const){
        primitives.push({kind:'circle',cx:x,cy:0,r:.10},
          {kind:'text',x,y:-.22,text:(q>0?'+':'')+q+' μC',align:'middle'});
      }
      for(const pts of linesFor(params)){
        primitives.push({kind:'polyline',points:pts});
        const k=Math.floor(pts.length/2),a=pts[Math.max(0,k-1)]!,b=pts[k]!;
        primitives.push({kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y});
      }
    }else if(params.mode==='uniform-three-point'){
      const sol=solveThreePointUniformField(params);
      primitives.push({kind:'polyline',points:[sol.A,sol.B,sol.C],closed:true});
      for(const [id,p] of [['A',sol.A],['B',sol.B],['C',sol.C]] as const)
        primitives.push({kind:'circle',cx:p.x,cy:p.y,r:.035,fill:true},{kind:'text',x:p.x,y:p.y+.14,text:id+' '+p.phi+' V'});
      if(sol.construction){const {start,end}=sol.construction;primitives.push({kind:'line',x1:start.x,y1:start.y,x2:end.x,y2:end.y,strokeWidth:2});}
      const norm=Math.hypot(sol.Ex,sol.Ey);
      if(norm>0)primitives.push({kind:'arrow',x1:0,y1:0,x2:sol.Ex/norm,y2:sol.Ey/norm,label:'E'});
      else primitives.push({kind:'text',x:0,y:1.5,text:'E = 0 · 全平面等势',align:'middle'});
    }else{
      for(const y of [-1,1])primitives.push({kind:'line',x1:-1,y1:y,x2:1,y2:y,strokeWidth:3});
      primitives.push({kind:'line',x1:-1.6,y1:0,x2:2.6,y2:0,dashed:true},
        {kind:'text',x:0,y:1.25,text:params.uDeflectV>0?'−':params.uDeflectV<0?'+':'0',align:'middle'},
        {kind:'text',x:0,y:-1.25,text:params.uDeflectV>0?'+':params.uDeflectV<0?'−':'0',align:'middle'});
      if(params.uDeflectV!==0)primitives.push({kind:'arrow',x1:0,y1:-.5*Math.sign(params.uDeflectV),x2:0,y2:.5*Math.sign(params.uDeflectV),label:'E'});
    }
    if(params.mode!=='deflection-tube')for(const c of contoursFor(params))for(const seg of c.segments)
      primitives.push({kind:'line',x1:seg.a.x,y1:seg.a.y,x2:seg.b.x,y2:seg.b.y,dashed:true});
    primitives.push({kind:'trajectory',points:state.trail,strokeWidth:2},{kind:'circle',cx:state.px,cy:state.py,r:.05,fill:true});
    const pts=[...state.trail,{x:state.px,y:state.py}];
    return {width:720,height:440,viewBox:{minX:Math.min(-3.4,...pts.map(p=>p.x-.2)),minY:Math.min(-2.4,...pts.map(p=>p.y-.2)),maxX:Math.max(3.4,...pts.map(p=>p.x+.2)),maxY:Math.max(2.4,...pts.map(p=>p.y+.2))},title:'静电场与粒子运动',primitives};
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const paper=viewport.theme==='projector';
    const ink=paper?'#0f172a':'#e2e8f0', guide=paper?'#64748b':'#94a3b8';
    const blue=paper?'#0369a1':'#38bdf8', gold=paper?'#92400e':'#fbbf24',green=paper?'#166534':'#4ade80';
    const arrow=(x1:number,y1:number,x2:number,y2:number,color:string,width=2)=>{
      const dx=x2-x1,dy=y2-y1,n=Math.hypot(dx,dy);if(n<1e-9)return;
      const ux=dx/n,uy=dy/n,h=Math.min(9,n*.45);
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-h*ux+h*.45*uy,y2-h*uy-h*.45*ux);ctx.lineTo(x2-h*ux-h*.45*uy,y2-h*uy+h*.45*ux);ctx.closePath();ctx.fill();
    };
    ctx.save();

    if (activeLayers.has('equipotentials') && params.mode !== 'deflection-tube') {
      const contours = contoursFor(params);
      ctx.strokeStyle = paper?'rgba(146,64,14,.65)':'rgba(251,191,36,.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      for (const c of contours) {
        ctx.beginPath();
        for (const seg of c.segments) {
          const a = m.toScreen(seg.a.x, seg.a.y);
          const b = m.toScreen(seg.b.x, seg.b.y);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (activeLayers.has('fieldLines')) {
      if (params.mode === 'dipole-point-charges') {
        const lines = linesFor(params);
        ctx.strokeStyle = paper?'rgba(3,105,161,.78)':'rgba(56,189,248,.65)';
        ctx.lineWidth = 1.5;
        for (const pts of lines) {
          if (pts.length < 2) continue;
          ctx.beginPath();
          const first = m.toScreen(pts[0]!.x, pts[0]!.y);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < pts.length; i++) {
            const point = m.toScreen(pts[i]!.x, pts[i]!.y);
            ctx.lineTo(point.x, point.y);
          }
          ctx.stroke();
          const k=Math.floor(pts.length/2),at=pts[k]!,field=evalPointChargePotentialAndField(at.x,at.y,params);
          const norm=Math.hypot(field.Ex,field.Ey);
          if(norm>1e-8){const p=m.toScreen(at.x,at.y),q=m.toScreen(at.x+.10*field.Ex/norm,at.y+.10*field.Ey/norm);arrow(p.x,p.y,q.x,q.y,blue,1.5);}
          ctx.strokeStyle=paper?'rgba(3,105,161,.78)':'rgba(56,189,248,.65)';ctx.lineWidth=1.5;
        }
      } else if (params.mode === 'uniform-three-point') {
        const sol = solveThreePointUniformField(params);
        const pts = [
          { ...sol.A, name: `A(${sol.A.phi}V)` },
          { ...sol.B, name: `B(${sol.B.phi}V)` },
          { ...sol.C, name: `C(${sol.C.phi}V)` }
        ];
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        const a = m.toScreen(sol.A.x, sol.A.y);
        const b = m.toScreen(sol.B.x, sol.B.y);
        const c = m.toScreen(sol.C.x, sol.C.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.stroke();

        if(sol.construction){
          const start=m.toScreen(sol.construction.start.x,sol.construction.start.y),end=m.toScreen(sol.construction.end.x,sol.construction.end.y);
          ctx.strokeStyle=gold;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();
          ctx.fillStyle=gold;ctx.beginPath();ctx.arc(end.x,end.y,3,0,Math.PI*2);ctx.fill();
          if(sol.construction.fraction>0&&sol.construction.fraction<1)labels.push({id:'equal-constructed',x:end.x,y:end.y+15,text:'D ('+sol.construction.start.phi+'V)',color:gold,font:'12px sans-serif'});
        }
        const eMag=Math.hypot(sol.Ex,sol.Ey);
        if(eMag>0){
          const a=m.toScreen(0,0),b=m.toScreen(1.1*sol.Ex/eMag,1.1*sol.Ey/eMag);
          arrow(a.x,a.y,b.x,b.y,blue,3);
          labels.push({id:'uniform-field-vector',x:b.x,y:b.y-12,text:'E = '+eMag.toFixed(2)+' V/m',color:blue,font:'13px sans-serif'});
        }else{
          const a=m.toScreen(0,1.5);labels.push({id:'zero-uniform',x:a.x,y:a.y,text:'E = 0 · 全平面等势',color:gold,font:'bold 14px sans-serif'});
        }
        for (const pt of pts) {
          const point = m.toScreen(pt.x, pt.y);
          ctx.fillStyle=ink;
          ctx.beginPath();
          ctx.arc(point.x, point.y, Math.max(3,m.len(0.025)), 0, Math.PI * 2);
          ctx.fill();
          labels.push({ id: `uniform-point-${pt.name[0]}`, x: point.x, y: point.y - m.len(0.1), text: pt.name, color: ink, font: '12px sans-serif' });
        }
      } else {
        // Parallel plates
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 4;
        const plateLeftTop = m.toScreen(-1.0, 1.0);
        const plateRightTop = m.toScreen(1.0, 1.0);
        const plateLeftBottom = m.toScreen(-1.0, -1.0);
        const plateRightBottom = m.toScreen(1.0, -1.0);
        ctx.beginPath();
        ctx.moveTo(plateLeftTop.x, plateLeftTop.y);
        ctx.lineTo(plateRightTop.x, plateRightTop.y);
        ctx.moveTo(plateLeftBottom.x, plateLeftBottom.y);
        ctx.lineTo(plateRightBottom.x, plateRightBottom.y);
        ctx.stroke();
        const sign=Math.sign(params.uDeflectV);
        const left=m.toScreen(-1,1),right=m.toScreen(1,-1);
        if(sign){
          ctx.fillStyle=paper?'rgba(3,105,161,.07)':'rgba(56,189,248,.09)';ctx.fillRect(left.x,left.y,right.x-left.x,right.y-left.y);
          for(let i=0;i<5;i++){
            const x=-.8+i*.4,a=m.toScreen(x,-.60*sign),b=m.toScreen(x,.60*sign);
            arrow(a.x,a.y,b.x,b.y,blue,1.4);
          }
        }
        for(const y of [-1,1]){
          const a=m.toScreen(-1,y),b=m.toScreen(1,y),c=y===sign?blue:y===-sign?gold:guide;
          ctx.strokeStyle=c;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
          const mid=m.toScreen(0,y);labels.push({id:'plate-'+y,x:mid.x,y:mid.y+(y>0?-15:15),text:sign===0?'0 V':y===sign?'− 极板':'+ 极板',color:c,font:'bold 13px sans-serif'});
        }
        const axisA=m.toScreen(-1.6,0),axisB=m.toScreen(2.7,0);
        ctx.strokeStyle=guide;ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(axisA.x,axisA.y);ctx.lineTo(axisB.x,axisB.y);ctx.stroke();ctx.setLineDash([]);
      }
    }

    if (params.mode === 'dipole-point-charges') {
      const drawCharge = (x: number, q: number, label: string) => {
        const color=q>0?(paper?'#be123c':'#fb7185'):q<0?blue:guide;
        ctx.fillStyle=color;
        const point = m.toScreen(x, 0);
        ctx.beginPath();
        const r=Math.max(5,m.len(.095));
        ctx.save();if(!paper&&q!==0){ctx.shadowColor=color;ctx.shadowBlur=14;}
        ctx.arc(point.x, point.y,r,0,Math.PI*2);ctx.fill();ctx.restore();
        ctx.fillStyle=paper?'#fff':'#0f172a';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 13px sans-serif';ctx.fillText(q>0?'+':q<0?'−':'0',point.x,point.y);ctx.textBaseline='alphabetic';
        labels.push({ id: `charge-${label}`, x: point.x, y: point.y + m.len(0.15), text: `${label}${q > 0 ? '+' : ''}${q} μC`, color: ink, font: 'bold 12px sans-serif' });
      };
      drawCharge(params.x1, params.q1MicroC, 'q₁=');
      drawCharge(params.x2, params.q2MicroC, 'q₂=');
    }

    if (activeLayers.has('particle')) {
      if (state.trail.length > 1) {
        ctx.strokeStyle = green;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        const first = m.toScreen(state.trail[0]!.x, state.trail[0]!.y);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < state.trail.length; i++) {
          const point = m.toScreen(state.trail[i]!.x, state.trail[i]!.y);
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
      const particle = m.toScreen(state.px, state.py);
      ctx.fillStyle = green;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(3,m.len(0.04)), 0, Math.PI * 2);
      ctx.fill();
    }

    if (activeLayers.has('profileCurve') && params.mode === 'dipole-point-charges') {
      // World-anchored inset respects pan/zoom; plot an honest range, not a clipped curve.
      const a=m.toScreen(-3.1,2.15),u=m.len(1.8)/200;
      ctx.save();ctx.translate(a.x,a.y);ctx.scale(u,u);
      const samples=Array.from({length:101},(_,i)=>evalPointChargePotentialAndField(-2.8+i*5.6/100,.25,params).phi);
      const max=Math.max(1,...samples.map(Math.abs));
      ctx.fillStyle=paper?'rgba(248,250,252,.96)':'rgba(15,23,42,.90)';ctx.strokeStyle=guide;ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(0,0,200,114,8);ctx.fill();ctx.stroke();
      ctx.fillStyle=ink;ctx.font='12px sans-serif';ctx.textAlign='left';ctx.fillText('φ* 剖面 · y=0.25 m',10,16);
      ctx.font='10px sans-serif';ctx.fillText(max.toFixed(2),6,32);ctx.fillText('−'+max.toFixed(2),6,94);
      ctx.strokeStyle=guide;ctx.beginPath();ctx.moveTo(32,27);ctx.lineTo(32,94);ctx.moveTo(32,60);ctx.lineTo(190,60);ctx.stroke();
      ctx.strokeStyle=gold;ctx.lineWidth=1.6;ctx.beginPath();
      samples.forEach((v,i)=>{const x=32+i*158/100,y=60-v/max*32;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
      ctx.fillStyle=ink;ctx.fillText('−2.8',31,106);ctx.textAlign='right';ctx.fillText('2.8 x/m',190,106);ctx.restore();
    }

    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas:(state,params)=>{
    const o=computeObservables(state,params);
    if(params.mode==='deflection-tube')return [
      {id:'tube-speed',label:'加速区出口速度（已完成加速）',latex:'v_x=\\sqrt{2|q/m|U_1}',substitutedLatex:'v_x='+state.vx.toFixed(3)+'\\,\\mathrm{m/s}'},
      {id:'tube-motion',label:'理想偏转区（未触板、非零荷质比）',latex:'y_{\\rm exit}=\\operatorname{sgn}(q/m)\\frac{U_2 L_p^2}{4dU_1}',substitutedLatex:state.tubePhase==='hit'?'\\text{plate contact: no exit}':o.yExit===undefined?'y='+state.py.toFixed(3)+'\\,\\mathrm m':'y_{\\rm exit}='+o.yExit.toFixed(3)+'\\,\\mathrm m'},
      {id:'tube-energy',label:'板内电场功—动能',latex:'K-K_0=W_E',substitutedLatex:'K='+o.ek!.toFixed(3)+',\\quad W_E='+state.tubeWork.toFixed(3)+'\\,\\mathrm J'}
    ];
    const normalized=params.mode==='dipole-point-charges';
    return [
      {id:'electrostatic-state',label:normalized?'归一化场强与电势（δ=0.01m）':'匀强场电势梯度',
        latex:normalized?'\\varphi^*=\\sum_i\\frac{q_i^*}{\\sqrt{r_i^2+\\delta^2}},\\quad\\mathbf E^*=-\\nabla\\varphi^*':'\\mathbf E=-\\nabla\\varphi',
        substitutedLatex:(normalized?'\\varphi^*=':'\\varphi=')+o.phi!.toFixed(3)+(normalized?'':'\\,\\mathrm V')+',\\quad '+(normalized?'|E^*|=':'|E|=')+o.eMag!.toFixed(3)+(normalized?'':'\\,\\mathrm{V/m}')},
      {id:'electrostatic-energy',label:'单位质量试探粒子能量守恒',
        latex:normalized?'K+\\eta\\varphi^*=\\mathrm{const}':'K+q\\varphi=\\mathrm{const}',substitutedLatex:'E_{\\rm tot}='+o.totalEnergy!.toFixed(4)+'\\,\\mathrm J'}
    ];
  }
}), { liveFormulas });

export default emElectrostaticFieldPlugin;
