import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { opticalScene, type OpticalMark } from './sceneGeometry.js';
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


/** All non-interface geometry comes from the same scene used by DiagramIR. */
function renderOpticalScene(ctx:CanvasRenderingContext2D,state:OpticsState,params:OpticsParams,viewport:Viewport,layers:ReadonlySet<string>):void{
  const scene=opticalScene(state,params),m=createWorldMapper(viewport),paper=viewport.theme==='projector';
  const palette={glass:paper?'#0369a1':'#7dd3fc',clad:paper?'#64748b':'#64748b',axis:paper?'#475569':'#94a3b8',warm:paper?'#92400e':'#fcd58b',cool:paper?'#075985':'#67e8f9',image:paper?'#166534':'#86efac',virtual:paper?'#9d174d':'#f0abfc',text:paper?'#334155':'#cbd5e1',spectral:paper?'#334155':'#f8fafc'};
  const spectral:Record<string,string>={'#f8fafc':'#334155','#ef4444':'#b91c1c','#f97316':'#c2410c','#eab308':'#a16207','#22c55e':'#15803d','#3b82f6':'#1d4ed8','#a855f7':'#7e22ce','#60a5fa':'#1d4ed8','#4ade80':'#166534','#fbbf24':'#92400e','#f87171':'#b91c1c'};
  const color=(mark:OpticalMark)=>mark.tone==='spectral'&&mark.color?(paper?spectral[mark.color]??palette.spectral:mark.color):palette[mark.tone];
  const labels:OpticalLabel[]=[],obstacles:Segment[]=[],scale=Math.max(.72,Math.min(1.15,viewport.height/850));
  const font='500 '+Math.round(15*scale)+'px system-ui, sans-serif';
  ctx.save();
  for(const mark of scene.marks){
    if(!layers.has(mark.layer))continue;
    const g=mark.primitive,c=color(mark);
    if(g.kind==='text'){const p=m.toScreen(g.x,g.y);labels.push({...p,text:g.text,color:c,font});continue;}
    ctx.save();ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=1.5;ctx.lineCap='round';ctx.lineJoin='round';
    if(g.kind==='polyline'){
      const pts=g.points.map(p=>m.toScreen(p.x,p.y));
      if(pts.length){ctx.beginPath();ctx.moveTo(pts[0]!.x,pts[0]!.y);for(const p of pts.slice(1))ctx.lineTo(p.x,p.y);
        if(g.closed){ctx.closePath();const top=Math.min(...pts.map(p=>p.y)),bottom=Math.max(...pts.map(p=>p.y));const grad=ctx.createLinearGradient(0,top,0,bottom);grad.addColorStop(0,paper?'rgba(56,189,248,.07)':'rgba(125,211,252,.17)');grad.addColorStop(1,paper?'rgba(56,189,248,.16)':'rgba(56,189,248,.055)');ctx.fillStyle=grad;ctx.fill();if(!paper&&mark.tone==='glass'){ctx.shadowColor=c;ctx.shadowBlur=8;}ctx.stroke();}
        else {ctx.lineWidth=2;ctx.stroke();}
      }
    }else if(g.kind==='circle'){
      const p=m.toScreen(g.cx,g.cy);ctx.beginPath();ctx.arc(p.x,p.y,m.len(g.r),0,Math.PI*2);if(g.fill)ctx.fill();else ctx.stroke();
    }else if(g.kind==='line'||g.kind==='arrow'){
      const a=m.toScreen(g.x1,g.y1),b=m.toScreen(g.x2,g.y2);
      if(mark.layer==='rays'&&!g.dashed&&g.kind==='arrow'){
        drawInterfaceRay(ctx,a,b,c,mark.power??1,true,paper,scale*.68);
      }else{
        ctx.setLineDash(g.dashed?[6,5]:[]);ctx.lineWidth=mark.layer==='medium'?2.2:1.4;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(g.kind==='arrow'){const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(l>1){const ux=dx/l,uy=dy/l;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-10*ux-5*uy,b.y-10*uy+5*ux);ctx.lineTo(b.x-10*ux+5*uy,b.y-10*uy-5*ux);ctx.closePath();if(!g.dashed)ctx.fill();else ctx.stroke();}}
      }
      obstacles.push({a,b});
    }
    ctx.restore();
  }
  if(scene.profile&&layers.has('rays')){
    const samples=scene.profile,mark=scene.marks.find(z=>z.tone==='spectral');
    const c=mark?color(mark):palette.warm;
    // Screen strip and quantitative graph share precisely the same samples.
    for(let i=0;i<samples.length-1;i++){
      const a=samples[i]!,b=samples[i+1]!;
      ctx.fillStyle=c;ctx.globalAlpha=paper?.08+.92*a.intensity:.035+.965*a.intensity;
      ctx.fillRect(m.toX(.56),m.toY(b.y),m.len(.18),m.len(b.y-a.y)+.2);
    }
    ctx.globalAlpha=1;
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
      if(params.sceneMode!=='tir-interface'){
        const b=opticalScene(createInitialState(params),params).bounds,base=Math.min(width,height)*.24,usable=width-(width>=900?300:0);
        return Math.max(.1,Math.min(1.3,(usable-36)/((b.maxX-b.minX)*base),(height-70)/((b.maxY-b.minY)*base)));
      }
      const base=Math.min(width,height)*.24,usable=width-(width>=900?300:0);
      return Math.max(.1,Math.min(1.3,(usable-30)/(2*TIR_WINDOW.halfWidth*base),(height-84)/(2*TIR_WINDOW.halfHeight*base)));
    },
    offsetRatioX: (params,{width,height}) => {
      const center=(width-(width>=900?280:0))/(2*width)-.45;
      if(params.sceneMode==='tir-interface')return center;
      const b=opticalScene(createInitialState(params),params).bounds,base=Math.min(width,height)*.24,usable=width-(width>=900?300:0);
      const scale=Math.max(.1,Math.min(1.3,(usable-36)/((b.maxX-b.minX)*base),(height-70)/((b.maxY-b.minY)*base)));
      return center-(b.minX+b.maxX)*.5*base*scale/width;
    },
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
    if(params.sceneMode==='double-slit')return [];
    if(params.sceneMode!=='tir-interface'){
      const ray=state.rays[0];if(!ray)return [];
      return [{id:'incident-angle',label:'入射角 '+state.activeAngleDeg.toFixed(0)+'°',position:ray.from,handleKind:'point',color:'#fbbf24',showWhenIdle:false,onDrag:wp=>{
        const dx=ray.to.x-wp.x,dy=ray.to.y-wp.y;
        const angle=params.sceneMode==='parallel-slab'?Math.atan2(dx,-dy):params.sceneMode==='optical-fiber'?Math.atan2(dy,dx):Math.atan2(dy,dx)+degToRad(params.prismApexDeg)/2;
        return {incidentAngleDeg:Math.max(0,Math.min(85,Math.round(angle*180/Math.PI))),animateSweep:false};
      }}];
    }
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
    if(params.sceneMode!=='tir-interface'){
      const scene=opticalScene(state,params);
      return {width:720,height:440,viewBox:scene.bounds,title:'光学实验 · '+params.sceneMode,primitives:scene.marks.map(m=>m.primitive)};
    }
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.6, y1: 0, x2: 2.6, y2: 0, dashed: false }
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
    if(params.sceneMode==='thin-lens-imaging'){
      const v=state.imageDistanceM,m=state.magnification;
      return [{id:'thin-lens-eq',label:'理想薄凸透镜 · 近轴',
        latex:'\\frac1u+\\frac1v=\\frac1f,\\quad m=-\\frac vu',
        substitutedLatex:state.imageAtInfinity?'u=f,\\quad v\\to\\infty':v===undefined||m===undefined?'\\text{无有限像}':'v='+v.toFixed(3)+'\\,\\mathrm{m},\\quad m='+m.toFixed(3)}];
    }
    if(params.sceneMode==='optical-fiber'){
      return [{id:'fiber-eq',label:'空气端面入射 · 几何光学',
        latex:state.criticalAngleDeg===null?'n_1\\le n_2:\\ \\text{无全反射导光}':'\\begin{gathered}\\sin C=n_2/n_1\\\\\\sin\\theta_{\\max}=\\min(1,\\sqrt{n_1^2-n_2^2})\\end{gathered}',
        substitutedLatex:state.fiberAcceptanceDeg===undefined?'\\text{无接受角}':'C='+state.criticalAngleDeg?.toFixed(1)+'^\\circ,\\quad\\theta_{\\max}='+state.fiberAcceptanceDeg.toFixed(1)+'^\\circ'}];
    }
    return [{id:'prism-eq',label:'示例 Cauchy 色散 · 直接穿过两腰时',
      latex:'\\begin{gathered}r_1+r_2=A\\\\\\delta=i_1+i_2-A\\end{gathered}',
      substitutedLatex:state.prismDeviationDeg===undefined?'\\text{黄光无直接两腰出射}':'\\delta_{589}='+state.prismDeviationDeg.toFixed(2)+'^\\circ'}];
  },
  renderCanvas: (ctx,state,params,viewport,layers) => {
    if(params.sceneMode==='tir-interface')renderTirInterface(ctx,state,params,viewport,layers);
    else renderOpticalScene(ctx,state,params,viewport,layers);
  }
}), { liveFormulas });

export default opticsRayStudioPlugin;
