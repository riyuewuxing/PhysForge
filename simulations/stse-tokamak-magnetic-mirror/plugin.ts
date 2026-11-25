import { fusionStoryDecks } from './storyDecks.js';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type LiveFormulaSpec, type ParamFieldSpec } from '@physforge/sim-sdk';
import { tokamakMirrorPresets } from './presets.js';
import {
  buildTokamakMirrorSegments,
  checkInvariants,
  computeMirrorLossConeDeg,
  computeObservables,
  createInitialState,
  stepTokamakMirror,
  traceTokamakMirrorLines,
  fusionParallelVelocity,
  fusionMinorRadius,
  fusionSurfaceWinding,
  TOKAMAK_MINOR_RADIUS_M,
  type TokamakMirrorParams,
  type TokamakMirrorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<TokamakMirrorParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '磁约束位形',
    defaultValue: 'magnetic-mirror',
    options: [
      { value: 'magnetic-mirror', label: '3D 无散磁镜 / 磁瓶' },
      { value: 'tokamak', label: '托卡马克环形螺旋磁面' }
    ]
  },
  { key: 'b0Tesla', kind: 'number', label: '中心磁场 B₀', unit: 'T', defaultValue: 2.5, min: 0.5, max: 5.0, step: 0.2 },
  { key: 'mirrorLengthM', kind: 'number', label: '磁镜特征长度 L', unit: 'm', defaultValue: 1.2, min: 0.6, max: 2.4, step: 0.1 },
  { key: 'coilHalfSpanM', kind: 'number', label: '磁喉半跨距 z_c', unit: 'm', defaultValue: 1.5, min: 0.8, max: 2.5, step: 0.1 },
  { key: 'pitchAngleDeg', kind: 'number', label: '初速度与局部 B 夹角 θ₀', unit: '°', defaultValue: 52, min: 10, max: 85, step: 2 },
  { key: 'speed0', kind: 'number', label: '粒子速率 v₀', unit: 'm/s', defaultValue: 2.0, min: 0.5, max: 4.0, step: 0.2 },
  { key: 'qOverM', kind: 'number', label: '荷质比 q/m', unit: 'C/kg', defaultValue: 45, min: 10, max: 80, step: 5 },
  { key: 'majorRadiusM', kind: 'number', label: '托卡马克大半径 R₀', unit: 'm', defaultValue: 1.4, min: 1.0, max: 2.2, step: 0.1 },
  { key: 'safetyFactorQ', kind: 'number', label: '极向场参数 q*', description: '调节极向分量；有限磁面真实绕行比依赖小半径', defaultValue: 2.5, min: 1.2, max: 5.0, step: 0.2 }
];

/** Shared right-handed physical-to-display rotation. XY is the torus plane;
 * for a mirror the axial z direction is horizontal and depth is -x. */
export function fusionDisplayPoint(point: { x: number; y: number; z: number }, mode: TokamakMirrorParams['mode']) {
  return mode === 'tokamak' ? { x: point.x, y: point.y, z: point.z } : { x: point.z, y: point.y, z: -point.x };
}
type Point3={x:number;y:number;z:number};
export function fusionGeometryKey(p:TokamakMirrorParams):string{
  return p.mode==='magnetic-mirror'?[p.mode,p.mirrorLengthM,p.coilHalfSpanM].join(':'):[p.mode,p.majorRadiusM,p.safetyFactorQ].join(':');
}
let cachedGeometry:{key:string;segments:ReturnType<typeof buildTokamakMirrorSegments>;lines:ReturnType<typeof traceTokamakMirrorLines>}|null=null;
export function fusionDisplayGeometry(p:TokamakMirrorParams){
  const key=fusionGeometryKey(p);
  if(!cachedGeometry||cachedGeometry.key!==key)cachedGeometry={key,segments:buildTokamakMirrorSegments(p),lines:traceTokamakMirrorLines(p)};
  return cachedGeometry;
}
export function fusionVelocityVectors(s:TokamakMirrorState,p:TokamakMirrorParams){
  const origin=fusionDisplayPoint(s.position,p.mode),v=fusionDisplayPoint(s.velocity,p.mode);
  const b=fusionDisplayPoint(s.bField,p.mode),bm=Math.max(1e-12,Math.hypot(b.x,b.y,b.z));
  const vp=fusionParallelVelocity(s.velocity,s.bField);
  const scale=Math.min(.27,.80/Math.max(1e-12,Math.hypot(v.x,v.y,v.z)));
  const add=(a:Point3,d:Point3,k:number)=>({x:a.x+k*d.x,y:a.y+k*d.y,z:a.z+k*d.z});
  const end=add(origin,v,scale),joint=add(origin,b,scale*vp/bm);
  return [{id:'v',a:origin,b:end},{id:'parallel',a:origin,b:joint},{id:'perpendicular',a:joint,b:end}] as const;
}
export function fusionStatus(s:TokamakMirrorState,p:TokamakMirrorParams):string{
  if(s.escapeEvent)return p.mode==='magnetic-mirror'?'首次穿过磁喉：'+s.escapeEvent.time.toFixed(3)+' s':'首次越过示意室壁：'+s.escapeEvent.time.toFixed(3)+' s';
  if(p.mode==='magnetic-mirror')return '真实反射 '+s.reflectionCount+' 次 · 尚未越过磁喉';
  return '尚未越过示意室壁 · 单粒子模型';
}
export function fusionEventPoints(s:TokamakMirrorState,p:TokamakMirrorParams){
  return [s.lastReflection,s.escapeEvent].flatMap(event=>event?.position&&event.position.z!==undefined?
    [{id:event.id,time:event.time,point:fusionDisplayPoint({x:event.position.x,y:event.position.y,z:event.position.z},p.mode)}]:[]);
}
function fusionCanvasArrow(ctx:CanvasRenderingContext2D,a:{x:number;y:number},b:{x:number;y:number},color:string){
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<.5)return;
  const ux=dx/len,uy=dy/len,head=Math.min(10,len*.28);
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2.1;
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*ux+head*.45*uy,b.y-head*uy-head*.45*ux);
  ctx.lineTo(b.x-head*ux-head*.45*uy,b.y-head*uy+head*.45*ux);ctx.closePath();ctx.fill();
}
const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "mirror-ratio",
    "title": "磁镜轴线上两喉口与中心的磁场比",
    "latex": "R_m=1+\\left(\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=coilHalfSpanM}{z_c}}}{\\htmlClass{pf-live-var}{\\htmlData{param=mirrorLengthM}{L}}}\\right)^2,\\quad\\sin^2\\theta_c=1/R_m",
    "bindings": [
      {
        "tokenKey": "coilHalfSpanM",
        "paramKey": "coilHalfSpanM",
        "label": "磁喉半跨距 z_c",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "mirrorLengthM",
        "paramKey": "mirrorLengthM",
        "label": "磁镜特征长度 L",
        "unit": "m",
        "min": 0.6,
        "max": 2.4,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "magnetic-mirror"
      ]
    }
  },
  {
    "id": "mirror-pitch",
    "title": "磁镜中心的初始垂直速率",
    "latex": "v_\\perp=\\htmlClass{pf-live-var}{\\htmlData{param=speed0}{v_0}}\\sin \\htmlClass{pf-live-var}{\\htmlData{param=pitchAngleDeg}{\\theta_0}}",
    "bindings": [
      {
        "tokenKey": "speed0",
        "paramKey": "speed0",
        "label": "粒子速率 v₀",
        "unit": "m/s",
        "min": 0.5,
        "max": 4,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "pitchAngleDeg",
        "paramKey": "pitchAngleDeg",
        "label": "初速度投射角 θ",
        "unit": "°",
        "min": 10,
        "max": 85,
        "step": 2,
        "precision": 0
      }
    ],
    "when": {
      "mode": [
        "magnetic-mirror"
      ]
    }
  },
  {
    "id": "mirror-axial-field",
    "title": "磁镜轴线上的磁场（模型位形）",
    "latex": "B_z(z)=\\htmlClass{pf-live-var}{\\htmlData{param=b0Tesla}{B_0}}\\left(1+\\frac{z^2}{\\htmlClass{pf-live-var}{\\htmlData{param=mirrorLengthM}{L}}^2}\\right)",
    "bindings": [
      {
        "tokenKey": "b0Tesla",
        "paramKey": "b0Tesla",
        "label": "中心磁场 B₀",
        "unit": "T",
        "min": 0.5,
        "max": 5,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "mirrorLengthM",
        "paramKey": "mirrorLengthM",
        "label": "磁镜特征长度 L",
        "unit": "m",
        "min": 0.6,
        "max": 2.4,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "magnetic-mirror"
      ]
    }
  },
  {
    "id": "tokamak-toroidal-field",
    "title": "托卡马克环向磁场分量（R 为柱坐标半径）",
    "latex": "B_\\phi=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=b0Tesla}{B_0}}\\htmlClass{pf-live-var}{\\htmlData{param=majorRadiusM}{R_0}}}{R}",
    "bindings": [
      {
        "tokenKey": "b0Tesla",
        "paramKey": "b0Tesla",
        "label": "中心磁场 B₀",
        "unit": "T",
        "min": 0.5,
        "max": 5,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "majorRadiusM",
        "paramKey": "majorRadiusM",
        "label": "托卡马克大半径 R₀",
        "unit": "m",
        "min": 1,
        "max": 2.2,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "tokamak"
      ]
    }
  }
];

export const stseTokamakMagneticMirrorPlugin = Object.assign(defineSimulationPlugin<TokamakMirrorParams, TokamakMirrorState>({
  meta: {
    id: 'stse-tokamak-magnetic-mirror',
    title: '托卡马克环形磁场与磁镜/磁瓶 (S01)',
    textbookRef: '人教版 选择性必修二 第一章 · 现代核聚变磁约束 STSE',
    curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'three3d',
  paramSchema,
  presets: tokamakMirrorPresets,
  defaultView:{scale:(p,size)=>{
    const w=p.mode==='tokamak'?2*(p.majorRadiusM+TOKAMAK_MINOR_RADIUS_M):2.2*p.coilHalfSpanM;
    const h=p.mode==='tokamak'?w:1.6;
    return Math.min(1.32,.68*size.width/(w*Math.min(size.width,size.height)*.24),.66*size.height/(h*Math.min(size.width,size.height)*.24));
  },offsetRatioX:-.025},
  engine: {
    createInitialState,
    step: stepTokamakMirror,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'conductors', label: '3D 线圈 / 真空室骨架', defaultVisible: true },
    { id: 'fieldLines3d', label: '3D 空间磁感线', defaultVisible: true },
    { id:'velocityComponents',label:'速度及平行/垂直分量',defaultVisible:true },
    { id:'eventPins',label:'真实反射与越界点',defaultVisible:true }
  ],
  telemetryChannels: [
    { key: 'z', label: '轴向位置 z', unit: 'm', color: '#38bdf8' },
    { key: 'bMagT', label: '所在处磁感应强度 |B|', unit: 'T', color: '#fbbf24' },
    { key: 'muCurrent', label: '单位质量磁矩 μ/m', unit: 'J/(kg·T)', color: '#4ade80' },
    { key: 'maxMuRelDev', label: 'μ 最大相对波动', unit: '', color: '#f472b6' },
    { key:'vParallel',label:'v∥',unit:'m/s',color:'#38bdf8' },
    { key:'vPerp',label:'v⊥',unit:'m/s',color:'#f472b6' },
    { key:'minorRadiusM',label:'磁面小半径 ρ',unit:'m',color:'#4ade80' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-tokamak-magnetic-mirror',
      title: '托卡马克与磁镜三维磁约束',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<TokamakMirrorParams>
  },
  exportDiagramIR:(state,params)=>{
    const geometry=fusionDisplayGeometry(params),project=(p:Point3)=>fusionDisplayPoint(p,params.mode);
    const points:Point3[]=[];
    const primitives:DiagramPrimitive[]=[];
    for(const seg of geometry.segments){const a=project(seg.a),b=project(seg.b);points.push(a,b);primitives.push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,strokeWidth:1.2});}
    for(const line of geometry.lines){
      const p=line.map(project);points.push(...p);primitives.push({kind:'polyline',points:p,dashed:true});
    }
    const track=state.trail.map(project),particle=project(state.position);points.push(...track,particle);
    if(track.length>1)primitives.push({kind:'trajectory',points:track,strokeWidth:1.8});
    primitives.push({kind:'circle',cx:particle.x,cy:particle.y,r:.045,fill:true});
    for(const vector of fusionVelocityVectors(state,params)){
      points.push(vector.a,vector.b);
      if(Math.hypot(vector.b.x-vector.a.x,vector.b.y-vector.a.y)>1e-8)
        primitives.push({kind:'arrow',x1:vector.a.x,y1:vector.a.y,x2:vector.b.x,y2:vector.b.y,label:vector.id==='v'?'v':vector.id==='parallel'?'v∥':'v⊥'});
    }
    for(const ev of fusionEventPoints(state,params)){
      points.push(ev.point);primitives.push({kind:'circle',cx:ev.point.x,cy:ev.point.y,r:.065});
      primitives.push({kind:'text',x:ev.point.x+.1,y:ev.point.y+.13,text:ev.id==='fusion-escape'?'首次越界':'反射点',align:'start'});
    }
    let minX=Math.min(-1,...points.map(p=>p.x)),maxX=Math.max(1,...points.map(p=>p.x)),
      minY=Math.min(-.8,...points.map(p=>p.y)),maxY=Math.max(.8,...points.map(p=>p.y));
    primitives.push({kind:'text',x:minX,y:minY-.16,text:params.mode==='magnetic-mirror'?'磁镜轴向投影 · 虚线为磁感线':'环形场 XY 投影 · 示意室壁',align:'start'});
    return {width:720,height:460,viewBox:{minX:minX-.25,maxX:maxX+.45,minY:minY-.40,maxY:maxY+.35},title:'S01 磁镜/托卡马克真实二维投影',primitives};
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const proj=(p:Point3)=>{const v=fusionDisplayPoint(p,params.mode);return m.toScreen(v.x,v.y);};
    const paper=viewport.theme==='projector',geometry=fusionDisplayGeometry(params);
    const copper=paper?'#92400e':'#f6b66d',field=paper?'#0369a1':'#75e5f1';
    const colors=[paper?'#92400e':'#ffcf78',paper?'#0369a1':'#38bdf8',paper?'#9d174d':'#f472b6'];
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    if (activeLayers.has('conductors')) {
      ctx.strokeStyle=copper;ctx.lineWidth=paper?2:3.4;
      if(!paper){ctx.shadowColor='#df8d53';ctx.shadowBlur=5;}
      ctx.beginPath();
      for (const seg of geometry.segments) {
        const a = proj(seg.a);
        const b = proj(seg.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();ctx.shadowBlur=0;
    }
    if (activeLayers.has('fieldLines3d')) {
      ctx.strokeStyle=field;ctx.lineWidth=1.45;ctx.globalAlpha=.72;
      if(!paper){ctx.shadowColor='#38bdf8';ctx.shadowBlur=4;}
      for (const line of geometry.lines) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach((p, idx) => {
          const pt = proj(p);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        const j=Math.floor(line.length*.62);
        fusionCanvasArrow(ctx,proj(line[j-2]!),proj(line[j]!),field);
      }
      ctx.shadowBlur=0;ctx.globalAlpha=1;
    }
    if(state.trail.length>1){
      ctx.strokeStyle=paper?'#166534':'#ffcb75';ctx.lineWidth=2.6;
      if(!paper){ctx.shadowColor='#ffad45';ctx.shadowBlur=7;}
      ctx.beginPath();
      state.trail.forEach((p, idx) => {
        const pt = proj(p);
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();ctx.shadowBlur=0;
    }
    const sp = proj(state.position);
    ctx.fillStyle=state.escaped?(paper?'#b91c1c':'#fb7185'):(paper?'#92400e':'#fff0bd');
    if(!paper){ctx.shadowColor=state.escaped?'#fb7185':'#fbbf24';ctx.shadowBlur=10;}
    ctx.beginPath();ctx.arc(sp.x,sp.y,Math.max(3.2,m.len(.028)),0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    if(activeLayers.has('velocityComponents'))fusionVelocityVectors(state,params).forEach((v,i)=>fusionCanvasArrow(ctx,m.toScreen(v.a.x,v.a.y),m.toScreen(v.b.x,v.b.y),colors[i]!));
    if(activeLayers.has('eventPins'))for(const ev of fusionEventPoints(state,params)){
      const q=m.toScreen(ev.point.x,ev.point.y);
      ctx.strokeStyle=ev.id==='fusion-escape'?(paper?'#b91c1c':'#fb7185'):(paper?'#166534':'#4ade80');ctx.lineWidth=2.3;
      ctx.beginPath();ctx.arc(q.x,q.y,7,0,Math.PI*2);ctx.stroke();
    }

    const radiusGuideEnd = params.mode === 'magnetic-mirror'
      ? { x: params.coilHalfSpanM, y: 0 }
      : { x: params.majorRadiusM, y: 0 };
    const radiusGuideStart = m.toScreen(0, 0);
    const radiusGuide = m.toScreen(radiusGuideEnd.x, radiusGuideEnd.y);
    ctx.strokeStyle = 'rgba(245,158,11,0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(radiusGuideStart.x, radiusGuideStart.y);
    ctx.lineTo(radiusGuide.x, radiusGuide.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // HUD is a screen-space readout away from title, formula card and scene.
    ctx.fillStyle=paper?'#334155':'#cbd5e1';ctx.font='600 12px system-ui,sans-serif';ctx.textAlign='left';
    const y=viewport.height-112;
    ctx.fillText(params.mode==='magnetic-mirror'?'轴向 z · 线圈为位形示意':'XY 投影 · 非真实等离子体模拟',12,y);
    ctx.fillText(fusionStatus(state,params),12,y+18);
    ctx.fillText(params.mode==='magnetic-mirror'?'θ₀='+params.pitchAngleDeg+'° · θc≈'+computeMirrorLossConeDeg(params).toFixed(1)+'°':'q*='+params.safetyFactorQ.toFixed(2)+' · ρ='+fusionMinorRadius(state.position,params).toFixed(3)+' m',12,y+36);
    if(activeLayers.has('velocityComponents')){
      ctx.fillStyle=colors[0]!;ctx.fillText('v',12,y-17);
      ctx.fillStyle=colors[1]!;ctx.fillText('v∥',38,y-17);
      ctx.fillStyle=colors[2]!;ctx.fillText('v⊥',72,y-17);
      ctx.fillStyle=paper?'#334155':'#cbd5e1';ctx.fillText('速度分解',105,y-17);
    }
    ctx.restore();
  },
  getControlHandles: (_state, params) => [
    params.mode === 'magnetic-mirror'
      ? {
          id: 'mirror-coil-span',
          label: `z_c=${params.coilHalfSpanM.toFixed(1)} m`,
          position: { x: params.coilHalfSpanM, y: 0 },
          origin: { x: 0, y: 0 },
          handleKind: 'point' as const,
          color: '#f59e0b',
          onDrag: (world: { x: number; y: number }) => {
            const span = Math.max(0.8, Math.min(2.5, Math.round((Math.abs(world.x)) * 10) / 10));
            return { coilHalfSpanM: Number(span.toFixed(1)) };
          }
        }
      : {
          id: 'tokamak-major-radius',
          label: `R₀=${params.majorRadiusM.toFixed(1)} m`,
          position: { x: params.majorRadiusM, y: 0 },
          origin: { x: 0, y: 0 },
          handleKind: 'radius' as const,
          color: '#f59e0b',
          onDrag: (world: { x: number; y: number }) => {
            const radius = Math.max(1, Math.min(2.2, Math.round((Math.hypot(world.x, world.y)) * 10) / 10));
            return { majorRadiusM: Number(radius.toFixed(1)) };
          }
        }
  ],
  getForceVectors: (state, params) => {
    const velocity = state.velocity;
    const magnetic = state.bField;
    const ax = velocity.y * magnetic.z - velocity.z * magnetic.y;
    const ay = velocity.z * magnetic.x - velocity.x * magnetic.z;
    const az = velocity.x * magnetic.y - velocity.y * magnetic.x;
    const a = fusionDisplayPoint({ x: ax * params.qOverM, y: ay * params.qOverM, z: az * params.qOverM }, params.mode);
    return [{
      id: 'fusion-lorentz-acceleration',
      label: 'a洛 = (q/m)v×B',
      origin: fusionDisplayPoint(state.position, params.mode),
      force: { x: a.x, y: a.y },
      color: '#38bdf8',
      category: 'magnetic',
      unit: 'm/s²'
    }];
  },
  referenceFrames: [{
    id: 'confined-particle',
    label: '约束带电粒子随动参考系',
    getOrigin: (state, params) => fusionDisplayPoint(state.position, params.mode),
    getVelocity: (state, params) => fusionDisplayPoint(state.velocity, params.mode)
  }],
  formatFormulas: (state, params) => {
    const b = Math.hypot(state.bField.x, state.bField.y, state.bField.z);
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    if(params.mode==='tokamak'){
      const rho=fusionMinorRadius(state.position,params);
      return [{id:'tokamak-field',label:'环向场与单粒子状态',latex:'B_\\phi=B_0R_0/R',
        substitutedLatex:`\\begin{aligned}|B|&=${b.toFixed(3)}\\text{ T}\\\\v&=${speed.toFixed(3)}\\text{ m/s}\\\\\\rho&=${rho.toFixed(3)}\\text{ m}\\\\q_{\\rm surf}(\\rho_0)&=${fusionSurfaceWinding(params,.28).toFixed(3)}\\end{aligned}`}];
    }
    return [{
      id: 'magnetic-mirror-mu', label: '轴线磁镜与绝热近似',
      latex: '\\begin{aligned}R_m&=1+(z_c/L)^2\\\\\\sin\\theta_c&=1/\\sqrt{R_m}\\end{aligned}',
      substitutedLatex: `\\begin{aligned}\\theta_c&=${computeMirrorLossConeDeg(params).toFixed(2)}^\\circ\\\\z&=${state.position.z.toFixed(3)}\\text{ m}\\\\N_{\\rm ref}&=${state.reflectionCount}\\\\\\Delta\\mu/\\mu&=${(state.maxMuRelDev * 100).toFixed(2)}\\%\\end{aligned}`
    }];
  }
}), { storyDecks: fusionStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xy' as const, defaultVisibleHeight: 5.2, sceneDepthRadius: 7, default3DAzimuthRad: 0.5, default3DPolarRad: 1.05 } });

export default stseTokamakMagneticMirrorPlugin;
