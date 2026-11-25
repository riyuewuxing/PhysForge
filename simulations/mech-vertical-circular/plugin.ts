import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { verticalCircularStoryDecks } from './storyDecks.js';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type ParamFieldSpec } from '@physforge/sim-sdk';
import { verticalDiagram,verticalForceVectors,verticalInitialView,fitVerticalViewport,verticalBoundsFit,type VerticalRole } from './diagram.js';
import { verticalCircularPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepVerticalCircular,
  type VerticalCircularParams,
  type VerticalCircularState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<VerticalCircularParams>[] = [
  {
    key: 'trackMode',
    kind: 'select',
    label: '轨道/约束类型',
    options: [
      { label: '外凸光滑半球面 (单边脱离)', value: 'outer-dome' },
      { label: '竖直内圆轨道 / 轻绳 (单边脱离)', value: 'inner-loop' },
      { label: '刚性轻杆 / 双轨管道 (不脱轨)', value: 'light-rod' }
    ],
    defaultValue: 'outer-dome'
  },
  { key: 'mass', kind: 'number', label: '质点质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'radius', kind: 'number', label: '圆弧半径 R', unit: 'm', min: 0.8, max: 2.5, step: 0.2, defaultValue: 1.6 },
  { key: 'vLaunch', kind: 'number', label: '初始切向速率 v₀', unit: 'm/s', min: 0, max: 12, step: 0.2, defaultValue: 0.01 },
  { key: 'startAngleDeg', kind: 'number', label: '半球微扰起始角 θ₀', unit: '°', min: 0, max: 30, step: 0.5, defaultValue: 0.5 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "critical-speed",
    "title": "内圆轨道最低点临界初速",
    "latex": "v_{0,\\rm crit}=\\sqrt{5g\\htmlClass{pf-live-var}{\\htmlData{param=radius}{R}}}",
    "bindings": [
      {
        "tokenKey": "radius",
        "paramKey": "radius",
        "label": "圆弧半径 R",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "trackMode": [
        "inner-loop"
      ]
    }
  },
  {
    "id": "dome-initial-normal",
    "title": "外凸半球起始接触条件（所需反力非负）",
    "latex": "N_0=\\htmlClass{pf-live-var}{\\htmlData{param=mass}{m}}\\left(g\\cos \\htmlClass{pf-live-var}{\\htmlData{param=startAngleDeg}{\\theta_0}}-\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=vLaunch}{v_0}}^2}{\\htmlClass{pf-live-var}{\\htmlData{param=radius}{R}}}\\right)",
    "bindings": [
      {
        "tokenKey": "mass",
        "paramKey": "mass",
        "label": "质点质量 m",
        "unit": "kg",
        "min": 0.5,
        "max": 5,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "startAngleDeg",
        "paramKey": "startAngleDeg",
        "label": "半球微扰起始角 θ₀",
        "unit": "°",
        "min": 0,
        "max": 30,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "vLaunch",
        "paramKey": "vLaunch",
        "label": "初始切向速率 v₀",
        "unit": "m/s",
        "min": 0,
        "max": 12,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "radius",
        "paramKey": "radius",
        "label": "圆弧半径 R",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "trackMode": [
        "outer-dome"
      ]
    }
  },
  {
    "id": "rod-radial-reaction",
    "title": "双边轻杆的径向约束力（向内为正，θ 从最高点计）",
    "latex": "F_r=\\htmlClass{pf-live-var}{\\htmlData{param=mass}{m}}\\left(\\frac{v^2}{\\htmlClass{pf-live-var}{\\htmlData{param=radius}{R}}}-g\\cos\\theta\\right)",
    "bindings": [
      {
        "tokenKey": "mass",
        "paramKey": "mass",
        "label": "质点质量 m",
        "unit": "kg",
        "min": 0.5,
        "max": 5,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "radius",
        "paramKey": "radius",
        "label": "圆弧半径 R",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "trackMode": [
        "light-rod"
      ]
    }
  }
];
export const mechVerticalCircularPlugin = Object.assign(defineSimulationPlugin<
  VerticalCircularParams,
  VerticalCircularState
>({
  meta: {
    id: 'mech-vertical-circular',
    title: '竖直面圆周运动与单边脱轨模态切换 (M06)',
    textbookRef: '人教版 必修第二册 第六章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: {minScale:.001,scale:(p,v)=>verticalInitialView(createInitialState(p),p,v).scale,offsetRatioX:(p,v)=>verticalInitialView(createInitialState(p),p,v).offsetRatioX,offsetRatioY:(p,v)=>verticalInitialView(createInitialState(p),p,v).offsetRatioY},
  getParamFields:p=>paramSchema.filter(f=>f.key!=='startAngleDeg'||p.trackMode==='outer-dome'),
  paramSchema,
  presets: verticalCircularPresets,
  engine: {
    createInitialState,
    step: stepVerticalCircular,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'track', label: '圆弧轨道与轻杆轮廓', defaultVisible: true },
    { id: 'trajectory', label: '真实圆弧与脱轨抛体虚线', defaultVisible: true },
    { id:'construction',label:'角度、半径与速度',defaultVisible:true },
    { id:'forces',label:'实际受力矢量（等比例）',defaultVisible:false }
  ],
  telemetryChannels: [
    { key: 'normalForceN', label: '约束法向反力 FN', unit: 'N', color: '#38bdf8' },
    { key: 'speed', label: '瞬时速率 v', unit: 'm/s', color: '#fbbf24' },
    { key: 'energy', label: '系统机械能 E', unit: 'J', color: '#4ade80' },
    {key:'kineticEnergy',label:'动能 Eₖ',unit:'J',color:'#38bdf8'},
    {key:'potentialEnergy',label:'有向重力势能 Eₚ',unit:'J',color:'#f472b6'}
  ],
  getControlHandles: (s, params) => s.t>0?[]:[
    {
      id: 'radius-handle',
      label: `R=${params.radius.toFixed(1)}m`,
      position: { x: params.radius, y: 0 },
      handleKind: 'radius',
      color: '#38bdf8',
      onDrag: (wp) => ({ radius: Number(Math.max(0.8, Math.min(2.5, Math.hypot(wp.x, wp.y))).toFixed(1)) })
    }
  ],
  getForceVectors:verticalForceVectors,
  referenceFrames: [
    {
      id: 'circular-ball',
      label: '质点平移参考系',
      description:'仅平移坐标原点，不将加速随动系视为惯性系。',
      getOrigin: (s) => ({ x: s.x, y: s.y }),
      getVelocity: (s) => ({ x: s.vx, y: s.vy })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-vertical-circular',
      title: '竖直面圆周脱轨',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<VerticalCircularParams>
  },
  exportDiagramIR:(s,p,opts)=>{
    const d=verticalDiagram(s,p,opts);
    return {width:900,height:560,viewBox:d.bounds,title:'竖直圆周 · 真实接触与脱轨',primitives:d.items.map(i=>i.primitive)};
  },
  formatFormulas: (state, params) => [{
    id: 'radial-reaction-state', label: state.derailed ? '脱轨后自由抛体（不模拟再接触）' : params.trackMode==='light-rod'?'轻杆有向径向力（向内为正）':'实际单边约束力与速率',
    latex: state.derailed ? '\\mathbf a=\\mathbf g' : params.trackMode === 'outer-dome'
      ? 'N=m(g\\cos\\theta-v^2/R)' : params.trackMode==='light-rod'?'F_r=m(v^2/R-g\\cos\\theta)':'N=m(v^2/R-g\\cos\\theta)',
    substitutedLatex: `\\begin{aligned}v&=${Math.hypot(state.vx, state.vy).toFixed(3)}\\text{ m/s}\\\\${params.trackMode === 'light-rod' ? 'F_r' : 'N'}&=${(state.derailed ? 0 : state.normalForceN).toFixed(3)}\\text{ N}\\end{aligned}`
  }],
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const d=verticalDiagram(s,p),m=createWorldMapper(vp),paper=vp.theme==='projector';
    const palette:Record<VerticalRole,string>=paper?{track:'#334155',contact:'#0369a1',free:'#92400e',velocity:'#166534',guide:'#64748b',event:'#9d174d',ball:'#be185d',gravity:'#92400e',reaction:'#075985',ink:'#0f172a'}:{track:'#cbd5e1',contact:'#38bdf8',free:'#fbbf24',velocity:'#4ade80',guide:'#94a3b8',event:'#fbbf24',ball:'#f472b6',gravity:'#fbbf24',reaction:'#38bdf8',ink:'#e2e8f0'};
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    for(const [i,{primitive:q,role,layer}] of d.items.entries()){
      if(layer!=='always'&&!layers.has(layer))continue;
      const color=palette[role];ctx.save();ctx.fillStyle=color;ctx.strokeStyle=color;
      ctx.lineWidth=role==='track'?3.5:role==='contact'||role==='free'?2.5:1.7;
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);
        ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x);
          if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-9*Math.cos(ang-.4),b.y-9*Math.sin(ang-.4));ctx.lineTo(b.x-9*Math.cos(ang+.4),b.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();}
          if(q.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*15,y:(a.y+b.y)/2-Math.cos(ang)*15,text:q.label,color,font:'bold 13px sans-serif'});
        }
      }else if(q.kind==='arc'||q.kind==='circle'){
        const c=m.toScreen(q.cx,q.cy),r=m.len(q.r);
        ctx.setLineDash(q.dashed?[5,5]:[]);
        ctx.beginPath();ctx.arc(c.x,c.y,q.kind==='circle'&&q.fill?Math.max(3,r):r,q.kind==='arc'?-q.startAngle:0,q.kind==='arc'?-q.endAngle:2*Math.PI,q.kind==='arc');
        if(q.kind==='circle'&&q.fill){if(role==='ball'&&!paper){ctx.shadowBlur=11;ctx.shadowColor=color;}ctx.fill();}
        else ctx.stroke();
      }else if(q.kind==='trajectory'){
        ctx.setLineDash(q.dashed?[7,5]:[]);ctx.beginPath();q.points.forEach((pt,j)=>{const c=m.toScreen(pt.x,pt.y);if(j===0)ctx.moveTo(c.x,c.y);else ctx.lineTo(c.x,c.y);});ctx.stroke();
      }else if(q.kind==='text'){
        const c=m.toScreen(q.x,q.y);labels.push({id:'text-'+i,x:c.x,y:c.y,text:q.text,color,font:'13px sans-serif'});
      }
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels.filter(l=>l.x>=0&&l.x<=vp.width&&l.y>=0&&l.y<=vp.height),vp.width,vp.height);
  }
}), { storyDecks: verticalCircularStoryDecks, liveFormulas,fitVerticalViewport,verticalBoundsFit });

export default mechVerticalCircularPlugin;
