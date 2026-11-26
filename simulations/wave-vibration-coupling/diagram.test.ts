import {describe,it,expect} from 'vitest';
import {createInitialState,stepWaveCoupling,evaluateStandingWave,computeWaveSpeed,type WaveCouplingParams} from './engine.js';
import {waveVibrationCouplingPlugin} from './plugin.js';
import {waveDiagramScene,interferenceFringes,wavefrontPrimitives,fitWaveViewport,waveBoundsFit} from './diagram.js';
import {resolvePluginParams,type Viewport} from '@physforge/sim-sdk';
const get=(id:string)=>resolvePluginParams(waveVibrationCouplingPlugin.paramSchema,waveVibrationCouplingPlugin.presets.find(p=>p.id===id)!.params);
describe('W01 physical drawing and export',()=>{
  it('uses actual world loci for constructive and destructive fringes, not a generic midline',()=>{
    const p={...get('interference-in-phase'),phaseDiffDeg:75};
    const f=interferenceFringes(p,1);expect(f.length).toBeGreaterThan(3);
    for(const line of f)for(const q of line.points){
      const d=Math.hypot(q.x-p.sourceSeparation/2,q.y)-Math.hypot(q.x+p.sourceSeparation/2,q.y);
      expect(d).toBeCloseTo(line.delta,8);
      const A=2*p.amplitude*Math.abs(Math.cos((p.phaseDiffDeg*Math.PI/180-2*Math.PI*d/p.wavelength)/2));
      expect(A).toBeCloseTo(line.node?0:2*p.amplitude,8);
    }
    const causal=get('interference-causal-two-arrivals');
    expect(interferenceFringes(causal,.3)).toEqual([]);
    for(const line of interferenceFringes(causal,.9))for(const q of line.points)expect(Math.max(Math.hypot(q.x+2,q.y),Math.hypot(q.x-2,q.y))).toBeLessThanOrEqual(computeWaveSpeed(causal)*.9+1e-9);
  });
  it('clips physical circular fronts without moving their centers or changing their radius',()=>{
    const cx=-3,cy=.4,r=2,b={minX:-2,maxX:2,minY:-1,maxY:1};
    const q=wavefrontPrimitives(cx,cy,r,b);expect(q.length).toBeGreaterThan(0);
    for(const path of q)if(path.kind==='polyline')for(const a of path.points){
      expect(Math.hypot(a.x-cx,a.y-cy)).toBeCloseTo(r,9);expect(a.x).toBeGreaterThanOrEqual(b.minX-1e-9);expect(a.x).toBeLessThanOrEqual(b.maxX+1e-9);expect(a.y).toBeGreaterThanOrEqual(b.minY-1e-9);expect(a.y).toBeLessThanOrEqual(b.maxY+1e-9);
    }
  });
  it('has mode-specific export and exact wave sample geometry',()=>{
    const p=get('standing-wave-nodes'),s=stepWaveCoupling(createInitialState(p),p,.32).nextState;
    const marks=waveDiagramScene(s,p),main=marks.find(m=>m.tone==='wave'&&m.primitive.kind==='polyline')!.primitive;
    if(main.kind==='polyline')for(const q of main.points)expect(q.y).toBeCloseTo(evaluateStandingWave(q.x,s.t,p).y,12);
    for(const id of ['standing-wave-nodes','interference-in-phase','doppler-moving-source','transverse-slope-rule']){
      const pp=get(id),ss=stepWaveCoupling(createInitialState(pp),pp,.6).nextState,ir=waveVibrationCouplingPlugin.exportDiagramIR!(ss,pp);
      expect(ir.metadata?.mode).toBe(pp.mode);expect(ir.primitives.length).toBeGreaterThan(5);
      expect(ir.title).toContain(pp.mode==='doppler'?'运动波源':pp.mode==='interference'?'双波源':pp.mode==='standing'?'驻波':'行波');
    }
  });
  it('fits all modes into unobstructed safe rectangles without changing physical coordinates',()=>{
    for(const preset of waveVibrationCouplingPlugin.presets){
      const p=resolvePluginParams(waveVibrationCouplingPlugin.paramSchema,preset.params);
      for(const [width,height] of [[1440,900],[1024,768]]){
        const v:Viewport={width:width!,height:height!,dpr:1,scale:1,offsetX:0,offsetY:0},safe={left:30,right:v.width-290,top:30,bottom:v.height-190};
        const q=fitWaveViewport(p,v,safe);expect(q).not.toBeNull();expect(waveBoundsFit(p,q!,safe)).toBe(true);
      }
    }
  });
});
