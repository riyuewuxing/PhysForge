import { resolvePluginParams } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { compRelativityQuantumTunnelingPlugin } from './plugin.js';
import { relativityQuantumPresets } from './presets.js';
import {
  createInitialState,
  TDSE_DX,
  TDSE_GRID_N,
  solveLorentzInterval,
  stepRelativityQuantum,
  type RelativityQuantumParams
} from './engine.js';

function getPreset(idx: number): RelativityQuantumParams {
  return resolvePluginParams(compRelativityQuantumTunnelingPlugin.paramSchema, relativityQuantumPresets[idx]!.params);
}

describe('comp-relativity-quantum-tunneling invariants (C03)', () => {
  it('conserves 1D Crank-Nicolson TDSE probability norm (< 1e-10) over 1000 steps', () => {
    const p = getPreset(0);
    let st = createInitialState(p);
    for (let i = 0; i < 1000; i++) {
      st = stepRelativityQuantum(st, p, 0.04).nextState;
    }
    expect(st.normDrift).toBeLessThan(1e-10);
  });

  it('produces sub-barrier quantum tunneling T > 0 when E0 < V0 and exponential decay with barrier width', () => {
    const thin = { ...getPreset(0), barrierWidth: 1.0 };
    const thick = { ...getPreset(0), barrierWidth: 2.2 };
    let stThin = createInitialState(thin);
    let stThick = createInitialState(thick);
    // k0 = 2.0 => v_g = 2.0, x0 = -18 => wavepacket hits and finishes tunneling by t = 15 (375 steps * 0.04)
    for (let i = 0; i < 375; i++) {
      stThin = stepRelativityQuantum(stThin, thin, 0.04).nextState;
      stThick = stepRelativityQuantum(stThick, thick, 0.04).nextState;
    }
    expect(stThin.transmissionProb).toBeGreaterThan(0.01);
    expect(stThick.transmissionProb).toBeGreaterThan(0);
    expect(stThick.transmissionProb).toBeLessThan(stThin.transmissionProb);
  });

  it('preserves Minkowski spacetime interval Δs² across Lorentz boosts (< 1e-10) and handles dt=0', () => {
    for (const beta of [-0.85, 0, 0.6, 0.92]) {
      const lor = solveLorentzInterval(beta, 4.5, 7.2);
      expect(lor.err).toBeLessThan(1e-10);
    }
    const p = getPreset(2);
    const st = createInitialState(p);
    expect(stepRelativityQuantum(st, p, 0).nextState.t).toBe(0);
  });
});

describe('F12 independently specified scattering and Lorentz evidence (prepared before implementation)',()=>{
  // The finite difference Hamiltonian uses zero-valued ghost cells outside the grid.
  const energy=(s:ReturnType<typeof createInitialState>)=>{
    let E=0;
    for(let j=0;j<TDSE_GRID_N;j++){
      const a=s.psiRe[j]!,b=s.psiIm[j]!,V=s.potential[j]!;
      const Ha=(2*a-(s.psiRe[j-1]??0)-(s.psiRe[j+1]??0))/(2*TDSE_DX**2)+V*a;
      const Hb=(2*b-(s.psiIm[j-1]??0)-(s.psiIm[j+1]??0))/(2*TDSE_DX**2)+V*b;
      E+=(a*Ha+b*Hb)*TDSE_DX;
    }
    return E;
  };
  it('matches the exact discrete free eigenstate Cayley phase with zero ghost boundaries',()=>{
    const p={...getPreset(0),barrierHeightV0:0},base=createInitialState(p),n=31;
    const q=n*Math.PI/(TDSE_GRID_N+1),E=(1-Math.cos(q))/TDSE_DX**2;
    const a=Float64Array.from({length:TDSE_GRID_N},(_,j)=>Math.sin(q*(j+1))*Math.sqrt(2/((TDSE_GRID_N+1)*TDSE_DX)));
    const b=new Float64Array(TDSE_GRID_N),dt=.04,phase=-2*Math.atan(dt*E/2);
    const s=stepRelativityQuantum({...base,psiRe:a,psiIm:b},p,dt).nextState;
    for(let j=0;j<TDSE_GRID_N;j++){expect(s.psiRe[j]).toBeCloseTo(a[j]!*Math.cos(phase),10);expect(s.psiIm[j]).toBeCloseTo(a[j]!*Math.sin(phase),10);}
    expect(s.totalNorm).toBeCloseTo(1,11);
  });
  it('keeps the selected Lorentz event a static analytic comparison instead of inventing flight time',()=>{
    const p=getPreset(2),s=createInitialState(p),plugin=compRelativityQuantumTunnelingPlugin;
    const semantics=plugin.timeSemantics;
    expect(typeof semantics==='function'?semantics(p):semantics).toBe('static-analytic');
    const r=stepRelativityQuantum(s,p,2);
    expect(r.nextState.t).toBe(0);expect(r.advancedTime).toBe(0);expect(r.halt).toBe(true);
  });
  it('conserves an independently calculated discrete Hamiltonian expectation under static V',()=>{
    const p={...getPreset(0),barrierWidth:1.6,packetSigma:2.2};
    let s=createInitialState(p);const E=energy(s);
    for(let i=0;i<450;i++)s=stepRelativityQuantum(s,p,.04).nextState;
    expect(energy(s)).toBeCloseTo(E,9);
    expect(s.totalNorm).toBeCloseTo(1,10);
  });
  for(const shape of ['single-barrier','double-barrier','potential-well'] as const){
    it('partitions actual grid support consistently at t=0 and after evolution: '+shape,()=>{
      const p={...getPreset(0),potentialShape:shape,barrierWidth:3.8,packetSigma:5.8};
      let s=createInitialState(p);
      for(let k=0;k<2;k++){
        const support=Array.from(s.potential).flatMap((v,j)=>v!==0?[j]:[]);
        expect(support.length).toBeGreaterThan(0);
        const first=support[0]!,last=support.at(-1)!;
        let left=0,inside=0,right=0;
        for(let j=0;j<TDSE_GRID_N;j++){
          const q=(s.psiRe[j]!**2+s.psiIm[j]!**2)*TDSE_DX;
          if(j<first)left+=q;else if(j>last)right+=q;else inside+=q;
        }
        expect(s.reflectionProb).toBeCloseTo(left,12);
        expect(s.transmissionProb).toBeCloseTo(right,12);
        expect(s.totalNorm-left-right).toBeCloseTo(inside,12);
        expect(left+inside+right).toBeCloseTo(s.totalNorm,12);
        s=stepRelativityQuantum(s,p,.04).nextState;
      }
    });
  }
  it('inverts signed Lorentz boosts and preserves null intervals for both light directions',()=>{
    for(const beta of [-.95,-.4,0,.4,.95]){
      for(const [x,ct] of [[4.5,7.2],[-5,5],[5,5],[4,-1]]){
        const a=solveLorentzInterval(beta,x!,ct!),b=solveLorentzInterval(-beta,a.xPrime,a.ctPrime);
        expect(b.xPrime).toBeCloseTo(x!,10);expect(b.ctPrime).toBeCloseTo(ct!,10);
        expect(a.s2Prime).toBeCloseTo(a.s2,10);
      }
    }
  });
  it('keeps one idle event label and separates the twin legend from its time axis',()=>{
    const p=getPreset(2),s=createInitialState(p),plugin=compRelativityQuantumTunnelingPlugin;
    const d=plugin.exportDiagramIR!(s,p),h=plugin.getControlHandles!(s,p).find(v=>v.id==='spacetime-event');
    expect(h?.showWhenIdle).toBe(false);
    const labels=d.primitives.flatMap(v=>v.kind==='text'?[v]:[]);
    expect(labels.filter(v=>v.text==='E')).toHaveLength(1);
    const axis=labels.find(v=>v.text==='ct'&&v.x>0),note=labels.find(v=>v.text.startsWith('瞬时反向'));
    expect(axis).toBeDefined();expect(note).toBeDefined();expect(note!.y-axis!.y).toBeGreaterThan(.25);
    expect(h?.onDrag(h.position)).toMatchObject({eventX:p.eventX,eventCt:p.eventCt});
  });
  it('retains measurable right-region probability before finite-box edge interaction',()=>{
    const p=getPreset(0),initial=createInitialState(p);
    let s=initial;for(let i=0;i<375;i++)s=stepRelativityQuantum(s,p,.04).nextState;
    expect(s.transmissionProb).toBeGreaterThan(.005);
    expect(s.transmissionProb).toBeLessThan(.95);
    expect(s.maxBoundaryProb).toBeLessThan(.01);
    expect(s.totalNorm).toBeCloseTo(1,10);expect(energy(s)).toBeCloseTo(energy(initial),9);
  });
  it('exports all four spacetime axes, null rays and the actual event rather than a generic empty cone',()=>{
    const p={...getPreset(2),lorentzBeta:-.65,eventX:2.5,eventCt:4.5},s=createInitialState(p);
    const d=compRelativityQuantumTunnelingPlugin.exportDiagramIR!(s,p);
    const lines=d.primitives.flatMap(v=>v.kind==='line'||v.kind==='arrow'?[v]:[]);
    const slopes=lines.filter(v=>Math.abs(v.x2-v.x1)>1e-9).map(v=>(v.y2-v.y1)/(v.x2-v.x1));
    expect(slopes.some(v=>Math.abs(v-p.lorentzBeta)<1e-8)).toBe(true);
    expect(slopes.some(v=>Math.abs(v-1/p.lorentzBeta)<1e-8)).toBe(true);
    expect(slopes.some(v=>Math.abs(v-1)<1e-8)).toBe(true);
    expect(slopes.some(v=>Math.abs(v+1)<1e-8)).toBe(true);
    expect(d.primitives.some(v=>v.kind==='circle'&&v.fill)).toBe(true);
  });
  it('uses only mode-relevant controls and telemetry, and never labels an incoming packet as already reflected',()=>{
    const plugin=compRelativityQuantumTunnelingPlugin,td=getPreset(0),sr=getPreset(2);
    const tf=plugin.getParamFields?.(td)??plugin.paramSchema,sf=plugin.getParamFields?.(sr)??plugin.paramSchema;
    expect(tf.map(f=>f.key)).not.toContain('lorentzBeta');
    expect(sf.map(f=>f.key)).not.toContain('barrierHeightV0');
    const tc=plugin.getTelemetryChannels?.(td)??plugin.telemetryChannels,sc=plugin.getTelemetryChannels?.(sr)??plugin.telemetryChannels;
    expect(tc.map(c=>c.key)).not.toContain('gammaFactor');
    expect(sc.map(c=>c.key)).not.toContain('reflectionProb');
    expect(tc.find(c=>c.key==='reflectionProb')?.label).not.toMatch(/反射率/);
  });
  it('exports actual potential as well as full-resolution probability density in the tunneling diagram',()=>{
    const p={...getPreset(0),potentialShape:'double-barrier' as const},s=createInitialState(p);
    const d=compRelativityQuantumTunnelingPlugin.exportDiagramIR!(s,p);
    const paths=d.primitives.flatMap(v=>v.kind==='polyline'||v.kind==='trajectory'?[v.points]:[]);
    expect(paths.some(q=>q.length===TDSE_GRID_N)).toBe(true);
    expect(d.primitives.some(v=>v.kind==='text'&&v.text.includes('V(x)'))).toBe(true);
    expect(d.primitives.some(v=>v.kind==='text'&&v.text.includes('概率密度'))).toBe(true);
  });
});
