import { magnetic3dStoryDecks } from './storyDecks.js';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type LiveFormulaSpec, type ParamFieldSpec, type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { magnetic3dPresets } from './presets.js';
import {
  buildMagneticConductorPaths,
  checkInvariants,
  computeObservables,
  createInitialState,
  stepMagnetic3d,
  getMagneticDisplayFieldLines,
  type Magnetic3dParams,
  type Magnetic3dState
} from './engine.js';

/** Proper rotation (determinant +1) preserving v × B and the existing side-view projection. */
export function magnetic3dDisplayPoint(p: { x: number; y: number; z: number }) {
  return { x: p.z, y: p.y, z: -p.x };
}

/** Default camera height fits the actual conductor dimensions, not particle state.
 * Geometry changes can refit, but particle steps and ordinary orbit never do. */
export function magnetic3dDefaultVisibleHeight(params: Magnetic3dParams, aspect: number): number {
  const R = Math.max(0.2, params.radiusR);
  const a = Math.max(0.6, Math.min(2.4, aspect));
  switch (params.geometryType) {
    case 'finite-solenoid': return Math.max(5 * R, 3.6 * R / (0.72 * a));
    case 'straight-wire':
    case 'parallel-wires': return Math.max(4.5, 8.8 / (0.78 * a));
    case 'single-loop':
    case 'helmholtz-coil': return Math.max(4.8 * R, 3.2 * R / (0.72 * a));
    case 'uniform-helix': return Math.max(4.8, 4.5 / a);
  }
}

const paramSchema: readonly ParamFieldSpec<Magnetic3dParams>[] = [
  {
    key: 'geometryType',
    kind: 'select',
    label: '3D 载流构型',
    defaultValue: 'helmholtz-coil',
    options: [
      { value: 'helmholtz-coil', label: '亥姆霍兹双线圈' },
      { value: 'single-loop', label: '单匝环形电流' },
      { value: 'finite-solenoid', label: '有限长通电螺线管' },
      { value: 'straight-wire', label: '有限直导线右手螺旋' },
      { value: 'parallel-wires', label: '平行同向双导线' },
      { value: 'uniform-helix', label: '3D 匀强场等距螺旋线' }
    ]
  },
  { key: 'currentI', kind: 'number', label: '线圈/导线电流 I', unit: 'A', min: -5, max: 5, step: 0.5, defaultValue: 2.0 },
  { key: 'radiusR', kind: 'number', label: '线圈半径 R', unit: 'm', min: 0.4, max: 1.6, step: 0.1, defaultValue: 1.0 },
  { key: 'solenoidTurns', kind: 'number', label: '螺线管匝数 N', unit: '匝', min: 4, max: 16, step: 2, defaultValue: 10 },
  { key: 'qOverM', kind: 'number', label: '有向荷质比参数', unit: '', min: -4, max: 4, step: 0.2, defaultValue: 1.5 },
  { key: 'vPerp', kind: 'number', label: '垂直初速度 v⊥', unit: 'm/s', min: 0, max: 3, step: 0.2, defaultValue: 1.2 },
  { key: 'vParallel', kind: 'number', label: '轴向初速度 v∥', unit: 'm/s', min: -2, max: 2, step: 0.2, defaultValue: 0.7 },
  { key: 'uniformBz', kind: 'number', label: '匀强模式磁感应强度 Bz', unit: 'T', min: -4, max: 4, step: 0.5, defaultValue: 2.0 }
];

const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "biot-savart-current",
    "title": "稳恒电流元的毕奥—萨伐尔定律",
    "latex": "d\\mathbf B=\\frac{\\mu_0 \\htmlClass{pf-live-var}{\\htmlData{param=currentI}{I}}}{4\\pi}\\frac{d\\boldsymbol\\ell\\times\\mathbf r}{r^3}",
    "bindings": [
      {
        "tokenKey": "currentI",
        "paramKey": "currentI",
        "label": "线圈/导线电流 I",
        "unit": "A",
        "min": -5,
        "max": 5,
        "step": 0.5,
        "precision": 1
      }
    ],
    "when": {
      "geometryType": [
        "helmholtz-coil",
        "single-loop",
        "finite-solenoid",
        "straight-wire",
        "parallel-wires"
      ]
    }
  },
  {
    "id": "uniform-gyro-frequency",
    "title": "匀强场初始回旋角频率与垂直加速度",
    "latex": "\\begin{aligned}\\omega_c&=\\htmlClass{pf-live-var}{\\htmlData{param=qOverM}{\\left|q/m\\right|}}\\htmlClass{pf-live-var}{\\htmlData{param=uniformBz}{|B_z|}}\\\\a_{\\perp,0}&=\\omega_c \\htmlClass{pf-live-var}{\\htmlData{param=vPerp}{v_\\perp}}\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "qOverM",
        "paramKey": "qOverM",
        "label": "有向荷质比参数",
        "unit": "",
        "min": -4,
        "max": 4,
        "step": 0.2,
        "precision": 1
      },
      {
        "tokenKey": "uniformBz",
        "paramKey": "uniformBz",
        "label": "匀强模式磁感应强度 Bz",
        "unit": "T",
        "min": -4,
        "max": 4,
        "step": 0.5,
        "precision": 1
      },
      {
        "tokenKey": "vPerp",
        "paramKey": "vPerp",
        "label": "垂直初速度 v⊥",
        "unit": "m/s",
        "min": 0,
        "max": 3,
        "step": 0.2,
        "precision": 1
      }
    ],
    "when": {
      "geometryType": [
        "uniform-helix"
      ]
    }
  },
  {
    "id": "uniform-parallel-velocity",
    "title": "匀强磁场沿磁场方向匀速运动",
    "latex": "z=z_0+\\htmlClass{pf-live-var}{\\htmlData{param=vParallel}{v_\\parallel}}t",
    "bindings": [
      {
        "tokenKey": "vParallel",
        "paramKey": "vParallel",
        "label": "轴向初速度 v∥",
        "unit": "m/s",
        "min": -2,
        "max": 2,
        "step": 0.2,
        "precision": 1
      }
    ],
    "when": {
      "geometryType": [
        "uniform-helix"
      ]
    }
  }
];


type Tone='wire'|'field'|'trail'|'velocity'|'force'|'muted'|'ink';
type Mark={primitive:DiagramPrimitive;tone:Tone;solid?:boolean};
type Point={x:number;y:number};
const side=(p:{x:number;y:number;z:number}):Point=>({x:p.z,y:p.y});
/** All primary geometry stays in the exact 3D morph plane z-y.
 * Axial wires overlap in that projection, so show a separately labeled
 * transverse x-y section rather than moving the actual conductor. */
export function magneticProjectionScene(s:Magnetic3dState,p:Magnetic3dParams,layers:ReadonlySet<string>):Mark[]{
  const marks:Mark[]=[],R=Math.max(.2,p.radiusR),wire=p.geometryType==='straight-wire'||p.geometryType==='parallel-wires';
  const add=(primitive:DiagramPrimitive,tone:Tone,solid=false)=>marks.push({primitive,tone,solid});
  const line=(a:Point,b:Point,tone:Tone,dashed=false)=>add({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},tone);
  const circle=(x:number,y:number,r:number,tone:Tone,fill=false)=>add({kind:'circle',cx:x,cy:y,r,fill},tone,fill);
  const label=(x:number,y:number,text:string,tone:Tone='ink')=>add({kind:'text',x,y,text,align:'middle'},tone);
  const poly=(points:Point[],tone:Tone)=>{if(points.length>=2)add({kind:'polyline',points},tone);};
  const arrow=(a:Point,b:Point,tone:Tone)=>{if(Math.hypot(a.x-b.x,a.y-b.y)>1e-8)add({kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y},tone);};
  const direction=(points:Point[],tone:Tone,size:number)=>{
    let best:{a:Point;b:Point;d:number}|undefined;
    for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,d=Math.abs(i-points.length/2);if(Math.hypot(b.x-a.x,b.y-a.y)>1e-8&&(!best||d<best.d))best={a,b,d};}
    if(!best)return;const dx=best.b.x-best.a.x,dy=best.b.y-best.a.y,n=Math.hypot(dx,dy),x=(best.a.x+best.b.x)/2,y=(best.a.y+best.b.y)/2;
    arrow({x:x-size*dx/n,y:y-size*dy/n},{x:x+size*dx/n,y:y+size*dy/n},tone);
  };
  if(layers.has('conductors')){
    for(const path of buildMagneticConductorPaths(p))if(path.length)poly([side(path[0]!.a),...path.map(q=>side(q.b))],'wire');
    if(p.currentI!==0&&!wire&&p.geometryType!=='uniform-helix'){
      const turns=Math.max(4,Math.min(16,Math.round(p.solenoidTurns))),zs=p.geometryType==='single-loop'?[0]:p.geometryType==='helmholtz-coil'?[-.5*R,.5*R]:Array.from({length:turns},(_,j)=>-1.2*R+2.4*R*j/(turns-1));
      for(const z of zs)for(const y of [-R,R]){
        const r=.075*R;circle(z,y,r,'wire');if(y*p.currentI>0)circle(z,y,.022*R,'wire',true);
        else{const a=r*.48;line({x:z-a,y:y-a},{x:z+a,y:y+a},'wire');line({x:z-a,y:y+a},{x:z+a,y:y-a},'wire');}
      }
    }
    if(wire&&p.currentI!==0)for(const z of [-2.5,0,2.5])arrow({x:z-.22*Math.sign(p.currentI),y:0},{x:z+.22*Math.sign(p.currentI),y:0},'wire');
  }
  if(layers.has('fieldLines3d')){
    const lines=getMagneticDisplayFieldLines(p);
    for(const points of lines){const projected=points.map(side);poly(projected,'field');direction(projected,'field',.045*R);}
  }
  if(wire){
    const center={x:2.45,y:2.0*R},scale=.52,section=(p:{x:number;y:number}):Point=>({x:center.x+scale*p.x,y:center.y+scale*p.y});
    const half=1.1*R,lo={x:center.x-half,y:center.y-half},hi={x:center.x+half,y:center.y+half};
    add({kind:'rect',x:lo.x,y:lo.y,width:2*half,height:2*half},'muted');
    label(center.x,hi.y+.16*R,'横截面 x-y · +z 出纸面','muted');
    if(layers.has('fieldLines3d')){
      const mid=getMagneticDisplayFieldLines(p).filter(q=>Math.abs(q[0]?.z??99)<1e-9);
      for(const q of mid){const pts=q.map(section);poly(pts,'field');direction(pts,'field',.035*R);}
    }
    if(layers.has('conductors')){
      const xs=p.geometryType==='straight-wire'?[0]:[-.8*R,.8*R];
      for(const x of xs){const a=section({x,y:0}),r=.08*R;circle(a.x,a.y,r,'wire');
        if(p.currentI>0)circle(a.x,a.y,.022*R,'wire',true);
        if(p.currentI<0){const d=r*.55;line({x:a.x-d,y:a.y-d},{x:a.x+d,y:a.y+d},'wire');line({x:a.x-d,y:a.y+d},{x:a.x+d,y:a.y-d},'wire');}
      }
    }
    label(center.x,lo.y-.16*R,p.geometryType==='parallel-wires'?'侧视重合 · 截面分离':'有限导线 · 横截面','muted');
  }
  poly(s.trail.map(side),'trail');const pos=side(s.position);circle(pos.x,pos.y,Math.max(.033,.04*R),'trail',true);
  if(layers.has('handednessTriad')){
    for(const [v,tone,name] of [[s.velocity,'velocity','v'],[s.bAtParticle,'field','B'],[s.lorentzForce,'force','a洛']] as const){
      if(tone!=='velocity'&&!s.fieldDefined)continue;
      const n=Math.hypot(v.x,v.y,v.z);if(n<=1e-10)continue;
      // Same relative direction as the actual 3D vector. Projection may vanish;
      // an out-of-plane vector is indicated by a dot or cross, never a fake arrow.
      const d=side(v),size=.55*Math.max(.6,R),end={x:pos.x+size*d.x/n,y:pos.y+size*d.y/n};
      if(Math.hypot(end.x-pos.x,end.y-pos.y)<.018*R){
        const r=.07*R;circle(pos.x,pos.y,r,tone);if(v.x<0)circle(pos.x,pos.y,.02*R,tone,true);else{const h=r*.5;line({x:pos.x-h,y:pos.y-h},{x:pos.x+h,y:pos.y+h},tone);line({x:pos.x-h,y:pos.y+h},{x:pos.x+h,y:pos.y-h},tone);}
        label(pos.x+.14*R,pos.y+.14*R,name+' 垂直纸面',tone);
      }else{arrow(pos,end,tone);label(end.x,end.y+.12*R,name,tone);}
    }
  }
  return marks;
}
export function magneticProjectionBounds(s:Magnetic3dState,p:Magnetic3dParams){
  const marks=magneticProjectionScene(s,p,new Set(['conductors','fieldLines3d','handednessTriad']));
  let minX=-1,maxX=1,minY=-1,maxY=1;
  const include=(x:number,y:number,r=0)=>{minX=Math.min(minX,x-r);maxX=Math.max(maxX,x+r);minY=Math.min(minY,y-r);maxY=Math.max(maxY,y+r);};
  for(const {primitive:q} of marks){
    if(q.kind==='line'||q.kind==='arrow'){include(q.x1,q.y1);include(q.x2,q.y2);}
    else if(q.kind==='polyline'||q.kind==='trajectory')for(const v of q.points)include(v.x,v.y);
    else if(q.kind==='circle')include(q.cx,q.cy,q.r);
    else if(q.kind==='text'||q.kind==='mathLabel')include(q.x,q.y,.15);
    else if(q.kind==='rect'){include(q.x,q.y);include(q.x+q.width,q.y+q.height);}
  }
  const pad=.18*Math.max(1,p.radiusR);return {minX:minX-pad,maxX:maxX+pad,minY:minY-pad,maxY:maxY+pad};
}

const magneticChannels:readonly TelemetryChannelSpec[]=[
  {key:'vx',label:'有向速度 vx',unit:'m/s',color:'#38bdf8'},
  {key:'vy',label:'有向速度 vy',unit:'m/s',color:'#f472b6'},
  {key:'vz',label:'有向速度 vz',unit:'m/s',color:'#fbbf24'},
  {key:'speed',label:'速率',unit:'m/s',color:'#38bdf8'},
  {key:'bMagT',label:'所在处 |B|',unit:'T',color:'#fbbf24'},
  {key:'bMagMicroT',label:'所在处 |B|',unit:'μT',color:'#fbbf24'},
  {key:'z',label:'轴向位置 z',unit:'m',color:'#38bdf8'},
  {key:'ke',label:'比动能',unit:'J/kg',color:'#4ade80'},
  {key:'vDotF',label:'磁力比功率 v·a',unit:'W/kg',color:'#f472b6'}
];
export const em3dMagneticFieldsPlugin = Object.assign(defineSimulationPlugin<Magnetic3dParams, Magnetic3dState>({
  meta: {
    id: 'em-3d-magnetic-fields',
    title: '3D 电磁空间场与左手/右手定则 (E10)',
    textbookRef: '人教版 选择性必修二 第一章 & 必修三 第十三章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'three3d',
  defaultView:{minScale:.0001,scale:(p,v)=>Math.max(.0001,Math.min((v.width-50)/(p.geometryType==='straight-wire'||p.geometryType==='parallel-wires'?9.5:8*Math.max(.65,p.radiusR)),(v.height-50)/(p.geometryType==='straight-wire'||p.geometryType==='parallel-wires'?5.2*Math.max(.65,p.radiusR):6.5*Math.max(.65,p.radiusR)))/(.24*Math.min(v.width,v.height))),offsetRatioX:.05},
  paramSchema,
  getParamFields:p=>{const keys=p.geometryType==='uniform-helix'?['geometryType','uniformBz','qOverM','vPerp','vParallel']:p.geometryType==='finite-solenoid'?['geometryType','currentI','radiusR','solenoidTurns','qOverM','vPerp','vParallel']:p.geometryType==='straight-wire'?['geometryType','currentI','qOverM','vPerp','vParallel','radiusR']:['geometryType','currentI','radiusR','qOverM','vPerp','vParallel'];return keys.flatMap(k=>paramSchema.filter(f=>f.key===k)).map(f=>f.key==='qOverM'?{...f,label:'有向荷质比 q/m',unit:p.geometryType==='uniform-helix'?'C/kg':'×10⁶ C/kg'}:f.key==='radiusR'&&p.geometryType==='straight-wire'?{...f,label:'初始位置与场线采样尺度 R'}:f.key==='radiusR'&&p.geometryType==='parallel-wires'?{...f,label:'半间距 = 0.8R'}:f.key==='vPerp'&&p.geometryType!=='uniform-helix'?{...f,label:'初始 x 向速度'}:f.key==='vParallel'?{...f,label:'初始 z 向速度'}:f);},
  presets: magnetic3dPresets,
  engine: {
    createInitialState,
    step: stepMagnetic3d,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'conductors', label: '3D 载流线圈/导线', defaultVisible: true },
    { id: 'fieldLines3d', label: '3D Biot-Savart 空间磁感线', defaultVisible: true },
    { id: 'handednessTriad', label: '速度、磁场与洛伦兹加速度', defaultVisible: true }
  ],
  telemetryChannels:magneticChannels,
  getTelemetryChannels:p=>(p.geometryType==='uniform-helix'?['vx','vy','vz','speed','bMagT','z','ke','vDotF']:['speed','bMagMicroT','vx','vy','vz','z','ke','vDotF']).flatMap(k=>magneticChannels.filter(c=>c.key===k)),
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-3d-magnetic-fields',
      title: '3D 电磁空间场',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<Magnetic3dParams>
  },
  exportDiagramIR:(s,p)=>{
    const viewBox=magneticProjectionBounds(s,p),primitives=magneticProjectionScene(s,p,new Set(['conductors','fieldLines3d','handednessTriad'])).map(m=>m.primitive);
    const caption=p.geometryType==='uniform-helix'?'Bz='+p.uniformBz.toFixed(2)+' T · q/m='+p.qOverM.toFixed(2)+' C/kg':'I='+p.currentI.toFixed(2)+' A · z-y 侧投影';
    primitives.push({kind:'text',x:(viewBox.minX+viewBox.maxX)/2,y:viewBox.maxY+.08,text:caption,align:'middle'});
    viewBox.maxY+=.35;
    return {width:960,height:540,viewBox,title:'空间磁场二维侧投影（矢量长度仅示意）',primitives};
  },
  renderCanvas:(ctx,s,p,v,layers)=>{
    const m=createWorldMapper(v),paper=v.theme==='projector',colors:Record<Tone,string>=paper?{wire:'#92400e',field:'#0369a1',trail:'#b45309',velocity:'#92400e',force:'#be123c',muted:'#475569',ink:'#0f172a'}:{wire:'#eabf94',field:'#67e8f9',trail:'#fbbf24',velocity:'#fbbf24',force:'#fb7185',muted:'#94a3b8',ink:'#e2e8f0'};
    const labels:CanvasLabel[]=[];ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const [i,{primitive:q,tone,solid}] of magneticProjectionScene(s,p,layers).entries()){
      const color=colors[tone];ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=tone==='field'?1.2:tone==='muted'?1.2:2.4;
      ctx.globalAlpha=tone==='field'&&q.kind==='polyline'?.55:1;ctx.shadowBlur=!paper&&tone!=='muted'&&q.kind!=='text'?tone==='field'?3:6:0;ctx.shadowColor=color;
      if(q.kind==='text'){const a=m.toScreen(q.x,q.y);labels.push({id:'e10-flat-'+i,x:a.x,y:a.y,text:q.text,color,font:'12px sans-serif'});}
      else if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[4,4]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n>1){const u=dx/n,w=dy/n,h=Math.min(10,Math.max(3,n*.36));ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-h*u+h*.55*w,b.y-h*w-h*.55*u);ctx.lineTo(b.x-h*u-h*.55*w,b.y-h*w+h*.55*u);ctx.closePath();ctx.fill();}}
      }else if(q.kind==='polyline'||q.kind==='trajectory'){
        const points=q.points;if(!points.length)continue;const a=m.toScreen(points[0]!.x,points[0]!.y);ctx.beginPath();ctx.moveTo(a.x,a.y);for(const point of points.slice(1)){const b=m.toScreen(point.x,point.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
      }else if(q.kind==='circle'){const a=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(a.x,a.y,Math.max(q.fill?1.5:2.8,m.len(q.r)),0,2*Math.PI);if(solid)ctx.fill();else ctx.stroke();}
      else if(q.kind==='rect'){const a=m.toScreen(q.x,q.y+q.height),b=m.toScreen(q.x+q.width,q.y);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
    }
    ctx.globalAlpha=1;ctx.shadowBlur=0;resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
  },
  getControlHandles: (state, params) => {
    const origin = {
      x: state.position.z,
      y: state.position.y
    };
    return [
      {
        id: 'particle-vperp',
        label: `v⊥=${params.vPerp.toFixed(1)} m/s`,
        position: { x: origin.x + Math.max(0.15, params.vPerp * 0.35), y: origin.y },
        origin,
        handleKind: 'vector',
        color: '#38bdf8',
        onDrag: (world) => ({
          vPerp: Number(Math.max(0, Math.min(3, Math.round((Math.hypot(world.x - origin.x, world.y - origin.y) / 0.35) * 5) / 5)).toFixed(1))
        })
      }
    ];
  },
  getForceVectors: (state) => {
    if(!state.fieldDefined)return [];
    const origin = {
      x: state.position.z,
      y: state.position.y
    };
    const acceleration = state.lorentzForce;
    return [
      {
        id: 'lorentz-acceleration',
        label: 'a洛 = (q/m)v×B',
        origin,
        force: { x: acceleration.z, y: acceleration.y },
        color: '#fb7185',
        category: 'magnetic',
        unit: 'm/s²'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'helical-particle',
      label: '带电粒子随动参考系 (2D 投影)',
      getOrigin: (state) => ({
        x: state.position.z,
        y: state.position.y
      }),
      getVelocity: (state) => ({
        x: state.velocity.z,
        y: state.velocity.y
      })
    }
  ],
  formatFormulas: (state, params): import('@physforge/sim-sdk').FormulaDisplayItem[] => {
    if(!state.fieldDefined)return [{id:'ideal-filament',label:'理想丝线奇异点 · 场无定义',latex:'\\text{理想丝线处不提供磁场测量}'}];
    const obs = computeObservables(state);
    const speed = obs.speed ?? 0;
    const specificEnergy = obs.ke ?? 0;
    const specificPower = obs.vDotF ?? 0;
    if (params.geometryType === 'uniform-helix') {
      const omega = Math.abs(params.qOverM * params.uniformBz);
      const vPerp = Math.hypot(state.velocity.x, state.velocity.y);
      const gyration = omega > 0 && vPerp > 1e-12
        ? `\\begin{aligned}R&=${(vPerp / omega).toFixed(3)}\\text{ m}\\\\ T&=${(2 * Math.PI / omega).toFixed(3)}\\text{ s}\\end{aligned}`
        : '\\text{零磁力：直线运动或静止，无实际回旋}';
      return [{
        id: 'uniform-helix-state', label: '均匀磁场中的实际速度与回旋参数',
        latex: '\\omega_c=|qB_z/m|,\\quad R=v_\\perp/\\omega_c',
        substitutedLatex: gyration
      }, {
        id: 'uniform-velocity-state', label: '速度分量与比动能',
        latex: 'v^2=v_\\perp^2+v_\\parallel^2',
        substitutedLatex: `\\begin{aligned}v_\\parallel&=${state.velocity.z.toFixed(3)}\\text{ m/s}\\\\v_\\perp&=${vPerp.toFixed(3)}\\text{ m/s}\\\\K/m&=${specificEnergy.toFixed(3)}\\text{ J/kg}\\end{aligned}`
      }];
    }
    const currentField = {
      id: 'biot-savart-lorentz', label: '3D 毕奥—萨伐尔磁场与洛伦兹加速度',
      latex: '\\begin{aligned}d\\mathbf B&=\\frac{\\mu_0 I}{4\\pi}\\frac{d\\boldsymbol\\ell\\times\\mathbf r}{r^3}\\\\\\mathbf a&=\\frac{q}{m}\\mathbf v\\times\\mathbf B\\end{aligned}',
      substitutedLatex: `\\begin{aligned}|B|&=${(obs.bMagMicroT ?? 0).toFixed(3)}\\,\\mu\\text{T}\\\\v&=${speed.toFixed(3)}\\text{ m/s}\\\\K/m&=${specificEnergy.toFixed(3)}\\text{ J/kg}\\\\\\mathbf v\\cdot\\mathbf a&=${specificPower.toFixed(6)}\\text{ W/kg}\\end{aligned}`
    };
    if (params.geometryType === 'finite-solenoid') return [{
      id: 'local-helical-motion', label: '局部匀强磁场近似下的螺旋运动',
      latex: '\\begin{aligned}\\text{局部匀强近似}\\\\ R &= \\frac{mv_\\perp}{|q|B}\\\\ T &= \\frac{2\\pi m}{|q|B}\\end{aligned}',
    }, currentField];
    return [currentField];
  }
}), { storyDecks: magnetic3dStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xy' as const, defaultVisibleHeight: 4.8, sceneDepthRadius: 6,
  default3DAzimuthRad: 0.46, default3DPolarRad: 1.30 } });

export default em3dMagneticFieldsPlugin;
