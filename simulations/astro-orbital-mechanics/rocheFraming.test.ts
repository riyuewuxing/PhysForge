import { createWorldMapper, resolvePluginParams, type Viewport } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { astroOrbitalMechanicsPlugin, binaryRocheFrameRadius, binaryRocheViewportFits, fitBinaryRocheViewport } from './plugin.js';
import { astroOrbitalPresets } from './presets.js';
import { createInitialState, extractRocheIsolines } from './engine.js';

describe('M10 binary workbench safe framing', () => {
  const params = resolvePluginParams(astroOrbitalMechanicsPlugin.paramSchema, astroOrbitalPresets[3]!.params);
  const layers = new Set(['orbit', 'rocheIsolines', 'corotatingView']);
  it('fits every sampled contour endpoint, including rotated frames, without modifying the state', () => {
    for (const q of [.01, .03, .4]) {
      const p = {...params, massRatioQ: q}, state = createInitialState(p), before = JSON.stringify(state);
      const radius = binaryRocheFrameRadius(state,p,layers);
      const points = extractRocheIsolines(q).flatMap(c => c.segments.flatMap(s => [s.a,s.b]));
      expect(points.length).toBeGreaterThan(100);
      for (const width of [976,1392]) {
        const vp: Viewport = {width,height:width===976?720:852,dpr:2,scale:1,offsetX:0,offsetY:0};
        const safe = {left:30,right:width-301,top:112,bottom:vp.height-230};
        const fitted = fitBinaryRocheViewport(vp,radius,safe)!;
        expect(fitted).not.toBeNull();
        expect(fitted.dpr).toBe(vp.dpr);
        expect(fitted.scale).toBeLessThanOrEqual((.42/.24)/2.6);
        expect(binaryRocheViewportFits(fitted,radius,safe)).toBe(true);
        const m = createWorldMapper(fitted);
        for (const theta of [0,.8,2.1]) for (const pt of points) {
          const xy = m.toScreen(pt.x*Math.cos(theta)-pt.y*Math.sin(theta),pt.x*Math.sin(theta)+pt.y*Math.cos(theta));
          expect(xy.x).toBeGreaterThanOrEqual(safe.left+28-1e-6);
          expect(xy.x).toBeLessThanOrEqual(safe.right-28+1e-6);
          expect(xy.y).toBeGreaterThanOrEqual(safe.top+28-1e-6);
          expect(xy.y).toBeLessThanOrEqual(safe.bottom-28+1e-6);
        }
      }
      expect(JSON.stringify(state)).toBe(before);
    }
  });
  it('rejects invalid radius and infeasible viewport without changing the input', () => {
    const vp: Viewport = {width:976,height:720,dpr:1,scale:1,offsetX:0,offsetY:0};
    const safe={left:30,right:50,top:112,bottom:490};
    expect(fitBinaryRocheViewport(vp,2,safe)).toBeNull();
    expect(fitBinaryRocheViewport(vp,NaN,{...safe,right:670})).toBeNull();
    expect(vp).toEqual({width:976,height:720,dpr:1,scale:1,offsetX:0,offsetY:0});
  });
});
