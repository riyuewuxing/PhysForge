import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { degToRad } from '@physforge/physics-core';
import {
  createWorldMapper,
  defineSimulationPlugin,
  type Viewport,
  type DiagramPrimitive,
  type ParamFieldSpec
} from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepOptics,
  type OpticsParams,
  type OpticsState
} from './engine.js';

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };
type LabelBox = Point & { w: number; h: number };
type OpticalLabel = Point & { text: string; color: string; font: string };
const TIR_WINDOW = { halfWidth: 2.55, halfHeight: 2.42 };

function intersectsLabel(s: Segment, box: LabelBox): boolean {
  let lo=0,hi=1;
  for(const axis of ['x','y'] as const) {
    const half=(axis==='x'?box.w:box.h)/2+4;
    const min=box[axis]-half,max=box[axis]+half,delta=s.b[axis]-s.a[axis];
    if(Math.abs(delta)<1e-8) {
      if(s.a[axis]<min||s.a[axis]>max)return false;
    } else {
      const t1=(min-s.a[axis])/delta,t2=(max-s.a[axis])/delta;
      lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
      if(lo>hi)return false;
    }
  }
  return true;
}

/** Keep labels off real ray segments and the normal, at the current angle. */
function drawInterfaceLabels(ctx:CanvasRenderingContext2D,labels:OpticalLabel[],obstacles:Segment[],viewport:Viewport):void {
  const placed:LabelBox[]=[];
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowBlur=0;
  for(const label of labels) {
    ctx.font=label.font;
    const w=ctx.measureText(label.text).width+12,h=23;
    const box=(x:number,y:number):LabelBox=>({x:Math.max(w/2+8,Math.min(viewport.width-w/2-8,x)),y:Math.max(h/2+8,Math.min(viewport.height-h/2-8,y)),w,h});
    const candidates=[box(label.x,label.y)];
    for(let d=24;d<=120;d+=24) for(const [dx,dy] of [[0,-d],[0,d],[-d,0],[d,0],[-d,-d],[d,-d],[-d,d],[d,d]] as const) candidates.push(box(label.x+dx,label.y+dy));
    const found=candidates.find(b=>!obstacles.some(s=>intersectsLabel(s,b))&&!placed.some(q=>Math.abs(q.x-b.x)<(q.w+b.w)/2+4&&Math.abs(q.y-b.y)<(q.h+b.h)/2+4));
    const b=found??candidates[0]!;
    if(!found){
      // Text halo, not a conditional world-space rectangle.
      ctx.strokeStyle=viewport.theme==='projector'?'rgba(255,255,255,.98)':'rgba(12,17,23,.95)';
      ctx.lineWidth=4;ctx.lineJoin='round';ctx.strokeText(label.text,b.x,b.y);
    }
    ctx.fillStyle=label.color;ctx.fillText(label.text,b.x,b.y);placed.push(b);
  }
  ctx.restore();
}

function drawInterfaceRay(ctx:CanvasRenderingContext2D,from:Point,to:Point,color:string,intensity:number,incident:boolean,paper:boolean,scale:number):void {
  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);
  if(len<1e-6||intensity<=1e-12)return;
  const ux=dx/len,uy=dy/len,strength=Math.sqrt(Math.max(0,Math.min(1,intensity)));
  ctx.save();ctx.lineCap='round';ctx.strokeStyle=color;ctx.fillStyle=color;
  ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);
  // Perceptual compression: read the exact power fractions in the inspector.
  if(!paper){ctx.globalAlpha=.10+.18*strength;ctx.lineWidth=14*scale;ctx.shadowColor=color;ctx.shadowBlur=20*scale;ctx.stroke();}
  ctx.shadowBlur=0;ctx.globalAlpha=(paper ? .55 : .30)+(paper ? .45 : .70)*strength;
  ctx.lineWidth=(3+2*strength)*scale;ctx.stroke();
  const offset=incident?14*scale:0,tx=to.x-ux*offset,ty=to.y-uy*offset,head=12*scale,half=6.5*scale;
  ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-ux*head-uy*half,ty-uy*head+ux*half);ctx.lineTo(tx-ux*head+uy*half,ty-uy*head-ux*half);ctx.closePath();ctx.fill();ctx.restore();
}

/** Two half-spaces in a finite viewing window; no extra refracting walls. */
function renderTirInterface(ctx:CanvasRenderingContext2D,state:OpticsState,params:OpticsParams,viewport:Viewport,layers:ReadonlySet<string>):void {
  const m=createWorldMapper(viewport),p=m.toScreen(0,0),paper=viewport.theme==='projector';
  const warm=paper?'#92400e':'#fcd58b',reflected=paper?'#9a3412':'#e8ba76',cool=paper?'#075985':'#67e8f9';
  const textColor=paper?'#334155':'#c1dce9',normal=paper?'#64748b':'rgba(170,186,204,.72)';
  const scale=Math.max(.76,Math.min(1.2,viewport.height/850));
  const font='500 '+Math.round(17*scale)+'px system-ui, sans-serif';
  const labels:OpticalLabel[]=[],obstacles:Segment[]=[];
  const add=(text:string,color:string,x:number,y:number)=>labels.push({text,color,x,y,font});
  const left=m.toX(-TIR_WINDOW.halfWidth),right=m.toX(TIR_WINDOW.halfWidth),top=m.toY(TIR_WINDOW.halfHeight),bottom=m.toY(-TIR_WINDOW.halfHeight);
  ctx.save();
  if(layers.has('medium')) {
    const upper=ctx.createLinearGradient(0,top,0,p.y);
    upper.addColorStop(0,paper?'rgba(56,189,248,.045)':'rgba(70,139,188,.055)');
    upper.addColorStop(.48,paper?'rgba(56,189,248,.15)':'rgba(81,156,203,.21)');
    upper.addColorStop(1,paper?'rgba(56,189,248,.21)':'rgba(110,185,228,.31)');
    ctx.fillStyle=upper;
    ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(right,top);ctx.lineTo(right,p.y);ctx.lineTo(left,p.y);ctx.closePath();ctx.fill();
    const lower=ctx.createLinearGradient(0,p.y,0,bottom);
    lower.addColorStop(0,paper?'rgba(100,116,139,.075)':'rgba(112,138,167,.10)');lower.addColorStop(1,'rgba(100,116,139,0)');
    ctx.fillStyle=lower;
    ctx.beginPath();ctx.moveTo(left,p.y);ctx.lineTo(right,p.y);ctx.lineTo(right,bottom);ctx.lineTo(left,bottom);ctx.closePath();ctx.fill();
    ctx.strokeStyle=paper?'#64748b':'rgba(164,218,248,.73)';ctx.lineWidth=1.5;
    if(!paper){ctx.shadowColor='#78c9ec';ctx.shadowBlur=7;}
    ctx.beginPath();ctx.moveTo(left,p.y);ctx.lineTo(right,p.y);ctx.stroke();ctx.shadowBlur=0;
    obstacles.push({a:{x:left,y:p.y},b:{x:right,y:p.y}});
    add('介质 1 (n₁ = '+params.n1.toFixed(2)+')',textColor,right-120*scale,p.y-25*scale);
    add('介质 2 (n₂ = '+params.n2.toFixed(2)+')',textColor,right-120*scale,p.y+25*scale);
  }
  if(layers.has('normalLine')) {
    const a={x:p.x,y:m.toY(2.14)},b={x:p.x,y:m.toY(-2.14)};
    ctx.strokeStyle=normal;ctx.lineWidth=1.4;ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);obstacles.push({a,b});
    const radius=m.len(.49),theta1=degToRad(state.activeAngleDeg),a1=-Math.PI/2-theta1/2;
    ctx.strokeStyle=warm;ctx.lineWidth=1.6;
    if(theta1>1e-5){ctx.beginPath();ctx.arc(p.x,p.y,radius,-Math.PI/2-theta1,-Math.PI/2);ctx.stroke();}
    add('θ₁ = '+state.activeAngleDeg.toFixed(1)+'°',warm,p.x+(radius+32)*Math.cos(a1),p.y+(radius+32)*Math.sin(a1));
    if(state.refractedAngleDeg!==null) {
      const theta2=degToRad(state.refractedAngleDeg),a2=Math.PI/2-theta2/2;
      ctx.strokeStyle=cool;
      if(theta2>1e-5){ctx.beginPath();ctx.arc(p.x,p.y,radius,Math.PI/2-theta2,Math.PI/2);ctx.stroke();}
      add('θ₂ = '+state.refractedAngleDeg.toFixed(1)+'°',cool,p.x+(radius+33)*Math.cos(a2),p.y+(radius+33)*Math.sin(a2));
    }
  }
  if(layers.has('rays')) {
    for(const ray of state.rays) if(ray.intensity>1e-12) obstacles.push({a:m.toScreen(ray.from.x,ray.from.y),b:m.toScreen(ray.to.x,ray.to.y)});
    for(const ray of state.rays) {
      if(ray.intensity<=1e-12)continue;
      const a=m.toScreen(ray.from.x,ray.from.y),b=m.toScreen(ray.to.x,ray.to.y),incident=ray.label==='入射光',transmit=ray.label==='折射光';
      const color=incident?warm:transmit?cool:reflected;
      drawInterfaceRay(ctx,a,b,color,ray.intensity,incident,paper,scale);
      if(ray.label) {
        const end=incident?a:b,dx=end.x-p.x,dy=end.y-p.y,len=Math.hypot(dx,dy)||1,sign=incident?-1:transmit?-1:1;
        add(ray.label,color,p.x+dx*.72+sign*(-dy/len)*44*scale,p.y+dy*.72+sign*(dx/len)*44*scale);
      }
    }
    ctx.strokeStyle=warm;ctx.lineWidth=2.5;ctx.fillStyle=paper?'#fff':'#14191f';if(!paper){ctx.shadowColor=warm;ctx.shadowBlur=15;}
    ctx.beginPath();ctx.arc(p.x,p.y,10*scale,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  }
  drawInterfaceLabels(ctx,labels,obstacles,viewport);ctx.restore();
}

const paramSchema: readonly ParamFieldSpec<OpticsParams>[] = [
  {
    key: 'sceneMode',
    kind: 'select',
    label: '光学实验模式',
    options: [
      { label: '全反射与临界角实验', value: 'tir-interface' },
      { label: '平行玻璃砖侧移测折射率', value: 'parallel-slab' },
      { label: '三棱镜折射与色散光谱', value: 'prism-dispersion' },
      { label: '光导纤维全反射导光', value: 'optical-fiber' },
      { label: '双缝干涉条纹测定', value: 'double-slit' },
      { label: '理想薄凸透镜成像规律 (1/u+1/v=1/f)', value: 'thin-lens-imaging' }
    ],
    defaultValue: 'tir-interface'
  },
  {
    key: 'incidentAngleDeg',
    kind: 'number',
    label: '入射角 θ₁',
    unit: '°',
    min: 0,
    max: 85,
    step: 1,
    defaultValue: 35
  },
  {
    key: 'n1',
    kind: 'number',
    label: '介质 1 / 玻璃折射率 n₁',
    unit: '',
    min: 1.0,
    max: 2.2,
    step: 0.05,
    defaultValue: 1.5
  },
  {
    key: 'n2',
    kind: 'number',
    label: '介质 2 / 包层折射率 n₂',
    unit: '',
    min: 1.0,
    max: 2.0,
    step: 0.05,
    defaultValue: 1.0
  },
  {
    key: 'slabThickness',
    kind: 'number',
    label: '玻璃砖厚度 d',
    unit: 'm',
    min: 0.3,
    max: 1.8,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'prismApexDeg',
    kind: 'number',
    label: '三棱镜顶角 A',
    unit: '°',
    min: 30,
    max: 75,
    step: 5,
    defaultValue: 60
  },
  {
    key: 'fiberHalfWidth',
    kind: 'number',
    label: '光纤纤芯半宽',
    unit: 'm',
    min: 0.15,
    max: 0.6,
    step: 0.05,
    defaultValue: 0.3
  },
  {
    key: 'wavelengthNm',
    kind: 'number',
    label: '单色光波长 λ（双缝）',
    unit: 'nm',
    min: 400,
    max: 720,
    step: 10,
    defaultValue: 600
  },
  {
    key: 'slitSeparationMm',
    kind: 'number',
    label: '双缝间距 d（双缝）',
    unit: 'mm',
    min: 0.2,
    max: 1.5,
    step: 0.05,
    defaultValue: 0.5
  },
  {
    key: 'screenDistanceM',
    kind: 'number',
    label: '屏缝距离 L（双缝）',
    unit: 'm',
    min: 0.5,
    max: 3.0,
    step: 0.1,
    defaultValue: 1.5
  },
  {
    key: 'animateSweep',
    kind: 'boolean',
    label: '连续扫描入射角（运行模式）',
    defaultValue: true
  },
  {
    key: 'focalLengthM',
    kind: 'number',
    label: '薄透镜焦距 f',
    unit: 'm',
    min: 0.3,
    max: 1.5,
    step: 0.05,
    defaultValue: 0.65
  },
  {
    key: 'objectDistanceM',
    kind: 'number',
    label: '物距 u（薄透镜）',
    unit: 'm',
    min: 0.25,
    max: 2.5,
    step: 0.05,
    defaultValue: 1.2
  }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "snell",
    "title": "折射定律（存在传播折射光）",
    "latex": "\\htmlClass{pf-live-var}{\\htmlData{param=n1}{n_1}}\\sin \\htmlClass{pf-live-var}{\\htmlData{param=incidentAngleDeg}{\\theta_1}}=\\htmlClass{pf-live-var}{\\htmlData{param=n2}{n_2}}\\sin\\theta_2",
    "bindings": [
      {
        "tokenKey": "n1",
        "paramKey": "n1",
        "label": "介质 1 / 玻璃折射率 n₁",
        "unit": "",
        "min": 1,
        "max": 2.2,
        "step": 0.05,
        "precision": 3
      },
      {
        "tokenKey": "incidentAngleDeg",
        "paramKey": "incidentAngleDeg",
        "label": "入射角 θ₁",
        "unit": "°",
        "min": 0,
        "max": 85,
        "step": 1,
        "precision": 1
      },
      {
        "tokenKey": "n2",
        "paramKey": "n2",
        "label": "介质 2 / 包层折射率 n₂",
        "unit": "",
        "min": 1,
        "max": 2,
        "step": 0.05,
        "precision": 3
      }
    ],
    "when": {
      "sceneMode": [
        "tir-interface"
      ]
    }
  },
  {
    "id": "slab-snell",
    "title": "平行玻璃砖第一界面（空气射入玻璃）",
    "latex": "\\sin \\htmlClass{pf-live-var}{\\htmlData{param=incidentAngleDeg}{\\theta_1}}=\\htmlClass{pf-live-var}{\\htmlData{param=n1}{n_{\\rm glass}}}\\sin\\theta_2",
    "bindings": [
      {
        "tokenKey": "incidentAngleDeg",
        "paramKey": "incidentAngleDeg",
        "label": "入射角 θ₁",
        "unit": "°",
        "min": 0,
        "max": 85,
        "step": 1,
        "precision": 0
      },
      {
        "tokenKey": "n1",
        "paramKey": "n1",
        "label": "介质 1 折射率 n₁",
        "unit": "",
        "min": 1,
        "max": 2.2,
        "step": 0.05,
        "precision": 2
      }
    ],
    "when": {
      "sceneMode": [
        "parallel-slab"
      ]
    }
  },
  {
    "id": "slab-offset",
    "title": "玻璃砖出射光线的侧移量",
    "latex": "\\Delta x=\\htmlClass{pf-live-var}{\\htmlData{param=slabThickness}{d}}\\frac{\\sin(\\theta_1-\\theta_2)}{\\cos\\theta_2}",
    "bindings": [
      {
        "tokenKey": "slabThickness",
        "paramKey": "slabThickness",
        "label": "玻璃砖厚度 d",
        "unit": "m",
        "min": 0.3,
        "max": 1.8,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "sceneMode": [
        "parallel-slab"
      ]
    }
  },
  {
    "id": "prism-apex",
    "title": "三棱镜内的两次折射角（光线从两腰穿过时）",
    "latex": "r_1+r_2=\\htmlClass{pf-live-var}{\\htmlData{param=prismApexDeg}{A}}",
    "bindings": [
      {
        "tokenKey": "prismApexDeg",
        "paramKey": "prismApexDeg",
        "label": "三棱镜顶角 A",
        "unit": "°",
        "min": 30,
        "max": 75,
        "step": 5,
        "precision": 0
      }
    ],
    "when": {
      "sceneMode": [
        "prism-dispersion"
      ]
    }
  },
  {
    "id": "fiber-critical-angle",
    "title": "纤芯/包层有效折射率（模型限制 n包<n芯）",
    "latex": "\\sin C=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=n2}{n_{\\rm clad}}}}{\\htmlClass{pf-live-var}{\\htmlData{param=n1}{n_{\\rm core}}}}",
    "bindings": [
      {
        "tokenKey": "n2",
        "paramKey": "n2",
        "label": "介质 2 折射率 n₂",
        "unit": "",
        "min": 1,
        "max": 2,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "n1",
        "paramKey": "n1",
        "label": "介质 1 折射率 n₁",
        "unit": "",
        "min": 1,
        "max": 2.2,
        "step": 0.05,
        "precision": 2
      }
    ],
    "when": {
      "sceneMode": [
        "optical-fiber"
      ]
    }
  },
  {
    "id": "young-fringe-spacing",
    "title": "双缝干涉近轴相邻同类条纹间距",
    "latex": "\\Delta x=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=screenDistanceM}{L}}\\htmlClass{pf-live-var}{\\htmlData{param=wavelengthNm}{\\lambda}}}{\\htmlClass{pf-live-var}{\\htmlData{param=slitSeparationMm}{d}}}",
    "bindings": [
      {
        "tokenKey": "screenDistanceM",
        "paramKey": "screenDistanceM",
        "label": "屏到双缝距离 L",
        "unit": "m",
        "min": 0.5,
        "max": 3,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "wavelengthNm",
        "paramKey": "wavelengthNm",
        "label": "入射光波长 λ",
        "unit": "nm",
        "min": 400,
        "max": 720,
        "step": 10,
        "precision": 0
      },
      {
        "tokenKey": "slitSeparationMm",
        "paramKey": "slitSeparationMm",
        "label": "双缝间距 d",
        "unit": "mm",
        "min": 0.2,
        "max": 1.5,
        "step": 0.05,
        "precision": 2
      }
    ],
    "when": {
      "sceneMode": [
        "double-slit"
      ]
    }
  },
  {
    "id": "thin-lens",
    "title": "理想薄凸透镜成像（虚像像距取负）",
    "latex": "\\frac1{\\htmlClass{pf-live-var}{\\htmlData{param=objectDistanceM}{u}}}+\\frac1v=\\frac1{\\htmlClass{pf-live-var}{\\htmlData{param=focalLengthM}{f}}}",
    "bindings": [
      {
        "tokenKey": "objectDistanceM",
        "paramKey": "objectDistanceM",
        "label": "物距 u",
        "unit": "m",
        "min": 0.25,
        "max": 2.5,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "focalLengthM",
        "paramKey": "focalLengthM",
        "label": "凸透镜焦距 f",
        "unit": "m",
        "min": 0.3,
        "max": 1.5,
        "step": 0.05,
        "precision": 2
      }
    ],
    "when": {
      "sceneMode": [
        "thin-lens-imaging"
      ]
    }
  }
];
export const opticsRayStudioPlugin = Object.assign(defineSimulationPlugin<OpticsParams, OpticsState>({
  meta: {
    id: 'builder-optics-ray',
    title: '自由几何光学与波动光学建模器 (B3)',
    textbookRef: '人教版 选择性必修一 第四章 第1–4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: {
    scale: (params,{width,height}) => {
      if(params.sceneMode!=='tir-interface')return 1;
      const base=Math.min(width,height)*.24,usable=width-(width>=900?300:0);
      return Math.max(.1,Math.min(1.3,(usable-30)/(2*TIR_WINDOW.halfWidth*base),(height-84)/(2*TIR_WINDOW.halfHeight*base)));
    },
    offsetRatioX: (params,{width}) => params.sceneMode==='tir-interface'?(width-(width>=900?280:0))/(2*width)-.45:0,
    offsetRatioY: (params) => params.sceneMode==='tir-interface'?-.025:0
  },
  getControlHandles: (state, params) => {
    if (params.sceneMode === 'thin-lens-imaging') {
      const u = params.objectDistanceM ?? 1.2;
      return [
        {
          id: 'object-distance',
          label: `物距 u=${u.toFixed(2)}m`,
          position: { x: -u, y: 0.55 },
          handleKind: 'point',
          color: '#fbbf24',
          onDrag: (wp) => ({
            objectDistanceM: Number(Math.max(0.25, Math.min(2.5, -wp.x)).toFixed(2))
          })
        }
      ];
    }
    const rad = degToRad(state.activeAngleDeg);
    return [
      {
        id: 'incident-angle',
        label: `θ₁=${state.activeAngleDeg.toFixed(0)}°`,
        position: { x: 0, y: 0 },
        handleKind: 'angle',
        color: '#fbbf24',
        showWhenIdle: false,
        onDrag: (wp) => {
          const ang = Math.max(0, Math.min(85, Math.round((Math.atan2(-wp.x, Math.max(0.05, wp.y)) * 180) / Math.PI)));
          return { incidentAngleDeg: ang, animateSweep: false };
        }
      }
    ];
  },
  sceneSerializer: {
    exportScene: (_state, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-optics-ray',
      title: '几何光学画板场景',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<OpticsParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.6, y1: 0, x2: 2.6, y2: 0, dashed: params.sceneMode === 'thin-lens-imaging' }
    ];
    if (params.sceneMode === 'tir-interface') {
      primitives.push({ kind: 'line', x1: 0, y1: -1.8, x2: 0, y2: 1.8, dashed: true });
      primitives.push({
        kind: 'arcAngle',
        cx: 0,
        cy: 0,
        r: 0.55,
        startAngle: Math.PI / 2,
        endAngle: Math.PI / 2 + degToRad(state.activeAngleDeg),
        label: `θ_1=${state.activeAngleDeg.toFixed(1)}°`
      });
      if(state.refractedAngleDeg!==null) primitives.push({
        kind:'arcAngle',cx:0,cy:0,r:.55,startAngle:-Math.PI/2,endAngle:-Math.PI/2+degToRad(state.refractedAngleDeg),
        label:`θ_2=${state.refractedAngleDeg.toFixed(1)}°`
      });
    } else if (params.sceneMode === 'thin-lens-imaging') {
      primitives.push({ kind: 'line', x1: 0, y1: -1.2, x2: 0, y2: 1.2, strokeWidth: 2 });
      const u = params.objectDistanceM ?? 1.2;
      primitives.push({ kind: 'arrow', x1: -u, y1: 0, x2: -u, y2: 0.55, label: '物' });
    }
    for (const r of state.rays) {
      primitives.push({ kind: 'arrow', x1: r.from.x, y1: r.from.y, x2: r.to.x, y2: r.to.y, dashed: r.dashed, label: r.label });
    }
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -2.8, minY: -1.9, maxX: 2.8, maxY: 1.9 },
      title: '几何光学与折射全反射光路图',
      primitives
    };
  },
  paramSchema,
  presets: [
    {
      id: 'tir-water-air',
      name: '1. 全反射与临界角扫描（光密→光疏）',
      description: '光线由折射率 1.5 玻璃射向空气，运行即自动扫描入射角至突破临界角 C = 41.8° 触发 100% 全反射。',
      params: {
        sceneMode: 'tir-interface',
        incidentAngleDeg: 35,
        n1: 1.5,
        n2: 1.0,
        animateSweep: true
      }
    },
    {
      id: 'parallel-glass-slab',
      name: '2. 平行玻璃砖侧移测折射率',
      description: '验证经过两平行折射面后出射光与入射光严格平行，并量化侧移距离 Δx。',
      params: {
        sceneMode: 'parallel-slab',
        incidentAngleDeg: 50,
        n1: 1.5,
        slabThickness: 1.0,
        animateSweep: false
      }
    },
    {
      id: 'prism-dispersion',
      name: '3. 三棱镜对复色光的色散',
      description: '白光经过等腰三棱镜两次折射后，紫光折射率最大偏折角最大、红光偏折最小，形成彩色光谱。',
      params: {
        sceneMode: 'prism-dispersion',
        incidentAngleDeg: 45,
        n1: 1.52,
        prismApexDeg: 60,
        animateSweep: false
      }
    },
    {
      id: 'optical-fiber',
      name: '4. 光导纤维内部全反射传导',
      description: '高折射率纤芯（n₁=1.6）包裹低折射率包层（n₂=1.4），演示小角度入射光在纤维内连续全反射向前传输。',
      params: {
        sceneMode: 'optical-fiber',
        incidentAngleDeg: 22,
        n1: 1.6,
        n2: 1.4,
        fiberHalfWidth: 0.3,
        animateSweep: false
      }
    },
    {
      id: 'double-slit-interference',
      name: '5. 双缝干涉条纹与波长测量',
      description: '改变单色光波长 λ、缝距 d 与屏距 L，实时观测明暗相间等距条纹及中心光强分布曲线。',
      params: {
        sceneMode: 'double-slit',
        wavelengthNm: 600,
        slitSeparationMm: 0.5,
        screenDistanceM: 1.5,
        animateSweep: false
      }
    },
    {
      id: 'thin-lens-real-image',
      name: '6. 薄凸透镜成倒立实像 (u > 2f)',
      description: '验证高斯成像公式 1/u + 1/v = 1/f，拖动左侧物矢即可连续观察实像/虚像转换。',
      params: {
        sceneMode: 'thin-lens-imaging',
        focalLengthM: 0.65,
        objectDistanceM: 1.5,
        animateSweep: false
      }
    }
  ],
  engine: {
    createInitialState,
    step: stepOptics,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'medium', label: '光学介质与几何轮廓', defaultVisible: true },
    { id: 'normalLine', label: '界面法线与角度标识', defaultVisible: true },
    { id: 'rays', label: '光路射线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'incidentAngleDeg', label: '入射角 θ₁', unit: '°', color: '#fbbf24' },
    { key: 'refractedAngleDeg', label: '折射角 θ₂', unit: '°', color: '#38bdf8' },
    { key: 'lateralShift', label: '玻璃砖侧移 Δx', unit: 'm', color: '#4ade80' },
    { key: 'fringeSpacingMm', label: '条纹间距 Δx', unit: 'mm', color: '#f472b6' }
  ],
  formatFormulas: (state, params) => {
    if (params.sceneMode === 'double-slit') {
      return [
        {
          id: 'double-slit-eq',
          label: '双缝干涉条纹间距公式',
          latex: '\\Delta x = \\frac{L}{d}\\lambda',
          substitutedLatex: `\\Delta x = \\frac{${params.screenDistanceM.toFixed(2)}}{${params.slitSeparationMm.toFixed(2)}\\text{ mm}} \\times ${params.wavelengthNm}\\text{ nm} = ${state.fringeSpacingMm.toFixed(2)}\\text{ mm}`
        }
      ];
    }
    if (params.sceneMode === 'parallel-slab') {
      return [
        {
          id: 'slab-eq',
          label: '平行玻璃砖侧移公式',
          latex: '\\Delta x = d\\frac{\\sin(\\theta_1 - \\theta_2)}{\\cos\\theta_2}',
          substitutedLatex: `\\theta_1 = ${state.activeAngleDeg.toFixed(1)}^\\circ,\\; \\theta_2 = ${(state.refractedAngleDeg ?? 0).toFixed(1)}^\\circ,\\; \\Delta x = ${state.lateralShift.toFixed(3)}\\text{ m}`
        }
      ];
    }
    if (params.sceneMode === 'tir-interface') {
      const c=state.criticalAngleDeg;
      const critical=c===null?'':'\\\\ \\sin C=\\frac{n_2}{n_1}';
      const base=state.isTotalInternalReflection?'\\theta_1\\ge C,\\quad R=1':'n_1\\sin\\theta_1=n_2\\sin\\theta_2';
      const result=state.refractedAngleDeg===null?'\\text{无传播折射光}':'\\theta_2='+state.refractedAngleDeg.toFixed(1)+'^\\circ';
      return [{id:'snell-eq',label:'无吸收介质界面（临界角仅 n₁>n₂）',
        latex:'\\begin{gathered}'+base+critical+'\\end{gathered}',
        substitutedLatex:'\\begin{gathered}\\theta_1='+state.activeAngleDeg.toFixed(1)+'^\\circ\\\\'+result+(c===null?'':'\\\\ C='+c.toFixed(1)+'^\\circ')+'\\end{gathered}'}];
    }
    const critStr =
      state.criticalAngleDeg !== null ? `${state.criticalAngleDeg.toFixed(1)}^\\circ` : '\\text{无}';
    return [
      {
        id: 'snell-eq',
        label: '斯涅尔折射定律与全反射临界角',
        latex: '\\begin{aligned}n_1 \\sin\\theta_1 &= n_2 \\sin\\theta_2 \\\\ \\sin C &= \\frac{n_2}{n_1}\\end{aligned}',
        substitutedLatex: `\\theta_1 = ${state.activeAngleDeg.toFixed(1)}^\\circ,\\; C = ${critStr},\\; ${
          state.isTotalInternalReflection ? '\\text{已全反射}' : `\\theta_2 = ${(state.refractedAngleDeg ?? 0).toFixed(1)}^\\circ`
        }`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    if(params.sceneMode==='tir-interface'){renderTirInterface(ctx,state,params,viewport,activeLayers);return;}
    const m = createWorldMapper(viewport);
    const basePpm = Math.min(viewport.width, viewport.height) * 0.24;
    const toScreen = (wx: number, wy: number) => {
      const point = m.toScreen(wx, wy);
      return { sx: point.x, sy: point.y };
    };

    if (params.sceneMode === 'double-slit') {
      // 双缝干涉专属屏面渲染
      const barrierX = m.toX(-1.5);
      const screenX = m.toX(1.6);
      const midY = m.toY(0);
      const slitGap = Math.max(14, params.slitSeparationMm * 28) / basePpm;
      const slitHalfWidth = 5 / basePpm;
      const worldYExtent = Math.max(0.1, viewport.height * 0.5 - 40) / basePpm;
      const sampleCount = Math.ceil((worldYExtent * 2 * basePpm) / 2);

      ctx.save();
      // 挡板与双缝
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(barrierX, m.toY(worldYExtent));
      ctx.lineTo(barrierX, m.toY(slitGap + slitHalfWidth));
      ctx.moveTo(barrierX, m.toY(slitGap - slitHalfWidth));
      ctx.lineTo(barrierX, m.toY(-slitGap + slitHalfWidth));
      ctx.moveTo(barrierX, m.toY(-slitGap - slitHalfWidth));
      ctx.lineTo(barrierX, m.toY(-worldYExtent));
      ctx.stroke();

      // 光屏干涉明暗条纹与右侧光强分布曲线
      const wavelengthColor =
        params.wavelengthNm < 490
          ? '#60a5fa'
          : params.wavelengthNm < 570
            ? '#4ade80'
            : params.wavelengthNm < 605
              ? '#fbbf24'
              : '#f87171';

      const spacingPx = Math.max(8, state.fringeSpacingMm * 22);

      for (let i = 0; i <= sampleCount; i += 1) {
        const worldY = worldYExtent - (i * 2) / basePpm;
        const intensity = Math.pow(Math.cos((Math.PI * worldY * basePpm) / spacingPx), 2);
        ctx.fillStyle = wavelengthColor;
        ctx.globalAlpha = 0.08 + 0.92 * intensity;
        ctx.fillRect(m.toX(1.6 - 10 / basePpm), m.toY(worldY), m.len(20 / basePpm), m.len(2.5 / basePpm));
      }
      ctx.globalAlpha = 1;

      // 光强曲线 I(y)
      ctx.strokeStyle = wavelengthColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= sampleCount; i += 1) {
        const worldY = worldYExtent - (i * 2) / basePpm;
        const intensity = Math.pow(Math.cos((Math.PI * worldY * basePpm) / spacingPx), 2);
        const ix = m.toX(1.6 + (24 + intensity * 120) / basePpm);
        const iy = m.toY(worldY);
        if (i === 0) ctx.moveTo(ix, iy);
        else ctx.lineTo(ix, iy);
      }
      ctx.stroke();

      // 示例相干路径线
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      for (const slitY of [-slitGap, slitGap]) {
        const sourceY = m.toY(slitY);
        ctx.beginPath();
        ctx.moveTo(barrierX, sourceY);
        ctx.lineTo(screenX, midY);
        ctx.moveTo(barrierX, sourceY);
        ctx.lineTo(screenX, m.toY(spacingPx / basePpm));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(
        `条纹间距 Δx = ${state.fringeSpacingMm.toFixed(2)} mm`,
        m.toX(1.6 - 10 / basePpm),
        m.toY((viewport.height * 0.5 - 26) / basePpm)
      );
      ctx.restore();
      return;
    }

    // 1. 绘制介质边界
    if (activeLayers.has('medium')) {
      ctx.save();
      if (params.sceneMode === 'parallel-slab') {
        const d = params.slabThickness;
        const tl = toScreen(-2.2, 0.5 * d);
        const br = toScreen(2.2, -0.5 * d);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      } else if (params.sceneMode === 'prism-dispersion') {
        const halfA = 0.5 * degToRad(params.prismApexDeg);
        const h = 1.6;
        const halfBase = h * Math.tan(halfA);
        const pTop = toScreen(0, 0.6 * h);
        const pL = toScreen(-halfBase, -0.4 * h);
        const pR = toScreen(halfBase, -0.4 * h);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pTop.sx, pTop.sy);
        ctx.lineTo(pL.sx, pL.sy);
        ctx.lineTo(pR.sx, pR.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (params.sceneMode === 'optical-fiber') {
        const hw = params.fiberHalfWidth;
        const tl = toScreen(-2.4, hw);
        const br = toScreen(2.4, -hw);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.fillRect(tl.sx, tl.sy - 16, br.sx - tl.sx, br.sy - tl.sy + 32);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      } else if (params.sceneMode === 'thin-lens-imaging') {
        const axisL = toScreen(-2.8, 0);
        const axisR = toScreen(2.8, 0);
        const lensTop = toScreen(0, 1.3);
        const lensBot = toScreen(0, -1.3);
        ctx.strokeStyle = '#94a3b8';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(axisL.sx, axisL.sy);
        ctx.lineTo(axisR.sx, axisR.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lensTop.sx, lensTop.sy);
        ctx.lineTo(lensBot.sx, lensBot.sy);
        ctx.stroke();
        const f = params.focalLengthM ?? 0.65;
        const u = params.objectDistanceM ?? 1.2;
        const fL = toScreen(-f, 0);
        const fR = toScreen(f, 0);
        ctx.fillStyle = '#38bdf8';
        for (const fp of [fL, fR]) {
          ctx.beginPath();
          ctx.arc(fp.sx, fp.sy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        const oB = toScreen(-u, 0);
        const oT = toScreen(-u, 0.55);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(oB.sx, oB.sy);
        ctx.lineTo(oT.sx, oT.sy);
        ctx.stroke();
        if (state.imageDistanceM !== undefined && state.magnification !== undefined) {
          const iB = toScreen(state.imageDistanceM, 0);
          const iT = toScreen(state.imageDistanceM, 0.55 * state.magnification);
          ctx.strokeStyle = state.imageDistanceM > 0 ? '#4ade80' : '#f472b6';
          ctx.setLineDash(state.imageDistanceM > 0 ? [] : [5, 4]);
          ctx.beginPath();
          ctx.moveTo(iB.sx, iB.sy);
          ctx.lineTo(iT.sx, iT.sy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }

    // 3. 光路射线
    if (activeLayers.has('rays')) {
      for (const ray of state.rays) {
        const p1 = toScreen(ray.from.x, ray.from.y);
        const p2 = toScreen(ray.to.x, ray.to.y);
        ctx.save();
        ctx.strokeStyle = ray.color;
        ctx.globalAlpha = ray.intensity;
        ctx.shadowColor = ray.color;
        ctx.shadowBlur = 14;
        const reflection = ray.label === '反射光' || ray.label?.startsWith('全反射光');
        ctx.lineWidth = reflection ? 10 : 7;
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = ray.intensity;
        ctx.lineWidth = reflection ? 3.5 : 2.8;
        ctx.stroke();

        // 线段中点箭头
        const mx = 0.5 * (p1.sx + p2.sx);
        const my = 0.5 * (p1.sy + p2.sy);
        const ang = Math.atan2(p2.sy - p1.sy, p2.sx - p1.sx);
        ctx.fillStyle = ray.color;
        ctx.beginPath();
        ctx.moveTo(mx + 6 * Math.cos(ang), my + 6 * Math.sin(ang));
        ctx.lineTo(mx - 6 * Math.cos(ang - 0.5), my - 6 * Math.sin(ang - 0.5));
        ctx.lineTo(mx - 6 * Math.cos(ang + 0.5), my - 6 * Math.sin(ang + 0.5));
        ctx.closePath();
        ctx.fill();

        if (ray.label) {
          ctx.font = 'bold 13px system-ui, sans-serif';
          if (ray.label === '入射光') {
            ctx.fillText(ray.label, mx + 12, my - 14);
          } else {
            const labelSign = p2.sy < p1.sy ? -1 : 1;
            ctx.fillText(ray.label, p2.sx + 8, p2.sy + labelSign * 16);
          }
        }
        ctx.restore();
      }
    }

    {
      ctx.save();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px system-ui, sans-serif';
      const critInfo = state.criticalAngleDeg !== null ? `  |  临界角 C = ${state.criticalAngleDeg.toFixed(1)}°` : '';
      ctx.fillText(`θ₁ = ${state.activeAngleDeg.toFixed(1)}°${critInfo}`, 20, 30);
      ctx.restore();
    }
  }
}), { liveFormulas });

export default opticsRayStudioPlugin;
