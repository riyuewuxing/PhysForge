import { createWorldMapper, resolvePluginParams, type Viewport } from '@physforge/sim-sdk';
import { describe, expect, it } from 'vitest';
import { createInitialState, type Magnetic3dParams } from './engine.js';
import { em3dMagneticFieldsPlugin, magneticSliceInitialBounds, resolveMagneticSliceCamera } from './plugin.js';

const viewport: Viewport = { width: 680, height: 440, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };

function renderCoil(currentI: number) {
  const params: Magnetic3dParams = {
    ...resolvePluginParams(em3dMagneticFieldsPlugin.paramSchema, {
      geometryType: 'helmholtz-coil', currentI: 2, radiusR: 1
    }),
    currentI
  };
  const state = createInitialState(params);
  const arcs: Array<{ x: number; y: number; radius: number; filled:boolean }> = [];
  let closedPaths = 0;
  let lastArc:(typeof arcs)[number]|null=null;
  const context = {
    save() {}, restore() {}, beginPath() { lastArc=null; }, moveTo() {}, lineTo() {}, setLineDash() {},
    closePath() { closedPaths += 1; }, stroke() {}, fill() { if(lastArc)lastArc.filled=true; },
    arc(x: number, y: number, radius: number) { lastArc={x,y,radius,filled:false};arcs.push(lastArc); },
    measureText(text:string){return {width:8*text.length};},fillText(){}
  } as unknown as CanvasRenderingContext2D;
  em3dMagneticFieldsPlugin.renderCanvas?.(
    context, state, params, viewport, new Set(['conductors', 'fieldLines3d'])
  );
  return { arcs, closedPaths };
}

describe('em-3d-magnetic-fields 2D fallback', () => {
  it('marks opposite coil cross-sections with current direction and arrows each projected field line', () => {
    const mapper = createWorldMapper(viewport);
    const hasDotAt = (arcs: ReturnType<typeof renderCoil>['arcs'], x: number, y: number) =>
      arcs.some(arc => arc.filled && Math.hypot(arc.x - x, arc.y - y) < 1e-8);
    const top = mapper.toScreen(0.5, 1);
    const bottom = mapper.toScreen(0.5, -1);

    const positive = renderCoil(2);
    expect(hasDotAt(positive.arcs, top.x, top.y)).toBe(true);
    expect(hasDotAt(positive.arcs, bottom.x, bottom.y)).toBe(false);
    expect(positive.closedPaths).toBeGreaterThan(0);

    const reversed = renderCoil(-2);
    expect(hasDotAt(reversed.arcs, top.x, top.y)).toBe(false);
    expect(hasDotAt(reversed.arcs, bottom.x, bottom.y)).toBe(true);
  });
});

describe('E10 independent standalone framing',()=>{
  for(const geometryType of ['single-loop','helmholtz-coil','finite-solenoid','straight-wire','parallel-wires','uniform-helix'] as const){
    it('fits actual '+geometryType+' initial geometry on both canvas sizes',()=>{
      const p={...resolvePluginParams(em3dMagneticFieldsPlugin.paramSchema, {geometryType,currentI:2,radiusR:.7}),geometryType};
      const b=magneticSliceInitialBounds(p);
      for(const [width,height] of [[1100,580],[684,448]] as const){
        const camera=resolveMagneticSliceCamera(p,width,height);
        const m=createWorldMapper({width,height,dpr:1,...camera});
        const tl=m.toScreen(b.minX,b.maxY),br=m.toScreen(b.maxX,b.minY);
        expect(tl.x).toBeGreaterThanOrEqual(39.999);
        expect(br.x).toBeLessThanOrEqual(width-39.999);
        expect(tl.y).toBeGreaterThanOrEqual(31.999);
        expect(br.y).toBeLessThanOrEqual(height-31.999);
        expect((tl.x+br.x)/2).toBeCloseTo(width/2,8);
        expect((tl.y+br.y)/2).toBeCloseTo(height/2,8);
        if(geometryType==='uniform-helix')expect((m.toX(2.2)-m.toX(-2.2))/width).toBeGreaterThan(.55);
      }
    });
  }
  it('zero field keeps a useful camera reference without adding field geometry',()=>{
    const p=resolvePluginParams(em3dMagneticFieldsPlugin.paramSchema,{geometryType:'uniform-helix',uniformBz:0});
    const b=magneticSliceInitialBounds(p);
    expect(b.minX).toBeLessThanOrEqual(-2.38);
    expect(b.maxX).toBeGreaterThanOrEqual(2.38);
    const m=createWorldMapper({width:1100,height:580,dpr:1,...resolveMagneticSliceCamera(p,1100,580)});
    expect((m.toX(2.2)-m.toX(-2.2))/1100).toBeGreaterThan(.55);
  });
});
