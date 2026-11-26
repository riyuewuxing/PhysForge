import {defineSimulationPlugin,type ParamFieldSpec} from '@physforge/sim-sdk';
import {rippleExport,renderRipple,gridX,gridY,fitRippleViewport,rippleBoundsFit,rippleDiagramBounds} from './diagram.js';
import { waveFdtdPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepWaveFdtd,
  type WaveFdtdParams,
  type WaveFdtdState,
  DX,WALL_I
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WaveFdtdParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '波动池实验',
    defaultValue: 'double-slit',
    options: [
      { value: 'double-slit', label: '双缝干涉（时间平均强度屏）' },
      { value: 'single-slit', label: '单缝明显衍射' },
      { value: 'obstacle-diffraction', label: '障碍物绕射' },
      { value: 'refraction-prism', label: '斜界面介质折射 c(x,y)' }
    ]
  },
  { key: 'wavelengthCells', kind: 'number', label: '入射波长 λ (网格)', unit: '格', min: 6, max: 20, step: 1, defaultValue: 10 },
  { key: 'waveSpeed', kind: 'number', label: '参考波速 c₀', unit: 'm/s', min: 0.5, max: 2.0, step: 0.1, defaultValue: 1.0 },
  { key: 'amplitude', kind: 'number', label: '波源振幅 A', unit: '', min: 0, max: 1.5, step: 0.1, defaultValue: 1.0 },
  { key: 'slitSepCells', kind: 'number', label: '双缝间距 d (网格)', unit: '格', min: 14, max: 52, step: 2, defaultValue: 30 },
  { key: 'slitWidthCells', kind: 'number', label: '缝宽 / 障碍半宽', unit: '格', min: 3, max: 20, step: 1, defaultValue: 5 },
  { key: 'refractiveIndexN', kind: 'number', label: '右侧介质折射率 n', unit: '', min: 1, max: 2.5, step: 0.1, defaultValue: 1.6 }
];

export const wave2dRippleFdtdPlugin = Object.assign(defineSimulationPlugin<WaveFdtdParams, WaveFdtdState>({
  meta: {
    id: 'wave-2d-ripple-fdtd',
    title: '2D FDTD 波动池衍射、折射与干涉 (W02)',
    textbookRef: '人教版 选择性必修一 第三、四章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  getParamFields:p=>{const keys=['mode','wavelengthCells','waveSpeed','amplitude',...(p.mode==='double-slit'?['slitSepCells','slitWidthCells']:p.mode==='refraction-prism'?['refractiveIndexN']:['slitWidthCells'])];return keys.flatMap(k=>paramSchema.filter(f=>f.key===k)).map(f=>f.key==='slitWidthCells'?{...f,label:p.mode==='obstacle-diffraction'?'障碍物半宽（实际宽 2w+1 格）':'实际开口宽度'}:f);},
  presets: waveFdtdPresets,
  defaultView: {scale:(p,v)=>Math.min((v.width-60)/14,(v.height-60)/9)/(.24*Math.min(v.width,v.height)),minScale:.0001},
  engine: {
    createInitialState,
    step: stepWaveFdtd,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'waveField', label: '2D 波面振幅伪彩场 u(x,y)', defaultVisible: true },
    { id: 'screenProfile', label: '右侧接收屏强度 ⟨u²(y)⟩ 曲线', defaultVisible: true }
  ],
  telemetryChannels:[
    {key:'maxAmplitude',label:'全场峰值 |u|',unit:'u',color:'#38bdf8'},
    {key:'centerScreenDisplacement',label:'屏中心瞬时位移',unit:'u',color:'#f472b6'},
    {key:'centerScreenIntensity',label:'屏中心平均 u²',unit:'u²',color:'#fbbf24'},
    {key:'peakScreenIntensity',label:'屏上峰值平均 u²',unit:'u²',color:'#4ade80'},
    {key:'courantNumber',label:'实际 CFL',unit:'',color:'#94a3b8'}
  ],
  getControlHandles:(s,p)=>p.mode==='double-slit'&&s.geometry.valid&&s.geometry.apertures.length===2?[{
    id:'slit-sep',label:'d='+s.geometry.separationCells+' 格',position:{x:gridX(WALL_I),y:gridY(s.geometry.apertures[0]!.centerJ)},handleKind:'point',color:'#fbbf24',
    onDrag:wp=>({slitSepCells:Math.round(Math.max(14,Math.min(52,Math.abs(wp.y)/DX*2))/2)*2})
  }]:[],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'wave-2d-ripple-fdtd',
      title: '2D FDTD 波动池',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WaveFdtdParams>
  },
  exportDiagramIR:rippleExport,
  renderCanvas:renderRipple,
  formatFormulas:(s,p)=>{
    const o=computeObservables(s,p),f=(n:number|undefined,d=3)=>n===undefined?'\\text{—}':n.toFixed(d),c=p.waveSpeed,lambda=p.wavelengthCells*DX;
    const common=[{id:'fdtd-cfl',label:'实际物理步长与 CFL',latex:'r=c_0\\Delta t/\\Delta x<1/\\sqrt2',substitutedLatex:'\\begin{aligned}\\Delta t&='+s.fdtdRef.dt.toFixed(5)+'\\text{ s}\\\\r&='+s.courantNumber.toFixed(3)+'\\\\t_{\\rm field}&='+s.fieldTime.toFixed(3)+'\\text{ s}\\end{aligned}'},{id:'fdtd-screen',label:'实际时间窗内均方位移（非能流）',latex:'\\langle u^2\\rangle_j=\\frac1N\\sum_{k=1}^N u^2(x_S,y_j,t_k)',substitutedLatex:'\\begin{aligned}N&='+s.screenAverageSamples+'\\\\\\langle u^2\\rangle_0&='+f(o.centerScreenIntensity,5)+'\\end{aligned}'}];
    if(!s.geometry.valid)return [...common,{id:'invalid',label:'请求不可实现',latex:'a<d',substitutedLatex:'\\text{开口重叠，请调整参数}'}];
    if(p.mode==='double-slit'){
      const d=s.geometry.separationCells*DX,L=(s.screenI-s.wallI)*DX,first=d>lambda?lambda/2*Math.sqrt(1+4*L*L/(d*d-lambda*lambda)):undefined;
      return [...common,{id:'fdtd-fringe',label:'理想等相位点源参考，非有限缝实测峰值',latex:'|r_2-r_1|=m\\lambda',substitutedLatex:'\\begin{aligned}d&='+d.toFixed(2)+'\\text{ m}\\\\a&='+(s.geometry.widthCells*DX).toFixed(2)+'\\text{ m}\\\\y_{1,\\rm ideal}&='+f(first)+'\\text{ m}\\end{aligned}'},{id:'paraxial',label:'仅在近轴远场的间距近似',latex:'\\Delta y\\approx L\\lambda/d',substitutedLatex:'\\Delta y_{\\rm parax}='+(L*lambda/d).toFixed(3)+'\\text{ m}'}];
    }
    if(p.mode==='refraction-prism'){
      const n=Math.max(1,p.refractiveIndexN),theta=Math.atan(.35),r=Math.asin(Math.sin(theta)/n);
      return [...common,{id:'refraction',label:'连续斜界面 Snell 理论参考（非实测角）',latex:'\\frac{\\sin\\theta_1}{\\sin\\theta_2}=\\frac{c_1}{c_2}=n',substitutedLatex:'\\begin{aligned}c_2&='+(c/n).toFixed(3)+'\\text{ m/s}\\\\\\lambda_2&='+(lambda/n).toFixed(3)+'\\text{ m}\\\\\\theta_2&='+(r*180/Math.PI).toFixed(2)+'^\\circ\\end{aligned}'}];
    }
    return [...common,{id:'diffraction',label:'开口/障碍尺度与波长比较',latex:'a/\\lambda',substitutedLatex:'a/\\lambda='+(s.geometry.widthCells/p.wavelengthCells).toFixed(3)}];
  }

}),{fitRippleViewport,rippleBoundsFit,rippleDiagramBounds});

export default wave2dRippleFdtdPlugin;
