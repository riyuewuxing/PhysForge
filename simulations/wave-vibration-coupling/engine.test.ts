import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  computeDopplerFrequencies,
  computeObservables,
  computeWaveSpeed,
  createInitialState,
  enumerateMultiSolutionSpeeds,
  evaluateInterferenceAtPoint,
  evaluateStandingWave,
  evaluateTransverseWave,
  stepWaveCoupling,
  type WaveCouplingParams
} from './engine.js';

const baseParams: WaveCouplingParams = {
  mode: 'transverse',
  amplitude: 0.5,
  frequency: 1.5,
  wavelength: 2.0,
  direction: 'right',
  causalFront: false,
  probeX: 1.5,
  probeY: 0,
  sourceSeparation: 4.0,
  phaseDiffDeg: 0,
  sourceSpeedRatio: 0.4
};

describe('wave-vibration-coupling engine', () => {
  it('satisfies wave speed v = lambda * f and partial time derivative v_y = dy/dt (< 1e-4)', () => {
    expect(computeWaveSpeed(baseParams)).toBeCloseTo(3.0, 12);

    const t = 0.73;
    const x = 1.25;
    const eps = 1e-6;
    const center = evaluateTransverseWave(x, t, baseParams);
    const plus = evaluateTransverseWave(x, t + eps, baseParams);
    const minus = evaluateTransverseWave(x, t - eps, baseParams);
    const numVy = (plus.y - minus.y) / (2 * eps);

    expect(Math.abs(center.vy - numVy) / Math.max(Math.abs(center.vy), 1e-6)).toBeLessThan(1e-4);

    const s0 = createInitialState(baseParams);
    const s1 = stepWaveCoupling(s0, baseParams, 0.2).nextState;
    const inv = checkInvariants(s1, s0, baseParams);
    expect(inv[0]?.passed).toBe(true);
  });

  it('verifies causal wavefront arrival time at probeX', () => {
    const causalParams: WaveCouplingParams = {
      ...baseParams,
      causalFront: true,
      probeX: 3.0 // vWave = 3.0 m/s -> 精确抵达时刻 1.0 s
    };
    let state = createInitialState(causalParams);
    expect(state.probeDisplacement).toBe(0);

    let arrivedTime: number | null = null;
    for (let i = 0; i < 150; i++) {
      const res = stepWaveCoupling(state, causalParams, 0.01);
      state = res.nextState;
      if (res.events.length > 0) {
        arrivedTime = res.events[0]!.time;
      }
    }

    expect(arrivedTime).toBeCloseTo(1.0, 6);
    expect(Math.abs(state.probeDisplacement)).toBeGreaterThan(0);
  });

  it('matches analytical constructive and destructive interference amplitudes (< 1e-4)', () => {
    // S1 = (-2, 0), S2 = (+2, 0), d = 4.0, lambda = 2.0
    // 中垂线 (0, 2) 处 r1 == r2, pathDiff = 0 -> 同相加强 (2A = 1.0), 反相减弱 (0)
    const inPhase = evaluateInterferenceAtPoint(0, 2, 0.4, {
      ...baseParams,
      mode: 'interference',
      phaseDiffDeg: 0
    });
    expect(inPhase.pathDiff).toBeCloseTo(0, 12);
    expect(inPhase.analyticalAmplitude).toBeCloseTo(1.0, 12);

    const antiPhase = evaluateInterferenceAtPoint(0, 2, 0.4, {
      ...baseParams,
      mode: 'interference',
      phaseDiffDeg: 180
    });
    expect(antiPhase.analyticalAmplitude).toBeCloseTo(0, 12);

    // 在 x 轴上 S1-S2 连线间取点 (0.5, 0): r1 = 2.5, r2 = 1.5 -> pathDiff = 1.0 = lambda/2
    // 同相时应为相消点 A_net = 0
    const nodePoint = evaluateInterferenceAtPoint(0.5, 0, 0.4, {
      ...baseParams,
      mode: 'interference',
      phaseDiffDeg: 0
    });
    expect(nodePoint.pathDiff).toBeCloseTo(1.0, 12);
    expect(nodePoint.analyticalAmplitude).toBeLessThan(1e-12);
  });

  it('computes Doppler shifted frequencies accurately', () => {
    const { frontFreq, backFreq } = computeDopplerFrequencies({
      ...baseParams,
      mode: 'doppler',
      frequency: 2.0,
      sourceSpeedRatio: 0.5
    });
    expect(frontFreq).toBeCloseTo(4.0, 12);
    expect(backFreq).toBeCloseTo(2.0 / 1.5, 12);
  });

  it('handles zero amplitude, zero frequency, and dt=0 without NaN or Infinity', () => {
    const cases: WaveCouplingParams[] = [
      { ...baseParams, amplitude: 0 },
      { ...baseParams, frequency: 0 },
      { ...baseParams, mode: 'doppler', sourceSpeedRatio: 0 }
    ];

    for (const p of cases) {
      const s0 = createInitialState(p);
      const s1 = stepWaveCoupling(s0, p, 0).nextState;
      const s2 = stepWaveCoupling(s1, p, 0.02).nextState;
      const obs = computeObservables(s2, p);
      for (const v of Object.values(obs)) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('enumerates bidirectional multi-solution speeds reproducing waveforms within < 1e-7 and keeps standing nodes < 1e-10', () => {
    const lambda = 2.0;
    const dx0 = 0.4;
    const dt = 0.5;
    const solutions = enumerateMultiSolutionSpeeds(lambda, dx0, dt, 2);
    expect(solutions).toHaveLength(6);

    for (const sol of solutions) {
      const fSol = sol.speed / lambda;
      const pSol: WaveCouplingParams = {
        ...baseParams,
        wavelength: lambda,
        frequency: fSol,
        direction: sol.direction
      };
      for (let x = -2; x <= 2; x += 0.25) {
        // Rightward wave shifted +dx0 from t=0; leftward wave shifted -(lambda - dx0) matches shifted target
        const yInit = evaluateTransverseWave(x, 0, pSol).y;
        const shift = sol.direction === 'right' ? dx0 : -(lambda - dx0);
        const yAtDt = evaluateTransverseWave(x + shift, dt, pSol).y;
        expect(Math.abs(yAtDt - yInit)).toBeLessThan(1e-7);
      }
    }

    // Standing wave nodes at x = k * lambda / 2 stay strictly at zero for all t
    const standP: WaveCouplingParams = { ...baseParams, mode: 'standing', wavelength: 2.0 };
    for (const t of [0, 0.13, 0.37, 0.91]) {
      for (const k of [-2, -1, 0, 1, 2]) {
        const nodeX = k * (standP.wavelength * 0.5);
        expect(Math.abs(evaluateStandingWave(nodeX, t, standP).y)).toBeLessThan(1e-10);
      }
    }
  });
});

describe('W01 independent retarded-time, exact emission and standing-wave oracles',()=>{
  const p:WaveCouplingParams={...baseParams,mode:'doppler',frequency:1.5,wavelength:2,amplitude:.5,probeX:0,probeY:0,sourceSpeedRatio:.5};
  const at=(p:WaveCouplingParams,t:number)=>stepWaveCoupling(createInitialState(p),p,t).nextState;
  it('has no receiver signal before the first causal arrival',()=>{
    const s=at(p,.4);
    expect(s.probeDisplacement).toBe(0);expect(s.probeVelocityY).toBe(0);expect(s.probeAccelY).toBe(0);
  });
  it('uses exact retarded emission phase and observed frequency in front of a subsonic source',()=>{
    const t=.87,c=p.wavelength*p.frequency,u=.5*c,omega=2*Math.PI*p.frequency,tau=(c*t-2)/(c-u),s=at(p,t);
    const wObserved=omega*c/(c-u);
    expect(s.probeDisplacement).toBeCloseTo(p.amplitude*Math.sin(omega*tau),10);
    expect(s.probeVelocityY).toBeCloseTo(p.amplitude*wObserved*Math.cos(omega*tau),9);
    expect(s.probeAccelY).toBeCloseTo(-p.amplitude*wObserved*wObserved*Math.sin(omega*tau),8);
  });
  it('matches independently differentiated off-axis retarded phase',()=>{
    const q={...p,probeY:1.1,probeX:1.4},t=1.42,h=1e-4,c=q.wavelength*q.frequency,u=q.sourceSpeedRatio*c;
    const y=(T:number)=>{let lo=0,hi=T;for(let j=0;j<70;j++){const tau=(lo+hi)/2;const residual=tau+Math.hypot(q.probeX+2-u*tau,q.probeY)/c-T;if(residual>0)hi=tau;else lo=tau;}return q.amplitude*Math.sin(2*Math.PI*q.frequency*(lo+hi)/2);};
    const s=at(q,t);
    expect(s.probeDisplacement).toBeCloseTo(y(t),10);
    expect(Math.abs(s.probeVelocityY!-(y(t+h)-y(t-h))/(2*h))).toBeLessThan(1e-5);
    expect(Math.abs(s.probeAccelY!-(y(t+h)-2*y(t)+y(t-h))/(h*h))).toBeLessThan(1e-4);
  });
  it('superposes two causal retarded branches inside the supersonic wake',()=>{
    const q={...p,sourceSpeedRatio:1.2},c=q.wavelength*q.frequency,u=1.2*c,t=.60,w=2*Math.PI*q.frequency;
    const a=(c*t-2)/(c-u),b=(c*t+2)/(c+u),s=at(q,t);
    expect(a).toBeGreaterThan(0);expect(b).toBeLessThan(t);
    expect(s.probeDisplacement).toBeCloseTo(q.amplitude*(Math.sin(w*a)+Math.sin(w*b)),10);
    expect(s.probeVelocityY).toBeCloseTo(q.amplitude*w*(c/(c-u)*Math.cos(w*a)+c/(c+u)*Math.cos(w*b)),9);
  });
  it('emits every exact periodic front even when one step spans many periods',()=>{
    const q={...p,frequency:2,wavelength:1.2},t=2.36,whole=at(q,t);
    let split=createInitialState(q);for(let j=0;j<59;j++)split=stepWaveCoupling(split,q,t/59).nextState;
    expect(whole.wavefronts.map(f=>f.emittedAt)).toEqual([0,.5,1,1.5,2]);
    expect(split.wavefronts).toEqual(whole.wavefronts);
    for(const f of whole.wavefronts)expect(f.cx).toBeCloseTo(-2+q.sourceSpeedRatio*computeWaveSpeed(q)*f.emittedAt,12);
  });
  it('distinguishes near-sonic finite forward frequency from undefined sonic or supersonic forward periodic arrival',()=>{
    expect(computeDopplerFrequencies({...p,sourceSpeedRatio:.9999}).frontFreq).toBeCloseTo(p.frequency/.0001,5);
    expect(computeDopplerFrequencies({...p,sourceSpeedRatio:1}).frontFreq).toBeUndefined();
    expect(computeDopplerFrequencies({...p,sourceSpeedRatio:1.15}).frontFreq).toBeUndefined();
  });
  it('reports actual local standing-wave amplitude at nodes and antinodes',()=>{
    for(const x of [0,.25,.5,1]){
      const q={...baseParams,mode:'standing' as const,probeX:x};
      expect(computeObservables(at(q,.37),q).analyticalAmplitude).toBeCloseTo(2*q.amplitude*Math.abs(Math.sin(2*Math.PI*x/q.wavelength)),12);
    }
  });
  it('excludes zero propagation speed in integer-wavelength multi-solution cases',()=>{
    const ss=enumerateMultiSolutionSpeeds(2,0,.5,2);
    expect(ss.every(s=>s.speed>0)).toBe(true);
    expect(ss.filter(s=>s.direction==='right').map(s=>s.speed)).toEqual([4,8,12]);
    expect(ss.filter(s=>s.direction==='left').map(s=>s.speed)).toEqual([4,8,12]);
  });
});

it('flags exact source and Mach caustic rather than publishing sentinel zero measurements',()=>{
  const p={...baseParams,mode:'doppler' as const,probeX:0,probeY:0,sourceSpeedRatio:.5};
  const crossing=(p.probeX+2)/(p.wavelength*p.frequency*p.sourceSpeedRatio);
  const s=stepWaveCoupling(createInitialState(p),p,crossing).nextState,o=computeObservables(s,p);
  expect(s.probeSampleDefined).toBe(false);expect(o.probeSampleDefined).toBe(0);expect(o.probeY).toBeUndefined();expect(o.probeVy).toBeUndefined();
  const q={...p,sourceSpeedRatio:1.25,probeX:0,probeY:1};
  const caustic=(2+Math.sqrt(q.sourceSpeedRatio**2-1))/(q.wavelength*q.frequency*q.sourceSpeedRatio);
  const a=stepWaveCoupling(createInitialState(q),q,caustic).nextState;
  expect(a.probeSampleDefined).toBe(false);
});
it('separates signed geometric path difference from phase at P and catches both arrivals',()=>{
  const p={...baseParams,mode:'interference' as const,probeX:.5,probeY:0,phaseDiffDeg:180,causalFront:true};
  const r=stepWaveCoupling(createInitialState(p),p,1),o=computeObservables(r.nextState,p);
  expect(r.events.map(e=>e.time)).toEqual([.5,2.5/3]);
  expect(o.signedPathDifference).toBeCloseTo(-1,12);expect(o.pathDifference).toBeCloseTo(1,12);
  expect(o.phaseAtProbeDeg).toBeCloseTo(360,10);expect(o.analyticalAmplitude).toBeCloseTo(1,12);
});
it('catches corrupt probe acceleration and emission state, not just an internally computed SHO identity',()=>{
  const p={...baseParams,mode:'doppler' as const,probeX:0,probeY:1,sourceSpeedRatio:.5},i=createInitialState(p),s=stepWaveCoupling(i,p,1.3).nextState;
  expect(checkInvariants(s,i,p).every(r=>r.passed)).toBe(true);
  expect(checkInvariants({...s,probeAccelY:s.probeAccelY+1,emittedCount:s.emittedCount+1},i,p).filter(r=>!r.passed).length).toBeGreaterThanOrEqual(2);
});
