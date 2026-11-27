import {describe,expect,it} from 'vitest';
import {createWorldMapper,resolveInitialCameraTransform,resolvePluginParams,type Viewport} from '@physforge/sim-sdk';
import {emInductionDoubleRodPlugin as plugin} from './plugin.js';
import {createInitialState,stepInduction} from './engine.js';
import {inductionDiagramGeometry} from './diagramGeometry.js';
import {fitInductionViewport,inductionBoundsFit,inductionScreenBounds} from './viewport.js';

describe('H75 E04 physical circuit auto framing',()=>{
  it('keeps both actual rods and uniform geometry at multiple times in each preset',()=>{
    for(const preset of plugin.presets){
      const p=resolvePluginParams(plugin.paramSchema,preset.params);
      let s=createInitialState(p);
      for(let n=0;n<=360;n++){
        if([0,24,90,360].includes(n)){
          const original=JSON.stringify(s),geometry=inductionDiagramGeometry(s,p);
          for(const [width,height,right,bottom] of [[1392,852,1091,615],[976,720,675,500],[1100,583,1074,555],[700,500,674,472]] as const){
            const v:Viewport={width,height,dpr:1,...resolveInitialCameraTransform(plugin,p,width,height)};
            const safe={left:26,right,top:28,bottom};
            const next=fitInductionViewport(s,p,v,safe);
            expect(next,`${preset.id} at ${n/60}s ${width}`).not.toBeNull();
            expect(inductionBoundsFit(s,p,next!,safe)).toBe(true);
            expect(next!.scale).toBeLessThanOrEqual(v.scale);
            const mapper=createWorldMapper(next!);
            for(const seg of [geometry.rod1,...(geometry.double?[geometry.rod2]:[]),...geometry.rails]){
              for(const q of [seg.start,seg.end]){
                const screen=mapper.toScreen(q.x,q.y);
                expect(screen.x).toBeGreaterThan(safe.left);
                expect(screen.x).toBeLessThan(safe.right);
                expect(screen.y).toBeGreaterThan(safe.top);
                expect(screen.y).toBeLessThan(safe.bottom);
              }
            }
            expect(mapper.toX(geometry.x1)-mapper.toX(geometry.x2)).toBeCloseTo((geometry.x1-geometry.x2)*mapper.ppm,8);
            expect(fitInductionViewport(s,p,next!,safe)).toBe(next);
          }
          expect(JSON.stringify(s)).toBe(original);
          expect(inductionDiagramGeometry(s,p)).toEqual(geometry);
        }
        if(n<360)for(let i=0;i<4;i++)s=stepInduction(s,p,1/240).nextState;
      }
    }
  });
  it('reproduces the reported t=.4s clipping and refuses an impossible safe rectangle',()=>{
    const p=resolvePluginParams(plugin.paramSchema,plugin.presets[0]!.params);
    let s=createInitialState(p);for(let i=0;i<96;i++)s=stepInduction(s,p,1/240).nextState;
    const v:Viewport={width:1392,height:852,dpr:1,...resolveInitialCameraTransform(plugin,p,1392,852)};
    const safe={left:30,right:1091,top:28,bottom:615};
    expect(inductionBoundsFit(s,p,v,safe)).toBe(false);
    expect(inductionScreenBounds(s,p,v).left).toBeLessThan(0);
    expect(fitInductionViewport(s,p,v,safe)).not.toBeNull();
    expect(fitInductionViewport(s,p,v,{left:100,right:120,top:100,bottom:120})).toBeNull();
  });
});
