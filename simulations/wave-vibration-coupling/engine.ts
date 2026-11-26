import { degToRad, vec2, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type WaveMode = 'transverse' | 'interference' | 'doppler' | 'standing';

export type WaveCouplingParams = {
  mode: WaveMode;
  amplitude: number;
  frequency: number;
  wavelength: number;
  direction: 'right' | 'left';
  causalFront: boolean;
  probeX: number;
  probeY: number;
  sourceSeparation: number;
  phaseDiffDeg: number;
  sourceSpeedRatio: number; // v_s / v_wave for Doppler
};

export interface WavefrontCircle {
  readonly cx: number;
  readonly cy: number;
  readonly emittedAt: number;
}

export interface WaveCouplingState {
  readonly t: number;
  readonly sourceX: number;
  readonly wavefronts: readonly WavefrontCircle[];
  readonly lastEmitTime: number;
  readonly probeDisplacement: number;
  readonly probeVelocityY: number;
  readonly probeAccelY: number;
  readonly probeSampleDefined:boolean;
  readonly arrivalCount:number;
  readonly retardedTimes:readonly number[];
  readonly localFrequencyHz?:number;
  readonly emittedCount:number;
  readonly probeHistory: readonly Vec2[]; // (t, y_probe)
}

const MAX_HISTORY_POINTS = 600;
const MAX_WAVEFRONTS = 40;

export function computeWaveSpeed(params: WaveCouplingParams): number {
  return Math.max(0, params.wavelength * params.frequency);
}

/**
 * 一维横波在 (x, t) 处的位移、质点速度与加速度
 */
export function evaluateTransverseWave(
  x: number,
  t: number,
  params: WaveCouplingParams
): { y: number; vy: number; ay: number } {
  const A = params.amplitude;
  const f = params.frequency;
  const lambda = params.wavelength;
  if (A === 0 || f <= 0 || lambda <= 0) {
    return { y: 0, vy: 0, ay: 0 };
  }

  const omega = 2 * Math.PI * f;
  const vWave = lambda * f;
  const dirSign = params.direction === 'right' ? 1 : -1;

  if (params.causalFront) {
    // 因果起振模式：从原点 x = 0 在 t = 0 起振，沿设定方向（或双向）传播
    const dist = params.direction === 'right' ? x : -x;
    if (dist < 0 || dist > vWave * t) {
      return { y: 0, vy: 0, ay: 0 };
    }
    const phase = omega * (t - dist / vWave);
    const y = A * Math.sin(phase);
    const vy = A * omega * Math.cos(phase);
    const ay = -omega * omega * y;
    return { y, vy, ay };
  }

  const phase = omega * (t - (dirSign * x) / vWave);
  const y = A * Math.sin(phase);
  const vy = A * omega * Math.cos(phase);
  const ay = -omega * omega * y;
  return { y, vy, ay };
}

/**
 * 双波源二维干涉在点 (x, y) 处的合位移与解析合振幅
 */
export function evaluateInterferenceAtPoint(
  x: number,
  y: number,
  t: number,
  params: WaveCouplingParams
): { displacement:number;vy:number;analyticalAmplitude:number;pathDiff:number;signedPathDiff:number;r1:number;r2:number;activeCount:number;phaseAtProbe:number } {
  const A=params.amplitude,f=params.frequency,lambda=params.wavelength;
  const halfD=.5*params.sourceSeparation,r1=Math.hypot(x+halfD,y),r2=Math.hypot(x-halfD,y),signedPathDiff=r2-r1,pathDiff=Math.abs(signedPathDiff);
  if(f<=0||lambda<=0)return {displacement:0,vy:0,analyticalAmplitude:0,pathDiff,signedPathDiff,r1,r2,activeCount:0,phaseAtProbe:0};

  const omega = 2 * Math.PI * f;
  const k = (2 * Math.PI) / lambda;
  const vWave = lambda * f;
  const dPhi = degToRad(params.phaseDiffDeg);

  const wave1Active = !params.causalFront || r1 <= vWave * t;
  const wave2Active = !params.causalFront || r2 <= vWave * t;

  const y1 = wave1Active ? A * Math.sin(omega * t - k * r1) : 0;
  const y2 = wave2Active ? A * Math.sin(omega * t - k * r2 + dPhi) : 0;

  const vy1 = wave1Active ? A * omega * Math.cos(omega * t - k * r1) : 0;
  const vy2 = wave2Active ? A * omega * Math.cos(omega * t - k * r2 + dPhi) : 0;

  const analyticalAmplitude =
    wave1Active && wave2Active
      ? 2 * A * Math.abs(Math.cos(0.5 * (k * (r2 - r1) - dPhi)))
      : wave1Active || wave2Active
        ? A
        : 0;

  return {
    displacement: y1 + y2,
    vy: vy1 + vy2,
    analyticalAmplitude,
    pathDiff,signedPathDiff,r1,r2,activeCount:Number(wave1Active)+Number(wave2Active),phaseAtProbe:dPhi-k*signedPathDiff
  };
}

/**
 * 多普勒效应解析表观频率
 */
export function computeDopplerFrequencies(params: WaveCouplingParams): {
  frontFreq?: number;
  backFreq: number;
} {
  const f0 = Math.max(0, params.frequency);
  const beta = params.sourceSpeedRatio;
  const frontFreq=beta<1?f0/(1-beta):undefined;
  const backFreq=f0/(1+Math.max(0,beta));
  return {frontFreq,backFreq};
}

export interface WaveMultiSolution {
  readonly order: number;
  readonly direction: 'right' | 'left';
  readonly speed: number;
}

/**
 * 高考波动多解性枚举器：给定波长、首周期波移与时间差，返回右/左双向全部通解波速
 */
export function enumerateMultiSolutionSpeeds(
  wavelength: number,
  deltaX0: number,
  deltaT: number,
  maxOrder = 2
): WaveMultiSolution[] {
  if(![wavelength,deltaX0,deltaT,maxOrder].every(Number.isFinite)||wavelength<=0||deltaT<=0||maxOrder<0)return [];
  const dxMod=((deltaX0%wavelength)+wavelength)%wavelength;
  const rightOffset=dxMod===0?wavelength:dxMod,leftOffset=wavelength-dxMod;
  const out:WaveMultiSolution[]=[];
  for(let n=0;n<=Math.floor(maxOrder);n++){
    out.push({order:n+(dxMod===0?1:0),direction:'right',speed:(rightOffset+n*wavelength)/deltaT});
    out.push({order:n,direction:'left',speed:(leftOffset+n*wavelength)/deltaT});
  }
  return out;
}

/**
 * 等幅反向行波叠加驻波解：y(x,t) = 2 A sin(k x) cos(omega t)
 */
export function evaluateStandingWave(
  x: number,
  t: number,
  params: WaveCouplingParams
): { y: number; vy: number; ay: number } {
  const A = params.amplitude;
  const f = params.frequency;
  const lambda = params.wavelength;
  if (A === 0 || f <= 0 || lambda <= 0) return { y: 0, vy: 0, ay: 0 };
  const k = (2 * Math.PI) / lambda;
  const omega = 2 * Math.PI * f;
  const spatial = 2 * A * Math.sin(k * x);
  const y = spatial * Math.cos(omega * t);
  const vy = -spatial * omega * Math.sin(omega * t);
  const ay = -omega * omega * y;
  return { y, vy, ay };
}

export interface DopplerProbeSample{
  y:number;vy:number;ay:number;defined:boolean;arrivalCount:number;retardedTimes:readonly number[];localFrequencyHz?:number;
}
/** Unit-amplitude delayed scalar signals, not a pressure/intensity solution.
 * A source starts at x=-2 at t=0 and moves at beta*c. All admissible emission
 * times satisfy c(t-tau)=distance(P,S(tau)), 0<=tau<=t.
 * Away from the source/caustic, differentiate the retarded equation exactly.
 * Singular source/caustic samples are marked undefined, not exported as zero.
 */
export function evaluateDopplerProbe(t:number,p:WaveCouplingParams):DopplerProbeSample{
  const c=computeWaveSpeed(p),beta=p.sourceSpeedRatio,dx=p.probeX+2-beta*c*t,dy=p.probeY;
  const quiet={y:0,vy:0,ay:0,defined:true,arrivalCount:0,retardedTimes:[] as number[]};
  if(c<=0||t<0||p.amplitude===0)return quiet;
  const r2=dx*dx+dy*dy,a=1-beta*beta,b=beta*dx,ct=c*t,tol=64*Number.EPSILON*Math.max(1,Math.abs(dx),Math.abs(dy),ct);
  const singular=(times:number[]):DopplerProbeSample=>({...quiet,defined:false,arrivalCount:times.length,retardedTimes:times});
  if(r2<=tol*tol)return singular([]);
  let lengths:number[]=[];
  if(a===0){
    if(b!==0)lengths=[-r2/(2*b)];
  }else{
    const D=dx*dx+a*dy*dy,dTol=64*Number.EPSILON*(dx*dx+Math.abs(a)*dy*dy);
    if(D< -dTol)return quiet;
    const root=Math.sqrt(Math.abs(D)<=dTol?0:Math.max(0,D)),q=b+(b>=0?root:-root);
    if(root===0)lengths=[b/a];
    else if(q!==0)lengths=[q/a,-r2/q];
  }
  const accepted=lengths.filter(L=>Number.isFinite(L)&&L>=-tol&&L<=ct+tol).map(L=>Math.max(0,Math.min(ct,L))).sort((x,y)=>y-x);
  const unique=accepted.filter((L,i)=>i===0||Math.abs(L-accepted[i-1]!)>tol);
  const times=unique.map(L=>Math.max(0,t-L/c));
  let y=0,vy=0,ay=0,freq:number|undefined;
  const omega=2*Math.PI*p.frequency;
  for(const [i,L] of unique.entries()){
    if(L<=tol)return singular(times);
    const tau=times[i]!,nx=(dx+beta*L)/L,ny=dy/L,J=1-beta*nx;
    if(Math.abs(J)<=1e-10)return singular(times);
    const tau1=1/J,tau2=-c*beta*beta*ny*ny/(L*J*J*J),phase=omega*tau;
    y+=p.amplitude*Math.sin(phase);
    vy+=p.amplitude*omega*Math.cos(phase)*tau1;
    ay+=p.amplitude*(-omega*omega*Math.sin(phase)*tau1*tau1+omega*Math.cos(phase)*tau2);
    freq=Math.abs(p.frequency*tau1);
  }
  if(![y,vy,ay].every(Number.isFinite))return singular(times);
  return {y,vy,ay,defined:true,arrivalCount:times.length,retardedTimes:times,...(times.length===1&&freq!==undefined?{localFrequencyHz:freq}:{})};
}
function evaluateProbe(t:number,p:WaveCouplingParams):DopplerProbeSample{
  if(p.mode==='doppler')return evaluateDopplerProbe(t,p);
  const base={defined:true,arrivalCount:0,retardedTimes:[] as number[]};
  if(p.mode==='transverse')return {...base,...evaluateTransverseWave(p.probeX,t,p)};
  if(p.mode==='standing')return {...base,...evaluateStandingWave(p.probeX,t,p)};
  const r=evaluateInterferenceAtPoint(p.probeX,p.probeY,t,p);
  return {...base,y:r.displacement,vy:r.vy,ay:-((2*Math.PI*p.frequency)**2)*r.displacement,arrivalCount:r.activeCount};
}
function exactWavefronts(t:number,p:WaveCouplingParams):{fronts:WavefrontCircle[];count:number;last:number}{
  if(p.mode!=='doppler'||p.frequency<=0||computeWaveSpeed(p)<=0||p.amplitude===0)return {fronts:[],count:0,last:0};
  const phase=t*p.frequency,n=Math.floor(phase+32*Number.EPSILON*Math.max(1,Math.abs(phase)));
  const fronts:WavefrontCircle[]=[],u=p.sourceSpeedRatio*computeWaveSpeed(p);
  for(let j=Math.max(0,n-MAX_WAVEFRONTS+1);j<=n;j++){
    const emittedAt=j/p.frequency;fronts.push({cx:-2+u*emittedAt,cy:0,emittedAt});
  }
  return {fronts,count:n+1,last:n/p.frequency};
}

export function createInitialState(params: WaveCouplingParams): WaveCouplingState {
  const probe = evaluateProbe(0, params);
  const initialSourceX = params.mode === 'doppler' ? -2.0 : 0;
  const emitted=exactWavefronts(0,params);
  return {
    t: 0,
    sourceX: initialSourceX,
    wavefronts:emitted.fronts,
    lastEmitTime:emitted.last,emittedCount:emitted.count,
    probeDisplacement: probe.y,
    probeVelocityY: probe.vy,
    probeAccelY:probe.ay,probeSampleDefined:probe.defined,arrivalCount:probe.arrivalCount,retardedTimes:probe.retardedTimes,...(probe.localFrequencyHz===undefined?{}:{localFrequencyHz:probe.localFrequencyHz}),
    probeHistory:probe.defined?[vec2(0,probe.y)]:[]
  };
}

export function stepWaveCoupling(
  state: WaveCouplingState,
  params: WaveCouplingParams,
  dt: number
): StepResult<WaveCouplingState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  const nextT = state.t + dt;
  const vWave = computeWaveSpeed(params);
  const events: PhysicsEvent[] = [];

  const nextSourceX=params.mode==='doppler'?-2+params.sourceSpeedRatio*vWave*nextT:0;
  const emitted=exactWavefronts(nextT,params);

  // 检查因果波前首次抵达探测点事件
  if (params.mode === 'transverse' && params.causalFront && vWave > 0) {
    const dist = params.direction === 'right' ? params.probeX : -params.probeX;
    if (dist > 0) {
      const arrivalT = dist / vWave;
      if (state.t < arrivalT && nextT >= arrivalT) {
        events.push({
          id: `wave-arrive-${arrivalT.toFixed(5)}`,
          time: arrivalT,
          label: '波前抵达探测质点 P',
          position: { x: params.probeX, y: 0 }
        });
      }
    }
  }

  if(params.mode==='interference'&&params.causalFront&&vWave>0){
    const h=params.sourceSeparation/2;
    for(const [i,x] of [-h,h].entries()){
      const time=Math.hypot(params.probeX-x,params.probeY)/vWave;
      if(state.t<time&&nextT>=time)events.push({id:'interference-arrive-'+(i+1),time,label:'S'+(i+1)+' 波前抵达 P',position:{x:params.probeX,y:params.probeY}});
    }
    events.sort((a,b)=>a.time-b.time);
  }
  const probe = evaluateProbe(nextT, params);
  const nextHistory =
    !probe.defined?[]:state.probeHistory.length >= MAX_HISTORY_POINTS
      ? [...state.probeHistory.slice(state.probeHistory.length - MAX_HISTORY_POINTS + 1), vec2(nextT, probe.y)]
      : [...state.probeHistory, vec2(nextT, probe.y)];

  return {
    nextState: {
      t: nextT,
      sourceX: nextSourceX,
      wavefronts:emitted.fronts,
      lastEmitTime:emitted.last,emittedCount:emitted.count,
      probeDisplacement: probe.y,
      probeVelocityY: probe.vy,
      probeAccelY:probe.ay,probeSampleDefined:probe.defined,arrivalCount:probe.arrivalCount,retardedTimes:probe.retardedTimes,...(probe.localFrequencyHz===undefined?{}:{localFrequencyHz:probe.localFrequencyHz}),
      probeHistory:nextHistory
    },
    events
  };
}

export function computeObservables(s:WaveCouplingState,p:WaveCouplingParams):Record<string,number>{
  const c=computeWaveSpeed(p),obs:Record<string,number>={waveSpeed:c,probeSampleDefined:Number(s.probeSampleDefined)};
  if(s.probeSampleDefined)Object.assign(obs,{probeY:s.probeDisplacement,probeVy:s.probeVelocityY,probeAy:s.probeAccelY});
  if(p.mode==='doppler'){
    const f=computeDopplerFrequencies(p);
    return {...obs,sourceX:s.sourceX,sourceSpeed:p.sourceSpeedRatio*c,arrivalCount:s.arrivalCount,emittedCount:s.emittedCount,
      ...(s.localFrequencyHz===undefined?{}:{localFrequencyHz:s.localFrequencyHz}),...(f.frontFreq===undefined?{}:{frontFreq:f.frontFreq}),backFreq:f.backFreq,
      ...(p.sourceSpeedRatio>1?{machAngleDeg:Math.asin(1/p.sourceSpeedRatio)*180/Math.PI}:{})};
  }
  if(p.mode==='interference'){
    const r=evaluateInterferenceAtPoint(p.probeX,p.probeY,s.t,p);
    return {...obs,analyticalAmplitude:r.analyticalAmplitude,pathDifference:r.pathDiff,signedPathDifference:r.signedPathDiff,phaseAtProbeDeg:r.phaseAtProbe*180/Math.PI,activeCount:r.activeCount,r1:r.r1,r2:r.r2};
  }
  if(p.mode==='standing')return {...obs,analyticalAmplitude:c>0?2*p.amplitude*Math.abs(Math.sin(2*Math.PI*p.probeX/p.wavelength)):0};
  const dir=p.direction==='right'?1:-1,dist=dir*p.probeX;
  const active=c>0&&(!p.causalFront||(dist>=0&&dist<=c*s.t));
  const slope=active?-dir*2*Math.PI*p.amplitude/p.wavelength*Math.cos(2*Math.PI*p.frequency*s.t-dir*2*Math.PI*p.probeX/p.wavelength):0;
  return {...obs,analyticalAmplitude:active?p.amplitude:0,spatialSlope:slope,
    ...(p.causalFront&&c>0?{frontX:dir*c*s.t,...(dist>=0?{arrivalTime:dist/c}:{})}:{})};
}

export function checkInvariants(s:WaveCouplingState,_initial:WaveCouplingState,p:WaveCouplingParams):InvariantReport[]{
  if(p.frequency<=0||p.wavelength<=0||p.amplitude===0)return [];
  const report=(name:string,error:number,tolerance=1e-8):InvariantReport=>({name,measuredError:Number.isFinite(error)?error:Number.MAX_VALUE,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  const err=(a:number,b:number)=>Math.abs(a-b)/Math.max(1,Math.abs(b));
  const expected=evaluateProbe(s.t,p),out:InvariantReport[]=[];
  out.push(report('探针物理定义域',Number(s.probeSampleDefined!==expected.defined),0));
  if(s.probeSampleDefined&&expected.defined)out.push(report('实际探针位移、速度及加速度',Math.max(err(s.probeDisplacement,expected.y),err(s.probeVelocityY,expected.vy),err(s.probeAccelY,expected.ay))));
  if(p.mode==='doppler'){
    const c=computeWaveSpeed(p),u=p.sourceSpeedRatio*c;
    const residual=s.retardedTimes.reduce((mx,tau)=>Math.max(mx,Math.abs(c*(s.t-tau)-Math.hypot(p.probeX+2-u*tau,p.probeY)),Math.max(0,-tau,tau-s.t)),0);
    out.push(report('因果延迟传播方程',residual/Math.max(1,c*s.t)));
    out.push(report('传播分支数',Math.abs(s.arrivalCount-expected.arrivalCount)+Math.abs(s.retardedTimes.length-expected.retardedTimes.length),0));
    const fronts=exactWavefronts(s.t,p);
    out.push(report('整数周期波前发射时刻',s.emittedCount!==fronts.count||s.wavefronts.length!==fronts.fronts.length?1:Math.max(0,...s.wavefronts.map((w,i)=>Math.max(err(w.emittedAt,fronts.fronts[i]!.emittedAt),err(w.cx,fronts.fronts[i]!.cx))))));
  }else{
    const omega=2*Math.PI*p.frequency;
    out.push(report('简谐振动动力学关系 (ay = -ω²y)',err(s.probeAccelY,-omega*omega*s.probeDisplacement),1e-6));
    if(p.mode==='transverse'){
      const slope=computeObservables(s,p).spatialSlope??0;
      out.push(report('行波速度与空间斜率',err(s.probeVelocityY,-(p.direction==='right'?1:-1)*computeWaveSpeed(p)*slope),1e-8));
    }
  }
  const last=s.probeHistory.at(-1);
  if(s.probeSampleDefined)out.push(report('实际探针历史末样本',last?Math.max(err(last.x,s.t),err(last.y,s.probeDisplacement)):1));
  return out;
}
