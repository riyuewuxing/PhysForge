import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { magneticStoryDecks } from './storyDecks.js';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec, type ForceVectorItem, type Viewport, createWorldMapper } from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeLarmorCircleForTrack,
  computeObservables,
  createInitialState,
  fieldSignedDistance,
  stepBoundedMagnetic,
  type BoundedMagneticParams,
  type BoundedMagneticState,
  type ParticleTrack
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<BoundedMagneticParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '场域几何类型',
    options: [
      { label: '直线半空间边界 (x≥0)', value: 'half-space' },
      { label: '圆形有界匀强磁场', value: 'circular' },
      { label: '矩形有界匀强磁场', value: 'rectangular' },
      { label: '正交电磁复合场 (E×B)', value: 'crossed-eb' }
    ],
    defaultValue: 'circular'
  },
  {
    key: 'family',
    kind: 'select',
    label: '动态圆族模式',
    options: [
      { label: '单粒子精细观测', value: 'single' },
      { label: '放缩圆（不同速率）', value: 'scaling' },
      { label: '旋转圆（不同入射角）', value: 'rotating' },
      { label: '平移圆（不同入射位置）', value: 'translating' },
      { label: '磁聚焦（圆形场平行汇聚）', value: 'focusing' }
    ],
    defaultValue: 'focusing'
  },
  {
    key: 'mass',
    kind: 'number',
    label: '粒子质量 m',
    unit: 'kg',
    min: 0.2,
    max: 5,
    step: 0.1,
    defaultValue: 1
  },
  {
    key: 'charge',
    kind: 'number',
    label: '粒子电荷量 q',
    unit: 'C',
    min: -3,
    max: 3,
    step: 0.5,
    defaultValue: 1
  },
  {
    key: 'magneticFieldZ',
    kind: 'number',
    label: '磁感应强度 Bz',
    unit: 'T',
    min: -4,
    max: 4,
    step: 0.2,
    defaultValue: 2
  },
  {
    key: 'electricFieldY',
    kind: 'number',
    label: '电场强度 Ey（复合场）',
    unit: 'V/m',
    min: -6,
    max: 6,
    step: 0.5,
    defaultValue: 3
  },
  {
    key: 'initialSpeed',
    kind: 'number',
    label: '入射初速率 v₀',
    unit: 'm/s',
    min: 0,
    max: 6,
    step: 0.2,
    defaultValue: 2.4
  },
  {
    key: 'launchAngleDeg',
    kind: 'number',
    label: '入射偏转角 θ',
    unit: '°',
    min: -60,
    max: 60,
    step: 5,
    defaultValue: 0
  },
  {
    key: 'fieldScale',
    kind: 'number',
    label: '磁场尺度 R / W',
    unit: 'm',
    min: 0.5,
    max: 2.5,
    step: 0.1,
    defaultValue: 1.2
  },
  {
    key: 'beamCount',
    kind: 'number',
    label: '粒子束数量',
    unit: '束',
    min: 1,
    max: 9,
    step: 1,
    defaultValue: 5
  }
];

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  label?: string
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.min(11, len * 0.35);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(label, x2 + 6, y2 - 6);
  }
  ctx.restore();
}


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "larmor-initial",
    "title": "纯磁场初始回旋半径（qB ≠ 0）",
    "latex": "r_0=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=mass}{m}}\\htmlClass{pf-live-var}{\\htmlData{param=initialSpeed}{v_0}}}{|\\htmlClass{pf-live-var}{\\htmlData{param=charge}{q}}\\htmlClass{pf-live-var}{\\htmlData{param=magneticFieldZ}{B_z}}|}",
    "bindings": [
      {
        "tokenKey": "mass",
        "paramKey": "mass",
        "label": "粒子质量 m",
        "unit": "kg",
        "min": 0.2,
        "max": 5,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "initialSpeed",
        "paramKey": "initialSpeed",
        "label": "入射初速率 v₀",
        "unit": "m/s",
        "min": 0,
        "max": 6,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "charge",
        "paramKey": "charge",
        "label": "粒子电荷量 q",
        "unit": "C",
        "min": -3,
        "max": 3,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "magneticFieldZ",
        "paramKey": "magneticFieldZ",
        "label": "磁感应强度 Bz",
        "unit": "T",
        "min": -4,
        "max": 4,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "half-space",
        "circular",
        "rectangular"
      ]
    }
  },
  {
    "id": "crossed-field-drift",
    "title": "正交匀强复合场漂移速度（q≠0、B_z≠0）",
    "latex": "v_d=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=electricFieldY}{E_y}}}{\\htmlClass{pf-live-var}{\\htmlData{param=magneticFieldZ}{B_z}}}",
    "bindings": [
      {
        "tokenKey": "electricFieldY",
        "paramKey": "electricFieldY",
        "label": "电场强度 E_y",
        "unit": "V/m",
        "min": -6,
        "max": 6,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "magneticFieldZ",
        "paramKey": "magneticFieldZ",
        "label": "磁场强度 B_z",
        "unit": "T",
        "min": -4,
        "max": 4,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "crossed-eb"
      ]
    }
  }
];
/** Display-only auxiliary circle in the uniformly translating E×B drift frame.
 * In pure B the unmodified engine helper is exact; in crossed fields reuse its geometry
 * with the velocity relative to the drift. No change to integrated state or observables. */
export function displayLarmorCircleForTrack(track: ParticleTrack, params: BoundedMagneticParams) {
  if (params.mode !== 'crossed-eb') return track.inField ? computeLarmorCircleForTrack(track, params) : null;
  if (params.magneticFieldZ === 0 || params.charge === 0) return null;
  const vd = params.electricFieldY / params.magneticFieldZ;
  return computeLarmorCircleForTrack({
    ...track,
    state: { ...track.state, velocity: { ...track.state.velocity, x: track.state.velocity.x - vd } }
  }, params);
}

/** Physical B orientation and a finite display window are shared by all output paths. */
export function b1FieldSymbol(bz:number):'dot'|'cross'|null{return bz>0?'dot':bz<0?'cross':null;}
export function b1FieldCaption(p:BoundedMagneticParams):string{
  const geometry=p.mode==='circular'?'圆形场域':p.mode==='rectangular'?'矩形场域':p.mode==='half-space'?'x≥0 半空间（截取显示）':'全空间匀强场（截取显示）';
  return geometry+' · '+(p.magneticFieldZ>0?'B 出纸面 (+z)':p.magneticFieldZ<0?'B 入纸面 (−z)':'B=0');
}
export function b1StateCaption(s:BoundedMagneticState,p:BoundedMagneticParams):string{
  if(p.mode==='crossed-eb')return 't='+s.t.toFixed(3)+' s · '+(p.charge!==0&&p.magneticFieldZ!==0?'漂移系辅助圆':'无磁回旋');
  return 't='+s.t.toFixed(3)+' s · 入场 '+s.particles.filter(t=>t.hasEntered).length+'/'+s.particles.length+' · 出场 '+s.particles.filter(t=>t.hasExited).length+'/'+s.particles.length;
}

/** The illustrative field window is tied to physical coordinates and state,
 * never to screen pan, zoom or clip order. A marker is not a field source.
 * Integer lattice indices keep a stationary marker fixed in world space. */
export function b1FieldSampleWindow(state:BoundedMagneticState,p:BoundedMagneticParams){
  const pos=state.particles[0]?.state.position??{x:0,y:0};
  const step=.55;
  const ix=Math.round(pos.x/step),iy=Math.round(pos.y/step);
  const points:{x:number;y:number}[]=[];
  if(p.mode==='circular'||p.mode==='rectangular'){
    const r=Math.max(p.fieldScale,p.mode==='circular'?.05:.1);
    const h=Math.max(p.fieldScale*1.6,.2)/2;
    const spacing=Math.min(step,r/2);
    const left=p.mode==='circular'?-Math.floor(r/spacing):0,right=Math.floor(r/spacing);
    const top=Math.floor((p.mode==='circular'?r:h)/spacing);
    for(let i=left;i<=right;i++)for(let j=-top;j<=top;j++){
      const x=i*spacing,y=j*spacing;
      if(fieldSignedDistance({x,y,z:0},p.mode,p.fieldScale)<-Math.min(.05,r*.06))points.push({x,y});
    }
    if(points.length===0)points.push({x:p.mode==='circular'?0:r/2,y:0});
  }else{
    const left=p.mode==='half-space'?Math.max(1,ix-5):ix-5;
    for(let i=left;i<=left+10;i++)for(let j=iy-4;j<=iy+4;j++)points.push({x:i*step,y:j*step});
  }
  const electricCenters:{x:number;y:number}[]=[];
  if(p.mode==='crossed-eb')for(let i=-2;i<=2;i++)electricCenters.push({x:(ix+2*i)*step,y:(iy-2)*step});
  return {points,electricCenters};
}

export type B1Bounds={minX:number;maxX:number;minY:number;maxY:number};
export type B1SafeRect={left:number;right:number;top:number;bottom:number};
/** A common visual scale for the three velocity vectors. Their tip-to-tail sum
 * is exact, but lengths are display-scaled rather than force or world distances. */
export function b1VelocityDisplay(track:ParticleTrack,p:BoundedMagneticParams,layers:ReadonlySet<string>){
  const {x:vx,y:vy}=track.state.velocity;
  const decomposition=layers.has('speedDecomposition')&&track.id===0&&p.mode==='crossed-eb'&&p.charge!==0&&Math.abs(p.magneticFieldZ)>1e-6;
  const vd=decomposition?p.electricFieldY/p.magneticFieldZ:0;
  const rx=vx-vd,ry=vy;
  const scale=Math.min(.22,1.15/Math.max(Math.hypot(vx,vy),Math.abs(vd),Math.hypot(rx,ry),1e-6));
  return {vx,vy,vd,rx,ry,scale,decomposition};
}

/** Include only visible physical content, not the artificial display window
 * of an infinite field. Huge auxiliary circles are intentionally allowed to
 * extend beyond the view rather than shrinking all real particles to dots. */
export function b1FrameBounds(s:BoundedMagneticState,p:BoundedMagneticParams,layers:ReadonlySet<string>):B1Bounds{
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  const add=(x:number,y:number)=>{if(Number.isFinite(x)&&Number.isFinite(y)){
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }};
  if(layers.has('fieldRegion')){
    if(p.mode==='circular'){const r=Math.max(p.fieldScale,.05);add(-r,-r);add(r,r);}
    if(p.mode==='rectangular'){const w=Math.max(p.fieldScale,.1),h=Math.max(p.fieldScale*1.6,.2)/2;add(0,-h);add(w,h);}
    if(p.mode==='half-space'){add(0,-1.2);add(0,1.2);}
  }
  for(const tr of s.particles){
    const pos=tr.state.position;add(pos.x,pos.y);
    if(layers.has('trajectory'))for(const pt of tr.trail)add(pt.x,pt.y);
    if(layers.has('eventPins')){if(tr.entryPoint)add(tr.entryPoint.x,tr.entryPoint.y);if(tr.exitPoint)add(tr.exitPoint.x,tr.exitPoint.y);}
    const d=b1VelocityDisplay(tr,p,layers);
    if(layers.has('velocityVector')&&(tr.id===0||s.particles.length<=5)||d.decomposition)
      add(pos.x+d.vx*d.scale,pos.y+d.vy*d.scale);
    if(d.decomposition)add(pos.x+d.vd*d.scale,pos.y);
    if(layers.has('larmorCircle')){
      const circle=displayLarmorCircleForTrack(tr,p);
      if(circle&&circle.radius<=Math.max(4,3*p.fieldScale)){
        add(circle.center.x-circle.radius,circle.center.y-circle.radius);add(circle.center.x+circle.radius,circle.center.y+circle.radius);
      }
    }
  }
  if(!Number.isFinite(minX)){add(-1,-1);add(1,1);}
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const hx=Math.max(.9,(maxX-minX)/2),hy=Math.max(.9,(maxY-minY)/2);
  return {minX:cx-hx,maxX:cx+hx,minY:cy-hy,maxY:cy+hy};
}
export function b1SafeRect(width:number,height:number,presentation:boolean,scope=true):B1SafeRect{
  return {left:Math.min(70,width*.09),right:width-Math.min(presentation?352:300,width*.40),
    top:Math.min(presentation?105:30,height*.17),
    bottom:height-Math.min(presentation?115:scope?230:85,height*.39)};
}
export function b1FitViewport(bounds:B1Bounds,viewport:Viewport,safe:B1SafeRect):Viewport{
  const cx=(bounds.minX+bounds.maxX)/2,cy=(bounds.minY+bounds.maxY)/2;
  const base=Math.min(viewport.width,viewport.height)*.24;
  const ppm=Math.max(base*.1,Math.min(base*1.15,
    Math.max(1,safe.right-safe.left-40)/(bounds.maxX-bounds.minX+.55),
    Math.max(1,safe.bottom-safe.top-40)/(bounds.maxY-bounds.minY+.55)));
  return {...viewport,scale:ppm/base,offsetX:(safe.left+safe.right)/2-.45*viewport.width-cx*ppm,
    offsetY:(safe.top+safe.bottom)/2-.5*viewport.height+cy*ppm};
}
export function b1BoundsInViewport(bounds:B1Bounds,viewport:Viewport,safe:B1SafeRect):boolean{
  const m=createWorldMapper(viewport);
  return m.toX(bounds.minX)>=safe.left+8&&m.toX(bounds.maxX)<=safe.right-8&&
    m.toY(bounds.maxY)>=safe.top+8&&m.toY(bounds.minY)<=safe.bottom-8;
}

export const emBoundedMagneticFieldPlugin = Object.assign(defineSimulationPlugin<
  BoundedMagneticParams,
  BoundedMagneticState
>({
  meta: {
    id: 'builder-composite-em-field',
    title: '自由复合场与动态圆建模器 (B1)',
    textbookRef: '人教版 选择性必修二 第一章 第2–3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  getControlHandles: (state, params) => {
    const primary = state.particles[0];
    if (!primary) return [];
    const pos = primary.state.position;
    // This handle edits the launch parameter, not the instantaneous velocity.
    const launchAngle=params.launchAngleDeg*Math.PI/180;
    const vel={x:params.initialSpeed*Math.cos(launchAngle),y:params.initialSpeed*Math.sin(launchAngle)};
    const handles = [
      {
        id: 'launch-velocity',
        label: `v₀=${params.initialSpeed.toFixed(1)}m/s`,
        position: { x: pos.x + vel.x * 0.35, y: pos.y + vel.y * 0.35 },
        origin: { x: pos.x, y: pos.y },
        handleKind: 'vector' as const,
        color: '#4ade80',
        onDrag: (worldPos: { x: number; y: number }) => {
          const dx = (worldPos.x - pos.x) / 0.35;
          const dy = (worldPos.y - pos.y) / 0.35;
          const speed = Math.max(0, Math.min(6, Math.hypot(dx, dy)));
          const deg = Math.max(-60, Math.min(60, (Math.atan2(dy, dx) * 180) / Math.PI));
          return {
            initialSpeed: Number(speed.toFixed(2)),
            launchAngleDeg: Math.round(deg / 5) * 5
          };
        }
      },
      {
        id: 'field-scale',
        label: `${params.mode==='rectangular'?'W':'R'}=${params.fieldScale.toFixed(1)}m`,
        position: { x: params.fieldScale, y: 0 },
        handleKind: 'radius' as const,
        color: '#38bdf8',
        onDrag: (worldPos: { x: number; y: number }) => ({
          fieldScale: Number(Math.max(0.5, Math.min(2.5, Math.hypot(worldPos.x, worldPos.y))).toFixed(1))
        })
      }
    ];
    // Launch controls belong to the launch state. The sliders remain available
    // during flight, but a moving particle must not carry a fake v0 vector.
    const visible=params.mode==='circular'||params.mode==='rectangular'?handles:handles.slice(0,1);
    return state.t===0?visible:visible.filter(h=>h.id!=='launch-velocity');
  },
  getForceVectors: (state, params) => {
    const primary = state.particles[0];
    if (!primary) return [];
    const pos = primary.state.position;
    const vel = primary.state.velocity;
    const activeB = params.mode === 'crossed-eb' || primary.inField ? params.magneticFieldZ : 0;
    const activeE = params.mode === 'crossed-eb' ? params.electricFieldY : 0;
    const fLorX = params.charge * vel.y * activeB;
    const fLorY = -params.charge * vel.x * activeB;
    const items:ForceVectorItem[] = [
      {
        id: 'lorentz',
        label: 'F_B',
        origin: { x: pos.x, y: pos.y },
        force: { x: fLorX, y: fLorY },
        color: '#38bdf8',
        category: 'magnetic' as const,
        unit: 'N'
      }
    ];
    if (Math.abs(activeE) > 1e-6) {
      items.push({
        id: 'electric',
        label: 'F_E',
        origin: { x: pos.x, y: pos.y },
        force: { x: 0, y: params.charge * activeE },
        color: '#fbbf24',
        category: 'electric' as const,
        unit: 'N'
      });
    }
    return items;
  },
  referenceFrames: [
    {
      id: 'primary-particle',
      label: '主粒子随动参考系',
      getOrigin: (state) => {
        const p = state.particles[0]?.state.position;
        return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
      }
    }
  ],
  sceneSerializer: {
    exportScene: (_state, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-composite-em-field',
      title: '有界磁场与复合场动态圆',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<BoundedMagneticParams>
  },
  exportDiagramIR: (state, params) => {
    const R=Math.max(params.fieldScale,params.mode==='circular'?.05:.1);
    const H=Math.max(params.fieldScale*1.6,.2);
    const primitives:DiagramPrimitive[]=[];
    const sym=b1FieldSymbol(params.magneticFieldZ);
    let minX=-Math.max(2.8,R+.2),maxX=Math.max(2.8,R+.2),minY=-Math.max(2.4,H/2+.2,R+.2),maxY=-minY;
    for(const track of state.particles)for(const point of [...track.trail,track.state.position]){
      minX=Math.min(minX,point.x-.25);maxX=Math.max(maxX,point.x+.25);
      minY=Math.min(minY,point.y-.25);maxY=Math.max(maxY,point.y+.25);
    }
    if(params.mode==='circular')primitives.push({kind:'circle',cx:0,cy:0,r:R,dashed:true});
    else if(params.mode==='half-space')primitives.push({kind:'line',x1:0,y1:minY,x2:0,y2:maxY,dashed:true});
    else if(params.mode==='rectangular')primitives.push({kind:'rect',x:0,y:-H/2,width:R,height:H,dashed:true});
    // Crossed fields are uniform in all space, so no artificial rectangular wall.
    if(sym){
      for(let x=-2.4;x<=2.4;x+=.6)for(let y=-1.8;y<=1.8;y+=.6)
        if(fieldSignedDistance({x,y,z:0},params.mode,params.fieldScale)<-.05)primitives.push({kind:'fieldMarker',x,y,symbol:sym});
    }
    if(params.mode==='crossed-eb'&&params.electricFieldY!==0){
      const sign=Math.sign(params.electricFieldY);
      primitives.push({kind:'arrow',x1:-2.1,y1:-sign*.8,x2:-2.1,y2:sign*.8,label:'E'});
    }
    for(const track of state.particles){
      if(track.trail.length>=2)primitives.push({kind:'trajectory',points:track.trail});
      const p=track.state.position;
      primitives.push({kind:'circle',cx:p.x,cy:p.y,r:.055,fill:true});
      if(track.entryPoint)primitives.push({kind:'circle',cx:track.entryPoint.x,cy:track.entryPoint.y,r:.04});
      if(track.exitPoint)primitives.push({kind:'circle',cx:track.exitPoint.x,cy:track.exitPoint.y,r:.065});
    }
    const p0=state.particles[0];
    if(p0){
      const pos=p0.state.position,v=p0.state.velocity;
      const end={x:pos.x+v.x*.35,y:pos.y+v.y*.35};
      minX=Math.min(minX,end.x-.3);maxX=Math.max(maxX,end.x+.3);
      minY=Math.min(minY,end.y-.3);maxY=Math.max(maxY,end.y+.3);
      if(Math.hypot(v.x,v.y)>1e-9)primitives.push({kind:'arrow',x1:pos.x,y1:pos.y,x2:end.x,y2:end.y,label:'v'});
    }
    primitives.push({kind:'text',x:minX+.15,y:maxY+.12,text:b1FieldCaption(params),align:'start'});
    primitives.push({kind:'text',x:minX+.15,y:minY-.12,text:b1StateCaption(state,params),align:'start'});
    return {width:720,height:460,viewBox:{minX:minX-.1,minY:minY-.35,maxX:maxX+.1,maxY:maxY+.35},title:'有界磁场与复合场动态圆试卷配图',primitives};
  },
  renderMode: 'hybrid',
  paramSchema,
  presets: [
    {
      id: 'circle-magnetic-focusing',
      name: '1. 圆形磁场磁聚焦 (R_c = R_field)',
      description: '五束平行同种电荷射入满足回旋半径等于磁场半径的圆形磁场，精确汇聚于同一边界点。',
      params: {
        mode: 'circular',
        family: 'focusing',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.4,
        fieldScale: 1.2,
        launchAngleDeg: 0,
        beamCount: 5
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'larmorCircle', 'velocityVector', 'eventPins']
    },
    {
      id: 'halfspace-rotating-circles',
      name: '2. 直线边界旋转圆与临界相切',
      description: '同速率粒子从同一点按不同入射角进入半空间磁场，动态观察旋转圆弦长与运动时间规律。',
      params: {
        mode: 'half-space',
        family: 'rotating',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.2,
        fieldScale: 1.2,
        launchAngleDeg: 0,
        beamCount: 5
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'larmorCircle', 'eventPins']
    },
    {
      id: 'circle-scaling-circles',
      name: '3. 圆形磁场放缩圆包络',
      description: '同方向不同速率粒子射入圆形有界磁场，动态呈现圆心共线且半径放缩的轨道族。',
      params: {
        mode: 'circular',
        family: 'scaling',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        initialSpeed: 2.0,
        fieldScale: 1.2,
        launchAngleDeg: 0,
        beamCount: 5
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'larmorCircle', 'eventPins']
    },
    {
      id: 'crossed-eb-cycloid',
      name: '4. 正交电磁复合场配速法摆线',
      description: '初速度为零的粒子在正交 E×B 复合场中做摆线运动，实时分解为匀速漂移 v_d 与圆周分速度 v_rot。',
      params: {
        mode: 'crossed-eb',
        family: 'single',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2,
        electricFieldY: 3,
        initialSpeed: 0,
        launchAngleDeg: 0,
        fieldScale: 1.2,
        beamCount: 1
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'velocityVector', 'speedDecomposition']
    },
    {
      id: 'misconception-lorentz-work',
      name: '5. 易错反例：洛伦兹力永不做功',
      description: '纯磁场中速度方向剧烈偏转，对比观测底部示波器动能曲线始终为水平直线。',
      params: {
        mode: 'rectangular',
        family: 'single',
        mass: 1,
        charge: 1,
        magneticFieldZ: 2.4,
        initialSpeed: 2.0,
        launchAngleDeg: 15,
        fieldScale: 1.5,
        beamCount: 1
      },
      visibleLayers: ['fieldRegion', 'trajectory', 'velocityVector', 'eventPins']
    }
  ],
  engine: {
    createInitialState,
    step: stepBoundedMagnetic,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'fieldRegion', label: '磁场边界与磁感线符号', defaultVisible: true },
    { id: 'trajectory', label: '粒子连续轨迹', defaultVisible: true },
    { id: 'larmorCircle', label: '动态圆心与完整辅助圆', defaultVisible: true },
    { id: 'velocityVector', label: '速度与洛伦兹力矢量', defaultVisible: true },
    { id: 'speedDecomposition', label: '复合场配速法分解', defaultVisible: true },
    { id: 'eventPins', label: '出入界精确事件钉点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'speed', label: '速率 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'kineticEnergy', label: '动能 Ek', unit: 'J', color: '#4ade80' },
    { key: 'x', label: '横坐标 x', unit: 'm', color: '#fbbf24' },
    { key: 'y', label: '纵坐标 y', unit: 'm', color: '#f472b6' },
    { key: 'larmorRadius', label: '场内/漂移系理论半径', unit: 'm', color: '#a78bfa' }
  ],
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    const qB = Math.abs(params.charge * params.magneticFieldZ);
    if (qB === 0) return [{
      id: 'no-magnetic-gyration', label: '无磁回旋（qB=0）',
      latex: '\\omega_c=0',
      substitutedLatex: '\\text{无磁回旋；电场作用须单独判断}'
    }];
    if (params.mode === 'crossed-eb') {
      const drift = obs.vDriftX ?? 0;
      const relativeSpeed = obs.vRotMag ?? 0;
      return [{ id: 'drift-v', label: '漂移系中的回旋半径与漂移速度',
        latex: '\\begin{aligned}v_d&=E_y/B_z\\\\ R_{\\rm rot}&=\\frac{m|\\mathbf v-\\mathbf v_d|}{|qB_z|}\\end{aligned}',
        substitutedLatex: `v_d=${drift.toFixed(3)}\\text{ m/s},\\quad R_{\\rm rot}=${(params.mass * relativeSpeed / qB).toFixed(3)}\\text{ m}` }];
    }
    return [{ id: 'larmor-r', label: state.particles[0]?.inField?'纯磁场内的回旋半径':'若进入纯磁场的理论半径',
      latex: 'R=\\frac{mv}{|qB|}',
      substitutedLatex: `R=${(obs.larmorRadius ?? 0).toFixed(3)}\\text{ m}` }];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const pxPerMeter = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
    const originX = viewport.width * 0.45 + viewport.offsetX;
    const originY = viewport.height * 0.5 + viewport.offsetY;
    const toScreen = (wx: number, wy: number) => ({
      sx: originX + wx * pxPerMeter,
      sy: originY - wy * pxPerMeter
    });

    const paper=viewport.theme==='projector';
    const palette=['#0369a1','#be185d','#166534','#92400e','#6d28d9','#be123c','#0f766e'];
    const trackColor=(track:ParticleTrack)=>paper?palette[track.id%palette.length]!:track.color;
    // 坐标系微弱网格
    ctx.save();
    ctx.strokeStyle = paper?'rgba(51,65,85,0.10)':'rgba(148, 163, 184, 0.10)';
    ctx.lineWidth = 1;
    const gridMeters = 0.5;
    const maxM = 6;
    for (let m = -maxM; m <= maxM; m += gridMeters) {
      const p = toScreen(m, m);
      ctx.beginPath();
      ctx.moveTo(p.sx, 0);
      ctx.lineTo(p.sx, viewport.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p.sy);
      ctx.lineTo(viewport.width, p.sy);
      ctx.stroke();
    }
    ctx.restore();

    // 1. 磁场区域与 ⊗ / ⊙ 符号
    if (activeLayers.has('fieldRegion')) {
      const R = Math.max(params.fieldScale, params.mode==='circular'?.05:.1);
      ctx.save();
      const grad=ctx.createRadialGradient(originX,originY,0,originX,originY,Math.max(1,Math.min(viewport.width,viewport.height)*.65));
      grad.addColorStop(0,paper?'rgba(3,105,161,.075)':'rgba(56,189,248,.075)');
      grad.addColorStop(1,paper?'rgba(3,105,161,.03)':'rgba(56,189,248,.035)');
      ctx.fillStyle=grad;ctx.strokeStyle=paper?'#0369a1':'#7dd3fc';
      ctx.lineWidth=2;
      if(!paper){ctx.shadowColor='#38bdf8';ctx.shadowBlur=6;}

      if (params.mode === 'half-space') {
        const p0 = toScreen(0, 0);
        ctx.fillRect(Math.max(0,p0.sx),0,Math.max(0,viewport.width-Math.max(0,p0.sx)),viewport.height);
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(p0.sx, 0);
        ctx.lineTo(p0.sx, viewport.height);
        ctx.stroke();
      } else if (params.mode === 'circular') {
        const c = toScreen(0, 0);
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, R * pxPerMeter, 0, Math.PI * 2);
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.stroke();
      } else if (params.mode === 'rectangular') {
        const h = Math.max(params.fieldScale*1.6,.2);
        const tl = toScreen(0, 0.5 * h);
        ctx.fillRect(tl.sx, tl.sy, R * pxPerMeter, h * pxPerMeter);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(tl.sx, tl.sy, R * pxPerMeter, h * pxPerMeter);
      } else {
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      }

      ctx.shadowBlur=0;
      // Same sign convention as DiagramIR and spatial arrows.
      const symbol=b1FieldSymbol(params.magneticFieldZ);
      if (symbol) {
        const outOfPage = symbol==='dot';
        ctx.setLineDash([]);
        ctx.strokeStyle = paper?'#0369a1':'rgba(125, 211, 252, 0.66)';
        ctx.fillStyle = paper?'#0369a1':'rgba(125, 211, 252, 0.75)';
        ctx.lineWidth = 1.4;
        for(const {x:wx,y:wy} of b1FieldSampleWindow(state,params).points){
              const p=toScreen(wx,wy);
              ctx.beginPath();
              ctx.arc(p.sx, p.sy, 6, 0, Math.PI * 2);
              ctx.stroke();
              if (outOfPage) {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, 2, 0, Math.PI * 2);
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.moveTo(p.sx - 4, p.sy - 4);
                ctx.lineTo(p.sx + 4, p.sy + 4);
                ctx.moveTo(p.sx + 4, p.sy - 4);
                ctx.lineTo(p.sx - 4, p.sy + 4);
                ctx.stroke();
              }
        }
      }

      // 复合场绘制向上的电场线箭头
      if (params.mode === 'crossed-eb' && Math.abs(params.electricFieldY) > 1e-6) {
        const sgn = params.electricFieldY > 0 ? 1 : -1;
        for(const {x,y} of b1FieldSampleWindow(state,params).electricCenters){
          const base=toScreen(x,y-.35*sgn);
          const tip=toScreen(x,y+.35*sgn);
          drawArrow(ctx, base.sx, base.sy, tip.sx, tip.sy, paper?'#92400e':'rgba(251, 191, 36, 0.78)', 'E');
        }
      }
      ctx.restore();
    }

    // 2. 动态圆辅助圆与圆心
    if (activeLayers.has('larmorCircle')) {
      for (const track of state.particles) {
        const circle = displayLarmorCircleForTrack(track, params);
        if (!circle) continue;
        const centerScreen = toScreen(circle.center.x, circle.center.y);
        const posScreen = toScreen(track.state.position.x, track.state.position.y);

        ctx.save();
        ctx.strokeStyle = trackColor(track);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(centerScreen.sx, centerScreen.sy, circle.radius * pxPerMeter, 0, Math.PI * 2);
        ctx.stroke();

        // 半径连线
        ctx.beginPath();
        ctx.moveTo(centerScreen.sx, centerScreen.sy);
        ctx.lineTo(posScreen.sx, posScreen.sy);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = trackColor(track);
        ctx.beginPath();
        ctx.arc(centerScreen.sx, centerScreen.sy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 3. 粒子轨迹
    if (activeLayers.has('trajectory')) {
      for (const track of state.particles) {
        if (track.trail.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = trackColor(track);
        ctx.lineWidth = track.id === 0 ? 3 : 2.2;
        ctx.lineJoin='round';ctx.lineCap='round';
        if(!paper){ctx.shadowColor=track.color;ctx.shadowBlur=track.id===0?8:4;}
        ctx.beginPath();
        track.trail.forEach((pt, idx) => {
          const s = toScreen(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(s.sx, s.sy);
          else ctx.lineTo(s.sx, s.sy);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // 4. 粒子主体、速度矢量与配速法分解
    for (const track of state.particles) {
      const p = toScreen(track.state.position.x, track.state.position.y);
      ctx.save();
      ctx.fillStyle = trackColor(track);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, track.id === 0 ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = paper?'#0f172a':'#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      const vector=b1VelocityDisplay(track,params,activeLayers);
      if (activeLayers.has('velocityVector') && (track.id === 0 || state.particles.length <= 5)) {
        const vScale=vector.scale*pxPerMeter;
        drawArrow(
          ctx,
          p.sx,
          p.sy,
          p.sx + track.state.velocity.x * vScale,
          p.sy - track.state.velocity.y * vScale,
          paper?'#166534':'#4ade80',
          track.id === 0 ? 'v' : undefined
        );
      }

      if (
        vector.decomposition
      ) {
        const vScale=vector.scale*pxPerMeter;
        const vd=vector.vd,vxRot=vector.rx,vyRot=vector.ry;
        drawArrow(ctx, p.sx, p.sy, p.sx + vd * vScale, p.sy, paper?'#92400e':'#fbbf24');
        drawArrow(
          ctx,
          p.sx+vd*vScale,
          p.sy,
          p.sx + (vd+vxRot) * vScale,
          p.sy - vyRot * vScale,
          paper?'#be185d':'#f472b6',
          undefined
        );
      }
    }

    // 5. 临界出入界钉点
    if (activeLayers.has('eventPins')) {
      // Each track carries its own solver-reported entry/exit point; primary event labels remain below.
      for(const track of state.particles){
        for(const [position,exit] of [[track.hasEntered?track.entryPoint:undefined,false],[track.hasExited?track.exitPoint:undefined,true]] as const){
          if(!position)continue;
          const p=toScreen(position.x,position.y);
          ctx.save();ctx.strokeStyle=trackColor(track);ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(p.sx,p.sy,exit?7:5,0,Math.PI*2);ctx.stroke();ctx.restore();
        }
      }
      for (const ev of state.events) {
        if (!ev.position) continue;
        const s = toScreen(ev.position.x, ev.position.y);
        ctx.save();
        ctx.fillStyle = paper?'#92400e':'#fbbf24';
        ctx.strokeStyle = paper?'#ffffff':'#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText(ev.label, s.sx + 9, s.sy - 8);
        ctx.restore();
      }
    }
    // Keep the coordinate/field convention outside the central trajectory and controls.
    ctx.save();ctx.font='600 12px system-ui,sans-serif';ctx.textAlign='left';
    ctx.fillStyle=paper?'#334155':'#cbd5e1';
    const y=viewport.height-102;
    ctx.fillText(b1FieldCaption(params),12,y);
    ctx.fillText(b1StateCaption(state,params),12,y+17);
    if(params.mode==='crossed-eb'&&activeLayers.has('speedDecomposition')&&params.charge!==0&&params.magneticFieldZ!==0){
      ctx.fillStyle=paper?'#92400e':'#fbbf24';ctx.fillText('v_d 漂移',12,y-17);
      ctx.fillStyle=paper?'#be185d':'#f472b6';ctx.fillText('v_rot 圆周分量',83,y-17);
    }
    ctx.restore();
  }
}), { b1FrameBounds,b1SafeRect,b1FitViewport,b1BoundsInViewport,storyDecks: magneticStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xy' as const, defaultVisibleHeight: 5.8, sceneDepthRadius: 9, default3DAzimuthRad: 0.65, default3DPolarRad: 1.15 } });

export default emBoundedMagneticFieldPlugin;
