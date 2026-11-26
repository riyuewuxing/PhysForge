import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { defineSimulationPlugin, type ParamFieldSpec, type TelemetryChannelSpec } from '@physforge/sim-sdk';
import {waveExport,renderWaveDiagram,fitWaveViewport,waveBoundsFit,waveDiagramBounds} from './diagram.js';
import {
  checkInvariants,
  computeDopplerFrequencies,
  computeObservables,
  computeWaveSpeed,
  createInitialState,
  evaluateStandingWave,
  evaluateTransverseWave,
  stepWaveCoupling,
  type WaveCouplingParams,
  type WaveCouplingState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<WaveCouplingParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '波动模型模式',
    options: [
      { label: '一维横波与质点振动联动', value: 'transverse' },
      { label: '两列等幅反向波叠加驻波（波节/波腹）', value: 'standing' },
      { label: '双波源二维水波干涉', value: 'interference' },
      { label: '运动波源多普勒效应（含超音速马赫锥）', value: 'doppler' }
    ],
    defaultValue: 'transverse'
  },
  {
    key: 'amplitude',
    kind: 'number',
    label: '振幅 A',
    unit: 'm',
    min: 0,
    max: 1.2,
    step: 0.05,
    defaultValue: 0.6
  },
  {
    key: 'frequency',
    kind: 'number',
    label: '波源频率 f',
    unit: 'Hz',
    min: 0.2,
    max: 3.0,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'wavelength',
    kind: 'number',
    label: '波长 λ',
    unit: 'm',
    min: 0.5,
    max: 4.0,
    step: 0.1,
    defaultValue: 2.0
  },
  {
    key: 'direction',
    kind: 'select',
    label: '传播方向',
    options: [
      { label: '沿 +x 向右传播', value: 'right' },
      { label: '沿 -x 向左传播', value: 'left' }
    ],
    defaultValue: 'right'
  },
  {
    key: 'causalFront',
    kind: 'boolean',
    label: '启用起振因果波前',
    defaultValue: false
  },
  {
    key: 'probeX',
    kind: 'number',
    label: '探测质点 Px',
    unit: 'm',
    min: -3.5,
    max: 3.5,
    step: 0.1,
    defaultValue: 1.5
  },
  {
    key: 'probeY',
    kind: 'number',
    label: '接收点 Py',
    unit: 'm',
    min: -2.5,
    max: 2.5,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'sourceSeparation',
    kind: 'number',
    label: '双波源间距 d',
    unit: 'm',
    min: 1.0,
    max: 6.0,
    step: 0.2,
    defaultValue: 4.0
  },
  {
    key: 'phaseDiffDeg',
    kind: 'number',
    label: '两波源初相差 Δφ₀',
    unit: '°',
    min: 0,
    max: 360,
    step: 15,
    defaultValue: 0
  },
  {
    key: 'sourceSpeedRatio',
    kind: 'number',
    label: '波源速度比 vs/v',
    unit: '倍',
    min: 0,
    max: 1.2,
    step: 0.05,
    defaultValue: 0.45
  }
];


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "wave-speed",
  "title": "行波波速",
  "latex": "v=\\htmlClass{pf-live-var}{\\htmlData{param=wavelength}{\\lambda}}\\htmlClass{pf-live-var}{\\htmlData{param=frequency}{f}}",
  "bindings": [
    {
      "tokenKey": "wavelength",
      "paramKey": "wavelength",
      "label": "波长 λ",
      "unit": "m",
      "min": 0.5,
      "max": 4,
      "step": 0.1,
      "precision": 2
    },
    {
      "tokenKey": "frequency",
      "paramKey": "frequency",
      "label": "波源频率 f",
      "unit": "Hz",
      "min": 0.2,
      "max": 3,
      "step": 0.1,
      "precision": 2
    }
  ]
}];
const channels:readonly TelemetryChannelSpec[]=[
  {key:'probeY',label:'固定质点位移 yP',unit:'m',color:'#f472b6'},
  {key:'probeVy',label:'固定质点速度 vy',unit:'m/s',color:'#4ade80'},
  {key:'probeAy',label:'固定质点加速度 ay',unit:'m/s²',color:'#38bdf8'},
  {key:'analyticalAmplitude',label:'局部振幅',unit:'m',color:'#fbbf24'},
  {key:'spatialSlope',label:'有符号空间斜率',unit:'',color:'#38bdf8'},
  {key:'localFrequencyHz',label:'单支接收局部频率',unit:'Hz',color:'#fbbf24'},
  {key:'arrivalCount',label:'接收支数',unit:'',color:'#38bdf8'}
];
export const waveVibrationCouplingPlugin = Object.assign(defineSimulationPlugin<
  WaveCouplingParams,
  WaveCouplingState
>({
  meta: {
    id: 'wave-vibration-coupling',
    title: '机械波与质点振动双图联动 · 干涉与多普勒',
    textbookRef: '人教版 选择性必修一 第三章 第1–4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: { scale: 0.72 },
  paramSchema,
  getParamFields:p=>{const keys=['mode','amplitude','frequency','wavelength',...(p.mode==='transverse'?['direction','causalFront','probeX']:p.mode==='standing'?['probeX']:p.mode==='interference'?['sourceSeparation','phaseDiffDeg','causalFront','probeX','probeY']:['sourceSpeedRatio','probeX','probeY'])];return keys.flatMap(k=>paramSchema.filter(f=>f.key===k));},
  presets: [
    {
      id: 'transverse-slope-rule',
      name: '1. 波形传播与上下坡法判振向',
      description: '观察波动图像向右推进时，“上坡质点向下振、下坡质点向上振”，并与底部 y-t 曲线同步对照。',
      params: {
        mode: 'transverse',
        amplitude: 0.6,
        frequency: 0.8,
        wavelength: 2.4,
        direction: 'right',
        causalFront: false,
        probeX: 1.5
      },
      visibleLayers: ['waveform', 'slopeGhost', 'probeParticle', 'vibrationGraph']
    },
    {
      id: 'causal-wavefront-startup',
      name: '2. 波源起振因果波前传播',
      description: '从 t=0 起波源开始起振，精确观察波前抵达远处质点 P 的时间延迟与起振方向传承。',
      params: {
        mode: 'transverse',
        amplitude: 0.65,
        frequency: 1.0,
        wavelength: 2.0,
        direction: 'right',
        causalFront: true,
        probeX: 2.6
      },
      visibleLayers: ['waveform', 'slopeGhost', 'probeParticle', 'vibrationGraph']
    },
    {
      id: 'interference-in-phase',
      name: '3. 双波源同相水波干涉',
      description: '两个振动步调完全相同的波源产生稳定干涉图样，中垂线及波程差为波长的整数倍处为加强区。',
      params: {
        mode: 'interference',
        amplitude: 0.5,
        frequency: 1.5,
        wavelength: 1.2,
        causalFront: false,
        sourceSeparation: 3.6,
        phaseDiffDeg: 0,
        probeX: 0,
        probeY: 1.4
      },
      visibleLayers: ['interferenceField', 'antinodeCurves', 'probeParticle']
    },
    {
      id: 'interference-anti-phase-misconception',
      name: '4. 反例辨析：反相波源中垂线相消',
      description: '当两波源初相差为 180° 时，到两波源等距的中垂线不再是加强区而是完全静止的减弱区。',
      params: {
        mode: 'interference',
        amplitude: 0.5,
        frequency: 1.5,
        wavelength: 1.2,
        causalFront: false,
        sourceSeparation: 3.6,
        phaseDiffDeg: 180,
        probeX: 0,
        probeY: 1.4
      },
      visibleLayers: ['interferenceField', 'antinodeCurves', 'probeParticle']
    },
    {
      id: 'doppler-moving-source',
      name: '5. 运动波源多普勒效应（波前挤压）',
      description: '波源以 0.55 倍波速向右移动，直观呈现前方波长变短（频率升高）、后方波长变长（频率降低）。',
      params: {
        mode: 'doppler',
        amplitude: 0.45,
        frequency: 1.8,
        wavelength: 1.0,
        sourceSpeedRatio: 0.55,
        probeX: 2.0,
        probeY: 0
      },
      visibleLayers: ['dopplerFronts', 'probeParticle']
    },
    {
      id: 'standing-wave-nodes',
      name: '6. 等幅相向行波叠加形成驻波（固定波节与波腹）',
      description: '在 x = kλ/2 处始终保持严格静止的波节，相邻波节间质点同相振动且振幅包络为 2A|sin(kx)|。',
      params: {
        mode: 'standing',
        amplitude: 0.45,
        frequency: 1.2,
        wavelength: 2.0,
        probeX: 0.5,
        probeY: 0
      },
      visibleLayers: ['waveform', 'probeParticle', 'vibrationGraph']
    },
    {
      id: 'supersonic-mach-cone',
      name: '7. 超音速波源与马赫锥 (vs = 1.15 v波)',
      description: '当波源速率超过波速时，连续发射的波前圆族形成马赫包络，半顶角满足 sin(α)=v/vs。',
      params: {
        mode: 'doppler',
        amplitude: 0.45,
        frequency: 2.0,
        wavelength: 0.9,
        sourceSpeedRatio: 1.15,
        probeX: 2.0,
        probeY: 0
      },
      visibleLayers: ['dopplerFronts', 'probeParticle']
    }
    ,{id:'causal-wavefront-left',name:'8. 向左起振 · 左侧质点延迟',description:'比较左行波斜率与质点速度，波前抵达后才开始振动。',params:{mode:'transverse',amplitude:.6,frequency:1,wavelength:2,direction:'left',causalFront:true,probeX:-2.4},visibleLayers:['waveform','slopeGhost','probeParticle','vibrationGraph']},
    {id:'standing-wave-node',name:'9. 驻波波节 · 始终静止',description:'x=λ/2，探针实际振幅为零。',params:{mode:'standing',amplitude:.6,frequency:1,wavelength:2,probeX:1},visibleLayers:['waveform','probeParticle','vibrationGraph']},
    {id:'interference-causal-two-arrivals',name:'10. 因果干涉 · 两次抵达',description:'两个源从零时刻起振，先单源振动后形成干涉，比较有符号波程差。',params:{mode:'interference',amplitude:.5,frequency:1.5,wavelength:2,sourceSeparation:4,phaseDiffDeg:180,causalFront:true,probeX:.5,probeY:0},visibleLayers:['interferenceField','antinodeCurves','probeParticle']},
    {id:'doppler-sonic-boundary',name:'11. 声速边界 · 前方周期接收无定义',description:'源速度等于波速，波前相切；不把奇点当成无限真实频率。',params:{mode:'doppler',amplitude:.45,frequency:1.5,wavelength:2,sourceSpeedRatio:1,probeX:0,probeY:0},visibleLayers:['dopplerFronts','probeParticle']},
    {id:'doppler-offaxis',name:'12. 斜向接收 · 延迟相位',description:'离轴探针的局部频率随接收方向变化。',params:{mode:'doppler',amplitude:.5,frequency:1.5,wavelength:2,sourceSpeedRatio:.5,probeX:1.4,probeY:1.1},visibleLayers:['dopplerFronts','probeParticle']},
    {id:'doppler-two-branches',name:'13. 超声速 · 双传播分支',description:'β=1.2 的轴上接收点，在源越过后且最早向前波尚未通过时可同时收到两支。',params:{mode:'doppler',amplitude:.5,frequency:1.5,wavelength:2,sourceSpeedRatio:1.2,probeX:0,probeY:0},visibleLayers:['dopplerFronts','probeParticle']}
  ],
  engine: {
    createInitialState,
    step: stepWaveCoupling,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'waveform', label: '当前时刻 y-x 波形', defaultVisible: true },
    { id: 'slopeGhost', label: '微平移法下一瞬虚线波形', defaultVisible: true },
    { id: 'probeParticle', label: '探测质点与振动方向矢量', defaultVisible: true },
    { id: 'vibrationGraph', label: '画内实时 y-t 振动缩略联动', defaultVisible: true },
    { id: 'interferenceField', label: '二维干涉波峰波谷强弱场', defaultVisible: true },
    { id: 'antinodeCurves', label: '加强区中垂与节点辅助标线', defaultVisible: true },
    { id: 'dopplerFronts', label: '多普勒同心波前族', defaultVisible: true }
  ],
  telemetryChannels:channels,
  getTelemetryChannels:p=>(p.mode==='doppler'?['probeY','localFrequencyHz','probeVy','probeAy','arrivalCount']:p.mode==='standing'||p.mode==='interference'?['probeY','analyticalAmplitude','probeVy','probeAy']:['probeY','probeVy','probeAy','spatialSlope','analyticalAmplitude']).flatMap(k=>channels.filter(c=>c.key===k)),
  getControlHandles: (state, params) => {
    const probeY = params.mode === 'interference'
      ? params.probeY
      : params.mode === 'doppler'
        ? params.probeY
        : (params.mode === 'standing'
          ? evaluateStandingWave(params.probeX, state.t, params).y
          : evaluateTransverseWave(params.probeX, state.t, params).y);
    return [{
      id: 'wave-probe',
      label: `探针 Px=${params.probeX.toFixed(1)}`,
      position: { x: params.probeX, y: probeY },
      handleKind: 'point',
      color: '#4ade80',
      onDrag: (wp) => ({
        probeX: Number(Math.max(-3.5, Math.min(3.5, wp.x)).toFixed(1)),
        ...(params.mode==='interference'||params.mode==='doppler'?{probeY:Number(Math.max(-2.5,Math.min(2.5,wp.y)).toFixed(1))}:{})
      })
    }];
  },
  referenceFrames: [
    {
      id: 'wavefront',
      label: '行波/运动源随动参考系',
      getOrigin: (s, params) => ({
        x: params.mode==='transverse'?(params.direction==='right'?1:-1)*computeWaveSpeed(params)*s.t:params.mode==='doppler'?s.sourceX+2:0,
        y: 0
      })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'wave-vibration-coupling',
      title: '机械波与驻波/多普勒',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<WaveCouplingParams>
  },
  exportDiagramIR:waveExport,
  formatFormulas:(s,p)=>{
    const o=computeObservables(s,p),c=computeWaveSpeed(p),w=2*Math.PI*p.frequency,k=p.wavelength>0?2*Math.PI/p.wavelength:0;
    const f=(n:number|undefined,d=3)=>n===undefined?'\\text{未定义}':n.toFixed(d);
    if(p.mode==='doppler'){
      const d=computeDopplerFrequencies(p);
      return [{id:'retarded-wave',label:'因果接收时间 · 等幅标量模型',latex:'c(t-\\tau)=|\\mathbf r_P-\\mathbf r_S(\\tau)|',
        substitutedLatex:'\\begin{aligned}\\beta&='+p.sourceSpeedRatio.toFixed(2)+'\\\\N_{\\rm branch}&='+s.arrivalCount+'\\\\f_{\\rm local}&='+f(s.localFrequencyHz,2)+'\\end{aligned}'},
        {id:'doppler-formula',label:'轴上单支频率（须已接收）',latex:"f_{\\rm front}=\\frac f{1-\\beta}\\ (\\beta<1),\\quad f_{\\rm back}=\\frac f{1+\\beta}",
        substitutedLatex:'\\begin{aligned}f_{\\rm front}&='+f(d.frontFreq,2)+'\\\\f_{\\rm back}&='+f(d.backFreq,2)+'\\end{aligned}'},
        ...(p.sourceSpeedRatio>1?[{id:'mach-envelope',label:'有限历程马赫包络，非真实激波强度',latex:'\\sin\\alpha=1/\\beta',substitutedLatex:'\\alpha='+f(o.machAngleDeg,2)+'^\\circ'}]:[])];
    }
    if(p.mode==='interference')return [{id:'interference-delta',label:'有符号波程差与接收相位',latex:'\\Delta r=r_2-r_1,\\quad\\Delta\\phi=\\phi_0-k\\Delta r',
      substitutedLatex:'\\begin{aligned}\\Delta r&='+f(o.signedPathDifference)+'\\text{ m}\\\\\\Delta\\phi&='+f(o.phaseAtProbeDeg,1)+'^\\circ\\\\N&='+o.activeCount+'\\end{aligned}'},
      {id:'interference-amplitude',label:'两波均到达时的合振幅',latex:'A_{\\rm net}=2A|\\cos(\\Delta\\phi/2)|',substitutedLatex:'A_P='+f(o.analyticalAmplitude)+'\\text{ m}'}];
    if(p.mode==='standing')return [{id:'standing-wave',label:'等幅反向波叠加（无限延伸理想解）',latex:'y=2A\\sin(kx)\\cos(\\omega t)',substitutedLatex:'\\begin{aligned}k&='+k.toFixed(3)+'\\text{ rad/m}\\\\A_P&='+f(o.analyticalAmplitude)+'\\text{ m}\\\\y_P&='+f(o.probeY)+'\\text{ m}\\end{aligned}'},
      {id:'standing-nodes',label:'固定波节与波腹',latex:'x_{\\rm node}=n\\lambda/2,\\quad x_{\\rm antinode}=(2n+1)\\lambda/4'}];
    return [{id:'traveling-wave',label:'行波空间相位与质点振动',latex:'y=A\\sin(\\omega t\\mp kx)',substitutedLatex:'\\begin{aligned}v&='+c.toFixed(3)+'\\text{ m/s}\\\\\\omega&='+w.toFixed(3)+'\\text{ rad/s}\\\\k&='+k.toFixed(3)+'\\text{ rad/m}\\end{aligned}'},
      {id:'slope-velocity',label:'坡度法 · 传播方向与振动方向区分',latex:'v_y=-\\operatorname{sgn}(v_x)c\\frac{\\partial y}{\\partial x}',substitutedLatex:'\\begin{aligned}\\partial_x y&='+f(o.spatialSlope)+'\\\\v_{y,P}&='+f(o.probeVy)+'\\text{ m/s}\\end{aligned}'},
      ...(p.causalFront?[{id:'causal-front',label:'起振波前，仅沿所选方向',latex:'t_P=|x_P|/c',substitutedLatex:o.arrivalTime===undefined?'\\text{P 不在传播半轴}':'t_P='+f(o.arrivalTime)+'\\text{ s}'}]:[])];
  },
  renderCanvas:renderWaveDiagram
}), { liveFormulas,fitWaveViewport,waveBoundsFit,waveDiagramBounds });

export default waveVibrationCouplingPlugin;
