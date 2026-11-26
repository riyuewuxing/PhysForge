import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type AcWaveformType =
  | 'sine'
  | 'half-wave'
  | 'full-wave'
  | 'duty-square'
  | 'sawtooth'
  | 'dc-plus-sine';

export type AcGeneratorParams = {
  waveform: AcWaveformType;
  turnsN: number;
  magneticB: number;
  coilAreaS: number;
  freqHz: number;
  loadR: number;
  dutyCycleD: number;
  dcOffsetV: number;
};

export interface AcGeneratorState {
  readonly t: number;
  readonly angleRad: number;
  readonly fluxWb: number;
  /** Generator sinusoid amplitude E_m (not the DC-shifted load peak). */
  readonly uPeakV: number;
  readonly sourceEmfV: number;
  readonly loadPeakAbsV: number;
  readonly currentA: number;
  readonly fluxLinkageWbTurn: number;
  readonly referencePhase: number;
  readonly uInstV: number;
  readonly uRmsV: number;
  readonly pInstW: number;
  readonly pAvgW: number;
  readonly jouleHeatJ: number;
  readonly atNeutralPlane: boolean;
  readonly events: readonly PhysicsEvent[];
}

export function evalWaveformVoltage(
  phaseNorm: number, // in [0, 1)
  uPeak: number,
  params: AcGeneratorParams
): number {
  const f = phaseNorm - Math.floor(phaseNorm);
  switch (params.waveform) {
    case 'sine':
      return uPeak * Math.sin(2 * Math.PI * f);
    case 'half-wave': {
      const s = uPeak * Math.sin(2 * Math.PI * f);
      return s > 0 ? s : 0;
    }
    case 'full-wave':
      return uPeak * Math.abs(Math.sin(2 * Math.PI * f));
    case 'duty-square':
      return f < Math.max(0, Math.min(1, params.dutyCycleD)) ? uPeak : 0;
    case 'sawtooth':
      return uPeak * (2 * f - 1);
    case 'dc-plus-sine':
      return params.dcOffsetV + uPeak * Math.sin(2 * Math.PI * f);
  }
}

function simpsonOnInterval(
  a: number,
  b: number,
  uPeak: number,
  params: AcGeneratorParams,
  panels = 40
): number {
  if (b <= a) return 0;
  const n = panels % 2 === 0 ? panels : panels + 1;
  const h = (b - a) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const f = a + i * h;
    // Clamp slightly inside endpoints to stay cleanly inside smooth branch
    const evalF = i === 0 ? a + 1e-12 * (b - a) : i === n ? b - 1e-12 * (b - a) : f;
    const u = evalWaveformVoltage(evalF, uPeak, params);
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    sum += w * u * u;
  }
  return (h / 3) * sum;
}

/**
 * Computes RMS voltage via piecewise composite Simpson quadrature over one period [0, 1].
 */
export function computeRmsSimpson(uPeak: number, params: AcGeneratorParams): number {
  const d = Math.max(0, Math.min(1, params.dutyCycleD));
  let breaks: number[];
  if (params.waveform === 'half-wave' || params.waveform === 'full-wave') {
    breaks = [0, 0.5, 1];
  } else if (params.waveform === 'duty-square') {
    breaks = d > 0 && d < 1 ? [0, d, 1] : [0, 1];
  } else {
    breaks = [0, 1];
  }

  let integralSq = 0;
  for (let k = 0; k < breaks.length - 1; k++) {
    integralSq += simpsonOnInterval(breaks[k]!, breaks[k + 1]!, uPeak, params, 48);
  }
  return Math.sqrt(Math.max(0, integralSq));
}

/** Exact primitive of u² in dimensionless phase x ∈ [0,1].
 * Distinct from the Simpson RMS oracle; no endpoint sampling across a jump.
 */
function squarePrimitive(x: number, a: number, p: AcGeneratorParams): number {
  const sine2 = (v:number) => v/2 - Math.sin(4*Math.PI*v)/(8*Math.PI);
  switch (p.waveform) {
    case 'sine': case 'full-wave': return a*a*sine2(x);
    case 'half-wave': return a*a*sine2(Math.min(x,.5));
    case 'duty-square': return a*a*Math.min(x,Math.max(0,Math.min(1,p.dutyCycleD)));
    case 'sawtooth': return a*a*(4*x*x*x/3-2*x*x+x);
    case 'dc-plus-sine':
      return p.dcOffsetV*p.dcOffsetV*x + a*a*sine2(x) +
        p.dcOffsetV*a*(2*Math.sin(Math.PI*x)**2)/Math.PI;
  }
}

/** Exact heat for a fixed-parameter segment, including multiple complete cycles. */
export function integrateLoadHeat(start: number, dt: number, a: number, p: AcGeneratorParams): number {
  const f=Math.max(0,p.freqHz), R=Math.max(.1,p.loadR);
  if(dt===0)return 0;
  if(f===0)return evalWaveformVoltage(0,a,p)**2*dt/R;
  const x=start*f-Math.floor(start*f), length=dt*f;
  const first=Math.min(length,1-x);
  const rem=Math.max(0,length-first), cycles=Math.floor(rem), tail=rem-cycles;
  const sum=squarePrimitive(x+first,a,p)-squarePrimitive(x,a,p) +
    cycles*squarePrimitive(1,a,p)+squarePrimitive(tail,a,p);
  return Math.max(0,sum)/(R*f);
}

export function analyticalRms(a:number,p:AcGeneratorParams):number {
  switch(p.waveform){
    case 'sine':case 'full-wave':return Math.abs(a)/Math.SQRT2;
    case 'half-wave':return Math.abs(a)/2;
    case 'duty-square':return Math.abs(a)*Math.sqrt(Math.max(0,Math.min(1,p.dutyCycleD)));
    case 'sawtooth':return Math.abs(a)/Math.sqrt(3);
    case 'dc-plus-sine':return Math.hypot(p.dcOffsetV,a/Math.SQRT2);
  }
}
export function isGeneratorLoad(p:AcGeneratorParams):boolean{
  return p.waveform==='sine'||p.waveform==='half-wave'||p.waveform==='full-wave';
}
export function sourceCurrent(state:AcGeneratorState,p:AcGeneratorParams):number{
  if(!isGeneratorLoad(p))return 0;
  return p.waveform==='full-wave'?Math.sign(state.sourceEmfV)*state.currentA:state.currentA;
}

function sample(t:number,heat:number,p:AcGeneratorParams,uRms:number):AcGeneratorState{
  const f=Math.max(0,p.freqHz),omega=2*Math.PI*f, phase=t*f-Math.floor(t*f),
    angle=omega*t, phi=p.magneticB*p.coilAreaS*Math.cos(2*Math.PI*phase),
    a=p.turnsN*p.magneticB*p.coilAreaS*omega, e=a*Math.sin(2*Math.PI*phase),
    u=evalWaveformVoltage(phase,a,p),R=Math.max(.1,p.loadR);
  const loadPeak=p.waveform==='dc-plus-sine'?Math.abs(p.dcOffsetV)+Math.abs(a):
    p.waveform==='duty-square'&&p.dutyCycleD<=0?0:Math.abs(a);
  return {t,angleRad:angle,referencePhase:phase,fluxWb:phi,fluxLinkageWbTurn:p.turnsN*phi,
    sourceEmfV:e,uPeakV:a,loadPeakAbsV:loadPeak,currentA:u/R,uInstV:u,uRmsV:uRms,
    pInstW:u*u/R,pAvgW:uRms*uRms/R,jouleHeatJ:heat,
    atNeutralPlane:Math.abs(Math.sin(2*Math.PI*phase))<.08,events:[]};
}

export function createInitialState(params:AcGeneratorParams):AcGeneratorState {
  const a=params.turnsN*params.magneticB*params.coilAreaS*2*Math.PI*Math.max(0,params.freqHz);
  return sample(0,0,params,computeRmsSimpson(a,params));
}

export function stepAcGeneratorRms(state:AcGeneratorState,params:AcGeneratorParams,dt:number):StepResult<AcGeneratorState>{
  if(!Number.isFinite(dt)||dt<0)throw new Error(`Invalid dt: ${dt}`);
  if(dt===0)return {nextState:state,events:[]};
  const a=params.turnsN*params.magneticB*params.coilAreaS*2*Math.PI*Math.max(0,params.freqHz);
  const heat=state.jouleHeatJ+integrateLoadHeat(state.t,dt,a,params);
  return {nextState:sample(state.t+dt,heat,params,computeRmsSimpson(a,params)),events:[]};
}

export function computeObservables(s:AcGeneratorState):Record<string,number>{
  return {t:s.t,fluxWb:s.fluxWb,fluxLinkageWbTurn:s.fluxLinkageWbTurn,sourceEmfV:s.sourceEmfV,
    uInstV:s.uInstV,uRmsV:s.uRmsV,uPeakV:s.uPeakV,loadPeakAbsV:s.loadPeakAbsV,currentA:s.currentA,
    pInstW:s.pInstW,pAvgW:s.pAvgW,jouleHeatJ:s.jouleHeatJ,referencePhase:s.referencePhase};
}

export function checkInvariants(s:AcGeneratorState,initial:AcGeneratorState,p:AcGeneratorParams):InvariantReport[]{
  const a=p.turnsN*p.magneticB*p.coilAreaS*2*Math.PI*Math.max(0,p.freqHz),
    rms=analyticalRms(a,p),R=Math.max(.1,p.loadR),
    q=integrateLoadHeat(initial.t,s.t-initial.t,a,p);
  const rel=(actual:number,expected:number)=>Math.abs(actual-expected)/Math.max(1e-12,Math.abs(expected));
  const report=(name:string,error:number):InvariantReport=>({name,measuredError:error,tolerance:1e-6,passed:Number.isFinite(error)&&error<=1e-6});
  return [report('分段 Simpson 与独立解析有效值',rel(s.uRmsV,rms)),
    report('累计焦耳热与整段解析积分',rel(s.jouleHeatJ-initial.jouleHeatJ,q)),
    report('电阻瞬时功率 u²/R',rel(s.pInstW,s.uInstV*s.uInstV/R)),
    report('平均热功率 Urms²/R',rel(s.pAvgW,rms*rms/R))];
}
