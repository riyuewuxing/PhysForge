import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { waveOpticsPresets } from './presets.js';
import { makeOpticsProfile, opticsReadout, makePattern } from './sceneGeometry.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepWaveOptics,
  type WaveOpticsParams,
  type WaveOpticsState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WaveOpticsParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '波动光学实验',
    defaultValue: 'thin-film-wedge',
    options: [
      { value: 'thin-film-wedge', label: '薄膜 / 空气劈尖等厚干涉' },
      { value: 'newtons-rings', label: '牛顿环同心等厚条纹' },
      { value: 'single-slit-grating', label: '夫琅禾费单缝/光栅衍射与缺级' }
    ]
  },
  { key: 'wavelengthNm', kind: 'number', label: '入射单色光波长 λ', unit: 'nm', min: 400, max: 700, step: 5, defaultValue: 589 },
  { key: 'refractiveIndexN2', kind: 'number', label: '薄膜折射率 n₂', unit: '', min: 1.0, max: 1.8, step: 0.05, defaultValue: 1.0 },
  { key: 'wedgeAngleDeg', kind: 'number', label: '劈尖夹角 α', unit: '°', min: 0, max: 0.03, step: 0.002, defaultValue: 0.012 },
  {
    key: 'defectMode',
    kind: 'select',
    label: '待测面微形貌缺陷',
    defaultValue: 'flat',
    options: [
      { value: 'flat', label: '理想光学平面' },
      { value: 'bump', label: '下表面微凸起（等厚点向厚端移动）' },
      { value: 'pit', label: '下表面微凹陷（等厚点向薄端移动）' }
    ]
  },
  { key: 'lensRadiusR', kind: 'number', label: '牛顿环透镜曲率半径 R', unit: 'm', min: 0.5, max: 5, step: 0.25, defaultValue: 2.0 },
  { key: 'slitWidthMicron', kind: 'number', label: '单缝宽度 a', unit: 'μm', min: 1, max: 12, step: 0.5, defaultValue: 4 },
  { key: 'gratingPitchMicron', kind: 'number', label: '光栅常数 d', unit: 'μm', min: 4, max: 30, step: 1, defaultValue: 12 },
  { key: 'slitCountN', kind: 'number', label: '相干狭缝数 N', unit: '条', min: 1, max: 12, step: 1, defaultValue: 6 },
  { key: 'halfWaveLoss', kind: 'boolean', label: '两反射束相对相移 π', defaultValue: true }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "wedge-fringe",
    "title": "劈尖等厚干涉（近法线，α>0）",
    "latex": "\\Delta x=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=wavelengthNm}{\\lambda}}}{2\\htmlClass{pf-live-var}{\\htmlData{param=refractiveIndexN2}{n}}\\tan \\htmlClass{pf-live-var}{\\htmlData{param=wedgeAngleDeg}{\\alpha}}}",
    "bindings": [
      {
        "tokenKey": "wavelengthNm",
        "paramKey": "wavelengthNm",
        "label": "入射单色光波长 λ",
        "unit": "nm",
        "min": 400,
        "max": 700,
        "step": 5,
        "precision": 1
      },
      {
        "tokenKey": "refractiveIndexN2",
        "paramKey": "refractiveIndexN2",
        "label": "薄膜折射率 n₂",
        "unit": "",
        "min": 1,
        "max": 1.8,
        "step": 0.05,
        "precision": 3
      },
      {
        "tokenKey": "wedgeAngleDeg",
        "paramKey": "wedgeAngleDeg",
        "label": "劈尖夹角 α",
        "unit": "°",
        "min": 0,
        "max": 0.03,
        "step": 0.002,
        "precision": 4
      }
    ],
    "when": {
      "mode": [
        "thin-film-wedge"
      ]
    }
  },
  {
    "id": "newton-ring-spacing",
    "title": "牛顿环相邻同类条纹半径平方差（薄膜近似）",
    "latex": "r_{j+1}^2-r_j^2\\simeq\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=wavelengthNm}{\\lambda}}\\htmlClass{pf-live-var}{\\htmlData{param=lensRadiusR}{R}}}{\\htmlClass{pf-live-var}{\\htmlData{param=refractiveIndexN2}{n}}}",
    "bindings": [
      {
        "tokenKey": "wavelengthNm",
        "paramKey": "wavelengthNm",
        "label": "入射单色光波长 λ",
        "unit": "nm",
        "min": 400,
        "max": 700,
        "step": 5,
        "precision": 0
      },
      {
        "tokenKey": "lensRadiusR",
        "paramKey": "lensRadiusR",
        "label": "牛顿环透镜曲率半径 R",
        "unit": "m",
        "min": 0.5,
        "max": 5,
        "step": 0.25,
        "precision": 2
      },
      {
        "tokenKey": "refractiveIndexN2",
        "paramKey": "refractiveIndexN2",
        "label": "薄膜折射率 n₂",
        "unit": "",
        "min": 1,
        "max": 1.8,
        "step": 0.05,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "newtons-rings"
      ]
    }
  },
  {
    "id": "single-slit-minimum",
    "title": "单缝远场衍射暗纹条件（m 为非零整数）",
    "latex": "\\htmlClass{pf-live-var}{\\htmlData{param=slitWidthMicron}{a}}\\sin\\theta=m\\htmlClass{pf-live-var}{\\htmlData{param=wavelengthNm}{\\lambda}}",
    "bindings": [
      {
        "tokenKey": "slitWidthMicron",
        "paramKey": "slitWidthMicron",
        "label": "单缝宽度 a",
        "unit": "μm",
        "min": 1,
        "max": 12,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "wavelengthNm",
        "paramKey": "wavelengthNm",
        "label": "入射单色光波长 λ",
        "unit": "nm",
        "min": 400,
        "max": 700,
        "step": 5,
        "precision": 0
      }
    ],
    "when": {
      "mode": [
        "single-slit-grating"
      ]
    }
  },
  {
    "id": "grating-principal-maximum",
    "title": "多缝相位同向条件（仅 d≥a）",
    "latex": "\\htmlClass{pf-live-var}{\\htmlData{param=gratingPitchMicron}{d}}\\sin\\theta=k\\htmlClass{pf-live-var}{\\htmlData{param=wavelengthNm}{\\lambda}}",
    "bindings": [
      {
        "tokenKey": "gratingPitchMicron",
        "paramKey": "gratingPitchMicron",
        "label": "光栅常数 d",
        "unit": "μm",
        "min": 4,
        "max": 30,
        "step": 1,
        "precision": 0
      },
      {
        "tokenKey": "wavelengthNm",
        "paramKey": "wavelengthNm",
        "label": "入射单色光波长 λ",
        "unit": "nm",
        "min": 400,
        "max": 700,
        "step": 5,
        "precision": 0
      }
    ],
    "when": {
      "mode": [
        "single-slit-grating"
      ],
      "slitCountN": [
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12
      ]
    }
  }
];
export const opticsWaveInterferencePlugin = Object.assign(defineSimulationPlugin<WaveOpticsParams, WaveOpticsState>({
  meta: {
    id: 'optics-wave-interference',
    title: '光的波动性进阶：劈尖、牛顿环与光栅缺级 (O01)',
    textbookRef: '人教版 选择性必修一 第四章 第4–6节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: waveOpticsPresets,
  defaultView:{scale:0.85},
  getParamFields:(p)=>paramSchema.filter(f=>['mode','wavelengthNm',...(p.mode==='thin-film-wedge'?['refractiveIndexN2','wedgeAngleDeg','defectMode','halfWaveLoss']:p.mode==='newtons-rings'?['refractiveIndexN2','lensRadiusR','halfWaveLoss']:['slitWidthMicron','slitCountN',...(p.slitCountN>1?['gratingPitchMicron']:[])])].includes(f.key)),
  engine: {
    createInitialState,
    step: stepWaveOptics,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'fringes', label: '波长示意色 · 归一化干涉/衍射图样', defaultVisible: true },
    { id: 'intensityCurve', label: '中心截面归一化光强 I/I₀', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'wedgeFringeSpacingMm', label: '劈尖条纹间距 Δx', unit: 'mm', color: '#38bdf8' },
    { key: 'newtonFirstDarkMm', label: '牛顿环第1暗环 r₁', unit: 'mm', color: '#fbbf24' },
    { key: 'missingOrderRatio', label: '节距宽度比 d/a', unit: '', color: '#f472b6' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'wavelength-tune',
      label: `λ=${params.wavelengthNm}nm`,
      position: { x: ((params.wavelengthNm - 550) / 150) * 1.6, y: -1.28 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({
        wavelengthNm: Math.round(Math.max(400, Math.min(700, 550 + (wp.x / 1.6) * 150)) / 5) * 5
      })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'optics-wave-interference',
      title: '波动光学干涉与衍射',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WaveOpticsParams>
  },
  exportDiagramIR: (state, params) => {
    const profile=makeOpticsProfile(params);
    const primitives:DiagramPrimitive[]=[
      {kind:'line',x1:-2,y1:0,x2:2,y2:0},
      {kind:'line',x1:-2,y1:0,x2:-2,y2:1},
      {kind:'text',x:-2,y:1.15,text:'I/I₀',align:'start'},
      {kind:'text',x:0,y:-.29,text:profile.axis,align:'middle'},
      {kind:'text',x:0,y:1.32,text:opticsReadout(state,params),align:'middle'}
    ];
    if(profile.points.length)primitives.push({kind:'polyline',points:profile.points.map(v=>({x:-2+4*v.u,y:v.intensity}))});
    for(const tick of profile.ticks)primitives.push({kind:'text',x:-2+4*tick.u,y:-.13,text:tick.label,align:'middle'});
    for(const mark of profile.marks)primitives.push({kind:'line',x1:-2+4*mark.u,y1:0,x2:-2+4*mark.u,y2:1,dashed:true});
    return {width:960,height:480,viewBox:{minX:-2.45,minY:-.48,maxX:2.45,maxY:1.55},title:'波动光学 · 中心截面光强',primitives};
  },
  renderCanvas: (ctx,state,p,viewport,layers)=>{
    const m=createWorldMapper(viewport),profile=makeOpticsProfile(p),labels:CanvasLabel[]=[];
    const projector=viewport.theme==='projector',ink=projector?'#1e293b':'#cbd5e1',accent=projector?'#075985':'#67e8f9';
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=1)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    };
    const label=(id:string,x:number,y:number,text:string,color=ink)=>{const q=m.toScreen(x,y);labels.push({id,x:q.x,y:q.y,text,color,font:'12px sans-serif'});};
    ctx.save();
    const isRing=p.mode==='newtons-rings',x0=isRing?-.69:-2,x1=isRing?.69:2,y0=isRing?.28:.35,y1=isRing?1.66:1.43;
    const a=m.toScreen(x0,y1),b=m.toScreen(x1,y0);
    const pattern=layers.has('fringes')?makePattern(p,state.rgbHex,(b.x-a.x)*viewport.dpr,(b.y-a.y)*viewport.dpr):undefined;
    if(pattern){
      ctx.drawImage(pattern,a.x,a.y,b.x-a.x,b.y-a.y);
      ctx.strokeStyle=projector?'#64748b':'#475569';ctx.lineWidth=1;ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
      if(isRing){label('ring-ruler',1.25,1.1,'视场半径 '+profile.max.toFixed(2)+' mm');label('ring-center',1.25,.75,p.halfWaveLoss?'中心暗':'中心亮');}
      else if(p.mode==='thin-film-wedge'){label('thin-end',-1.65,1.55,'薄端 x=0');label('thick-end',1.65,1.55,'厚端 x=20 mm');}
      else label('angle-domain',0,1.55,'远场角坐标 sinθ（非屏上距离）');
    }
    if(!profile.points.length)label('invalid',0,.84,'无有效几何 · 不生成光强',projector?'#991b1b':'#fca5a5');
    if(layers.has('intensityCurve')&&profile.points.length){
      const baseline=-.77,height=.76;
      line(-2,baseline,2,baseline,ink);line(-2,baseline,-2,baseline+height,ink);
      line(-2,baseline+height,2,baseline+height,projector?'#cbd5e1':'#334155');
      label('i1',-2.13,baseline+height,'1');label('i0',-2.13,baseline,'0');
      ctx.beginPath();
      for(let i=0;i<profile.points.length;i++){const v=profile.points[i]!;const q=m.toScreen(-2+4*v.u,baseline+height*v.intensity);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);}
      ctx.strokeStyle=accent;ctx.lineWidth=1.6;ctx.stroke();
      ctx.setLineDash([3,3]);for(const mark of profile.marks)line(-2+4*mark.u,baseline,-2+4*mark.u,baseline+height,projector?'#b45309':'#fbbf24');ctx.setLineDash([]);
      for(let i=0;i<profile.ticks.length;i++){const tick=profile.ticks[i]!;const x=-2+4*tick.u;line(x,baseline,x,baseline-.035,ink);label('tick-'+i,x,baseline-.11,tick.label);}
      label('axis',0,-1.06,profile.axis);label('readout',0,.16,opticsReadout(state,p),accent);
    }
    line(-1.6,-1.28,1.6,-1.28,projector?'#92400e':'#fbbf24',2);
    label('wavelength-control-rail',0,-1.47,'波长 λ='+p.wavelengthNm+' nm',projector?'#92400e':'#fbbf24');
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  formatFormulas: (state,p)=>{
    const m=state.metrics,phase=p.halfWaveLoss?'\\pi':'0';
    if(p.mode==='thin-film-wedge')return [{id:'wave-optics-eq',label:'近法线、等幅双束反射 · 远离缺陷的条纹间距',latex:'I/I_0=\\cos^2(2\\pi nh/\\lambda+\\delta/2)',substitutedLatex:m.wedgeSpacingMm===undefined?'\\alpha=0,\\quad \\Delta x\\text{ undefined}':'\\Delta x='+m.wedgeSpacingMm.toFixed(4)+'\\,\\mathrm{mm},\\quad \\delta='+phase}];
    if(p.mode==='newtons-rings')return [{id:'wave-optics-eq',label:'球面精确弓高 · 近法线双束反射',latex:'r_1=\\sqrt{2Rh_1-h_1^2},\\quad h_1=\\frac{\\lambda}{'+(p.halfWaveLoss?'2':'4')+'n}',substitutedLatex:m.newtonR1Mm===undefined?'r_1\\text{ undefined}':'r_1='+m.newtonR1Mm.toFixed(5)+'\\,\\mathrm{mm},\\quad \\delta='+phase}];
    return [{id:'wave-optics-eq',label:!m.gratingValid?'几何无效：d<a，不求光强':p.slitCountN===1?'单缝 · 无光栅级次':'夫琅禾费远场 · 缺级为两整数条件重合',latex:p.slitCountN===1?'I/I_0=(\\sin\\beta/\\beta)^2':'I/I_0=(\\sin\\beta/\\beta)^2(\\sin N\\gamma/(N\\sin\\gamma))^2',substitutedLatex:!m.gratingValid?'d<a':p.slitCountN===1?'N=1':('d/a='+m.missingOrder!.toFixed(3)+',\\quad k_{\\max}='+m.gratingMaxOrder)}];
  }
}), { liveFormulas });
export default opticsWaveInterferencePlugin;
