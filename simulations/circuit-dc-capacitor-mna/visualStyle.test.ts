import {describe,expect,it} from 'vitest';
import {createWorldMapper,resolvePluginParams} from '@physforge/sim-sdk';
import {circuitDcCapacitorMnaPlugin,resolveCircuitSliceCamera} from './plugin.js';
import {lampDisplayLight} from './visualStyle.js';
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
