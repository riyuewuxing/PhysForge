import { orbitalStoryDecks } from './storyDecks.js';
import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { astroOrbitalPresets } from './presets.js';
import {
  checkInvariants,
  computeLagrangePoints,
  computeObservables,
  buildAstroScaleContext,
  binaryMassRatio,binaryGravityAt,
  createInitialState,
  extractRocheIsolines,
  stepAstroOrbital,
  type AstroOrbitalParams,
  type AstroOrbitalState
} from './engine.js';

/** Shared inertial/corotating display coordinates; dynamics stay in the inertial frame. */
export function orbitDisplayXY(x: number, y: number, t: number, corotating: boolean) {
  const theta = corotating ? -t : 0;
  const c = Math.cos(theta), sin = Math.sin(theta);
  return { x: x * c - y * sin, y: x * sin + y * c };
}

/** Each inertial historical point is transformed at its own physical time. */
export function orbitDisplayTrail(state:AstroOrbitalState,corotating:boolean){
  const history=state.trailNorm.filter(p=>!corotating||Number.isFinite(p.tNorm));
  return history.map(p=>orbitDisplayXY(p.x,p.y,p.tNorm,corotating));
}

/** Engine-reported Hohmann impulses only; no synthetic burn positions or timing. */
export function orbitalBurnMarkers(state:AstroOrbitalState,params:AstroOrbitalParams){
  if(params.mode!=='hohmann-transfer')return [];
  return state.events.flatMap(event=>{
    const index=event.id==='hohmann-burn-1'?1:event.id.startsWith('hohmann-burn-2-')?2:0;
    const pos=event.position;
    const deltaV=index===1?event.metrics?.deltaV1SI:event.metrics?.deltaV2SI;
    if(!index||!pos||deltaV===undefined||!Number.isFinite(deltaV))return [];
    const radius=Math.hypot(pos.x,pos.y);
    if(radius<1e-10)return [];
    return [{index,x:pos.x,y:pos.y,deltaV,dx:-pos.y/radius*Math.sign(deltaV),dy:pos.x/radius*Math.sign(deltaV)}];
  });
}
export function orbitDisplayVelocity(state:AstroOrbitalState,corotating:boolean){
  return orbitDisplayXY(state.vxNorm+(corotating?state.yNorm:0),state.vyNorm-(corotating?state.xNorm:0),state.tNorm,corotating);
}

const paramSchema: readonly ParamFieldSpec<AstroOrbitalParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '天体模型',
    defaultValue: 'kepler-ellipse',
    options: [
      { value: 'kepler-ellipse', label: '开普勒椭圆与宇宙速度' },
      { value: 'hohmann-transfer', label: '霍曼双脉冲转移变轨' },
      { value: 'binary-lagrange', label: '双星系统与拉格朗日点' }
    ]
  },
  {
    key: 'scaleRegime',
    kind: 'select',
    label: '尺度量纲 (ScaleContext)',
    defaultValue: 'earth-orbit',
    options: [
      { value: 'earth-orbit', label: '近地卫星轨道 (7000 km / M地)' },
      { value: 'solar-au', label: '日地天文尺度 (1 AU / M日)' }
    ]
  },
  { key: 'r1Ratio', kind: 'number', label: '近地点尺度比 r₁/L₀', unit: '', min: 0.5, max: 2, step: 0.1, defaultValue: 1 },
  { key: 'r2OverR1', kind: 'number', label: '霍曼目标半径比 r₂/r₁', unit: '', min: 1.2, max: 3.5, step: 0.1, defaultValue: 2.4 },
  { key: 'v0Ratio', kind: 'number', label: '初速度比 v₀/v_环', unit: '', min: 0.7, max: 1.45, step: 0.02, defaultValue: 1.2 },
  { key: 'massRatioQ', kind: 'number', label: '双星次星质量比 q', unit: '', min: 0.01, max: 0.4, step: 0.01, defaultValue: 0.03 },
  { key: 'simSpeed', kind: 'number', label: '仿真倍率', unit: 'x', min: 0.5, max: 4, step: 0.5, defaultValue: 1 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "hohmann-first-burn",
    "title": "圆轨道霍曼转移第一次加速（κ=r₂/r₁）",
    "latex": "\\frac{\\Delta v_1}{v_{c1}}=\\sqrt{\\frac{2\\htmlClass{pf-live-var}{\\htmlData{param=r2OverR1}{\\kappa}}}{1+\\htmlClass{pf-live-var}{\\htmlData{param=r2OverR1}{\\kappa}}}}-1",
    "bindings": [
      {
        "tokenKey": "r2OverR1",
        "paramKey": "r2OverR1",
        "label": "霍曼目标半径比 r₂/r₁",
        "unit": "",
        "min": 1.2,
        "max": 3.5,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "hohmann-transfer"
      ]
    }
  },
  {
    "id": "circular-speed",
    "title": "圆轨道速度（r₁=ηL₀，M 由尺度位形确定）",
    "latex": "v_{c1}=\\sqrt{\\frac{GM}{\\htmlClass{pf-live-var}{\\htmlData{param=r1Ratio}{\\eta}}L_0}}",
    "bindings": [
      {
        "tokenKey": "r1Ratio",
        "paramKey": "r1Ratio",
        "label": "近地点尺度比 r₁/L₀",
        "unit": "",
        "min": 0.5,
        "max": 2,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "kepler-ellipse",
        "hohmann-transfer"
      ]
    }
  },
  {
    "id": "binary-barycenter",
    "title": "双星质心距离（a 为两星间距）",
    "latex": "\\begin{aligned}r_1&=\\htmlClass{pf-live-var}{\\htmlData{param=massRatioQ}{q}}a\\\\r_2&=(1-q)a\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "massRatioQ",
        "paramKey": "massRatioQ",
        "label": "双星次星质量比 q",
        "unit": "",
        "min": 0.01,
        "max": 0.4,
        "step": 0.01,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "binary-lagrange"
      ]
    }
  }
];
export const astroOrbitalMechanicsPlugin = Object.assign(defineSimulationPlugin<AstroOrbitalParams, AstroOrbitalState>({
  meta: {
    id: 'astro-orbital-mechanics',
    title: '万有引力、霍曼转移与拉格朗日点 (M10)',
    textbookRef: '人教版 必修第二册 第七章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'hybrid',
  defaultView: {
    scale: (params) => (0.42 / 0.24) / (params.mode === 'hohmann-transfer' ? params.r2OverR1 + 0.6 : 2.6),
    offsetRatioX: 0.05
  },
  paramSchema,
  presets: astroOrbitalPresets,
  engine: {
    createInitialState,
    step: stepAstroOrbital,
    computeObservables,
    checkInvariants
  },
  getForceVectors: (state, params, activeLayers) => {
    const { muSI, r1SI } = buildAstroScaleContext(params);
    const scaleSI = muSI / (r1SI * r1SI);
    const position = { x: state.xNorm, y: state.yNorm };
    if (params.mode !== 'binary-lagrange') {
      const r2 = position.x * position.x + position.y * position.y;
      const scale = r2 > 1e-12 ? -scaleSI / (r2 * Math.sqrt(r2)) : 0;
      return [{
        id: 'central-gravity', label: 'F_g (1 kg)', origin: position,
        force: { x: scale * position.x, y: scale * position.y }, color: '#fbbf24', category: 'gravity', unit: 'N'
      }];
    }

    const corotating = activeLayers?.has('corotatingView') ?? false;
    const project = (x: number, y: number) => orbitDisplayXY(x, y, state.tNorm, corotating);
    return binaryGravityAt(position.x,position.y,state.tNorm,params.massRatioQ).map((primary,index)=>({
      id:'primary-'+(index+1),label:index===0?'F₁ (1 kg)':'F₂ (1 kg)',
      origin:project(position.x,position.y),force:project(scaleSI*primary.ax,scaleSI*primary.ay),
      color:index===0?'#fbbf24':'#fb923c',category:'gravity' as const,unit:'N'
    }));
  },
  layers: [
    { id: 'orbit', label: '轨道轨迹与天体', defaultVisible: true },
    { id: 'keplerSectors', label: '开普勒等面积扫过扇区', defaultVisible: true },
    { id: 'rocheIsolines', label: '拉格朗日 L₁–L₅ 与洛希等势线', defaultVisible: true },
    { id: 'corotatingView', label: '双星共转系锁定视图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'rNorm', label: '无量纲距离 r/r₁', unit: '', color: '#38bdf8' },
    { key: 'speedNorm', label: '无量纲速率 v/v_环', unit: '', color: '#4ade80' },
    { key: 'energyNorm', label: '惯性系比机械能 ε', unit: '', color: '#fbbf24' },
    { key: 'angularMomNorm', label: '惯性系比角动量 Lz', unit: '', color: '#f472b6' },
    { key:'jacobiConstant',label:'三体雅可比积分 C',unit:'',color:'#fbbf24' },
    { key:'rotatingSpeedNorm',label:'共转系归一化速率',unit:'',color:'#4ade80' }
  ],
  referenceFrames: [
    {
      id: 'satellite',
      label: '卫星随动参考系',
      getOrigin: (s, p, layers) => orbitDisplayXY(s.xNorm, s.yNorm, s.tNorm, p.mode === 'binary-lagrange' && (layers?.has('corotatingView') ?? false)),
      getVelocity: (s, p, layers) => {
        const rotating = p.mode === 'binary-lagrange' && (layers?.has('corotatingView') ?? false);
        return orbitDisplayVelocity(s,rotating);
      }
    }
  ],
  getControlHandles: (state, params) =>
    params.mode === 'kepler-ellipse'
      ? [
          {
            id: 'periapsis-speed',
            label: `v₀/v_环=${params.v0Ratio.toFixed(2)}`,
            position: { x: 1, y: params.v0Ratio - 1 },
            handleKind: 'vector',
            color: '#4ade80',
            onDrag: (wp) => ({
              v0Ratio: Number(Math.max(0.7, Math.min(1.45, 1 + wp.y)).toFixed(2))
            })
          }
        ]
      : state.hohmannPhase === 'transfer'
        ? [
            {
              id: 'target-r2',
              label: `r₂/r₁=${params.r2OverR1.toFixed(1)}`,
              position: { x: -params.r2OverR1, y: 0 },
              handleKind: 'point',
              color: '#fbbf24',
              onDrag: (wp) => ({
                r2OverR1: Number(Math.max(1.2, Math.min(3.5, -wp.x)).toFixed(1))
              })
            }
          ]
        : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'astro-orbital-mechanics',
      title: '万有引力与天体力学',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<AstroOrbitalParams>
  },
  exportDiagramIR: (state,params)=>{
    // Export the inertial view: history points carry no individual time stamps.
    const primitives:DiagramPrimitive[]=[];
    if(params.mode==='binary-lagrange'){
      const q=binaryMassRatio(params.massRatioQ),c=Math.cos(state.tNorm),sin=Math.sin(state.tNorm);
      primitives.push({kind:'circle',cx:-q*c,cy:-q*sin,r:0.13,fill:true},
        {kind:'circle',cx:(1-q)*c,cy:(1-q)*sin,r:0.065,fill:true});
    }else primitives.push({kind:'circle',cx:0,cy:0,r:0.13,fill:true});
    if(params.mode==='hohmann-transfer')primitives.push({kind:'circle',cx:0,cy:0,r:1,dashed:true},
      {kind:'circle',cx:0,cy:0,r:params.r2OverR1,dashed:true});
    primitives.push({kind:'polyline',points:state.trailNorm,dashed:true},
      {kind:'circle',cx:state.xNorm,cy:state.yNorm,r:0.05,fill:true},
      {kind:'arrow',x1:state.xNorm,y1:state.yNorm,x2:state.xNorm+state.vxNorm*0.45,y2:state.yNorm+state.vyNorm*0.45,label:'v'});
    for(const burn of orbitalBurnMarkers(state,params))primitives.push(
      {kind:'circle',cx:burn.x,cy:burn.y,r:0.08},
      {kind:'arrow',x1:burn.x,y1:burn.y,x2:burn.x+0.45*burn.dx,y2:burn.y+0.45*burn.dy,label:'Δv'+burn.index});
    const extent=Math.max(2.8,params.mode==='hohmann-transfer'?params.r2OverR1+0.6:0,Math.hypot(state.xNorm,state.yNorm)+0.6);
    return {width:720,height:460,viewBox:{minX:-extent,minY:-extent,maxX:extent,maxY:extent},
      title:'天体轨道动力学配图（惯性系，归一化长度）',primitives};
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const baseExtent = params.mode === 'hohmann-transfer' ? params.r2OverR1 + 0.6 : 2.6;
    const m = createWorldMapper(viewport);
    const baseViewScale = (0.42 / 0.24) / baseExtent;
    const markerRadius = (pixels: number) => m.len(pixels / (Math.min(viewport.width, viewport.height) * 0.24 * baseViewScale));
    const useCorotating = params.mode === 'binary-lagrange' && activeLayers.has('corotatingView');

    const mapPoint = (x: number, y: number): { px: number; py: number } => {
      const p = orbitDisplayXY(x, y, state.tNorm, useCorotating);
      const point = m.toScreen(p.x, p.y);
      return { px: point.x, py: point.y };
    };

    ctx.save();

    if (params.mode === 'binary-lagrange' && activeLayers.has('rocheIsolines')) {
      const contours = extractRocheIsolines(params.massRatioQ);
      const rot = useCorotating ? 0 : state.tNorm;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1;
      for (const c of contours) {
        ctx.beginPath();
        for (const seg of c.segments) {
          const ax = seg.a.x * cr - seg.a.y * sr;
          const ay = seg.a.x * sr + seg.a.y * cr;
          const bx = seg.b.x * cr - seg.b.y * sr;
          const by = seg.b.x * sr + seg.b.y * cr;
          const a = m.toScreen(ax, ay);
          const b = m.toScreen(bx, by);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }

      const lPts = computeLagrangePoints(params.massRatioQ);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '11px sans-serif';
      for (const lp of lPts) {
        const lx = lp.x * cr - lp.y * sr;
        const ly = lp.x * sr + lp.y * cr;
        ctx.beginPath();
        const point = m.toScreen(lx, ly);
        ctx.arc(point.x, point.y, markerRadius(3.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(lp.id, point.x + 6, point.y - 4);
      }
    }

    if (params.mode === 'kepler-ellipse' && activeLayers.has('keplerSectors')) {
      state.sectors.forEach((sec, idx) => {
        if (sec.vertices.length < 2) return;
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(244, 114, 182, 0.2)';
        ctx.beginPath();
        const origin = m.toScreen(0, 0);
        ctx.moveTo(origin.x, origin.y);
        for (const v of sec.vertices) {
          const point = m.toScreen(v.x, v.y);
          ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.fill();
      });
    }

    if (activeLayers.has('orbit')) {
      if (params.mode === 'hohmann-transfer') {
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const origin = m.toScreen(0, 0);
        ctx.arc(origin.x, origin.y, m.len(1), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, params.r2OverR1 * m.ppm, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const history=orbitDisplayTrail(state,useCorotating);
      if(history.length>1){
        ctx.strokeStyle=viewport.theme==='projector'?'#0369a1':'#38bdf8';
        ctx.lineWidth=2;ctx.beginPath();
        history.forEach((point,i)=>{const p=m.toScreen(point.x,point.y);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.stroke();
      }

      if (params.mode === 'binary-lagrange') {
        const q = binaryMassRatio(params.massRatioQ);
        const p1 = { x: -q * Math.cos(state.tNorm), y: -q * Math.sin(state.tNorm) };
        const p2 = { x: (1 - q) * Math.cos(state.tNorm), y: (1 - q) * Math.sin(state.tNorm) };
        const c1 = mapPoint(p1.x, p1.y);
        const c2 = mapPoint(p2.x, p2.y);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(c1.px, c1.py, markerRadius(14), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(c2.px, c2.py, markerRadius(7), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        const origin = m.toScreen(0, 0);
        ctx.arc(origin.x, origin.y, markerRadius(16), 0, Math.PI * 2);
        ctx.fill();
      }

      const sat = mapPoint(state.xNorm, state.yNorm);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(sat.px, sat.py, markerRadius(6), 0, Math.PI * 2);
      ctx.fill();
      const drawArrow=(x:number,y:number,dx:number,dy:number,color:string,label:string)=>{
        const a=m.toScreen(x,y),b=m.toScreen(x+dx,y+dy),angle=Math.atan2(b.y-a.y,b.x-a.x);
        if(Math.hypot(dx,dy)<1e-8)return;
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
        ctx.moveTo(b.x-8*Math.cos(angle-.45),b.y-8*Math.sin(angle-.45));ctx.lineTo(b.x,b.y);
        ctx.lineTo(b.x-8*Math.cos(angle+.45),b.y-8*Math.sin(angle+.45));ctx.stroke();
        ctx.font='12px sans-serif';ctx.fillText(label,b.x+4,b.y-4);
      };
      const v=orbitDisplayVelocity(state,useCorotating),position=orbitDisplayXY(state.xNorm,state.yNorm,state.tNorm,useCorotating);
      drawArrow(position.x,position.y,v.x*.35,v.y*.35,'#4ade80','v');
      for(const burn of orbitalBurnMarkers(state,params)){
        const p=m.toScreen(burn.x,burn.y);ctx.strokeStyle='#fb923c';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(p.x,p.y,markerRadius(8),0,Math.PI*2);ctx.stroke();
        drawArrow(burn.x,burn.y,burn.dx*.45,burn.dy*.45,'#fb923c','Δv'+burn.index);
      }
      if(useCorotating){ctx.font='12px sans-serif';ctx.fillStyle=viewport.theme==='projector'?'#475569':'#94a3b8';ctx.fillText('共转系 · 各历史点按自身时刻转换',18,28);}

    }

    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    if (params.mode === 'binary-lagrange') {
      const display = orbitDisplayXY(state.xNorm, state.yNorm, state.tNorm, true);
      return [{ id: 'binary-jacobi',label:'三体共转系雅可比积分（归一化）',
        latex:'C=2U+x^2+y^2-|\\\\mathbf v_{\\\\rm rot}|^2',
        substitutedLatex:`C=${obs.jacobiConstant!.toFixed(7)}`},
        { id: 'binary-state', label: '共转系试探粒子位置（双星间距为长度单位）',
        latex: 'r_1/a=q,\\quad r_2/a=1-q',
        substitutedLatex: `\\begin{aligned}x_{\\rm rot}/a&=${display.x.toFixed(3)}\\\\y_{\\rm rot}/a&=${display.y.toFixed(3)}\\\\q&=${binaryMassRatio(params.massRatioQ).toFixed(3)}\\end{aligned}` }];
    }
    const items = [{ id: 'orbit-state', label: '归一化二体轨道状态',
      latex: 'r/r_1,\\quad v/v_{c1},\\quad e',
      substitutedLatex: `\\begin{aligned}r/r_1&=${(obs.rNorm ?? 0).toFixed(4)}\\\\v/v_{c1}&=${(obs.speedNorm ?? 0).toFixed(4)}\\\\e&=${(obs.eccentricity ?? 0).toFixed(4)}\\end{aligned}` }];
    items.push({id:'orbit-integrals',label:'归一化比机械能与比角动量',
      latex:'\\varepsilon=\\tfrac12v^2-1/r,\\quad h_z=xv_y-yv_x',
      substitutedLatex: `\\begin{aligned}\\varepsilon&=${(obs.energyNorm??0).toFixed(5)}\\\\h_z&=${(obs.angularMomNorm??0).toFixed(5)}\\end{aligned}`});
    if (params.mode === 'hohmann-transfer') {
      const dv2 = state.hohmannPhase === 'circularized'
        ? `${(state.deltaV2SI / 1000).toFixed(3)}\\text{ km/s}` : '\\text{待点火}';
      items.push({ id: 'hohmann-dv', label: '霍曼转移实际脉冲速度增量',
        latex: '\\Delta v_1=\\sqrt{GM/r_1}\\left(\\sqrt{2r_2/(r_1+r_2)}-1\\right)',
        substitutedLatex: `\\begin{aligned}\\Delta v_1&=${(state.deltaV1SI / 1000).toFixed(3)}\\text{ km/s}\\\\\\Delta v_2&=${dv2}\\end{aligned}` });
    } else if (state.sectors.length >= 2) {
      const previous = state.sectors[state.sectors.length - 2], last = state.sectors[state.sectors.length - 1];
      if (previous && last) items.push({ id: 'kepler-area', label: '最近两个完整等时区间的数值扫过面积',
        latex: '\\Delta A=\\frac12|\\mathbf r\\times\\mathbf v|\\Delta t',
        substitutedLatex: `\\begin{aligned}A_{n-1}/r_1^2&=${previous.areaDimless.toFixed(5)}\\\\A_n/r_1^2&=${last.areaDimless.toFixed(5)}\\end{aligned}` });
    }
    return items;
  }
}), { storyDecks: orbitalStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xz' as const, defaultVisibleHeight: 8.5, sceneDepthRadius: 8, default3DAzimuthRad: 0.5, default3DPolarRad: 0.92 } });

export default astroOrbitalMechanicsPlugin;
