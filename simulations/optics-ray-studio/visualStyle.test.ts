import { describe,expect,it } from 'vitest';
import { createWorldMapper,resolvePluginParams } from '@physforge/sim-sdk';
import { opticsRayStudioPlugin } from './plugin.js';
import { createInitialState,type OpticsParams } from './engine.js';
import { opticalScene } from './sceneGeometry.js';
import { heroBeamStyle,resolveOpticsSliceCamera,TIR_WINDOW } from './visualStyle.js';

describe('B3 hero presentation geometry',()=>{
  it('does not reserve the inspector twice in a standalone optical slice',()=>{
    for(const [width,height] of [[1100,819],[684,640],[800,520]] as const){
      for(const angle of [0,35,41,50,85]){
        const p=resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema,{sceneMode:'tir-interface',incidentAngleDeg:angle,n1:1.5,n2:1,animateSweep:false});
        const m=createWorldMapper({width,height,dpr:1,...resolveOpticsSliceCamera(p,width,height)});
        expect(m.toX(0)).toBeCloseTo(width/2,10);
        expect(m.toX(-TIR_WINDOW.halfWidth)).toBeGreaterThan(12);
        expect(m.toX(TIR_WINDOW.halfWidth)).toBeLessThan(width-12);
        for(const ray of createInitialState(p).rays){
          for(const q of [ray.from,ray.to]){
            const s=m.toScreen(q.x,q.y);
            expect(s.x).toBeGreaterThan(12);expect(s.x).toBeLessThan(width-12);
            expect(s.y).toBeGreaterThan(12);expect(s.y).toBeLessThan(height-12);
          }
          const a=m.toScreen(ray.from.x,ray.from.y),b=m.toScreen(ray.to.x,ray.to.y);
          expect(b.x-a.x).toBeCloseTo((ray.to.x-ray.from.x)*m.ppm,10);
          expect(b.y-a.y).toBeCloseTo(-(ray.to.y-ray.from.y)*m.ppm,10);
        }
      }
    }
  });
  it('fits all five other optical presets using their real shared scene bounds',()=>{
    for(const preset of opticsRayStudioPlugin.presets.slice(1)){
      const p=resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema,preset.params);
      const b=opticalScene(createInitialState(p),p).bounds;
      for(const [width,height] of [[1100,819],[684,640],[800,520]] as const){
        const m=createWorldMapper({width,height,dpr:1,...resolveOpticsSliceCamera(p,width,height)});
        expect((m.toX(b.minX)+m.toX(b.maxX))/2).toBeCloseTo(width/2,9);
        expect((m.toY(b.minY)+m.toY(b.maxY))/2).toBeCloseTo(height/2,9);
        expect(m.toX(b.minX)).toBeGreaterThan(12);expect(m.toX(b.maxX)).toBeLessThan(width-12);
        expect(m.toY(b.maxY)).toBeGreaterThan(12);expect(m.toY(b.minY)).toBeLessThan(height-12);
      }
    }
  });
  it('has no visual beam for zero/nonfinite power and preserves monotonic compressed brightness',()=>{
    expect(heroBeamStyle(0,1,false)).toBeNull();
    expect(heroBeamStyle(NaN,1,false)).toBeNull();
    expect(heroBeamStyle(1,0,false)).toBeNull();
    for(const paper of [false,true]){
      const low=heroBeamStyle(.04,1,paper)!,high=heroBeamStyle(.9,1,paper)!;
      for(const key of ['outerWidth','outerAlpha','transitionWidth','transitionAlpha','middleWidth','middleAlpha','innerWidth','innerAlpha','coreWidth','coreAlpha','highlightWidth','highlightAlpha'] as const)
        expect(high[key]).toBeGreaterThan(low[key]);
      expect(high.coreAlpha).toBeLessThanOrEqual(1);
      expect(heroBeamStyle(2,1,paper)).toEqual(heroBeamStyle(1,1,paper));
    }
  });
});
