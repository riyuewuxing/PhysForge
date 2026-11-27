import {describe,expect,it,vi} from 'vitest';
import {createWorldMapper,resolvePluginParams} from '@physforge/sim-sdk';
import {circuitDcCapacitorMnaPlugin,resolveCircuitSliceCamera} from './plugin.js';
import {lampDisplayLight,lampCrossStrokes,drawLampCross} from './visualStyle.js';
import type {CircuitParams} from './engine.js';
import {dividerDefaultCamera} from './dividerView.js';
import {topologyCamera} from './topologyView.js';

describe('B2 presentation-only camera and lamp material',()=>{
  it('does not double-reserve the inspector in an isolated slice, for all presets',()=>{
    for(const preset of circuitDcCapacitorMnaPlugin.presets){
      const p=resolvePluginParams<CircuitParams>(circuitDcCapacitorMnaPlugin.paramSchema,preset.params);
      for(const [width,height] of [[1100,819],[684,640],[800,520]] as const){
        const vp={width,height,dpr:1,...resolveCircuitSliceCamera(p,width,height)};
        const m=createWorldMapper(vp);
        const divider=p.topology==='divider-lamp',left=divider?-2.05:-1.7,right=divider?2.20:1.7;
        expect((m.toX(left)+m.toX(right))/2).toBeCloseTo(width/2,10);
        expect(m.toX(left)).toBeGreaterThan(15);expect(m.toX(right)).toBeLessThan(width-15);
        expect(m.toY(1.427)).toBeGreaterThan(12);expect(m.toY(-1.46)).toBeLessThan(height-12);
        expect(m.toX(1)-m.toX(0)).toBeCloseTo(m.toY(0)-m.toY(1),10);
      }
    }
  });
  it('retains online camera reservation while using the measured canvas offline',()=>{
    for(const fn of [dividerDefaultCamera,topologyCamera]){
      const on=fn(1100,819),off=fn(1100,819,false);
      expect(off.offsetRatioX).toBeGreaterThan(on.offsetRatioX);
      expect(off.scale).toBeGreaterThanOrEqual(on.scale);
      expect(fn(684,640,false).scale).toBe(fn(684,640).scale);
    }
  });
  it('has no emission at zero or invalid power and monotonic compressed brightness',()=>{
    expect(lampDisplayLight(0)).toBe(0);expect(lampDisplayLight(-1)).toBe(0);
    expect(lampDisplayLight(NaN)).toBe(0);expect(lampDisplayLight(Infinity)).toBe(0);
    expect(lampDisplayLight(.1)).toBeGreaterThan(0);expect(lampDisplayLight(2)).toBeGreaterThan(lampDisplayLight(.1));
    expect(lampDisplayLight(8)).toBe(1);expect(lampDisplayLight(80)).toBe(1);
  });
});

describe('H73 B2 recognisable lamp mark',()=>{
  it('centers the two diagonals inside the existing ring, not on adjacent wires',()=>{
    const q={x:100,y:200},r=36,strokes=lampCrossStrokes(q,r);
    expect(strokes).toHaveLength(2);
    for(const [a,b] of strokes){expect((a.x+b.x)/2).toBeCloseTo(q.x,12);expect((a.y+b.y)/2).toBeCloseTo(q.y,12);expect(Math.hypot(a.x-q.x,a.y-q.y)).toBeLessThan(r);expect(Math.hypot(b.x-q.x,b.y-q.y)).toBeLessThan(r);}
    expect(lampCrossStrokes(q,0)).toEqual([]);
    expect(lampCrossStrokes(q,NaN)).toEqual([]);
  });
  it('draws the exact same cross at zero power and uses warm highlight only when powered',()=>{
    const make=()=>({save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),shadowBlur:0,strokeStyle:'',globalAlpha:1});
    const dark=make(),lit=make(),paper=make();const q={x:100,y:200};
    drawLampCross(dark as unknown as CanvasRenderingContext2D,q,30,0,false);
    drawLampCross(lit as unknown as CanvasRenderingContext2D,q,30,2,false);
    drawLampCross(paper as unknown as CanvasRenderingContext2D,q,30,2,true);
    expect(dark.moveTo.mock.calls).toEqual(lit.moveTo.mock.calls);expect(dark.lineTo.mock.calls).toEqual(lit.lineTo.mock.calls);
    expect(dark.stroke).toHaveBeenCalledTimes(1);expect(dark.shadowBlur).toBe(0);expect(dark.strokeStyle).toBe('#cbd5e1');
    expect(lit.stroke).toHaveBeenCalledTimes(2);expect(paper.stroke).toHaveBeenCalledTimes(1);expect(paper.shadowBlur).toBe(0);
  });
});
